const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

/** Format a byte count like `1.4 GB`. Unknown (-1) renders as an em dash. */
export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes === null || bytes === undefined || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / Math.pow(1024, i)
  const fixed = i === 0 ? 0 : digits
  return `${value.toFixed(fixed)} ${UNITS[i]}`
}

/** Format a transfer rate like `3.2 MB/s`. */
export function formatSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '—'
  return `${formatBytes(bytesPerSecond)}/s`
}

/** Format a duration in seconds like `1h 04m` or `00:42`. */
export function formatEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '—'
  }
  const s = Math.floor(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const remS = s % 60
  if (m < 60) return `${m}m ${String(remS).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  const remM = m % 60
  if (h < 24) return `${h}h ${String(remM).padStart(2, '0')}m`
  const d = Math.floor(h / 24)
  return `${d}d ${String(h % 24).padStart(2, '0')}h`
}

export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '—'
  return `${(fraction * 100).toFixed(fraction >= 0.9995 ? 0 : 1)}%`
}

export function formatDate(ms: number | undefined): string {
  if (!ms) return '—'
  const d = new Date(ms)
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text
  const keep = Math.floor((max - 1) / 2)
  return `${text.slice(0, keep)}…${text.slice(text.length - keep)}`
}
