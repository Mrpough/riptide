import type { Settings, StorageCategoryId } from './types'

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export const MAX_CONNECTIONS = 32
export const MIN_CONNECTIONS = 1

/** Smallest slice a segment should cover before we stop adding connections. */
export const MIN_SEGMENT_BYTES = 512 * 1024

/** Files at or below this size always use a single connection. */
export const SINGLE_CONNECTION_THRESHOLD = 1024 * 1024

export const TUNING = {
  /** How long to wait between pipeline progress flushes. */
  progressIntervalMs: 200,
  /** How often the download list is persisted to disk. */
  persistIntervalMs: 1000,
  /** How often aggregate stats are pushed to the renderer. */
  statsIntervalMs: 500,
  /** Network read chunk size. */
  chunkSize: 64 * 1024,
  /** Reduced chunk size while a speed limit is active. */
  throttledChunkSize: 16 * 1024,
  /** Number of retry attempts per segment before the download errors out. */
  maxRetries: 5,
  /** Base backoff for segment retries, in milliseconds. */
  retryBaseMs: 1000,
  /** Maximum backoff between retries. */
  retryMaxMs: 30_000,
  /** Connection/headers timeout for metadata probes. */
  probeTimeoutMs: 30_000,
  /** Idle timeout: no bytes received for this long aborts a segment. */
  idleTimeoutMs: 60_000,
  /** Threshold above which a progress notification is considered complete. */
  resumeValidation: true
} as const

export function defaultCategoryDirs(): Record<StorageCategoryId, string> {
  return {
    compressed: '',
    documents: '',
    music: '',
    video: '',
    programs: '',
    other: ''
  }
}

export function defaultSettings(downloadDir: string): Settings {
  return {
    downloadDir,
    categoryFolders: true,
    defaultConnections: 8,
    maxConcurrent: 3,
    speedLimit: 0,
    autoStart: true,
    startOnAdd: true,
    minimizeToTray: false,
    closeToTray: false,
    launchOnStartup: false,
    clipboardMonitor: false,
    notifyOnComplete: true,
    autoCheckUpdates: true,
    updateChannel: 'stable',
    userAgent: DEFAULT_USER_AGENT,
    proxy: { enabled: false, url: '' },
    theme: 'dark',
    confirmOnRemove: true,
    categoryDirs: defaultCategoryDirs(),
    catchServer: true,
    catchServerPort: 7777
  }
}

export const APP_NAME = 'Riptide'
export const APP_ID = 'com.riptide.dm'
