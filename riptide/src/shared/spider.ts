import { detectCategory } from './categories'
import type { StorageCategoryId } from './types'

/** Where a crawl currently is. */
export type SpiderPhase = 'idle' | 'walking' | 'probing' | 'done' | 'stopped' | 'error'

export interface SpiderOptions {
  /** The page the crawl starts from. */
  startUrl: string
  /** How many link hops away from the start page to follow (0 = just the start page). */
  maxDepth: number
  /** Hard ceiling on pages fetched, so a crawl can never run away. */
  maxPages: number
  /** Stay on the start page's host. */
  sameHost: boolean
  /** Read and honour robots.txt. */
  respectRobots: boolean
  /** Only keep files whose category is in this list. */
  types: StorageCategoryId[]
  /** Optional regex; when set a file URL must match it. */
  include: string
  /** Optional regex; when set a file URL must NOT match it. */
  exclude: string
  /** Ask the server for each file's size and type after the walk. */
  probeSizes: boolean
  /** Pages fetched in parallel. */
  concurrency: number
}

export const DEFAULT_SPIDER_OPTIONS: SpiderOptions = {
  startUrl: '',
  maxDepth: 2,
  maxPages: 250,
  sameHost: true,
  respectRobots: true,
  types: ['video', 'music'],
  include: '',
  exclude: '',
  probeSizes: true,
  concurrency: 4
}

export interface SpiderState {
  phase: SpiderPhase
  startUrl: string
  pagesCrawled: number
  queueLength: number
  filesFound: number
  filesProbed: number
  currentUrl?: string
  error?: string
  startedAt?: number
  finishedAt?: number
}

export interface SpiderFile {
  url: string
  fileName: string
  /** The page the link was found on, used as the Referer for the download. */
  pageUrl: string
  category: StorageCategoryId
  ext: string
  /** Bytes, or -1 when unknown. */
  size: number
  mimeType?: string
  /** Link distance from the start page. */
  depth: number
}

/** Everything the renderer needs to render the grabber results. */
export interface SpiderSnapshot {
  state: SpiderState
  files: SpiderFile[]
}

/** Outcome of handing crawled files to the download queue. */
export interface SpiderAddResult {
  ok: boolean
  added: number
  skipped: number
}

export const SPIDER_LIMITS = {
  maxDepth: 10,
  maxPages: 5000,
  concurrency: 8,
  maxFiles: 5000
} as const

/** Documents above this size are not parsed for links (they are almost never HTML). */
export const MAX_PAGE_BYTES = 2 * 1024 * 1024

const PAGE_EXT = new Set([
  'html',
  'htm',
  'xhtml',
  'shtml',
  'php',
  'asp',
  'aspx',
  'jsp',
  'jspx',
  'cgi',
  'do',
  'action',
  'pl',
  'cfm',
  'erb'
])

const NON_HTTP = /^(javascript|mailto|tel|data|about|blob|file|ftp|ws|wss):/i

/** Resolve `raw` against `base` and return a normalised absolute http(s) URL, or null. */
export function normalizeUrl(raw: string, base?: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  if (NON_HTTP.test(trimmed)) return null
  let url: URL
  try {
    url = base ? new URL(trimmed, base) : new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  url.hash = ''
  return url.toString()
}

/** Lower-case extension without the dot, or '' when there is none. */
export function extensionOf(pathname: string): string {
  const last = pathname.split('/').pop() ?? ''
  const dot = last.lastIndexOf('.')
  if (dot <= 0 || dot === last.length - 1) return ''
  return last.slice(dot + 1).toLowerCase()
}

/** Whether a URL looks like a document worth crawling rather than a file to grab. */
export function isPageUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const path = parsed.pathname
  if (path === '' || path.endsWith('/')) return true
  const ext = extensionOf(path)
  if (!ext) return true
  return PAGE_EXT.has(ext)
}

/** A best-effort file name from a URL's last path segment. */
export function fileNameFromUrl(url: string): string {
  let pathname = url
  try {
    pathname = new URL(url).pathname
  } catch {
    /* keep the raw string */
  }
  const segments = pathname.split('/').filter(Boolean)
  let name = segments.length ? segments[segments.length - 1] : ''
  try {
    name = decodeURIComponent(name)
  } catch {
    /* leave it percent-encoded */
  }
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  name = name.replace(/^\.+/, '')
  if (!name) name = 'download'
  return name.slice(0, 200)
}

/** Category for a crawled file, based on its name. */
export function categoryForUrl(url: string): StorageCategoryId {
  return detectCategory(fileNameFromUrl(url))
}
