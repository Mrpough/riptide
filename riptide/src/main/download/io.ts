import type { FileHandle } from 'node:fs/promises'
import { TUNING } from '@shared/defaults'
import type { SpeedLimiter } from './speed-limiter'

/** The reason an AbortSignal was aborted, normalised to an Error. */
export function abortReason(signal: AbortSignal): Error {
  return (signal.reason as Error) ?? new Error('aborted')
}

/** Tear a response body down without reading it (used on the error paths). */
export function destroyBody(body: unknown): void {
  const destroy = (body as { destroy?: () => void }).destroy
  if (typeof destroy === 'function') destroy.call(body)
}

/** Write a whole buffer at an absolute file position, looping over short writes. */
export async function writeFully(
  handle: FileHandle | null,
  buffer: Buffer,
  position: number
): Promise<void> {
  if (!handle) throw new Error('File handle is not open')
  let written = 0
  while (written < buffer.length) {
    const { bytesWritten } = await handle.write(
      buffer,
      written,
      buffer.length - written,
      position + written
    )
    if (bytesWritten <= 0) throw new Error('Disk write returned 0 bytes')
    written += bytesWritten
  }
}

/**
 * Await the next chunk from a body, rejecting if no bytes arrive within
 * `timeoutMs`. The optional `onIdle` hook lets the caller abort the underlying
 * request so the socket is torn down rather than left dangling.
 */
export function nextWithIdle(
  iterator: AsyncIterator<Buffer>,
  timeoutMs: number,
  onIdle: () => void
): Promise<IteratorResult<Buffer>> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onIdle()
      reject(new Error('IDLE_TIMEOUT'))
    }, timeoutMs)
  })
  return Promise.race([iterator.next(), timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  }) as Promise<IteratorResult<Buffer>>
}

/**
 * Read an entire response body into memory, honouring the global speed limiter
 * and the idle watchdog. Used for playlists and media segments, which are small
 * enough to buffer whole.
 */
export async function readAll(
  body: AsyncIterable<Buffer>,
  limiter: SpeedLimiter,
  signal: AbortSignal,
  timeoutMs: number = TUNING.idleTimeoutMs
): Promise<Buffer> {
  const chunks: Buffer[] = []
  const iterator = body[Symbol.asyncIterator]()
  try {
    for (;;) {
      if (signal.aborted) throw abortReason(signal)
      const result = await nextWithIdle(iterator, timeoutMs, () => undefined)
      if (result.done) break
      const buffer = Buffer.isBuffer(result.value)
        ? result.value
        : Buffer.from(result.value as Uint8Array)
      if (buffer.length === 0) continue
      await limiter.consume(buffer.length, signal)
      chunks.push(buffer)
    }
  } finally {
    await iterator.return?.(undefined).catch(() => undefined)
  }
  return Buffer.concat(chunks)
}
