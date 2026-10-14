import { createDecipheriv } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { TUNING } from '@shared/defaults'
import type { DownloadItem, DownloadStatus } from '@shared/types'
import { ensureDir, errorMessage, isAbortError, pathExists, sleep, uniqueFileNameOnDisk } from '../utils'
import { parseMpd } from './dash'
import { sanitizeFileName } from './filename'
import { abortReason, destroyBody, readAll, writeFully } from './io'
import { buildBaseHeaders, headerValue, HttpError, httpStatusMessage, openStream } from './net'
import {
  isMasterPlaylist,
  parseMasterPlaylist,
  parseMediaPlaylist,
  selectVariant,
  sequenceIv,
  variantLabel,
  type ByteRange,
  type PlaylistSegment,
  type SegmentKey
} from './playlist'
import type { TaskHost, TrackedTask } from './task'

/** Statuses that will never succeed on retry. */
const FATAL_STATUS = new Set([400, 401, 403, 404, 405, 409, 410, 451])
const MAX_PARALLEL_SEGMENTS = 8
const MAX_PLAYLIST_BYTES = 8 * 1024 * 1024

interface InitTarget {
  uri: string
  range?: ByteRange
}

/**
 * Download engine for HLS and DASH playlists.
 *
 * Unlike the byte-range engine, this fetches a manifest, then pulls each media
 * segment in turn — several in flight at once — and concatenates them in order
 * at the end of the output file. Only fully written segments are marked done,
 * so an interrupted download resumes cleanly at the first unfinished segment.
 */
export class StreamTask implements TrackedTask {
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

  private mediaSegments: PlaylistSegment[] = []
  private initSegment: InitTarget | null = null
  private readonly keyCache = new Map<string, Buffer>()

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
    if (this.item.status === 'completed') {
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
      await this.resolveManifest(signal)
      await this.openFile()
      this.setStatus('downloading')
      if (!this.item.startedAt) this.item.startedAt = Date.now()
      await this.downloadAll(signal)
      await this.complete()
    } catch (error) {
      this.handleRunError(error)
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
    if (!this.runController) return
    this.intent = 'pause'
    this.runController.abort(new Error('paused'))
  }

  stop(): void {
    if (!this.runController) return
    this.intent = 'stop'
    this.runController.abort(new Error('stopped'))
  }

  resetProgress(): void {
    this.item.downloaded = 0
    this.item.speed = 0
    this.item.eta = null
    for (const unit of this.item.segments) {
      unit.downloaded = 0
      unit.done = false
    }
    if (this.item.stream) this.item.stream.initDone = false
    this.emaSpeed = 0
    this.lastSampleBytes = 0
    this.lastSampleAt = Date.now()
  }

  private setStatus(status: DownloadStatus): void {
    this.item.status = status
    if (status !== 'downloading') this.item.speed = 0
  }

  // ---- manifest -----------------------------------------------------------

  private async resolveManifest(signal: AbortSignal): Promise<void> {
    const source = this.item.finalUrl ?? this.item.url
    const manifest = await this.fetchText(source, signal)
    this.item.finalUrl = manifest.url
    if (manifest.mimeType) this.item.mimeType = manifest.mimeType
    this.item.supportsRanges = false
    this.item.resumable = true

    if (this.item.kind === 'dash') {
      const parsed = parseMpd(manifest.text, manifest.url)
      if (parsed.segments.length === 0) throw new Error('The DASH manifest listed no segments')
      this.mediaSegments = parsed.segments.map((segment, index) => ({
        uri: segment.uri,
        range: segment.range,
        sequence: index
      }))
      this.initSegment = parsed.initSegment
        ? { uri: parsed.initSegment.uri, range: parsed.initSegment.range }
        : null
      this.item.stream = {
        initDone: this.item.stream?.initDone ?? false,
        quality: parsed.height
          ? `${parsed.height}p`
          : parsed.bandwidth
            ? `${(parsed.bandwidth / 1e6).toFixed(1)} Mbps`
            : undefined
      }
    } else {
      let text = manifest.text
      let url = manifest.url
      if (isMasterPlaylist(text)) {
        const variants = parseMasterPlaylist(text, url)
        const preferred = this.item.stream?.variantUri
        const variant = (preferred && variants.find((v) => v.uri === preferred)) || selectVariant(variants)
        if (variant) {
          const variantManifest = await this.fetchText(variant.uri, signal)
          text = variantManifest.text
          url = variantManifest.url
          this.item.stream = {
            variantUri: variant.uri,
            initDone: this.item.stream?.initDone ?? false,
            quality: variantLabel(variant)
          }
        }
      }
      const media = parseMediaPlaylist(text, url)
      if (media.segments.length === 0) throw new Error('The playlist listed no media segments')
      this.mediaSegments = media.segments
      this.initSegment = media.initSegment ?? null
      this.item.stream = {
        ...(this.item.stream ?? {}),
        initDone: this.item.stream?.initDone ?? false
      }
    }

    this.rebuildUnits()
    await this.assignPaths()
  }

  /**
   * Rebuild the per-segment progress units. When the segment count is
   * unchanged (the usual resume case) previously completed segments are kept;
   * otherwise we start over, because offsets can no longer be trusted.
   */
  private rebuildUnits(): void {
    const count = this.mediaSegments.length
    const previous = this.item.segments

    if (previous.length !== count) {
      this.item.segments = Array.from({ length: count }, (_, index) => ({
        index,
        start: 0,
        end: 0,
        downloaded: 0,
        done: false
      }))
      this.item.downloaded = 0
      if (this.item.stream) this.item.stream.initDone = false
      return
    }

    let seenGap = false
    for (const unit of previous) {
      if (!unit.done) seenGap = true
      else if (seenGap) {
        unit.done = false
        unit.downloaded = 0
      }
      unit.start = 0
      unit.end = 0
      unit.downloaded = unit.done ? 1 : 0
    }
  }

  private async assignPaths(): Promise<void> {
    const directory = this.item.saveDir || this.host.resolveDir(this.item.category)
    this.item.saveDir = directory

    if (this.item.downloaded === 0) {
      const desired =
        this.item.customName && this.item.fileName ? this.item.fileName : this.streamFileName()
      this.item.fileName = await uniqueFileNameOnDisk(
        directory,
        sanitizeFileName(desired, 'video.ts'),
        this.host.takenPaths(this.id)
      )
    }
    this.item.filePath = join(directory, this.item.fileName)
  }

  private streamFileName(): string {
    const source = this.item.finalUrl ?? this.item.url
    let base = 'video'
    try {
      const parsed = new URL(source)
      const parts = parsed.pathname.split('/').filter(Boolean)
      const last = decodeURIComponent(parts[parts.length - 1] ?? '')
      const stem = last.replace(/\.[a-z0-9]{1,8}$/i, '')
      const generic = /^(index|master|manifest|playlist|media|stream|video|hls|dash|out)$/i
      if (stem && !generic.test(stem)) base = stem
      else if (parsed.hostname) base = parsed.hostname.replace(/^www\./, '')
    } catch {
      /* keep the default stem */
    }
    const ext = this.initSegment ? '.mp4' : '.ts'
    return `${base}${ext}`
  }

  // ---- file ---------------------------------------------------------------

  private async openFile(): Promise<void> {
    const path = this.item.filePath
    if (!path) throw new Error('Download has no destination path')
    await ensureDir(dirname(path))

    const exists = await pathExists(path)
    if (this.item.downloaded > 0 && !exists) this.resetProgress()

    this.fileHandle = exists ? await fs.open(path, 'r+') : await fs.open(path, 'w+')
    if (this.item.downloaded === 0) await this.fileHandle.truncate(0)
  }

  private async closeFile(): Promise<void> {
    if (!this.fileHandle) return
    const handle = this.fileHandle
    this.fileHandle = null
    await handle.close().catch(() => undefined)
  }

  // ---- segments -----------------------------------------------------------

  private async downloadAll(signal: AbortSignal): Promise<void> {
    let offset = this.item.downloaded
    if (this.fileHandle) await this.fileHandle.truncate(offset)

    if (this.initSegment && !this.item.stream?.initDone) {
      const buffer = await this.fetchRaw(this.initSegment.uri, signal, this.initSegment.range)
      await writeFully(this.fileHandle, buffer, offset)
      offset += buffer.length
      this.item.downloaded = offset
      if (this.item.stream) this.item.stream.initDone = true
      this.tick(true)
    }

    const total = this.mediaSegments.length
    let start = this.item.segments.findIndex((unit) => !unit.done)
    if (start < 0) start = total

    if (start < total) {
      const parallel = Math.min(MAX_PARALLEL_SEGMENTS, Math.max(1, this.item.connections))
      const pending = new Map<number, Promise<Buffer>>()
      let cursor = start

      const schedule = (): void => {
        while (cursor < total && pending.size < parallel && !signal.aborted) {
          const index = cursor++
          pending.set(index, this.fetchMediaSegment(this.mediaSegments[index], signal))
        }
        this.activeSegments = pending.size
      }

      try {
        for (let index = start; index < total; index++) {
          schedule()
          const task = pending.get(index)
          if (!task) throw new Error('Segment pipeline stalled')
          pending.delete(index)
          const buffer = await task
          await writeFully(this.fileHandle, buffer, offset)
          offset += buffer.length
          this.item.downloaded = offset
          const unit = this.item.segments[index]
          if (unit) {
            unit.downloaded = 1
            unit.done = true
          }
          this.activeSegments = pending.size
          this.tick()
        }
      } finally {
        for (const task of pending.values()) task.catch(() => undefined)
        pending.clear()
        this.activeSegments = 0
      }
    }

    if (this.item.downloaded !== offset) this.item.downloaded = offset
  }

  private async fetchMediaSegment(segment: PlaylistSegment, signal: AbortSignal): Promise<Buffer> {
    const settings = this.host.settings()
    let lastError: unknown

    for (let attempt = 1; attempt <= TUNING.maxRetries; attempt++) {
      if (signal.aborted) throw abortReason(signal)
      try {
        const raw = await this.fetchRaw(segment.uri, signal, segment.range, settings.userAgent)
        return segment.key ? await this.decrypt(segment.key, segment.sequence, raw, signal) : raw
      } catch (error) {
        lastError = error
        if (signal.aborted || this.intent) throw error
        if (isAbortError(error)) throw error
        if (error instanceof HttpError && FATAL_STATUS.has(error.statusCode)) throw error
        if (attempt === TUNING.maxRetries) break
        await sleep(Math.min(TUNING.retryBaseMs * 2 ** (attempt - 1), TUNING.retryMaxMs), signal)
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  private async fetchRaw(
    uri: string,
    signal: AbortSignal,
    range?: ByteRange,
    userAgent?: string
  ): Promise<Buffer> {
    const settings = this.host.settings()
    const headers = buildBaseHeaders(userAgent ?? settings.userAgent, {
      ...(this.item.requestHeaders ?? {}),
      ...(this.item.referrer ? { Referer: this.item.referrer } : {}),
      ...(range ? { Range: `bytes=${range.offset}-${range.offset + range.length - 1}` } : {})
    })
    const result = await openStream({
      url: uri,
      headers,
      dispatcher: this.host.dispatcher(),
      signal,
      maxRedirects: 10
    })
    if (result.statusCode >= 400) {
      destroyBody(result.body)
      throw new HttpError(result.statusCode, httpStatusMessage(result.statusCode))
    }
    return readAll(result.body, this.host.limiter, signal, TUNING.idleTimeoutMs)
  }

  private async decrypt(
    key: SegmentKey,
    sequence: number,
    data: Buffer,
    signal: AbortSignal
  ): Promise<Buffer> {
    let keyBytes = this.keyCache.get(key.uri)
    if (!keyBytes) {
      keyBytes = await this.fetchRaw(key.uri, signal)
      if (keyBytes.length !== 16) throw new Error('Invalid AES-128 key length')
      this.keyCache.set(key.uri, keyBytes)
    }
    const decipher = createDecipheriv('aes-128-cbc', keyBytes, key.iv ?? sequenceIv(sequence))
    return Buffer.concat([decipher.update(data), decipher.final()])
  }

  private async fetchText(
    url: string,
    signal: AbortSignal
  ): Promise<{ text: string; url: string; mimeType?: string }> {
    const settings = this.host.settings()
    const headers = buildBaseHeaders(settings.userAgent, {
      ...(this.item.requestHeaders ?? {}),
      ...(this.item.referrer ? { Referer: this.item.referrer } : {})
    })
    const result = await openStream({
      url,
      headers,
      dispatcher: this.host.dispatcher(),
      signal,
      maxRedirects: 10
    })
    if (result.statusCode >= 400) {
      destroyBody(result.body)
      throw new HttpError(result.statusCode, httpStatusMessage(result.statusCode))
    }
    const mimeType = headerValue(result.headers, 'content-type')
    const buffer = await readAll(result.body, this.host.limiter, signal, TUNING.probeTimeoutMs)
    if (buffer.length > MAX_PLAYLIST_BYTES) throw new Error('The playlist is unexpectedly large')
    return { text: buffer.toString('utf8'), url: result.url, mimeType }
  }

  // ---- finish -------------------------------------------------------------

  private async complete(): Promise<void> {
    for (const unit of this.item.segments) {
      unit.done = true
      unit.downloaded = 1
    }
    if (this.fileHandle) {
      this.item.size = this.item.downloaded
      await this.fileHandle.truncate(this.item.downloaded)
    }
    if (this.item.size <= 0) this.item.size = this.item.downloaded
    this.item.status = 'completed'
    this.item.completedAt = Date.now()
    this.item.speed = 0
    this.item.eta = 0
    this.item.error = undefined
    this.host.log.info(`[${this.id}] completed: ${this.item.filePath}`)
  }

  private handleRunError(error: unknown): void {
    if (this.intent === 'stop') {
      this.setStatus('stopped')
      return
    }
    if (this.intent === 'pause' || isAbortError(error)) {
      this.setStatus('paused')
      return
    }
    this.item.error = errorMessage(error)
    this.setStatus('error')
    this.host.log.error(`[${this.id}] stream failed: ${this.item.error}`)
  }

  private tick(force = false): void {
    const now = Date.now()
    const elapsed = now - this.lastSampleAt
    if (elapsed >= 250) {
      const delta = this.item.downloaded - this.lastSampleBytes
      const instant = (delta * 1000) / elapsed
      this.emaSpeed = this.emaSpeed === 0 ? instant : this.emaSpeed * 0.7 + instant * 0.3
      this.lastSampleAt = now
      this.lastSampleBytes = this.item.downloaded
      this.item.speed = Math.max(0, this.emaSpeed)
    }
    this.item.eta = null
    if (force || now - this.lastEmitAt >= TUNING.progressIntervalMs) {
      this.lastEmitAt = now
      this.host.onProgress(this)
    }
  }
}
