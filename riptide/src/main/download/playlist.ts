/**
 * Minimal HLS (RFC 8216) playlist parsing.
 *
 * We only need enough to build an ordered list of HTTP segment requests for
 * VOD-style playlists: variant selection, byte-range segments, fMP4 init
 * segments and AES-128 keys. Live playlists are treated as a single snapshot.
 */

export interface ByteRange {
  offset: number
  length: number
}

export interface SegmentKey {
  method: 'AES-128'
  uri: string
  /** Explicit IV from the playlist; when absent the media sequence is used. */
  iv?: Buffer
}

export interface PlaylistSegment {
  uri: string
  range?: ByteRange
  /** AES-128 key in force for this segment, if the playlist encrypts it. */
  key?: SegmentKey
  /** Media sequence number, also the default CBC IV. */
  sequence: number
}

export interface Variant {
  uri: string
  bandwidth: number
  width?: number
  height?: number
  codecs?: string
  name?: string
}

export interface MediaPlaylist {
  segments: PlaylistSegment[]
  /** fMP4 initialisation segment (`#EXT-X-MAP`) written before the media. */
  initSegment?: { uri: string; range?: ByteRange }
  /** False once `#EXT-X-ENDLIST` (or a VOD playlist type) has been seen. */
  isLive: boolean
  isEncrypted: boolean
}

/** True when a playlist lists alternate renditions rather than media segments. */
export function isMasterPlaylist(text: string): boolean {
  return /#EXT-X-STREAM-INF:/i.test(text)
}

export function resolveUrl(base: string, uri: string): string {
  try {
    return new URL(uri, base).toString()
  } catch {
    return uri
  }
}

/** Parse `KEY=value` pairs, honouring quoted values that contain commas. */
export function parseAttributes(input: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([A-Za-z0-9-]+)=("[^"]*"|[^,]*)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(input)) !== null) {
    let value = match[2]
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    out[match[1].toUpperCase()] = value
  }
  return out
}

function parseByteRange(spec: string, fallbackOffset: number): ByteRange | undefined {
  const match = /^(\d+)(?:@(\d+))?$/.exec(spec.trim())
  if (!match) return undefined
  const length = Number(match[1])
  const offset = match[2] !== undefined ? Number(match[2]) : fallbackOffset
  if (!Number.isFinite(length) || !Number.isFinite(offset)) return undefined
  return { offset, length }
}

function parseIv(value: string | undefined): Buffer | undefined {
  if (!value) return undefined
  const hex = value.replace(/^0x/i, '')
  if (!/^[0-9a-f]{1,32}$/i.test(hex)) return undefined
  const buffer = Buffer.from(hex.padStart(32, '0'), 'hex')
  return buffer.length === 16 ? buffer : undefined
}

/** The 16-byte big-endian IV derived from a media sequence number. */
export function sequenceIv(sequence: number): Buffer {
  const iv = Buffer.alloc(16)
  iv.writeBigUInt64BE(BigInt(Math.max(0, Math.floor(sequence))), 8)
  return iv
}

export function parseMasterPlaylist(text: string, baseUrl: string): Variant[] {
  const lines = text.split(/\r?\n/)
  const variants: Variant[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line.toUpperCase().startsWith('#EXT-X-STREAM-INF:')) continue

    const attrs = parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length))
    let uri = ''
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j].trim()
      if (!candidate || candidate.startsWith('#')) continue
      uri = candidate
      break
    }
    if (!uri) continue

    const resolution = (attrs.RESOLUTION ?? '').split('x')
    const width = Number(resolution[0])
    const height = Number(resolution[1])
    variants.push({
      uri: resolveUrl(baseUrl, uri),
      bandwidth: Number(attrs.BANDWIDTH ?? attrs['AVERAGE-BANDWIDTH'] ?? 0) || 0,
      width: Number.isFinite(width) ? width : undefined,
      height: Number.isFinite(height) ? height : undefined,
      codecs: attrs.CODECS,
      name: attrs.NAME
    })
  }

  return variants
}

/** Highest resolution (then bandwidth) first. Returns null for an empty list. */
export function selectVariant(variants: Variant[]): Variant | null {
  if (variants.length === 0) return null
  return [...variants].sort(
    (a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bandwidth - a.bandwidth
  )[0]
}

export function variantLabel(variant: Variant): string {
  if (variant.height) return `${variant.height}p`
  if (variant.bandwidth) return `${(variant.bandwidth / 1e6).toFixed(1)} Mbps`
  return 'stream'
}

export function parseMediaPlaylist(text: string, baseUrl: string): MediaPlaylist {
  const lines = text.split(/\r?\n/)
  const segments: PlaylistSegment[] = []
  let initSegment: MediaPlaylist['initSegment']
  let isLive = true
  let sequence = 0
  let currentKey: SegmentKey | undefined
  let pendingRange: ByteRange | undefined
  let pendingSegment = false
  let isEncrypted = false

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    if (line.startsWith('#')) {
      const upper = line.toUpperCase()
      if (upper.startsWith('#EXTINF:')) {
        pendingSegment = true
      } else if (upper.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
        const value = Number(line.slice(line.indexOf(':') + 1))
        if (Number.isFinite(value)) sequence = value
      } else if (upper.startsWith('#EXT-X-KEY:')) {
        const attrs = parseAttributes(line.slice(line.indexOf(':') + 1))
        if (attrs.METHOD === 'AES-128' && attrs.URI) {
          currentKey = {
            method: 'AES-128',
            uri: resolveUrl(baseUrl, attrs.URI),
            iv: parseIv(attrs.IV)
          }
          isEncrypted = true
        } else {
          currentKey = undefined
        }
      } else if (upper.startsWith('#EXT-X-MAP:')) {
        const attrs = parseAttributes(line.slice(line.indexOf(':') + 1))
        if (attrs.URI) {
          initSegment = {
            uri: resolveUrl(baseUrl, attrs.URI),
            range: attrs.BYTERANGE ? parseByteRange(attrs.BYTERANGE, 0) : undefined
          }
        }
      } else if (upper.startsWith('#EXT-X-BYTERANGE:')) {
        const spec = line.slice(line.indexOf(':') + 1)
        const last = segments[segments.length - 1]
        const fallback = last?.range ? last.range.offset + last.range.length : 0
        pendingRange = parseByteRange(spec, fallback)
      } else if (upper.startsWith('#EXT-X-ENDLIST')) {
        isLive = false
      } else if (upper.startsWith('#EXT-X-PLAYLIST-TYPE:')) {
        if (line.slice(line.indexOf(':') + 1).trim().toUpperCase() === 'VOD') isLive = false
      }
      continue
    }

    if (!pendingSegment) continue
    segments.push({
      uri: resolveUrl(baseUrl, line),
      range: pendingRange,
      key: currentKey,
      sequence: sequence + segments.length
    })
    pendingRange = undefined
    pendingSegment = false
  }

  return { segments, initSegment, isLive, isEncrypted }
}
