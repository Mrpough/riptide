import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Dispatcher } from 'undici'
import { TUNING } from '@shared/defaults'
import type { DownloadItem, DownloadSegment, Settings, StorageCategoryId } from '@shared/types'
import type { Logger } from '../logger'
import { errorMessage, isAbortError, pathExists, sleep, uniqueFileNameOnDisk } from '../utils'
import { resolveFileName } from './filename'
import { buildBaseHeaders, HttpError, httpStatusMessage, openStream, probe } from './net'
import { allSegmentsDone, planSegments, singleSegment, sumDownloaded } from './segments'
import type { SpeedLimiter } from './speed-limiter'

/** Server ignored our Range header and streamed the whole file. */
export class RangeUnsupportedError extends Error {
  constructor() {
    super('Server does not honor byte-range requests')
    this.name = 'RangeUnsupportedError'
  }
}

/** The remote file changed since we recorded progress. */
export class RemoteChangedError extends Error {
  constructor() {
    super('The remote file changed since the download started')
    this.name = 'RemoteChangedError'
  }
}

/** The task surface the manager drives and observes, whatever the transport. */
export interface TrackedTask {
  readonly id: string
  readonly item: DownloadItem
  readonly isRunning: boolean
  readonly openConnections: number
  start(options?: { restart?: boolean }): Promise<void>
  pause(): void
  stop(): void
  resetProgress(): void
}

export interface TaskHost {
  limiter: SpeedLimiter
  dispatcher(): Dispatcher
  settings(): Settings
  resolveDir(category: StorageCategoryId): string
  takenPaths(excludeId: string): Set<string>
  onProgress(task: TrackedTask): void
  onStateChange(task: TrackedTask): void
  onFinished(task: TrackedTask): void
  log: Logger
}

const FATAL_STATUS = new Set([400, 401, 403, 404, 405, 409, 410, 451])

export class DownloadTask implements TrackedTask {
  readonly id: string
  item: DownloadItem
  private readonly host: TaskHost

  private runController: AbortController | null = null
  private fileHandle: FileHandle | null = null
  private intent: 'pause' | 'stop' | null = null
  private activeSegments = 0

  private lastEmitAt = 0
  private lastSampleAt = 0
  private lastSampleBytes = 0
  private emaSpeed = 0

  constructor(item: DownloadItem, host: TaskHost) {
    this.id = item.id
    this.item = item
    this.host = host
  }

  get isRunning(): boolean {
    return this.runController !== null
  }

  get openConnections(): number {
    return this.activeSegments
  }

  async start(options: { restart?: boolean } = {}): Promise<void> {
    if (this.runController) return

    if (options.restart) this.resetProgress()

    if (
      this.item.size > 0 &&
      this.item.downloaded >= this.item.size &&
      allSegmentsDone(this.item.segments)
    ) {
      this.setStatus('completed')
      this.host.onStateChange(this)
      return
    }

    this.intent = null
    this.item.error = undefined
    this.runController = new AbortController()
    this.activeSegments = 0
    this.lastSampleAt = Date.now()
    this.lastSampleBytes = this.item.downloaded
    this.emaSpeed = 0

    this.setStatus('connecting')
    this.host.onStateChange(this)

    const signal = this.runController.signal

    try {
      await this.prepare(signal)
      await this.openFile()

      for (let cycle = 0; cycle <= 1; cycle++) {
        try {
          this.setStatus('downloading')
          if (!this.item.startedAt) this.item.startedAt = Date.now()
          await this.runSegments(signal)
          await this.completeDownload()
          break
        } catch (err) {
          if (signal.aborted) throw err
          if (err instanceof RemoteChangedError && cycle === 0) {
            this.host.log.warn(`[${this.id}] remote file changed, restarting from scratch`)
            this.item.size = -1
            this.resetProgress()
            this.item.segments = []
            await this.truncateFile()
            // Re-probe on the next cycle by restarting preparation.
            await this.prepare(signal)
            this.item.segments = planSegments(this.item.size, this.item.connections)
            await this.truncateFile()
            continue
          }
          if (err instanceof RangeUnsupportedError && cycle === 0) {
            this.host.log.warn(`[${this.id}] ranges unsupported, falling back to a single connection`)
            this.item.supportsRanges = false
            this.item.resumable = false
            this.item.connections = 1
            this.item.segments = singleSegment(this.item.size)
            this.item.downloaded = 0
            await this.truncateFile()
            continue
          }
          throw err
        }
      }
    } catch (err) {
      this.handleRunError(err)
    } finally {
      await this.closeFile()
      this.runController = null
      this.activeSegments = 0
      this.item.speed = 0
      this.tick(true)
      this.host.onStateChange(this)
      this.host.onFinished(this)
    }
  }

  pause(): void {
    if (!this.runController) {
      if (
        this.item.status === 'downloading' ||
        this.item.status === 'connecting' ||
        this.item.status === 'queued'
      ) {
        this.setStatus('paused')
        this.host.onStateChange(this)
      }
      return
    }
    this.intent = 'pause'
    this.runController.abort(new Error('paused'))
  }

  stop(): void {
    if (!this.runController) {
      this.setStatus('stopped')
      this.host.onStateChange(this)
      return
    }
    this.intent = 'stop'
    this.runController.abort(new Error('stopped'))
  }

  resetProgress(): void {
    this.item.downloaded = 0
    this.item.speed = 0
    this.item.eta = null
    this.item.segments = this.item.segments.map((s) => ({ ...s, downloaded: 0, done: false }))
    this.emaSpeed = 0
    this.lastSampleBytes = 0
    this.lastSampleAt = Date.now()
  }

  private setStatus(status: DownloadItem['status']): void {
    this.item.status = status
  }

  // ---- preparation -------------------------------------------------------

  private async prepare(signal: AbortSignal): Promise<void> {
    const settings = this.host.settings()
    const result = await probe({
      url: this.item.url,
      userAgent: settings.userAgent,
      dispatcher: this.host.dispatcher(),
      signal,
      referrer: this.item.referrer,
      headers: this.item.requestHeaders
    })

    this.item.finalUrl = result.url
    this.item.mimeType = result.mimeType ?? this.item.mimeType
    this.item.etag = result.etag
    this.item.lastModified = result.lastModified
    this.item.supportsRanges = result.supportsRanges
    this.item.resumable = result.supportsRanges && result.size > 0

    const previousSize = this.item.size
    if (result.size > 0) this.item.size = result.size

    const hasProgress = this.item.downloaded > 0 && this.item.segments.length > 0

    if (!hasProgress) {
      this.item.fileName = resolveFileName({
        contentDisposition: result.contentDisposition,
        url: result.url,
        mime: result.mimeType,
        override: this.item.customName ? this.item.fileName : undefined
      })
    }

    if (previousSize > 0 && result.size > 0 && result.size !== previousSize && hasProgress) {
      throw new RemoteChangedError()
    }

    if (!hasProgress) {
      this.item.segments = result.supportsRanges
        ? planSegments(this.item.size, this.item.connections)
        : singleSegment(this.item.size)
    } else if (!result.supportsRanges) {
      throw new RangeUnsupportedError()
    }

    await this.assignPaths()
  }

  private async assignPaths(): Promise<void> {
    const dir = this.host.resolveDir(this.item.category)
    this.item.saveDir = dir

    if (this.item.downloaded === 0) {
      const taken = this.host.takenPaths(this.id)
      this.item.fileName = await uniqueFileNameOnDisk(dir, this.item.fileName, taken)
    }
    this.item.filePath = join(dir, this.item.fileName)
    this.item.downloaded = sumDownloaded(this.item.segments)
  }

  // ---- file handling -----------------------------------------------------

  private async openFile(): Promise<void> {
    await fs.mkdir(dirname(this.item.filePath), { recursive: true })

    const exists = await pathExists(this.item.filePath)

    if (!exists && this.item.downloaded > 0) {
      this.host.log.warn(`[${this.id}] partial file missing, restarting`)
      this.resetProgress()
      this.item.segments = planSegments(this.item.size, this.item.connections)
    }

    this.fileHandle = exists
      ? await fs.open(this.item.filePath, 'r+')
      : await fs.open(this.item.filePath, 'w+')

    if (this.item.downloaded === 0) {
      await this.fileHandle.truncate(0)
    }
  }

  private async truncateFile(): Promise<void> {
    if (this.fileHandle) await this.fileHandle.truncate(0)
  }

  private async closeFile(): Promise<void> {
    const handle = this.fileHandle
    this.fileHandle = null
    if (handle) await handle.close().catch(() => undefined)
  }

  // ---- downloading -------------------------------------------------------

  private async runSegments(signal: AbortSignal): Promise<void> {
    const pending = this.item.segments.filter((s) => !s.done)
    await Promise.all(pending.map((segment) => this.runSegment(segment, signal)))
  }

  private async runSegment(segment: DownloadSegment, signal: AbortSignal): Promise<void> {
    let attempt = 0
    for (;;) {
      if (signal.aborted) throw abortReason(signal)
      try {
        await this.attemptSegment(segment, signal)
        segment.done = true
        return
      } catch (err) {
        if (signal.aborted) throw err
        if (err instanceof RangeUnsupportedError || err instanceof RemoteChangedError) throw err
        if (err instanceof HttpError && FATAL_STATUS.has(err.statusCode)) throw err

        attempt += 1
        if (attempt >= TUNING.maxRetries) throw err

        const wait = Math.min(TUNING.retryBaseMs * 2 ** (attempt - 1), TUNING.retryMaxMs)
        this.host.log.warn(
          `[${this.id}] segment ${segment.index} failed (attempt ${attempt}): ${errorMessage(err)}; retrying in ${wait}ms`
        )
        await sleep(wait, signal).catch(() => undefined)
      }
    }
  }

  private async attemptSegment(segment: DownloadSegment, runSignal: AbortSignal): Promise<void> {
    const settings = this.host.settings()
    const url = this.item.finalUrl ?? this.item.url
    const start = segment.start + segment.downloaded
    const end = segment.end >= 0 ? segment.end : undefined
    const rangeHeader = end !== undefined ? `bytes=${start}-${end}` : `bytes=${start}-`

    const headers = buildBaseHeaders(settings.userAgent, {
      ...(this.item.requestHeaders ?? {}),
      ...(this.item.referrer ? { Referer: this.item.referrer } : {}),
      Range: rangeHeader
    })

    const attemptController = new AbortController()
    const onRunAbort = (): void => attemptController.abort(runSignal.reason)
    runSignal.addEventListener('abort', onRunAbort, { once: true })

    try {
      const res = await openStream({
        url,
        headers,
        dispatcher: this.host.dispatcher(),
        signal: attemptController.signal,
        maxRedirects: 10
      })

      if (res.statusCode === 416) {
        segment.done = true
        destroyBody(res.body)
        return
      }

      if (res.statusCode !== 206 && res.statusCode !== 200) {
        destroyBody(res.body)
        throw new HttpError(res.statusCode, httpStatusMessage(res.statusCode))
      }

      if (res.statusCode === 200 && (start > 0 || this.item.segments.length > 1)) {
        destroyBody(res.body)
        throw new RangeUnsupportedError()
      }

      if (
        res.statusCode === 206 &&
        res.contentRange &&
        res.contentRange.total != null &&
        this.item.size > 0 &&
        res.contentRange.total !== this.item.size
      ) {
        destroyBody(res.body)
        throw new RemoteChangedError()
      }

      this.activeSegments += 1
      try {
        await this.streamInto(res.body, segment, attemptController, runSignal)
      } finally {
        this.activeSegments -= 1
      }
    } finally {
      runSignal.removeEventListener('abort', onRunAbort)
    }
  }

  private async streamInto(
    body: AsyncIterable<Buffer>,
    segment: DownloadSegment,
    attemptController: AbortController,
    runSignal: AbortSignal
  ): Promise<void> {
    const capacity =
      segment.end >= segment.start ? segment.end - segment.start + 1 : Number.POSITIVE_INFINITY
    const limiter = this.host.limiter
    let offset = segment.start + segment.downloaded

    const iterator = body[Symbol.asyncIterator]()
    try {
      for (;;) {
        if (attemptController.signal.aborted) {
          throw attemptController.signal.reason ?? new Error('IDLE_TIMEOUT')
        }
        if (runSignal.aborted) throw abortReason(runSignal)

        const result = await nextWithIdle(
          iterator,
          TUNING.idleTimeoutMs,
          () => attemptController.abort(new Error('IDLE_TIMEOUT'))
        )
        if (result.done) break

        let buffer = Buffer.isBuffer(result.value)
          ? result.value
          : Buffer.from(result.value as Uint8Array)
        const remaining = capacity - segment.downloaded
        if (remaining <= 0) break
        if (buffer.length > remaining) buffer = buffer.subarray(0, remaining)

        await limiter.consume(buffer.length, attemptController.signal)
        await writeFully(this.fileHandle, buffer, offset)

        segment.downloaded += buffer.length
        this.item.downloaded += buffer.length
        offset += buffer.length

        this.tick()
        if (segment.downloaded >= capacity) break
      }
    } finally {
      await iterator.return?.(undefined).catch(() => undefined)
    }
  }

  private async completeDownload(): Promise<void> {
    if (this.item.size > 0) {
      if (this.item.downloaded < this.item.size) {
        throw new Error(
          `Transfer ended early: received ${this.item.downloaded} of ${this.item.size} bytes`
        )
      }
      this.item.downloaded = this.item.size
      if (this.fileHandle) await this.fileHandle.truncate(this.item.size).catch(() => undefined)
    }
    this.item.status = 'completed'
    this.item.completedAt = Date.now()
    this.item.speed = 0
    this.item.eta = 0
    this.item.error = undefined
    for (const segment of this.item.segments) segment.done = true
    this.host.log.info(`[${this.id}] completed: ${this.item.filePath}`)
  }

  private handleRunError(err: unknown): void {
    this.item.speed = 0
    this.item.eta = null
    if (this.intent === 'stop') {
      this.item.status = 'stopped'
      return
    }
    if (this.intent === 'pause' || isAbortError(err)) {
      this.item.status = 'paused'
      return
    }
    this.item.status = 'error'
    this.item.error = errorMessage(err)
    this.host.log.error(`[${this.id}] failed: ${this.item.error}`)
  }

  // ---- progress ----------------------------------------------------------

  private tick(force = false): void {
    const now = Date.now()
    const elapsed = (now - this.lastSampleAt) / 1000
    if (elapsed >= 0.25) {
      const delta = this.item.downloaded - this.lastSampleBytes
      const instant = delta / elapsed
      this.emaSpeed = this.emaSpeed > 0 ? this.emaSpeed * 0.6 + instant * 0.4 : instant
      this.lastSampleAt = now
      this.lastSampleBytes = this.item.downloaded
      this.item.speed = Math.max(0, this.emaSpeed)
      this.item.eta =
        this.item.size > 0 && this.emaSpeed > 0
          ? Math.max(0, (this.item.size - this.item.downloaded) / this.emaSpeed)
          : null
    }

    if (force || now - this.lastEmitAt >= TUNING.progressIntervalMs) {
      this.lastEmitAt = now
      this.host.onProgress(this)
    }
  }
}

function abortReason(signal: AbortSignal): Error {
  return (signal.reason as Error) ?? new Error('aborted')
}

function destroyBody(body: unknown): void {
  const destroy = (body as { destroy?: () => void }).destroy
  if (typeof destroy === 'function') destroy.call(body)
}

async function writeFully(handle: FileHandle | null, buffer: Buffer, position: number): Promise<void> {
  if (!handle) throw new Error('File handle is not open')
  let written = 0
  while (written < buffer.length) {
    const { bytesWritten } = await handle.write(
      buffer,
      written,
      buffer.length - written,
      position + written
    )
    if (bytesWritten <= 0) throw new Error('Disk write returned 0 bytes')
    written += bytesWritten
  }
}

function nextWithIdle(
  iterator: AsyncIterator<Buffer>,
  timeoutMs: number,
  onIdle: () => void
): Promise<IteratorResult<Buffer>> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onIdle()
      reject(new Error('IDLE_TIMEOUT'))
    }, timeoutMs)
  })
  return Promise.race([iterator.next(), timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  }) as Promise<IteratorResult<Buffer>>
}
