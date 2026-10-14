import {
  app,
  dialog,
  ipcMain,
  shell,
  BrowserWindow,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import { dirname, join } from 'node:path'
import { IPC } from '@shared/channels'
import { APP_NAME } from '@shared/defaults'
import type { AddDownloadInput, AppInfo, BrowserBridgeInfo, Settings } from '@shared/types'
import type { DownloadManager } from './download/manager'
import { logFilePath } from './logger'
import type { SettingsService } from './settings'
import type { UpdateService } from './updater'
import type { CatchServer } from './integrations/catch-server'
import type { ClipboardMonitor } from './integrations/clipboard'

export interface IpcContext {
  manager: DownloadManager
  settings: SettingsService
  updater: UpdateService
  catchServer: CatchServer
  clipboard: ClipboardMonitor
  getWindow: () => BrowserWindow | null
  applySettings: (settings: Settings) => Promise<void>
  quit: () => void
}

function windowFor(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

/**
 * Where the unpacked browser extension lives. In a packaged build it is copied
 * next to the app by electron-builder's extraResources; in development it sits
 * in the repository.
 */
function extensionDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'extension')
    : join(app.getAppPath(), 'extension')
}

export function registerIpc(ctx: IpcContext): void {
  const { manager, settings, updater, catchServer } = ctx

  const broadcast = (channel: string, payload: unknown): void => {
    const window = ctx.getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }

  // ---- downloads ---------------------------------------------------------
  ipcMain.handle(IPC.downloadsList, () => manager.list())

  ipcMain.handle(IPC.downloadsAdd, (_e, input: AddDownloadInput) => manager.add(input))

  ipcMain.handle(IPC.downloadsAddBatch, (_e, inputs: AddDownloadInput[]) =>
    manager.addBatch(Array.isArray(inputs) ? inputs : [])
  )

  ipcMain.handle(IPC.downloadsPause, (_e, id: string) => void manager.pause(id))
  ipcMain.handle(IPC.downloadsResume, (_e, id: string) => void manager.resume(id))
  ipcMain.handle(IPC.downloadsStop, (_e, id: string) => void manager.stop(id))
  ipcMain.handle(IPC.downloadsRetry, (_e, id: string) => void manager.resume(id))
  ipcMain.handle(IPC.downloadsRestart, (_e, id: string) => void manager.restart(id))
  ipcMain.handle(IPC.downloadsRemove, (_e, id: string, deleteFile?: boolean) =>
    manager.remove(id, Boolean(deleteFile))
  )
  ipcMain.handle(IPC.downloadsRemoveMany, (_e, ids: string[], deleteFiles?: boolean) =>
    manager.removeMany(Array.isArray(ids) ? ids : [], Boolean(deleteFiles))
  )
  ipcMain.handle(IPC.downloadsRemoveCompleted, (_e, deleteFiles?: boolean) =>
    manager.removeCompleted(Boolean(deleteFiles))
  )
  ipcMain.handle(IPC.downloadsPauseAll, () => void manager.pauseAll())
  ipcMain.handle(IPC.downloadsResumeAll, () => void manager.resumeAll())
  ipcMain.handle(IPC.downloadsStopAll, () => void manager.stopAll())
  ipcMain.handle(IPC.downloadsStartNext, () => void manager.startNext())
  ipcMain.handle(IPC.downloadsSetPriority, (_e, id: string, priority: number) =>
    void manager.setPriority(id, priority)
  )
  ipcMain.handle(IPC.downloadsReorder, (_e, ids: string[]) =>
    void manager.reorder(Array.isArray(ids) ? ids : [])
  )
  ipcMain.handle(IPC.downloadsProbe, (_e, url: string, headers?: Record<string, string>) =>
    manager.probeUrl(url, headers)
  )

  ipcMain.handle(IPC.downloadsOpenFile, async (_e, id: string) => {
    const item = manager.get(id)
    if (!item) return { ok: false, error: 'Download not found' }
    if (!(await manager.fileExists(item.filePath))) {
      return { ok: false, error: 'The file is no longer on disk' }
    }
    const error = await shell.openPath(item.filePath)
    return error ? { ok: false, error } : { ok: true }
  })

  ipcMain.handle(IPC.downloadsReveal, (_e, id: string) => {
    const item = manager.get(id)
    if (!item) return false
    shell.showItemInFolder(item.filePath)
    return true
  })

  // ---- settings ----------------------------------------------------------
  ipcMain.handle(IPC.settingsGet, () => settings.get())
  ipcMain.handle(IPC.settingsSet, async (_e, patch: Partial<Settings>) => {
    const next = await settings.patch(patch ?? {})
    await ctx.applySettings(next)
    broadcast(IPC.evSettings, next)
    return next
  })
  ipcMain.handle(IPC.settingsReset, async () => {
    const next = await settings.reset()
    await ctx.applySettings(next)
    broadcast(IPC.evSettings, next)
    return next
  })

  // ---- dialogs & shell ---------------------------------------------------
  ipcMain.handle(IPC.dialogChooseDir, async (event, defaultPath?: string) => {
    const options: OpenDialogOptions = {
      title: 'Choose a folder',
      defaultPath,
      properties: ['openDirectory', 'createDirectory']
    }
    const window = windowFor(event)
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(
    IPC.dialogChooseFile,
    async (event, filters?: { name: string; extensions: string[] }[]) => {
      const options: OpenDialogOptions = { title: 'Choose a file', properties: ['openFile'], filters }
      const window = windowFor(event)
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }
  )

  ipcMain.handle(IPC.dialogSaveFile, async (event, defaultPath?: string) => {
    const options: SaveDialogOptions = { title: 'Choose where to save', defaultPath }
    const window = windowFor(event)
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    return result.canceled ? null : (result.filePath ?? null)
  })

  ipcMain.handle(IPC.shellOpenPath, (_e, path: string) => shell.openPath(path))
  ipcMain.handle(IPC.shellOpenExternal, (_e, url: string) => {
    if (/^https?:/i.test(url)) return shell.openExternal(url)
    return Promise.resolve()
  })

  ipcMain.handle(IPC.clipboardRead, async () => {
    const { clipboard } = await import('electron')
    return clipboard.readText()
  })
  ipcMain.handle(IPC.clipboardWrite, async (_e, text: string) => {
    const { clipboard } = await import('electron')
    await clipboard.writeText(String(text ?? ''))
    return true
  })

  // ---- window controls ---------------------------------------------------
  ipcMain.handle(IPC.windowMinimize, (event) => windowFor(event)?.minimize())
  ipcMain.handle(IPC.windowToggleMaximize, (event) => {
    const window = windowFor(event)
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  ipcMain.handle(IPC.windowClose, (event) => windowFor(event)?.close())
  ipcMain.handle(IPC.windowIsMaximized, (event) => windowFor(event)?.isMaximized() ?? false)

  // ---- app info ----------------------------------------------------------
  ipcMain.handle(IPC.appInfo, (): AppInfo => {
    const current = settings.get()
    return {
      name: APP_NAME,
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged,
      userDataPath: app.getPath('userData'),
      downloadDir: current.downloadDir
    }
  })

  ipcMain.handle(IPC.appDiskUsage, () => manager.totalDiskUsage())

  ipcMain.handle(IPC.appOpenLogs, async () => {
    const file = logFilePath()
    if (!file) return false
    await shell.openPath(dirname(file))
    return true
  })

  ipcMain.handle(IPC.appSetLaunchOnStartup, (_e, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) })
    return app.getLoginItemSettings().openAtLogin
  })

  // ---- browser integration ----------------------------------------------
  ipcMain.handle(IPC.appBrowserBridge, (): BrowserBridgeInfo => {
    const current = settings.get()
    const port = catchServer.running ? catchServer.port : current.catchServerPort
    return {
      running: Boolean(current.catchServer) && catchServer.running,
      port,
      endpoint: `http://127.0.0.1:${port}/add`,
      extensionPath: extensionDir()
    }
  })

  ipcMain.handle(IPC.appOpenExtensionFolder, async () => {
    const error = await shell.openPath(extensionDir())
    return error ? { ok: false, error } : { ok: true }
  })

  // ---- updates -----------------------------------------------------------
  ipcMain.handle(IPC.updateState, () => updater.getState())
  ipcMain.handle(IPC.updateCheck, () => updater.check(true))
  ipcMain.handle(IPC.updateDownload, () => updater.download())
  ipcMain.handle(IPC.updateInstall, () => updater.install())
}
