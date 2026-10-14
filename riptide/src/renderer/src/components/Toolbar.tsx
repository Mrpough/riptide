import { useApp } from '../state/store'
import {
  IconArchive,
  IconGear,
  IconPause,
  IconPlay,
  IconPlus,
  IconSearch,
  IconSpider,
  IconStop,
  IconX
} from './Icons'

/** Primary action strip: add, bulk transfer controls, search and settings. */
export function Toolbar(): JSX.Element {
  const downloads = useApp((s) => s.downloads)
  const stats = useApp((s) => s.stats)
  const search = useApp((s) => s.search)
  const openAddDialog = useApp((s) => s.openAddDialog)
  const openSettings = useApp((s) => s.openSettings)
  const openGrabber = useApp((s) => s.openGrabber)
  const setSearch = useApp((s) => s.setSearch)

  const api = window.riptide
  const hasItems = downloads.length > 0
  const canResume = downloads.some(
    (d) => d.status === 'paused' || d.status === 'stopped' || d.status === 'error'
  )
  const canPause = stats.activeCount > 0 || stats.queuedCount > 0
  const completedCount = downloads.filter((d) => d.status === 'completed').length

  return (
    <div className="toolbar">
      <button type="button" className="btn btn--primary" onClick={() => openAddDialog()}>
        <IconPlus size={15} />
        New
      </button>

      <div className="toolbar__divider" />

      <button
        type="button"
        className="btn"
        disabled={!canResume}
        onClick={() => void api.downloads.resumeAll()}
        title="Resume all paused downloads"
      >
        <IconPlay size={14} />
        Resume
      </button>
      <button
        type="button"
        className="btn"
        disabled={!canPause}
        onClick={() => void api.downloads.pauseAll()}
        title="Pause all active downloads"
      >
        <IconPause size={14} />
        Pause
      </button>
      <button
        type="button"
        className="btn"
        disabled={!hasItems}
        onClick={() => void api.downloads.stopAll()}
        title="Stop all downloads"
      >
        <IconStop size={14} />
        Stop
      </button>

      <div className="toolbar__divider" />

      <button
        type="button"
        className="btn btn--danger"
        disabled={completedCount === 0}
        onClick={() => void api.downloads.removeCompleted(false)}
        title="Remove finished downloads from the list"
      >
        <IconArchive size={14} />
        Clear done
      </button>

      <div className="toolbar__spacer" />

      <div className="search">
        <span className="search__icon">
          <IconSearch size={14} />
        </span>
        <input
          type="search"
          value={search}
          placeholder="Filter by name or URL"
          spellCheck={false}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Filter downloads"
        />
        {search && (
          <button
            type="button"
            className="iconbtn search__clear"
            aria-label="Clear filter"
            onClick={() => setSearch('')}
          >
            <IconX size={13} />
          </button>
        )}
      </div>

      <button
        type="button"
        className="btn"
        title="Site grabber"
        onClick={openGrabber}
      >
        <IconSpider size={14} />
        Grabber
      </button>

      <button
        type="button"
        className="btn btn--icon"
        title="Settings"
        aria-label="Settings"
        onClick={openSettings}
      >
        <IconGear size={16} />
      </button>
    </div>
  )
}
