/**
 * Pragmatic MPEG-DASH MPD parsing for the common VOD case: a single Period
 * whose Representations describe their media with a SegmentTemplate or a
 * SegmentList. DRM (`ContentProtection`) and `SegmentTimeline` are out of
 * scope; a manifest that needs them simply falls back to a normal download.
 */

import { resolveUrl, type ByteRange } from './playlist'

export interface DashSegment {
  uri: string
  range?: ByteRange
}

export interface DashManifest {
  initSegment?: { uri: string; range?: ByteRange }
  segments: DashSegment[]
  bandwidth: number
  width?: number
  height?: number
  representationId?: string
}

interface Candidate {
  bandwidth: number
  width?: number
  height?: number
  representationId?: string
  baseUrl: string
  template?: Record<string, string>
  list?: DashSegment[]
}

function attrOf(tag: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)
  return match ? match[1] : undefined
}

/** Parse an ISO-8601 duration such as `PT1H2M3.5S` into seconds. */
export function parseIsoDuration(value: string | undefined): number {
  if (!value) return 0
  const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
    value.trim()
  )
  if (!match) return 0
  const [, d, h, m, s] = match
  return (
    (Number(d) || 0) * 86400 +
    (Number(h) || 0) * 3600 +
    (Number(m) || 0) * 60 +
    (Number(s) || 0)
  )
}

function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\$\$|\$([A-Za-z]+)(?:%0(\d+)d)?\$/g, (match, name?: string, pad?: string) => {
    if (match === '$$') return '$'
    if (!name || !(name in vars)) return match
    const value = String(vars[name])
    return pad ? value.padStart(Number(pad), '0') : value
  })
}

function firstBaseUrl(scope: string): string | undefined {
  const match = /<BaseURL[^>]*>([\s\S]*?)<\/BaseURL>/i.exec(scope)
  return match ? match[1].trim() : undefined
}

function firstSegmentTemplate(scope: string): Record<string, string> | undefined {
  const match = /<SegmentTemplate\b([^>]*?)\/?>/i.exec(scope)
  if (!match) return undefined
  const attrs: Record<string, string> = {}
  const re = /([A-Za-z]+)\s*=\s*"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(match[1])) !== null) attrs[m[1]] = m[2]
  return attrs
}

function parseSegmentList(scope: string, base: string): DashSegment[] | undefined {
  const block = /<SegmentList\b[^>]*>([\s\S]*?)<\/SegmentList>/i.exec(scope)
  if (!block) return undefined
  const segments: DashSegment[] = []
  const re = /<SegmentURL\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(block[1])) !== null) {
    const media = attrOf(m[0], 'media')
    if (media) segments.push({ uri: resolveUrl(base, media) })
  }
  return segments.length > 0 ? segments : undefined
}

function collectRepresentations(
  xml: string,
  mpdBase: string,
  periodDuration: number
): Candidate[] {
  const candidates: Candidate[] = []
  const adaptationRe = /<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/gi
  let adaptation: RegExpExecArray | null

  while ((adaptation = adaptationRe.exec(xml)) !== null) {
    const adaptationScope = adaptation[2]
    const adaptationBase = resolveUrl(
      mpdBase,
      firstBaseUrl(adaptationScope) ?? firstBaseUrl(adaptation[0]) ?? '.'
    )
    const adaptationTemplate = firstSegmentTemplate(adaptationScope)

    const repRe = /<Representation\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Representation>)/gi
    let rep: RegExpExecArray | null
    while ((rep = repRe.exec(adaptationScope)) !== null) {
      const repAttrs = rep[1]
      const repBody = rep[2] ?? ''
      const base = resolveUrl(adaptationBase, firstBaseUrl(repBody) ?? '.')

      candidates.push({
        bandwidth: Number(attrOf(repAttrs, 'bandwidth') ?? 0) || 0,
        width: Number(attrOf(repAttrs, 'width')) || undefined,
        height: Number(attrOf(repAttrs, 'height')) || undefined,
        representationId: attrOf(repAttrs, 'id'),
        baseUrl: base,
        template: firstSegmentTemplate(repBody) ?? adaptationTemplate,
        list: parseSegmentList(repBody, base)
      })
    }
  }

  void periodDuration
  return candidates
}

/** Resolve a candidate into a concrete, ordered segment list. */
function materialise(
  candidate: Candidate,
  periodDuration: number
): { initSegment?: { uri: string }; segments: DashSegment[] } {
  if (candidate.list && candidate.list.length > 0) {
    return { segments: candidate.list }
  }

  const template = candidate.template
  if (!template || !template.media) return { segments: [] }

  const timescale = Number(template.timescale ?? 1) || 1
  const startNumber = Number(template.startNumber ?? 1) || 1
  const duration = Number(template.duration ?? 0)
  const vars: Record<string, string | number> = {
    Number: startNumber,
    Bandwidth: candidate.bandwidth,
    RepresentationID: candidate.representationId ?? '',
    Time: 0
  }

  const segments: DashSegment[] = []
  if (duration > 0 && periodDuration > 0) {
    const count = Math.max(1, Math.ceil((periodDuration * timescale) / duration))
    for (let i = 0; i < count; i++) {
      const media = fillTemplate(template.media, { ...vars, Number: startNumber + i })
      segments.push({ uri: resolveUrl(candidate.baseUrl, media) })
    }
  }

  const initSegment = template.initialization
    ? { uri: resolveUrl(candidate.baseUrl, fillTemplate(template.initialization, vars)) }
    : undefined

  return { initSegment, segments }
}

/** Pick the highest-quality Representation and resolve its segments. */
export function parseMpd(text: string, baseUrl: string): DashManifest {
  const mpdOpen = /<MPD\b([^>]*)>/i.exec(text)
  const total = parseIsoDuration(attrOf(mpdOpen?.[1] ?? '', 'mediaPresentationDuration'))
  const periodOpen = /<Period\b([^>]*)>/i.exec(text)
  const periodStart = parseIsoDuration(attrOf(periodOpen?.[1] ?? '', 'start'))
  const periodDuration =
    parseIsoDuration(attrOf(periodOpen?.[1] ?? '', 'duration')) || Math.max(0, total - periodStart)

  // An <BaseURL> before the first Period shifts every segment path.
  const preamble = text.split(/<Period\b/i)[0] ?? text
  const mpdBase = resolveUrl(baseUrl, firstBaseUrl(preamble) ?? '.')

  const candidates = collectRepresentations(text, mpdBase, periodDuration).filter(
    (c) => c.list?.length || c.template?.media
  )
  if (candidates.length === 0) {
    return { segments: [], bandwidth: 0 }
  }

  const best = [...candidates].sort(
    (a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bandwidth - a.bandwidth
  )[0]

  const { initSegment, segments } = materialise(best, periodDuration)
  return {
    initSegment,
    segments,
    bandwidth: best.bandwidth,
    width: best.width,
    height: best.height,
    representationId: best.representationId
  }
}
