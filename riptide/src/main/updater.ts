import { app } from 'electron'
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater'
import type { UpdateState } from '@shared/types'
import type { Logger } from './logger'

export interface UpdateServiceOptions {
  onState: (state: UpdateState) => void
  autoCheck: () => boolean
  channel: () => 'stable' | 'beta'
  log: Logger
}

/**
 * Wraps electron-updater. Updates are checked against the GitHub Releases feed
 * configured in electron-builder.yml (`publish`). Downloads are user-initiated
 * so a metered connection is never surprised, and the install happens on quit
 * or on demand.
 */
export class UpdateService {
  private state: UpdateState = { stage: 'idle' }
  private readonly options: UpdateServiceOptions
  private checkTimer: NodeJS.Timeout | null = null
  private currentVersion: string | undefined

  constructor(options: UpdateServiceOptions) {
    this.options = options
    this.configure()
  }

  getState(): UpdateState {
    return this.state
  }

  private setState(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.options.onState(this.state)
  }

  private configure(): void {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = this.options.channel() === 'beta'
    // Keep electron-updater's console chatter inside our logger.
    autoUpdater.logger = {
      info: (...args: unknown[]) => this.options.log.info('[updater]', ...args),
      warn: (...args: unknown[]) => this.options.log.warn('[updater]', ...args),
      error: (...args: unknown[]) => this.options.log.error('[updater]', ...args),
      debug: (...args: unknown[]) => this.options.log.debug('[updater]', ...args)
    }

    autoUpdater.on('checking-for-update', () => this.setState({ stage: 'checking', message: undefined }))
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.currentVersion = info.version
      this.setState({
        stage: 'available',
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
        releaseDate: info.releaseDate,
        percent: undefined,
        message: undefined
      })
    })
    autoUpdater.on('update-not-available', () =>
      this.setState({ stage: 'not-available', percent: undefined })
    )
    autoUpdater.on('download-progress', (progress: ProgressInfo) =>
      this.setState({
        stage: 'downloading',
        percent: Math.round(progress.percent * 10) / 10,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total
      })
    )
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.currentVersion = info.version
      this.setState({ stage: 'downloaded', version: info.version, percent: 100 })
    })
    autoUpdater.on('error', (err: Error) => {
      this.options.log.warn('[updater] error', err.message)
      this.setState({ stage: 'error', message: err.message })
    })
  }

  /** Schedule a background check shortly after launch, then every few hours. */
  scheduleBackgroundChecks(): void {
    if (!app.isPackaged) return
    const run = (): void => {
      if (this.options.autoCheck()) void this.check(false)
    }
    setTimeout(run, 12_000)
    this.checkTimer = setInterval(run, 6 * 60 * 60 * 1000)
  }

  stop(): void {
    if (this.checkTimer) clearInterval(this.checkTimer)
    this.checkTimer = null
  }

  async check(manual = true): Promise<UpdateState> {
    if (!app.isPackaged) {
      if (manual) {
        this.setState({
          stage: 'not-available',
          message: 'Update checks are disabled in development builds.'
        })
      }
      return this.state
    }

    autoUpdater.allowPrerelease = this.options.channel() === 'beta'
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.setState({ stage: 'error', message })
    }
    return this.state
  }

  async download(): Promise<void> {
    if (!app.isPackaged) return
    try {
      this.setState({ stage: 'downloading', percent: 0 })
      await autoUpdater.downloadUpdate()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.setState({ stage: 'error', message })
    }
  }

  install(): void {
    if (!app.isPackaged) return
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
  }

  get offeredVersion(): string | undefined {
    return this.currentVersion
  }
}
