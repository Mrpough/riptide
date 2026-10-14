import { extname } from 'node:path'

/** Characters that are illegal in Windows path components, plus controls. */
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g
const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
])

export function sanitizeFileName(input: string, fallback = 'download'): string {
  let name = (input || '').trim()

  // Strip any path components a server may have smuggled in.
  name = name.replace(/[\\/]+/g, '_')
  name = name.replace(ILLEGAL, '_')
  // Windows trims trailing dots and spaces.
  name = name.replace(/[. ]+$/, '')
  // Collapse runs of underscores/spaces produced by the scrub.
  name = name.replace(/_{2,}/g, '_').trim()

  if (!name) return fallback

  const ext = extname(name)
  const base = ext ? name.slice(0, -ext.length) : name
  if (WINDOWS_RESERVED.has(base.toUpperCase())) {
    name = `_${name}`
  }

  // Keep well under the common 255-byte component limit.
  if (name.length > 180) {
    const e = extname(name)
    name = name.slice(0, 180 - e.length) + e
  }
  return name
}

/** Parse a Content-Disposition header, preferring the RFC 5987 form. */
export function parseContentDisposition(header: string | undefined): string | null {
  if (!header) return null

  const star = /filename\*\s*=\s*([^;]+)/i.exec(header)
  if (star) {
    let value = star[1].trim().replace(/^["']|["']$/g, '')
    const parts = value.split("''")
    if (parts.length === 2) {
      const [charset, encoded] = parts
      try {
        value = decodeURIComponent(encoded)
      } catch {
        /* keep raw */
      }
      if (charset && !/^(utf-8|us-ascii)$/i.test(charset)) {
        // Best effort: decode latin1 bytes as UTF-8.
        try {
          value = Buffer.from(value, 'latin1').toString('utf8')
        } catch {
          /* ignore */
        }
      }
    }
    const cleaned = stripQuotes(value)
    if (cleaned) return cleaned
  }

  const plain = /filename\s*=\s*("(?:[^"\\]|\\.)*"|[^;]+)/i.exec(header)
  if (plain) {
    const cleaned = stripQuotes(plain[1].trim())
    if (cleaned) return cleaned
  }
  return null
}

function stripQuotes(value: string): string {
  let v = value.trim()
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    v = v.slice(1, -1).replace(/\\(.)/g, '$1')
  }
  return v.trim()
}

const EXT_BY_MIME: Record<string, string> = {
  'application/zip': '.zip',
  'application/x-7z-compressed': '.7z',
  'application/x-rar-compressed': '.rar',
  'application/x-tar': '.tar',
  'application/gzip': '.gz',
  'application/pdf': '.pdf',
  'application/json': '.json',
  'application/xml': '.xml',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/x-msdownload': '.exe',
  'application/vnd.microsoft.portable-executable': '.exe',
  'application/x-msi': '.msi',
  'application/vnd.android.package-archive': '.apk',
  'application/x-apple-diskimage': '.dmg',
  'application/x-deb': '.deb',
  'application/x-rpm': '.rpm',
  'text/plain': '.txt',
  'text/html': '.html',
  'text/csv': '.csv',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'audio/mpeg': '.mp3',
  'audio/flac': '.flac',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/mp4': '.m4a',
  'video/mp4': '.mp4',
  'video/x-matroska': '.mkv',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi'
}

export function extensionForMime(mime: string | undefined): string {
  if (!mime) return ''
  const base = mime.split(';')[0].trim().toLowerCase()
  return EXT_BY_MIME[base] ?? ''
}

/** Derive a plausible file name from a URL's last path segment. */
export function fileNameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter(Boolean)
    const last = segments[segments.length - 1]
    if (!last) return null
    const decoded = decodeURIComponent(last)
    if (!decoded || decoded === '/') return null
    // A bare index/action endpoint is not a usable file name.
    if (!/\.[a-z0-9]{1,8}$/i.test(decoded)) {
      if (/^(index|download|file|get|view|dl|redirect)$/i.test(decoded)) return null
    }
    return decoded
  } catch {
    return null
  }
}

/** Choose a file name from, in order of preference: server, URL, mime, default. */
export function resolveFileName(options: {
  contentDisposition?: string
  url: string
  mime?: string
  override?: string
}): string {
  const candidates: string[] = []
  if (options.override) candidates.push(options.override)
  const cd = parseContentDisposition(options.contentDisposition)
  if (cd) candidates.push(cd)
  const fromUrl = fileNameFromUrl(options.url)
  if (fromUrl) candidates.push(fromUrl)

  for (const candidate of candidates) {
    const cleaned = sanitizeFileName(candidate)
    if (cleaned && cleaned !== 'download' && /\.[a-z0-9]{1,8}$/i.test(cleaned)) return cleaned
  }
  for (const candidate of candidates) {
    const cleaned = sanitizeFileName(candidate)
    if (cleaned && cleaned !== 'download') {
      return cleaned + extensionForMime(options.mime)
    }
  }

  const ext = extensionForMime(options.mime) || '.bin'
  const host = (() => {
    try {
      return new URL(options.url).hostname.replace(/^www\./, '')
    } catch {
      return 'file'
    }
  })()
  return sanitizeFileName(`${host}${ext}`, `download${ext}`)
}
