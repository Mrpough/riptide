import { Menu, Tray } from 'electron'
import type { TransferStats } from '@shared/channels'
import type { DownloadManager } from './download/manager'
import { createLogger } from './logger'
import { trayIcon } from './icons'
import { formatSpeed } from '@shared/format'

const log = createLogger('tray')

export interface TrayOptions {
  manager: DownloadManager
  showWindow: () => void
  quit: () => void
}

export class TrayController {
  private tray: Tray | null = null
  private readonly options: TrayOptions
  private lastTooltip = 'Riptide'

  constructor(options: TrayOptions) {
    this.options = options
  }

  create(): void {
    if (this.tray) return
    try {
      this.tray = new Tray(trayIcon())
    } catch (err) {
      log.warn('could not create tray icon', err)
      return
    }
    this.tray.setToolTip('Riptide')
    this.tray.on('click', () => this.options.showWindow())
    this.rebuildMenu()
  }

  private rebuildMenu(): void {
    if (!this.tray) return
    const { manager } = this.options
    const menu = Menu.buildFromTemplate([
      { label: 'Open Riptide', click: () => this.options.showWindow() },
      { type: 'separator' },
      { label: 'Pause all', click: () => manager.pauseAll() },
      { label: 'Resume all', click: () => manager.resumeAll() },
      { label: 'Remove completed', click: () => void manager.removeCompleted(false) },
      { type: 'separator' },
      { label: 'Quit Riptide', click: () => this.options.quit() }
    ])
    this.tray.setContextMenu(menu)
  }

  update(stats: TransferStats): void {
    if (!this.tray) return
    const tooltip =
      stats.activeCount > 0
        ? `Riptide — ${stats.activeCount} downloading · ${formatSpeed(stats.totalSpeed)}`
        : stats.queuedCount > 0
          ? `Riptide — ${stats.queuedCount} queued`
          : 'Riptide — idle'
    if (tooltip !== this.lastTooltip) {
      this.lastTooltip = tooltip
      this.tray.setToolTip(tooltip)
    }
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
