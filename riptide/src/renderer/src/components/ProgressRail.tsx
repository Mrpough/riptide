import { memo } from 'react'
import { formatBytes, formatPercent } from '@shared/format'
import type { DownloadView } from '@shared/types'

interface ProgressRailProps {
  item: DownloadView
}

/**
 * The signature progress treatment: a thin track whose fill colour encodes
 * status, overlaid with evenly spaced "segment ticks" so multi-connection
 * downloads read as parallel lanes rather than one opaque bar.
 */
export const ProgressRail = memo<ProgressRailProps>(function ProgressRail({
  item
}: ProgressRailProps): JSX.Element {
  const totalKnown = item.size > 0
  const fraction = totalKnown ? Math.min(1, item.downloaded / item.size) : 0
  const segs = item.segmentProgress

  return (
    <div className="rail" data-status={item.status}>
      <div
        className="rail__track"
        role="progressbar"
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${item.fileName} progress`}
      >
        <div className="rail__fill" style={{ width: `${(fraction * 100).toFixed(2)}%` }} />
        {segs.length > 1 && (
          <div className="rail__segs" aria-hidden="true">
            {segs.map((_, index) => (
              <span key={index} className="rail__seg" />
            ))}
          </div>
        )}
      </div>
      <div className="rail__meta">
        <b>{totalKnown ? formatPercent(fraction) : `${item.downloaded > 0 ? '?' : '0%'}`}</b>
        <span>
          {formatBytes(item.downloaded)}
          {totalKnown ? ` / ${formatBytes(item.size)}` : ''}
        </span>
      </div>
    </div>
  )
})
