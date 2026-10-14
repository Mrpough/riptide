import { memo, type MouseEvent } from 'react'
import { formatBytes, formatEta, formatSpeed, truncateMiddle } from '@shared/format'
import type { DownloadStatus, DownloadView } from '@shared/types'
import { useApp } from '../state/store'
import {
  IconExternal,
  IconFile,
  IconPause,
  IconPlay,
  IconTrash,
  IconAlert,
  IconCode,
  IconArchive,
  IconMusic,
  IconVideo,
  IconGlobe
} from './Icons'
import { ProgressRail } from './ProgressRail'

const STATUS_LABEL: Record<DownloadStatus, string> = {
  queued: 'Queued',
  connecting: 'Connecting',
  downloading: 'Downloading',
  paused: 'Paused',
  completed: 'Completed',
  error: 'Failed',
  stopped: 'Stopped'
}

const CATEGORY_ICON: Record<string, JSX.Element> = {
  compressed: <IconArchive size={14} />,
  documents: <IconFile size={14} />,
  music: <IconMusic size={14} />,
  video: <IconVideo size={14} />,
  programs: <IconCode size={14} />,
  other: <IconGlobe size={14} />
}

const TOGGLE_STATUS = new Set<DownloadStatus>(['downloading', 'connecting', 'queued'])
const RESUMABLE_STATUS = new Set<DownloadStatus>(['paused', 'stopped', 'error'])

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

interface DownloadRowProps {
  item: DownloadView
  selected: boolean
}

export const DownloadRow = memo<DownloadRowProps>(function DownloadRow({
  item,
  selected
}: DownloadRowProps): JSX.Element {
  const openContextMenu = useApp((s) => s.openContextMenu)
  const toggleSelection = useApp((s) => s.toggleSelection)
  const api = window.riptide

  const running = TOGGLE_STATUS.has(item.status)
  const canResume = RESUMABLE_STATUS.has(item.status)
  const done = item.status === 'completed'

  const handleClick = (event: MouseEvent<HTMLDivElement>): void => {
    toggleSelection(item.id, event.ctrlKey || event.metaKey)
  }

  const handleDoubleClick = (): void => {
    if (done) void api.downloads.openFile(item.id)
    else if (canResume) void api.downloads.resume(item.id)
    else if (running) void api.downloads.pause(item.id)
  }

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    if (!selected) toggleSelection(item.id, false)
    openContextMenu({ id: item.id, x: event.clientX, y: event.clientY })
  }

  const primaryLabel = running ? 'Pause' : canResume ? (item.status === 'error' ? 'Retry' : 'Resume') : null

  return (
    <div
      className="row"
      data-selected={selected ? 'true' : 'false'}
      role="row"
      tabIndex={0}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
      <div className="row__name">
        <span className="row__type" data-category={item.category}>
          {CATEGORY_ICON[item.category] ?? <IconGlobe size={14} />}
        </span>
        <span className="row__text">
          <span className="row__title" title={item.fileName}>
            {item.fileName}
          </span>
          <span className="row__sub" title={item.url}>
            {hostOf(item.url)}
            {item.status === 'downloading' && ` · ${item.connections} segs`}
            {item.error && item.status === 'error' ? ` · ${truncateMiddle(item.error, 48)}` : ''}
          </span>
        </span>
      </div>

      <div className="row__size">{formatBytes(item.size)}</div>

      <ProgressRail item={item} />

      <div className="row__speed">{running ? formatSpeed(item.speed) : '—'}</div>
      <div className="row__eta">{running ? formatEta(item.eta) : '—'}</div>

      <span className="chip" data-status={item.status}>
        <span className="chip__dot" />
        {STATUS_LABEL[item.status]}
      </span>

      <div className="row__actions">
        {primaryLabel && (
          <button
            type="button"
            className="iconbtn"
            title={primaryLabel}
            aria-label={`${primaryLabel} ${item.fileName}`}
            onClick={(e) => {
              e.stopPropagation()
              if (running) void api.downloads.pause(item.id)
              else void api.downloads.resume(item.id)
            }}
          >
            {running ? <IconPause size={14} /> : <IconPlay size={14} />}
          </button>
        )}

        {done && (
          <button
            type="button"
            className="iconbtn"
            title="Open file"
            aria-label={`Open ${item.fileName}`}
            onClick={(e) => {
              e.stopPropagation()
              void api.downloads.openFile(item.id)
            }}
          >
            <IconExternal size={14} />
          </button>
        )}

        {item.status === 'error' && (
          <span className="iconbtn" title={item.error} aria-hidden="true">
            <IconAlert size={14} />
          </span>
        )}

        <button
          type="button"
          className="iconbtn iconbtn--danger"
          title="Remove from list"
          aria-label={`Remove ${item.fileName}`}
          onClick={(e) => {
            e.stopPropagation()
            const confirm = useApp.getState().settings?.confirmOnRemove
            if (confirm && !window.confirm(`Remove "${item.fileName}" from the list?`)) return
            void api.downloads.remove(item.id, false)
          }}
        >
          <IconTrash size={14} />
        </button>
      </div>
    </div>
  )
})
