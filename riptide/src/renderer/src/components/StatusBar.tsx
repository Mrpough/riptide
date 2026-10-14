import { formatBytes, formatSpeed } from '@shared/format'
import { useApp } from '../state/store'
import { IconGauge, IconPulse, IconRefresh } from './Icons'

/** Thin status strip: aggregate counters, speed cap and the update affordance. */
export function StatusBar(): JSX.Element {
  const stats = useApp((s) => s.stats)
  const update = useApp((s) => s.update)
  const appInfo = useApp((s) => s.appInfo)
  const openSettings = useApp((s) => s.openSettings)

  const api = window.riptide
  const limited = stats.speedLimit > 0

  const updateLabel = (): string | null => {
    switch (update.stage) {
      case 'checking':
        return 'Checking for updates…'
      case 'available':
        return `Update available: ${update.version ?? ''}`.trim()
      case 'downloading':
        return `Downloading update ${Math.round(update.percent ?? 0)}%`
      case 'downloaded':
        return `Restart to install ${update.version ?? ''}`.trim()
      case 'error':
        return 'Update check failed'
      default:
        return null
    }
  }

  const label = updateLabel()

  const onUpdateClick = (): void => {
    if (update.stage === 'available') void api.update.download()
    else if (update.stage === 'downloaded') void api.update.install()
    else if (update.stage === 'error' || update.stage === 'not-available')
      void api.update.check()
    else openSettings()
  }

  return (
    <footer className="statusbar">
      <span className="statusbar__item">
        <IconPulse size={12} />
        <b>{stats.activeCount}</b> active
      </span>
      <span className="statusbar__item">
        <b>{stats.queuedCount}</b> queued
      </span>
      <span className="statusbar__item">
        <b>{stats.completedCount}</b> done
      </span>
      <span className="statusbar__item">
        <b>{formatSpeed(stats.totalSpeed)}</b>
      </span>
      <span className="statusbar__item">
        <b>{stats.totalConnections}</b> conn
      </span>

      {limited && (
        <span className="statusbar__item statusbar__limiter">
          <IconGauge size={12} />
          cap {formatBytes(stats.speedLimit)}/s
        </span>
      )}

      <span className="statusbar__spacer" />

      {label && (
        <button type="button" className="statusbar__update" onClick={onUpdateClick}>
          <IconRefresh size={12} />
          {label}
        </button>
      )}

      <span className="statusbar__item mono">Riptide {appInfo?.version ?? ''}</span>
    </footer>
  )
}
