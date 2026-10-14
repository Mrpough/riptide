import { formatSpeed } from '@shared/format'
import { useApp } from '../state/store'
import { IconArrowDown, IconMaximize, IconMinimize, IconRestore, IconX } from './Icons'

/**
 * Frameless titlebar. Carries the brand, a live "signal sweep" activity bar
 * that animates whenever bytes are moving, and the window controls.
 */
export function TitleBar(): JSX.Element {
  const stats = useApp((s) => s.stats)
  const maximized = useApp((s) => s.maximized)
  const active = stats.activeCount > 0

  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <span className="titlebar__mark">
          <IconArrowDown size={18} />
        </span>
        Riptide
      </div>
      <span className="titlebar__tag">download manager</span>

      <div className="titlebar__activity" data-active={active ? 'true' : 'false'} />

      <div className="titlebar__readout">
        <strong>{formatSpeed(stats.totalSpeed)}</strong>
        <span>{stats.totalConnections} conn</span>
      </div>

      <div className="titlebar__controls">
        <button
          type="button"
          className="winbtn"
          title="Minimize"
          aria-label="Minimize"
          onClick={() => void window.riptide.window.minimize()}
        >
          <IconMinimize size={15} />
        </button>
        <button
          type="button"
          className="winbtn"
          title={maximized ? 'Restore' : 'Maximize'}
          aria-label={maximized ? 'Restore' : 'Maximize'}
          onClick={() => void window.riptide.window.toggleMaximize()}
        >
          {maximized ? <IconRestore size={15} /> : <IconMaximize size={15} />}
        </button>
        <button
          type="button"
          className="winbtn winbtn--close"
          title="Close"
          aria-label="Close"
          onClick={() => void window.riptide.window.close()}
        >
          <IconX size={15} />
        </button>
      </div>
    </header>
  )
}
