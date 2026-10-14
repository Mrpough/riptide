/**
 * Shared domain types for Riptide. These are the single source of truth for
 * the shape of data that crosses the main <-> preload <-> renderer boundary.
 *
 * Keep this file free of any Node or DOM imports: it is compiled into all
 * three targets.
 */

export type CategoryId =
  | 'all'
  | 'compressed'
  | 'documents'
  | 'music'
  | 'video'
  | 'programs'
  | 'other'

/** Categories that an actual on-disk folder can be assigned to. */
export type StorageCategoryId = Exclude<CategoryId, 'all'>

export type DownloadStatus =
  | 'queued'
  | 'connecting'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'error'
  | 'stopped'

/** How a transfer is fetched: a plain file, or a segmented streaming playlist. */
export type DownloadKind = 'http' | 'hls' | 'dash'

/** Extra bookkeeping for manifest (hls/dash) downloads. */
export interface StreamState {
  /** Variant chosen from a master playlist, so a resume stays on the same stream. */
  variantUri?: string
  /** Whether the fMP4 initialisation segment has been written. */
  initDone: boolean
  /** Human label for the selected quality, e.g. "1080p". */
  quality?: string
}

/** Per-segment byte range and progress. Kept in the main process only. */
export interface DownloadSegment {
  index: number
  /** Absolute first byte of the range (inclusive). */
  start: number
  /** Absolute last byte of the range (inclusive). */
  end: number
  /** Bytes already written for this segment. */
  downloaded: number
  /** Whether this segment has finished downloading. */
  done: boolean
}

/** Full record as held by the main process, including segment detail. */
export interface DownloadItem {
  id: string
  url: string
  /** URL after following redirects. */
  finalUrl?: string
  /** Page that linked to the file, sent as the Referer header. */
  referrer?: string
  fileName: string
  saveDir: string
  /** Absolute path of the destination file. */
  filePath: string
  category: StorageCategoryId
  /** Transport: a plain HTTP file or a segmented streaming playlist. */
  kind: DownloadKind
  /** Present only for hls/dash items. */
  stream?: StreamState
  status: DownloadStatus
  /** Total size in bytes, or -1 when the server does not report one. */
  size: number
  downloaded: number
  /** Bytes per second, smoothed. */
  speed: number
  /** Estimated seconds remaining, or null when unknown. */
  eta: number | null
  /** Number of connections requested for this item. */
  connections: number
  segments: DownloadSegment[]
  resumable: boolean
  supportsRanges: boolean
  mimeType?: string
  /** Extra request headers (Cookie, Authorization, ...) supplied at add time. */
  requestHeaders?: Record<string, string>
  /** Validators used to detect that a remote file changed since we started. */
  etag?: string
  lastModified?: string
  error?: string
  /** True when the user supplied the file name, so probing must not rename it. */
  customName?: boolean
  /** Queue priority; higher runs first. */
  priority: number
  createdAt: number
  startedAt?: number
  completedAt?: number
}

/**
 * Trimmed projection sent to the renderer. Segments are replaced by a compact
 * array of per-segment completion ratios (0..1) so progress can be rendered
 * without shipping the full range table on every tick.
 */
export interface DownloadView {
  id: string
  url: string
  finalUrl?: string
  referrer?: string
  fileName: string
  saveDir: string
  filePath: string
  category: StorageCategoryId
  kind: DownloadKind
  /** Present only for hls/dash items. */
  stream?: StreamState
  status: DownloadStatus
  size: number
  downloaded: number
  speed: number
  eta: number | null
  connections: number
  segmentProgress: number[]
  resumable: boolean
  supportsRanges: boolean
  mimeType?: string
  error?: string
  priority: number
  createdAt: number
  startedAt?: number
  completedAt?: number
}

export interface CategoryCounts {
  all: number
  compressed: number
  documents: number
  music: number
  video: number
  programs: number
  other: number
}

export interface ProxySettings {
  enabled: boolean
  /** e.g. http://user:pass@host:8080 */
  url: string
}

export interface Settings {
  /** Base directory new downloads are saved into. */
  downloadDir: string
  /** When true, files are organised into per-category subfolders. */
  categoryFolders: boolean
  /** How many parallel connections a new download uses (1..32). */
  defaultConnections: number
  /** How many downloads may run at the same time. */
  maxConcurrent: number
  /** Global speed cap in bytes/second. 0 means unlimited. */
  speedLimit: number
  /** Resume unfinished downloads automatically the next time the app starts. */
  autoStart: boolean
  /** Start a download as soon as it is added, rather than holding it stopped. */
  startOnAdd: boolean
  minimizeToTray: boolean
  closeToTray: boolean
  launchOnStartup: boolean
  /** Watch the clipboard for URLs and offer to download them. */
  clipboardMonitor: boolean
  /** Show a desktop notification when a download finishes. */
  notifyOnComplete: boolean
  autoCheckUpdates: boolean
  updateChannel: 'stable' | 'beta'
  userAgent: string
  proxy: ProxySettings
  theme: 'dark' | 'light'
  confirmOnRemove: boolean
  /** Per-category destination overrides. Empty string means "use downloadDir". */
  categoryDirs: Record<StorageCategoryId, string>
  /** Enable the local HTTP endpoint used by the browser extension. */
  catchServer: boolean
  /** Port for the local catch endpoint. */
  catchServerPort: number
}

export interface AddDownloadInput {
  url: string
  saveDir?: string
  fileName?: string
  connections?: number
  category?: StorageCategoryId
  /** Force a transport instead of detecting it from the URL. */
  kind?: DownloadKind
  referrer?: string
  /** Start immediately instead of queueing. */
  startNow?: boolean
  /** Extra request headers, e.g. Cookie or Authorization. */
  headers?: Record<string, string>
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  isPackaged: boolean
  userDataPath: string
  downloadDir: string
}

export type UpdateStage =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  stage: UpdateStage
  /** Version string offered by the feed. */
  version?: string
  /** 0..100 */
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  message?: string
  /** Release notes for the offered version. */
  releaseNotes?: string
  releaseDate?: string
}

export interface Notice {
  kind: 'info' | 'success' | 'warning' | 'error'
  message: string
  detail?: string
}

/** Result of an add operation: the created item or an error message. */
export interface AddResult {
  ok: boolean
  id?: string
  error?: string
}

export interface DiskUsage {
  total: number
  free: number
}

/** Metadata returned when previewing a URL before adding it. */
export interface ProbePreview {
  url: string
  fileName: string
  size: number
  mimeType?: string
  supportsRanges: boolean
  category: StorageCategoryId
}
