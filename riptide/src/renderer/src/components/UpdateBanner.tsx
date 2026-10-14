import { useApp } from '../state/store'
import { IconArrowDown, IconLink, IconRefresh, IconX } from './Icons'

/** Contextual banner above the list: update lifecycle, else a clipboard offer. */
export function UpdateBanner(): JSX.Element | null {
  const update = useApp((s) => s.update)
  const clipboardSuggestion = useApp((s) => s.clipboardSuggestion)
  const setClipboardSuggestion = useApp((s) => s.setClipboardSuggestion)
  const openAddDialog = useApp((s) => s.openAddDialog)

  const api = window.riptide

  if (update.stage === 'available') {
    return (
      <div className="banner" role="status">
        <span className="banner__icon">
          <IconArrowDown size={15} />
        </span>
        <span className="banner__text">
          Riptide <b>{update.version}</b> is available.
          {update.releaseNotes ? ` ${update.releaseNotes.split('\n')[0]}` : ''}
        </span>
        <button type="button" className="btn btn--primary" onClick={() => void api.update.download()}>
          Download update
        </button>
      </div>
    )
  }

  if (update.stage === 'downloading') {
    return (
      <div className="banner" role="status">
        <span className="banner__icon">
          <IconRefresh size={15} />
        </span>
        <span className="banner__text">
          Downloading update <b>{update.version}</b> — {Math.round(update.percent ?? 0)}%
        </span>
        <span className="banner__bar" aria-hidden="true">
          <span style={{ width: `${Math.min(100, update.percent ?? 0)}%` }} />
        </span>
      </div>
    )
  }

  if (update.stage === 'downloaded') {
    return (
      <div className="banner" role="status">
        <span className="banner__icon">
          <IconRefresh size={15} />
        </span>
        <span className="banner__text">
          Riptide <b>{update.version}</b> is ready. Restart to finish installing.
        </span>
        <button type="button" className="btn btn--primary" onClick={() => void api.update.install()}>
          Restart and install
        </button>
      </div>
    )
  }

  if (clipboardSuggestion) {
    return (
      <div className="banner" role="status">
        <span className="banner__icon">
          <IconLink size={15} />
        </span>
        <span className="banner__text">
          Download the link on your clipboard? <b>{clipboardSuggestion}</b>
        </span>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            openAddDialog(clipboardSuggestion)
            setClipboardSuggestion(null)
          }}
        >
          Add it
        </button>
        <button
          type="button"
          className="iconbtn"
          aria-label="Dismiss"
          onClick={() => setClipboardSuggestion(null)}
        >
          <IconX size={14} />
        </button>
      </div>
    )
  }

  return null
}
