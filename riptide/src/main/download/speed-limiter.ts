import { setTimeout as delay } from 'node:timers/promises'

/**
 * A token bucket shared by every connection in the app, so a global speed cap
 * applies across all concurrent downloads rather than per download.
 *
 * Tokens refill at `rate` bytes/second with a one-second burst ceiling. When
 * `rate` is 0 the limiter is a no-op.
 */
export class SpeedLimiter {
  private rate = 0
  private tokens = 0
  private lastRefill = Date.now()

  setRate(bytesPerSecond: number): void {
    const next = Math.max(0, Math.floor(bytesPerSecond || 0))
    if (next === this.rate) return
    this.rate = next
    this.tokens = Math.min(this.tokens, this.rate)
    this.lastRefill = Date.now()
  }

  getRate(): number {
    return this.rate
  }

  get limited(): boolean {
    return this.rate > 0
  }

  /** Wait until `bytes` may be sent, or until the signal aborts. */
  async consume(bytes: number, signal?: AbortSignal): Promise<void> {
    if (this.rate <= 0 || bytes <= 0) return

    // A request larger than a full second of budget needs multiple rounds.
    let remaining = bytes
    while (remaining > 0) {
      this.refill()
      if (signal?.aborted) throw signal.reason ?? new Error('aborted')

      const grant = Math.min(remaining, this.tokens)
      if (grant >= 1) {
        this.tokens -= grant
        remaining -= grant
        continue
      }

      const deficit = Math.min(remaining, this.rate) - this.tokens
      const waitMs = Math.max(10, Math.min(500, (deficit / this.rate) * 1000))
      await delay(waitMs, undefined, { signal }).catch(() => undefined)
    }
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    if (elapsed <= 0) return
    this.lastRefill = now
    this.tokens = Math.min(this.rate, this.tokens + elapsed * this.rate)
  }
}
