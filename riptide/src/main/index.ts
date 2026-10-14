import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/channels'
import { APP_ID } from '@shared/defaults'
import type { DownloadItem, Settings } from '@shared/types'
import { DownloadManager } from './download/manager'
import { CatchServer } from './integrations/catch-server'
import { ClipboardMonitor } from './integrations/clipboard'
import { registerIpc } from './ipc'
import { log } from './logger'
import { notifyDownloadComplete } from './notifications'
import { SettingsService } from './settings'
import { JsonStore } from './store'
import { TrayController } from './tray'
import { UpdateService } from './updater'
import { createMainWindow } from './window'

app.setAppUserModelId(APP_ID)

let mainWindow: BrowserWindow | null = null
let tray: TrayController | null = null

let settingsService: SettingsService
let manager: DownloadManager
let clipboard: ClipboardMonitor
let catchServer: CatchServer
let updater: UpdateService

let quitting = false
let shutdownStarted = false
let lastProxySignature = ''

function getWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

function send(channel: string, payload: unknown): void {
  const window = getWindow()
  if (window) window.webContents.send(channel, payload)
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow()
    attachWindowBehavior(mainWindow)
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function attachWindowBehavior(window: BrowserWindow): void {
  window.on('close', (event) => {
    if (quitting) return
    if (settingsService.get().closeToTray) {
      event.preventDefault()
      window.hide()
    }
  })
  window.on('minimize', () => {
    if (settingsService.get().minimizeToTray) window.hide()
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
}

/** Push settings changes into the running services. */
async function applySettings(settings: Settings): Promise<void> {
  manager.setSpeedLimit(settings.speedLimit)

  const proxySignature = settings.proxy.enabled ? settings.proxy.url.trim() : ''
  if (proxySignature !== lastProxySignature) {
    lastProxySignature = proxySignature
    manager.refreshDispatcher()
  }

  if (settings.clipboardMonitor && !clipboard.running) await clipboard.start()
  if (!settings.clipboardMonitor && clipboard.running) clipboard.stop()

  if (settings.catchServer) {
    if (!catchServer.running) await catchServer.start(settings.catchServerPort)
    else if (catchServer.port !== settings.catchServerPort) {
      await catchServer.stop()
      await catchServer.start(settings.catchServerPort)
    }
  } else if (catchServer.running) {
    await catchServer.stop()
  }

  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: settings.launchOnStartup })
  }
}

async function shutdown(): Promise<void> {
  log.info('shutting down')
  clipboard.stop()
  updater.stop()
  await catchServer.stop().catch(() => undefined)
  tray?.destroy()
  await manager.dispose().catch((err) => log.error('manager dispose failed', err))
  await settingsService.flush().catch(() => undefined)
}

async function main(): Promise<void> {
  settingsService = new SettingsService()
  await settingsService.load()

  const store = new JsonStore<DownloadItem[]>(
    join(app.getPath('userData'), 'downloads.json'),
    []
  )
  manager = new DownloadManager(settingsService, store, log.child('downloads'))

  clipboard = new ClipboardMonitor((url) => send(IPC.evClipboardUrl, url))

  catchServer = new CatchServer({
    version: () => app.getVersion(),
    handler: (payload) =>
      manager.add({
        url: payload.url,
        referrer: payload.referrer,
        fileName: payload.fileName,
        headers: payload.headers,
        startNow: payload.startNow
      })
  })

  updater = new UpdateService({
    onState: (state) => send(IPC.evUpdate, state),
    autoCheck: () => settingsService.get().autoCheckUpdates,
    channel: () => settingsService.get().updateChannel,
    log: log.child('updater')
  })

  registerIpc({
    manager,
    settings: settingsService,
    updater,
    catchServer,
    clipboard,
    getWindow,
    applySettings,
    quit: () => {
      quitting = true
      app.quit()
    }
  })

  // Manager events fan out to the renderer, the tray and notifications.
  manager.onItem = (item) => send(IPC.evDownloadItem, item)
  manager.onList = (items) => send(IPC.evDownloadsList, items)
  manager.onRemoved = (ids) => send(IPC.evDownloadsRemoved, ids)
  manager.onNotice = (notice) => send(IPC.evNotice, notice)
  manager.onStats = (stats) => {
    send(IPC.evStats, stats)
    tray?.update(stats)
  }
  manager.onCompleted = (item) => {
    send(IPC.evDownloadItem, item)
    notifyDownloadComplete(item, settingsService.get().notifyOnComplete)
  }

  await manager.init()

  mainWindow = createMainWindow()
  attachWindowBehavior(mainWindow)

  tray = new TrayController({
    manager,
    showWindow,
    quit: () => {
      quitting = true
      app.quit()
    }
  })
  tray.create()

  await applySettings(settingsService.get())
  updater.scheduleBackgroundChecks()

  log.info(`Riptide ${app.getVersion()} ready`)
}

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (getWindow()) showWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') return
    const settings = settingsService?.get()
    if (settings && (settings.closeToTray || settings.minimizeToTray)) return
    quitting = true
    app.quit()
  })

  app.on('activate', () => showWindow())

  app.on('before-quit', (event) => {
    quitting = true
    if (shutdownStarted) return
    event.preventDefault()
    shutdownStarted = true
    void shutdown().finally(() => app.exit(0))
  })

  app.whenReady().then(main).catch((err) => {
    log.error('fatal startup error', err)
    app.exit(1)
  })
}
