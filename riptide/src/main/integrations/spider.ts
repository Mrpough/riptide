import type { Readable } from 'node:stream'
import type { Dispatcher } from 'undici'
import type { Settings, StorageCategoryId } from '@shared/types'
import { detectCategory } from '@shared/categories'
import {
  DEFAULT_SPIDER_OPTIONS,
  MAX_PAGE_BYTES,
  SPIDER_LIMITS,
  extensionOf,
  fileNameFromUrl,
  isPageUrl,
  normalizeUrl,
  type SpiderFile,
  type SpiderOptions,
  type SpiderPhase,
  type SpiderState
} from '@shared/spider'
import { buildBaseHeaders, headerValue, openStream, probe } from '../download/net'
import { destroyBody } from '../download/io'
import type { Logger } from '../logger'

export interface SpiderDeps {
  getSettings: () => Settings
  dispatcher: () => Dispatcher
  onState: (state: SpiderState) => void
  log: Logger
}

interface RobotsRule {
  regex: RegExp
  /** Length of the source pattern (longest match wins). */
  length: number
  allow: boolean
}

interface RobotsRules {
  rules: RobotsRule[]
  crawlDelayMs: number
}

const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'

/** Extensions that are streaming fragments rather than standalone files. */
const SEGMENT_EXT = new Set(['ts', 'm4s', 'cmfv', 'cmfa'])

const ATTR_RE =
  /(?:href|src|data|poster|action|data-src|data-href|data-url|data-video|data-file|data-mp4|data-hls)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/gi
const SRCSET_RE = /srcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi
const MEDIA_RE =
  /["'`(]([^"'`()\s\\]+\.(?:m3u8|mpd|mp4|mkv|webm|mov|avi|wmv|flv|m4v|mpg|mpeg|ogv|3gp|mp3|m4a|flac|wav|ogg|oga|opus|wma|pdf|zip|rar|7z|tar|gz|apk|exe|msi|iso|dmg|epub|mobi|srt|vtt))(?:\?[^"'`()\s\\]*)?["'`)]/gi

/** A single page queue entry. */
interface QueueItem {
  url: string
  depth: number
}

function emptyState(): SpiderState {
  return {
    phase: 'idle',
    startUrl: '',
    pagesCrawled: 0,
    queueLength: 0,
    filesFound: 0,
    filesProbed: 0
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    timer.unref?.()
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Parse a robots.txt body into the rules that apply to our user agent. */
function parseRobots(text: string, userAgent: string): RobotsRules {
  interface Group {
    agents: string[]
    rules: Array<{ pattern: string; allow: boolean }>
    crawlDelay: number
  }

  const groups: Group[] = []
  let current: Group | null = null
  let sawRule = false

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const field = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()

    if (field === 'user-agent') {
      if (!current || sawRule) {
        current = { agents: [], rules: [], crawlDelay: 0 }
        groups.push(current)
        sawRule = false
      }
      current.agents.push(value.toLowerCase())
      continue
    }
    if (!current) continue
    if (field === 'allow' || field === 'disallow') {
      sawRule = true
      if (value) current.rules.push({ pattern: value, allow: field === 'allow' })
      continue
    }
    if (field === 'crawl-delay') {
      sawRule = true
      const seconds = Number(value)
      if (Number.isFinite(seconds) && seconds > 0) {
        current.crawlDelay = Math.min(seconds * 1000, 30_000)
      }
    }
  }

  const ua = userAgent.toLowerCase()
  let chosen: Group | null = null
  let bestSpecificity = -1
  for (const group of groups) {
    for (const agent of group.agents) {
      if (agent === '*') {
        if (bestSpecificity < 0 && !chosen) chosen = group
        continue
      }
      if (ua.includes(agent) && agent.length > bestSpecificity) {
        bestSpecificity = agent.length
        chosen = group
      }
    }
  }
  if (!chosen) return { rules: [], crawlDelayMs: 0 }

  const rules: RobotsRule[] = chosen.rules.map((rule) => ({
    regex: patternToRegex(rule.pattern),
    length: rule.pattern.length,
    allow: rule.allow
  }))
  return { rules, crawlDelayMs: chosen.crawlDelay }
}

function patternToRegex(pattern: string): RegExp {
  let body = pattern
  let anchored = false
  if (body.endsWith('$')) {
    anchored = true
    body = body.slice(0, -1)
  }
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  try {
    return new RegExp('^' + escaped + (anchored ? '$' : ''))
  } catch {
    return /^$/ // never matches
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function htmlLike(contentType: string): boolean {
  if (!contentType) return true
  return (
    contentType.includes('text/html') ||
    contentType.includes('application/xhtml') ||
    contentType.includes('application/xml') ||
    contentType.includes('text/xml')
  )
}

async function readCapped(body: Readable, max: number): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  try {
    for await (const chunk of body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
      if (total + buffer.length >= max) {
        chunks.push(buffer.subarray(0, max - total))
        total = max
        break
      }
      chunks.push(buffer)
      total += buffer.length
    }
  } finally {
    destroyBody(body)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function collectMatches(html: string, re: RegExp, out: Set<string>): void {
  re.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    const value = match[1] ?? match[2] ?? match[3]
    if (value) out.add(value.trim())
  }
}

/** Pull every URL-ish token out of an HTML document. */
function extractLinks(html: string): string[] {
  const found = new Set<string>()
  collectMatches(html, ATTR_RE, found)
  collectMatches(html, CSS_URL_RE, found)
  collectMatches(html, MEDIA_RE, found)

  const srcsets: string[] = []
  let match: RegExpExecArray | null
  SRCSET_RE.lastIndex = 0
  while ((match = SRCSET_RE.exec(html)) !== null) {
    const value = match[1] ?? match[2]
    if (value) srcsets.push(value)
  }
  for (const list of srcsets) {
    for (const part of list.split(',')) {
      const candidate = part.trim().split(/\s+/)[0]
      if (candidate) found.add(candidate)
    }
  }

  return [...found]
}

export class SiteSpider {
  private readonly deps: SpiderDeps
  private options: SpiderOptions = { ...DEFAULT_SPIDER_OPTIONS }
  private state: SpiderState = emptyState()
  private files: SpiderFile[] = []
  private controller: AbortController | null = null
  private running = false

  private queue: QueueItem[] = []
  private pending = 0
  private visited = new Set<string>()
  private seenFiles = new Set<string>()
  private host = ''
  private includeRe: RegExp | null = null
  private excludeRe: RegExp | null = null
  private robots: RobotsRules = { rules: [], crawlDelayMs: 0 }
  private nextAllowedAt = 0

  private emitTimer: NodeJS.Timeout | null = null
  private lastEmit = 0

  constructor(deps: SpiderDeps) {
    this.deps = deps
  }

  getState(): SpiderState {
    return { ...this.state }
  }

  getFiles(): SpiderFile[] {
    return [...this.files]
  }

  /** Validate the options, reset the crawl and start it in the background. */
  start(options: SpiderOptions): { ok: boolean; error?: string } {
    if (this.running) return { ok: false, error: 'A crawl is already running' }

    const startUrl = normalizeUrl(options.startUrl)
    if (!startUrl) return { ok: false, error: 'Enter a valid http:// or https:// site URL' }

    let includeRe: RegExp | null = null
    let excludeRe: RegExp | null = null
    try {
      if (options.include.trim()) includeRe = new RegExp(options.include.trim(), 'i')
    } catch {
      return { ok: false, error: 'The include pattern is not a valid regular expression' }
    }
    try {
      if (options.exclude.trim()) excludeRe = new RegExp(options.exclude.trim(), 'i')
    } catch {
      return { ok: false, error: 'The exclude pattern is not a valid regular expression' }
    }

    this.options = {
      ...options,
      startUrl,
      include: options.include.trim(),
      exclude: options.exclude.trim(),
      maxDepth: clamp(options.maxDepth, 0, SPIDER_LIMITS.maxDepth),
      maxPages: clamp(options.maxPages, 1, SPIDER_LIMITS.maxPages),
      concurrency: clamp(options.concurrency, 1, SPIDER_LIMITS.concurrency),
      types: [...options.types]
    }

    this.includeRe = includeRe
    this.excludeRe = excludeRe
    this.files = []
    this.queue = [{ url: startUrl, depth: 0 }]
    this.visited = new Set([startUrl])
    this.seenFiles = new Set()
    this.host = hostOf(startUrl)
    this.robots = { rules: [], crawlDelayMs: 0 }
    this.nextAllowedAt = 0
    this.pending = 0
    this.state = {
      ...emptyState(),
      phase: 'walking',
      startUrl,
      queueLength: 1,
      startedAt: Date.now()
    }

    this.controller = new AbortController()
    const signal = this.controller.signal
    this.running = true
    this.emit(true)
    void this.run(signal)
    return { ok: true }
  }

  stop(): void {
    if (!this.running) return
    this.controller?.abort(new Error('Crawl stopped'))
  }

  dispose(): void {
    this.stop()
    if (this.emitTimer) {
      clearTimeout(this.emitTimer)
      this.emitTimer = null
    }
  }

  clear(): void {
    if (this.running) return
    this.files = []
    this.seenFiles = new Set()
    this.state = { ...emptyState(), startUrl: this.state.startUrl }
    this.emit(true)
  }

  private async run(signal: AbortSignal): Promise<void> {
    try {
      if (this.options.respectRobots) await this.loadRobots(signal)
      if (signal.aborted) throw new Error('Crawl stopped')
      await this.crawl(signal)
      if (signal.aborted) throw new Error('Crawl stopped')
      if (this.options.probeSizes && this.files.length > 0) {
        this.setState({ phase: 'probing' })
        await this.probeFiles(signal)
      }
      if (signal.aborted) throw new Error('Crawl stopped')
      this.finish('done')
    } catch (err) {
      if (signal.aborted) this.finish('stopped')
      else {
        this.deps.log.warn('spider failed', messageOf(err))
        this.finish('error', messageOf(err))
      }
    } finally {
      this.running = false
      this.controller = null
    }
  }

  private finish(phase: SpiderPhase, error?: string): void {
    this.state.phase = phase
    this.state.finishedAt = Date.now()
    this.state.queueLength = 0
    if (error) this.state.error = error
    this.emit(true)
  }

  private async loadRobots(signal: AbortSignal): Promise<void> {
    let origin: string
    try {
      origin = new URL(this.options.startUrl).origin
    } catch {
      return
    }
    try {
      const res = await openStream({
        url: `${origin}/robots.txt`,
        headers: buildBaseHeaders(this.deps.getSettings().userAgent, { Accept: 'text/plain,*/*' }),
        dispatcher: this.deps.dispatcher(),
        signal,
        headersTimeout: 15_000
      })
      if (res.statusCode >= 400) {
        destroyBody(res.body)
        return
      }
      const text = await readCapped(res.body, 512 * 1024)
      this.robots = parseRobots(text, this.deps.getSettings().userAgent)
      if (this.robots.crawlDelayMs > 0) {
        this.deps.log.debug('spider respecting robots crawl-delay', this.robots.crawlDelayMs)
      }
    } catch (err) {
      if (!signal.aborted) this.deps.log.debug('spider robots.txt fetch failed', messageOf(err))
    }
  }

  private robotsAllows(url: string): boolean {
    if (!this.options.respectRobots || this.robots.rules.length === 0) return true
    let target = url
    try {
      const parsed = new URL(url)
      target = parsed.pathname + parsed.search
    } catch {
      /* keep the raw URL */
    }
    let bestLength = -1
    let allowed = true
    for (const rule of this.robots.rules) {
      if (rule.regex.test(target)) {
        if (rule.length > bestLength || (rule.length === bestLength && rule.allow && !allowed)) {
          bestLength = rule.length
          allowed = rule.allow
        }
      }
    }
    return allowed
  }

  private async crawl(signal: AbortSignal): Promise<void> {
    const workers: Promise<void>[] = []
    const count = this.robots.crawlDelayMs > 0 ? 1 : this.options.concurrency
    for (let i = 0; i < count; i++) workers.push(this.worker(signal))
    await Promise.all(workers)
  }

  private async worker(signal: AbortSignal): Promise<void> {
    for (;;) {
      if (signal.aborted) return
      const item = this.queue.shift()
      if (!item) {
        if (this.pending === 0) return
        await delay(25, signal)
        continue
      }
      if (this.state.pagesCrawled >= this.options.maxPages) return
      this.pending++
      try {
        await this.crawlPage(item, signal)
      } finally {
        this.pending--
        this.state.queueLength = this.queue.length
        this.emit()
      }
    }
  }

  private async crawlPage(item: QueueItem, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return
    if (this.robots.crawlDelayMs > 0) {
      const wait = this.nextAllowedAt - Date.now()
      if (wait > 0) await delay(wait, signal)
      this.nextAllowedAt = Date.now() + this.robots.crawlDelayMs
    }
    if (!this.robotsAllows(item.url)) {
      this.deps.log.debug('spider skipping robots-disallowed page', item.url)
      return
    }

    this.setState({ currentUrl: item.url })
    try {
      const res = await openStream({
        url: item.url,
        headers: buildBaseHeaders(this.deps.getSettings().userAgent, { Accept: HTML_ACCEPT }),
        dispatcher: this.deps.dispatcher(),
        signal,
        headersTimeout: 15_000
      })

      const contentType = (headerValue(res.headers, 'content-type') ?? '').toLowerCase()
      if (res.statusCode >= 400) {
        destroyBody(res.body)
        return
      }

      if (!htmlLike(contentType)) {
        destroyBody(res.body)
        const sizeHeader = headerValue(res.headers, 'content-length')
        const size = sizeHeader != null && Number.isFinite(Number(sizeHeader)) ? Number(sizeHeader) : undefined
        this.considerFile(res.url || item.url, item.url, item.depth, contentType, size)
        return
      }

      const html = await readCapped(res.body, MAX_PAGE_BYTES)
      this.setState({ pagesCrawled: this.state.pagesCrawled + 1 })

      const base = res.url || item.url
      for (const href of extractLinks(html)) {
        if (signal.aborted) return
        this.consider(href, item.depth, base)
      }
    } catch (err) {
      if (signal.aborted) return
      this.deps.log.debug('spider page failed', item.url, messageOf(err))
    }
  }

  private consider(rawUrl: string, depth: number, base: string): void {
    const url = normalizeUrl(rawUrl, base)
    if (!url) return

    if (isPageUrl(url)) {
      const childDepth = depth + 1
      if (childDepth > this.options.maxDepth) return
      if (this.options.sameHost && this.host && hostOf(url) !== this.host) return
      if (this.visited.has(url)) return
      if (this.visited.size >= this.options.maxPages) return
      this.visited.add(url)
      this.queue.push({ url, depth: childDepth })
      this.state.queueLength = this.queue.length
      this.emit()
      return
    }

    this.considerFile(url, base, depth)
  }

  private considerFile(
    url: string,
    pageUrl: string,
    depth: number,
    mimeHint?: string,
    sizeHint?: number
  ): void {
    if (this.seenFiles.has(url)) return
    if (this.files.length >= SPIDER_LIMITS.maxFiles) return
    if (!this.robotsAllows(url)) return

    let ext = ''
    try {
      ext = extensionOf(new URL(url).pathname)
    } catch {
      return
    }
    if (SEGMENT_EXT.has(ext)) return

    const fileName = fileNameFromUrl(url)
    const category: StorageCategoryId = detectCategory(fileName, mimeHint)
    if (this.options.types.length > 0 && !this.options.types.includes(category)) return
    if (this.includeRe && !this.includeRe.test(url)) return
    if (this.excludeRe && this.excludeRe.test(url)) return

    this.seenFiles.add(url)
    const file: SpiderFile = {
      url,
      fileName,
      pageUrl,
      category,
      ext,
      size: typeof sizeHint === 'number' ? sizeHint : -1,
      depth
    }
    if (mimeHint) file.mimeType = mimeHint
    this.files.push(file)
    this.state.filesFound = this.files.length
    this.emit()
  }

  private async probeFiles(signal: AbortSignal): Promise<void> {
    const settings = this.deps.getSettings()
    const pool = Math.max(1, Math.min(4, this.options.concurrency))
    let index = 0

    const worker = async (): Promise<void> => {
      for (;;) {
        if (signal.aborted) return
        const current = index++
        if (current >= this.files.length) return
        const file = this.files[current]
        try {
          const result = await probe({
            url: file.url,
            userAgent: settings.userAgent,
            dispatcher: this.deps.dispatcher(),
            signal,
            referrer: file.pageUrl
          })
          file.size = result.size
          if (result.mimeType) file.mimeType = result.mimeType
        } catch (err) {
          if (signal.aborted) return
          this.deps.log.debug('spider probe failed', file.url, messageOf(err))
        }
        this.state.filesProbed += 1
        this.emit()
      }
    }

    await Promise.all(Array.from({ length: pool }, () => worker()))
  }

  private setState(patch: Partial<SpiderState>): void {
    Object.assign(this.state, patch)
    this.emit()
  }

  private emit(force = false): void {
    if (force) {
      if (this.emitTimer) {
        clearTimeout(this.emitTimer)
        this.emitTimer = null
      }
      this.lastEmit = Date.now()
      this.deps.onState({ ...this.state })
      return
    }
    if (this.emitTimer) return
    const wait = Math.max(0, 160 - (Date.now() - this.lastEmit))
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.lastEmit = Date.now()
      this.deps.onState({ ...this.state })
    }, wait)
    this.emitTimer.unref?.()
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}
