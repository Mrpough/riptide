import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type { Dispatcher } from 'undici'
import { categoryFolder, detectCategory } from '@shared/categories'
import { MAX_CONNECTIONS, MIN_CONNECTIONS, TUNING } from '@shared/defaults'
import { isStreamKind, kindFromMime, kindFromUrl } from '@shared/stream'
import type {
  AddDownloadInput,
  AddResult,
  DownloadItem,
  DownloadView,
  Notice,
  ProbePreview,
  Settings,
  StorageCategoryId
} from '@shared/types'
import type { TransferStats } from '@shared/channels'
import type { Logger } from '../logger'
import { resolveFileName, sanitizeFileName } from '../download/filename'
import { createDispatcher, probe } from '../download/net'
import { reconcileSegments } from '../download/segments'
import { SpeedLimiter } from '../download/speed-limiter'
import { StreamTask } from '../download/stream-task'
import { DownloadTask, type TaskHost, type TrackedTask } from '../download/task'
import type { SettingsService } from '../settings'
import type { JsonStore } from '../store'
import { clamp, createId, errorMessage, partPath, uniqueFileNameOnDisk } from '../utils'

/** Project a full record down to what the renderer needs. */
export function toView(item: DownloadItem): DownloadView {
  const segmentProgress = item.segments.map((s) => {
    const capacity = s.end >= s.start ? s.end - s.start + 1 : s.downloaded
    if (capacity <= 0) return 0
    return Math.max(0, Math.min(1, s.downloaded / capacity))
  })
  return {
    id: item.id,
    url: item.url,
    finalUrl: item.finalUrl,
    referrer: item.referrer,
    fileName: item.fileName,
    saveDir: item.saveDir,
    filePath: item.filePath,
    category: item.category,
    kind: item.kind,
    stream: item.stream,
    status: item.status,
    size: item.size,
    downloaded: item.downloaded,
    speed: item.speed,
    eta: item.eta,
    connections: item.connections,
    segmentProgress,
    resumable: item.resumable,
    supportsRanges: item.supportsRanges,
    mimeType: item.mimeType,
    error: item.error,
    priority: item.priority,
    createdAt: item.createdAt,
    startedAt: item.startedAt,
    completedAt: item.completedAt
  }
}

export class DownloadManager implements TaskHost {
  readonly limiter = new SpeedLimiter()
  readonly log: Logger

  private readonly settingsService: SettingsService
  private readonly store: JsonStore<DownloadItem[]>
  private dispatcherHandle: { dispatcher: Dispatcher; close: () => Promise<void> }
  private disconnecting: Promise<void> | null = null

  private items = new Map<string, DownloadItem>()
  private tasks = new Map<string, TrackedTask>()

  private persistTimer: NodeJS.Timeout | null = null
  private statsTimer: NodeJS.Timeout | null = null
  private needsPersist = false
  private disposed = false

  onItem?: (item: DownloadView) => void
  onList?: (items: DownloadView[]) => void
  onRemoved?: (ids: string[]) => void
  onStats?: (stats: TransferStats) => void
  onCompleted?: (item: DownloadView) => void
  onNotice?: (notice: Notice) => void

  constructor(settings: SettingsService, store: JsonStore<DownloadItem[]>, logger: Logger) {
    this.settingsService = settings
    this.store = store
    this.log = logger
    this.dispatcherHandle = createDispatcher(settings.get())
  }

  // ---- lifecycle ---------------------------------------------------------

  async init(): Promise<void> {
    const raw = await this.store.load()
    const loaded = Array.isArray(raw) ? raw : []
    const s = this.settingsService.get()

    for (const item of loaded) {
      if (!item || !item.id || !item.url) continue

      item.speed = 0
      item.eta = null
      if (!item.kind) item.kind = 'http'
      if (isStreamKind(item.kind) && !item.stream) item.stream = { initDone: false }
      if (!Array.isArray(item.segments)) item.segments = []
      if (item.segments.length > 0) {
        item.segments = reconcileSegments(item.segments, item.size)
        // Stream progress is tracked per segment, so the byte total stays authoritative.
        if (item.kind === 'http') {
          item.downloaded = item.segments.reduce((sum, seg) => sum + seg.downloaded, 0)
        }
      }

      if (item.status === 'downloading' || item.status === 'connecting') {
        item.status = s.autoStart && item.resumable !== false ? 'queued' : 'paused'
      }
      this.items.set(item.id, item)
    }

    this.limiter.setRate(s.speedLimit)
    this.startTimers()
    this.emitList()
    this.log.info(`restored ${this.items.size} download(s)`)
    this.pump()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    if (this.persistTimer) clearInterval(this.persistTimer)
    if (this.statsTimer) clearInterval(this.statsTimer)
    for (const task of this.tasks.values()) task.stop()
    await this.persist(true)
    await this.disconnect()
  }

  private disconnect(): Promise<void> {
    if (!this.disconnecting) {
      this.disconnecting = this.dispatcherHandle.close().catch(() => undefined)
    }
    return this.disconnecting
  }

  private startTimers(): void {
    this.persistTimer = setInterval(() => void this.persist(false), TUNING.persistIntervalMs)
    this.statsTimer = setInterval(() => this.emitStats(), TUNING.statsIntervalMs)
  }

  // ---- queries -----------------------------------------------------------

  list(): DownloadView[] {
    return [...this.items.values()].map(toView)
  }

  get(id: string): DownloadItem | undefined {
    return this.items.get(id)
  }

  // ---- additions ---------------------------------------------------------

  async add(input: AddDownloadInput): Promise<AddResult> {
    const url = (input.url ?? '').trim()
    if (!url) return { ok: false, error: 'A download URL is required' }

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { ok: false, error: 'That is not a valid URL' }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'Only http:// and https:// links are supported' }
    }

    const s = this.settingsService.get()
    const explicitName = input.fileName?.trim()
    const guessedName = explicitName || safeDecode(basename(parsed.pathname)) || parsed.hostname
    const category = input.category ?? detectCategory(guessedName, undefined)
    const kind = input.kind ?? kindFromUrl(url)

    const item: DownloadItem = {
      id: createId(),
      url,
      referrer: input.referrer,
      fileName: sanitizeFileName(guessedName, 'download'),
      customName: Boolean(explicitName),
      saveDir: input.saveDir?.trim() || this.resolveDir(category),
      filePath: '',
      category,
      kind,
      status: input.startNow === false ? 'stopped' : 'queued',
      size: -1,
      downloaded: 0,
      speed: 0,
      eta: null,
      connections: clamp(input.connections ?? s.defaultConnections, MIN_CONNECTIONS, MAX_CONNECTIONS),
      segments: [],
      resumable: true,
      supportsRanges: false,
      requestHeaders: input.headers,
      priority: 0,
      createdAt: Date.now()
    }

    if (isStreamKind(kind)) item.stream = { initDone: false }

    const taken = new Set<string>()
    for (const existing of this.items.values()) taken.add(existing.filePath.toLowerCase())
    item.fileName = await uniqueFileNameOnDisk(item.saveDir, item.fileName, taken)
    item.filePath = join(item.saveDir, item.fileName)

    this.items.set(item.id, item)
    this.emitItem(item)
    this.emitList()
    this.schedulePersist()
    this.pump()

    // Enrich name/size/category in the background so the row fills out.
    if (!explicitName) void this.enrich(item.id)

    return { ok: true, id: item.id }
  }

  private async enrich(id: string): Promise<void> {
    const item = this.items.get(id)
    if (!item || item.downloaded > 0 || item.status === 'completed') return
    if (item.size > 0) return
    // Streaming items resolve their own metadata from the manifest.
    if (isStreamKind(item.kind)) return
    try {
      const preview = await this.probeUrl(item.url, item.requestHeaders)
      const current = this.items.get(id)
      if (!current || current.downloaded > 0 || isStreamKind(current.kind)) return
      current.finalUrl = preview.url
      current.mimeType = preview.mimeType
      const detected = !this.tasks.get(id)?.isRunning ? kindFromMime(preview.mimeType) : null
      if (detected) {
        // A playlist URL that did not look like one: switch to the stream engine.
        current.kind = detected
        current.stream = { initDone: false }
        current.size = -1
        current.supportsRanges = false
        current.resumable = true
        this.tasks.delete(id)
        this.emitItem(current)
        this.schedulePersist()
        return
      }
      current.size = preview.size
      current.supportsRanges = preview.supportsRanges
      current.resumable = preview.supportsRanges && preview.size > 0
      if (!current.customName && preview.fileName) {
        current.fileName = sanitizeFileName(preview.fileName, current.fileName)
        current.filePath = join(current.saveDir, current.fileName)
      }
      if (current.category === 'other') current.category = preview.category
      this.emitItem(current)
      this.schedulePersist()
    } catch {
      /* enrichment is best-effort; the download itself will report errors */
    }
  }

  async addBatch(inputs: AddDownloadInput[]): Promise<AddResult[]> {
    const results: AddResult[] = []
    for (const input of inputs) results.push(await this.add(input))
    return results
  }

  async probeUrl(url: string, headers?: Record<string, string>): Promise<ProbePreview> {
    const s = this.settingsService.get()
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(new Error('Probe timed out')),
      TUNING.probeTimeoutMs
    )
    try {
      const result = await probe({
        url,
        userAgent: s.userAgent,
        dispatcher: this.dispatcher(),
        signal: controller.signal,
        headers
      })
      const fileName = resolveFileName({
        contentDisposition: result.contentDisposition,
        url: result.url,
        mime: result.mimeType
      })
      return {
        url: result.url,
        fileName,
        size: result.size,
        mimeType: result.mimeType,
        supportsRanges: result.supportsRanges,
        category: detectCategory(fileName, result.mimeType)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  // ---- controls ----------------------------------------------------------

  pause(id: string): void {
    const item = this.items.get(id)
    if (!item) return
    const task = this.tasks.get(id)
    if (task?.isRunning) {
      task.pause()
      return
    }
    if (item.status === 'queued' || item.status === 'downloading' || item.status === 'connecting') {
      item.status = 'paused'
      item.speed = 0
      item.eta = null
      this.emitItem(item)
      this.schedulePersist()
      this.pump()
    }
  }

  resume(id: string): void {
    const item = this.items.get(id)
    if (!item || item.status === 'completed') return
    item.error = undefined
    item.status = 'queued'
    this.emitItem(item)
    this.schedulePersist()
    this.pump()
  }

  restart(id: string): void {
    const item = this.items.get(id)
    if (!item) return
    const task = this.tasks.get(id)
    if (task?.isRunning) {
      task.stop()
      setTimeout(() => this.startRestart(id), 200)
      return
    }
    this.startRestart(id)
  }

  private startRestart(id: string): void {
    const item = this.items.get(id)
    if (!item) return
    const task = this.ensureTask(item)
    task.resetProgress()
    item.status = 'queued'
    item.error = undefined
    this.emitItem(item)
    this.schedulePersist()
    void task.start({ restart: true })
  }

  stop(id: string): void {
    const item = this.items.get(id)
    if (!item) return
    const task = this.tasks.get(id)
    if (task?.isRunning) {
      task.stop()
      return
    }
    item.status = 'stopped'
    item.speed = 0
    item.eta = null
    this.emitItem(item)
    this.schedulePersist()
    this.pump()
  }

  async remove(id: string, deleteFile = false): Promise<boolean> {
    const item = this.items.get(id)
    if (!item) return false
    const task = this.tasks.get(id)
    if (task?.isRunning) {
      task.stop()
      await delay(150)
    }
    this.tasks.delete(id)
    this.items.delete(id)

    if (deleteFile) {
      await fs.rm(item.filePath, { force: true }).catch(() => undefined)
      await fs.rm(partPath(item.filePath), { force: true }).catch(() => undefined)
    }

    this.onRemoved?.([id])
    this.onList?.(this.list())
    this.schedulePersist()
    this.pump()
    return true
  }

  async removeMany(ids: string[], deleteFiles = false): Promise<number> {
    let count = 0
    for (const id of ids) if (await this.remove(id, deleteFiles)) count += 1
    return count
  }

  async removeCompleted(deleteFiles = false): Promise<number> {
    const ids = [...this.items.values()]
      .filter((item) => item.status === 'completed')
      .map((item) => item.id)
    return this.removeMany(ids, deleteFiles)
  }

  pauseAll(): void {
    for (const item of [...this.items.values()]) {
      if (item.status === 'queued' || item.status === 'downloading' || item.status === 'connecting') {
        this.pause(item.id)
      }
    }
  }

  resumeAll(): void {
    for (const item of [...this.items.values()]) {
      if (item.status === 'paused' || item.status === 'stopped' || item.status === 'error') {
        this.resume(item.id)
      }
    }
  }

  stopAll(): void {
    for (const item of [...this.items.values()]) {
      if (item.status === 'downloading' || item.status === 'connecting' || item.status === 'queued') {
        this.stop(item.id)
      }
    }
  }

  startNext(): void {
    const next = [...this.items.values()].find(
      (item) => item.status === 'stopped' || item.status === 'paused'
    )
    if (next) this.resume(next.id)
  }

  setPriority(id: string, priority: number): void {
    const item = this.items.get(id)
    if (!item) return
    item.priority = Math.round(priority)
    this.emitItem(item)
    this.schedulePersist()
    this.pump()
  }

  reorder(ids: string[]): void {
    const reordered = new Map<string, DownloadItem>()
    for (const id of ids) {
      const item = this.items.get(id)
      if (item) reordered.set(id, item)
    }
    for (const [id, item] of this.items) if (!reordered.has(id)) reordered.set(id, item)
    this.items = reordered
    this.onList?.(this.list())
    this.schedulePersist()
  }

  setSpeedLimit(bytesPerSecond: number): void {
    this.limiter.setRate(bytesPerSecond)
  }

  refreshDispatcher(): void {
    const previous = this.dispatcherHandle
    this.dispatcherHandle = createDispatcher(this.settingsService.get())
    void previous.close().catch(() => undefined)
  }

  async totalDiskUsage(): Promise<{ total: number; free: number } | null> {
    try {
      const stats = await fs.statfs(this.settingsService.get().downloadDir)
      return { total: Number(stats.blocks) * Number(stats.bsize), free: Number(stats.bavail) * Number(stats.bsize) }
    } catch {
      return null
    }
  }

  async fileExists(path: string): Promise<boolean> {
    try {
      await fs.access(path)
      return true
    } catch {
      return false
    }
  }

  // ---- queue -------------------------------------------------------------

  private pump(): void {
    if (this.disposed) return
    const s = this.settingsService.get()
    let active = this.countActive()
    if (active >= s.maxConcurrent) return

    const queued = [...this.items.values()]
      .filter((item) => item.status === 'queued')
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)

    for (const item of queued) {
      if (active >= s.maxConcurrent) break
      active += 1
      void this.ensureTask(item).start()
    }
  }

  private countActive(): number {
    let active = 0
    for (const item of this.items.values()) {
      if (item.status === 'downloading' || item.status === 'connecting') active += 1
    }
    for (const task of this.tasks.values()) {
      if (task.isRunning && task.item.status === 'queued') active += 1
    }
    return active
  }

  private ensureTask(item: DownloadItem): TrackedTask {
    let task = this.tasks.get(item.id)
    if (!task) {
      task = item.kind === 'http' ? new DownloadTask(item, this) : new StreamTask(item, this)
      this.tasks.set(item.id, task)
    }
    return task
  }

  // ---- TaskHost ----------------------------------------------------------

  dispatcher(): Dispatcher {
    return this.dispatcherHandle.dispatcher
  }

  settings(): Settings {
    return this.settingsService.get()
  }

  resolveDir(category: StorageCategoryId): string {
    const s = this.settingsService.get()
    const override = s.categoryDirs[category]
    if (override && override.trim()) return override
    if (s.categoryFolders) return join(s.downloadDir, categoryFolder(category))
    return s.downloadDir
  }

  takenPaths(excludeId: string): Set<string> {
    const set = new Set<string>()
    for (const [id, item] of this.items) {
      if (id === excludeId) continue
      set.add(item.filePath.toLowerCase())
    }
    return set
  }

  onProgress(task: TrackedTask): void {
    this.onItem?.(toView(task.item))
  }

  onStateChange(task: TrackedTask): void {
    this.emitItem(task.item)
    this.schedulePersist()
    this.pump()
  }

  onFinished(task: TrackedTask): void {
    if (task.item.status === 'completed') {
      this.onCompleted?.(toView(task.item))
    }
    this.schedulePersist()
    this.pump()
    this.emitStats()
  }

  private emitItem(item: DownloadItem): void {
    this.onItem?.(toView(item))
  }

  private emitList(): void {
    this.onList?.(this.list())
  }

  private emitStats(): void {
    const s = this.settingsService.get()
    let totalSpeed = 0
    let activeCount = 0
    let queuedCount = 0
    let completedCount = 0
    let totalConnections = 0

    for (const item of this.items.values()) {
      if (item.status === 'downloading' || item.status === 'connecting') {
        activeCount += 1
        totalSpeed += item.speed
      } else if (item.status === 'queued') {
        queuedCount += 1
      } else if (item.status === 'completed') {
        completedCount += 1
      }
      totalConnections += this.tasks.get(item.id)?.openConnections ?? 0
    }

    this.onStats?.({
      totalSpeed,
      activeCount,
      queuedCount,
      completedCount,
      totalConnections,
      speedLimit: s.speedLimit
    })
  }

  // ---- persistence -------------------------------------------------------

  private schedulePersist(): void {
    this.needsPersist = true
  }

  async persist(force = false): Promise<void> {
    if (!force && !this.needsPersist) return
    this.needsPersist = false
    this.store.set([...this.items.values()])
    await this.store
      .flush()
      .catch((err) => this.log.error('failed to persist downloads', errorMessage(err)))
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
