import type { Readable } from 'node:stream'
import { Agent, ProxyAgent, request, type Dispatcher } from 'undici'
import type { Settings } from '@shared/types'
import { TUNING } from '@shared/defaults'

export type RawHeaders = Record<string, string | string[] | undefined>

export interface Range {
  start: number
  end: number
  /** Total size when the server reports it; null when unknown. */
  total: number | null
}

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308])

export class HttpError extends Error {
  readonly statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
  }
}

/** Case-insensitive header lookup across undici's header object. */
export function headerValue(headers: RawHeaders, name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const value = headers[key]
      return Array.isArray(value) ? value[0] : value
    }
  }
  return undefined
}

/** Create the connection pool, honoring the proxy setting. */
export function createDispatcher(settings: Settings): {
  dispatcher: Dispatcher
  close: () => Promise<void>
} {
  const proxyUrl = settings.proxy.enabled ? settings.proxy.url.trim() : ''
  if (proxyUrl) {
    const agent = new ProxyAgent({
      uri: proxyUrl,
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000
    })
    return { dispatcher: agent, close: () => agent.close() }
  }
  const agent = new Agent({
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 120_000,
    headersTimeout: TUNING.probeTimeoutMs
  })
  return { dispatcher: agent, close: () => agent.close() }
}

export function buildBaseHeaders(
  userAgent: string,
  extra?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    Accept: '*/*',
    'Accept-Encoding': 'identity'
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined && value !== null && value !== '') headers[key] = value
    }
  }
  return headers
}

export interface OpenStreamOptions {
  url: string
  headers?: Record<string, string>
  dispatcher: Dispatcher
  signal?: AbortSignal
  method?: string
  maxRedirects?: number
  headersTimeout?: number
}

export interface StreamResult {
  /** Final URL after redirects. */
  url: string
  statusCode: number
  headers: RawHeaders
  body: Readable
  contentRange: Range | null
}

/**
 * Open a streaming HTTP response, following redirects by hand so the final URL
 * is known (needed for file-name and referrer resolution) and so auth headers
 * are dropped on cross-origin hops.
 */
export async function openStream(options: OpenStreamOptions): Promise<StreamResult> {
  const {
    url,
    dispatcher,
    signal,
    method = 'GET',
    maxRedirects = 10,
    headersTimeout = TUNING.probeTimeoutMs
  } = options

  let currentUrl = url
  let currentMethod = method
  const currentHeaders: Record<string, string> = { ...(options.headers ?? {}) }

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await request(currentUrl, {
      method: currentMethod,
      headers: currentHeaders,
      dispatcher,
      signal,
      headersTimeout,
      bodyTimeout: 0
    })

    if (REDIRECT_CODES.has(res.statusCode)) {
      const location = headerValue(res.headers as RawHeaders, 'location')
      await (res.body as unknown as { dump: () => Promise<void> }).dump().catch(() => undefined)
      if (!location) throw new HttpError(res.statusCode, 'Server sent a redirect without a Location header')
      const nextUrl = new URL(location, currentUrl).toString()
      try {
        if (new URL(nextUrl).origin !== new URL(currentUrl).origin) {
          for (const key of Object.keys(currentHeaders)) {
            if (/^(authorization|cookie)$/i.test(key)) delete currentHeaders[key]
          }
        }
      } catch {
        /* ignore malformed URL comparison */
      }
      if (res.statusCode === 303 || (currentMethod === 'POST' && (res.statusCode === 301 || res.statusCode === 302))) {
        currentMethod = 'GET'
      }
      currentUrl = nextUrl
      continue
    }

    return {
      url: currentUrl,
      statusCode: res.statusCode,
      headers: res.headers as RawHeaders,
      body: res.body,
      contentRange: parseContentRange(headerValue(res.headers as RawHeaders, 'content-range'))
    }
  }

  throw new HttpError(0, 'Too many redirects')
}

/**
 * Parse a Content-Range header (a start-end slice over a total, or an
 * unsatisfied range where the slice is unknown) into a structured range.
 */
export function parseContentRange(value: string | undefined): Range | null {
  if (!value) return null
  const match = /bytes\s+(?:(\d+)-(\d+)|\*)\/(\d+|\*)/i.exec(value)
  if (!match) return null
  const start = match[1] ? Number(match[1]) : 0
  const end = match[2] ? Number(match[2]) : -1
  const total = match[3] === '*' ? null : Number(match[3])
  return { start, end, total }
}

export interface ProbeResult {
  url: string
  statusCode: number
  size: number
  supportsRanges: boolean
  mimeType?: string
  contentDisposition?: string
  etag?: string
  lastModified?: string
}

export interface ProbeOptions {
  url: string
  userAgent: string
  dispatcher: Dispatcher
  signal?: AbortSignal
  referrer?: string
  headers?: Record<string, string>
}

/**
 * Ask the server what the resource is: total size, range support, name and
 * type. Uses a one-byte ranged GET, which is more reliable than HEAD across
 * CDNs, and falls back gracefully when the server ignores the Range header.
 */
export async function probe(options: ProbeOptions): Promise<ProbeResult> {
  const { url, userAgent, dispatcher, signal, referrer, headers } = options

  const requestHeaders = buildBaseHeaders(userAgent, {
    ...(headers ?? {}),
    ...(referrer ? { Referer: referrer } : {}),
    Range: 'bytes=0-0'
  })

  const res = await openStream({ url, headers: requestHeaders, dispatcher, signal, maxRedirects: 10 })

  const mimeType = headerValue(res.headers, 'content-type')
  const contentDisposition = headerValue(res.headers, 'content-disposition')
  const etag = headerValue(res.headers, 'etag')
  const lastModified = headerValue(res.headers, 'last-modified')

  let size = -1
  let supportsRanges = false

  if (res.statusCode === 206) {
    supportsRanges = res.contentRange != null
    if (res.contentRange && res.contentRange.total != null) size = res.contentRange.total
    else {
      const len = Number(headerValue(res.headers, 'content-length'))
      size = Number.isFinite(len) ? len : -1
    }
    await drain(res.body)
  } else if (res.statusCode === 200) {
    // The server ignored our Range header: no resumable multi-connection.
    supportsRanges = false
    const len = Number(headerValue(res.headers, 'content-length'))
    size = Number.isFinite(len) && len > 0 ? len : -1
    await drain(res.body)
  } else if (res.statusCode === 416) {
    // Unsatisfiable range: typically an empty file. The total is in Content-Range.
    supportsRanges = res.contentRange != null
    if (res.contentRange && res.contentRange.total != null) size = res.contentRange.total
    await drain(res.body)
  } else if (res.statusCode >= 400) {
    await drain(res.body)
    throw new HttpError(res.statusCode, httpStatusMessage(res.statusCode))
  } else {
    await drain(res.body)
  }

  return { url: res.url, statusCode: res.statusCode, size, supportsRanges, mimeType, contentDisposition, etag, lastModified }
}

export function httpStatusMessage(status: number): string {
  const map: Record<number, string> = {
    400: 'Bad request',
    401: 'Authentication required (401)',
    403: 'Access forbidden (403)',
    404: 'File not found (404)',
    405: 'Method not allowed',
    407: 'Proxy authentication required (407)',
    408: 'Request timed out',
    416: 'Range not satisfiable',
    429: 'Too many requests (429) — the server is rate limiting',
    500: 'Server error (500)',
    502: 'Bad gateway (502)',
    503: 'Service unavailable (503)',
    504: 'Gateway timeout (504)'
  }
  return map[status] ?? `Server responded with status ${status}`
}

async function drain(body: Readable): Promise<void> {
  const dump = (body as unknown as { dump?: () => Promise<void> }).dump
  if (typeof dump === 'function') {
    await dump.call(body).catch(() => undefined)
    return
  }
  body.destroy()
}
