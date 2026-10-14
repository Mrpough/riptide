import { MIN_SEGMENT_BYTES, SINGLE_CONNECTION_THRESHOLD } from '@shared/defaults'
import type { DownloadSegment } from '@shared/types'

/**
 * Split a known-size resource into N byte ranges, evenly distributing the
 * remainder. Falls back to a single range when the file is small or the
 * connection count is 1.
 */
export function planSegments(size: number, connections: number): DownloadSegment[] {
  if (size <= 0 || size <= SINGLE_CONNECTION_THRESHOLD) {
    return [makeSegment(0, 0, size > 0 ? size - 1 : -1)]
  }

  const maxBySize = Math.floor(size / MIN_SEGMENT_BYTES)
  const count = Math.max(1, Math.min(connections, maxBySize || 1))

  const base = Math.floor(size / count)
  const remainder = size % count

  const segments: DownloadSegment[] = []
  let offset = 0
  for (let i = 0; i < count; i++) {
    const length = base + (i < remainder ? 1 : 0)
    segments.push(makeSegment(i, offset, offset + length - 1))
    offset += length
  }
  return segments
}

/** A single range covering the whole resource (used when ranges are unsupported). */
export function singleSegment(size: number): DownloadSegment[] {
  return [makeSegment(0, 0, size > 0 ? size - 1 : -1)]
}

function makeSegment(index: number, start: number, end: number): DownloadSegment {
  return { index, start, end, downloaded: 0, done: false }
}

/** Total bytes accounted for across segments. */
export function sumDownloaded(segments: DownloadSegment[]): number {
  let total = 0
  for (const s of segments) total += s.downloaded
  return total
}

/** True when every segment has reached its end. */
export function allSegmentsDone(segments: DownloadSegment[]): boolean {
  return segments.every((s) => s.done)
}

/**
 * Repair a segment list loaded from disk: clamp progress to the range,
 * recompute done flags, and make sure ranges still tile [0, size).
 */
export function reconcileSegments(segments: DownloadSegment[], _size: number): DownloadSegment[] {
  return segments.map((s) => {
    const capacity = s.end >= s.start ? s.end - s.start + 1 : Math.max(0, s.downloaded)
    const downloaded = Math.max(0, Math.min(s.downloaded, capacity))
    const done = s.end >= s.start ? downloaded >= capacity : s.done
    return { ...s, downloaded, done }
  })
}
