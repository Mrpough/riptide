import { useApp } from '../state/store'
import type { DownloadView } from '@shared/types'
import { IconArrowDown, IconSearch } from './Icons'
import { DownloadRow } from './DownloadRow'

interface DownloadTableProps {
  items: DownloadView[]
}

function EmptyState({ hasAny }: { hasAny: boolean }): JSX.Element {
  const openAddDialog = useApp((s) => s.openAddDialog)
  const clipboardSuggestion = useApp((s) => s.clipboardSuggestion)
  const search = useApp((s) => s.search)
  const setSearch = useApp((s) => s.setSearch)

  if (search) {
    return (
      <div className="empty">
        <span className="empty__mark">
          <IconSearch size={44} />
        </span>
        <h2>No matches</h2>
        <p>Nothing in this view matches the current filter.</p>
        <button type="button" className="btn btn--bordered" onClick={() => setSearch('')}>
          Clear filter
        </button>
      </div>
    )
  }

  if (hasAny) {
    return (
      <div className="empty">
        <span className="empty__mark">
          <IconArrowDown size={44} />
        </span>
        <h2>No downloads in this view</h2>
        <p>Switch the category or status filter on the left to see your other transfers.</p>
      </div>
    )
  }

  return (
    <div className="empty">
      <span className="empty__mark">
        <IconArrowDown size={44} />
      </span>
      <h2>No downloads yet</h2>
      <p>
        Paste a link to start a multi-connection download, or use the browser extension to capture
        files automatically.
      </p>
      <button type="button" className="btn btn--primary" onClick={() => openAddDialog()}>
        Add a download
      </button>
      <span className="empty__hint">Ctrl+N to add · F5 to refresh</span>
      {clipboardSuggestion && (
        <button
          type="button"
          className="btn btn--bordered"
          onClick={() => openAddDialog(clipboardSuggestion)}
        >
          Add URL from clipboard
        </button>
      )}
    </div>
  )
}

/** Column header + scroll viewport. Rows themselves are memoised so per-item
 *  IPC patches only re-render the one row that changed. */
export function DownloadTable({ items }: DownloadTableProps): JSX.Element {
  const selection = useApp((s) => s.selection)
  const clearSelection = useApp((s) => s.clearSelection)
  const total = useApp((s) => s.downloads.length)

  if (items.length === 0) {
    return (
      <div className="list">
        <div className="list__head" aria-hidden="true">
          <span>Name</span>
          <span>Size</span>
          <span>Progress</span>
          <span>Speed</span>
          <span>ETA</span>
          <span>Status</span>
          <span />
        </div>
        <div className="list__scroll">
          <EmptyState hasAny={total > 0} />
        </div>
      </div>
    )
  }

  return (
    <div className="list">
      <div className="list__head" role="row">
        <span>Name</span>
        <span>Size</span>
        <span>Progress</span>
        <span>Speed</span>
        <span>ETA</span>
        <span>Status</span>
        <span />
      </div>
      <div
        className="list__scroll"
        role="grid"
        aria-label="Downloads"
        onClick={(e) => {
          if (e.target === e.currentTarget) clearSelection()
        }}
      >
        {items.map((item) => (
          <DownloadRow key={item.id} item={item} selected={selection.has(item.id)} />
        ))}
      </div>
    </div>
  )
}
