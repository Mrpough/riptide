import type { DownloadKind } from './types'

/**
 * Detection helpers for segmented streaming playlists (HLS / DASH). Shared so
 * the main process and the renderer agree on what counts as a stream.
 */

const PLAYLIST_MIME: Array<[RegExp, DownloadKind]> = [
  [/^(application\/(vnd\.apple\.mpegurl|x-mpegurl)|audio\/(mpegurl|x-mpegurl))/i, 'hls'],
  [/^application\/dash\+xml/i, 'dash']
]

/** Map a Content-Type to a streaming kind, or null for ordinary files. */
export function kindFromMime(mime: string | undefined | null): DownloadKind | null {
  if (!mime) return null
  const base = mime.split(';')[0].trim()
  for (const [re, kind] of PLAYLIST_MIME) if (re.test(base)) return kind
  return null
}

/** Guess a streaming kind from the URL path; falls back to a plain download. */
export function kindFromUrl(url: string): DownloadKind {
  let pathname = url
  try {
    pathname = new URL(url).pathname
  } catch {
    /* keep the raw string */
  }
  const lower = pathname.toLowerCase()
  if (lower.endsWith('.m3u8') || lower.endsWith('.m3u')) return 'hls'
  if (lower.endsWith('.mpd')) return 'dash'
  return 'http'
}

/** True when the item needs the streaming engine rather than the byte-range one. */
export function isStreamKind(kind: DownloadKind): boolean {
  return kind !== 'http'
}
