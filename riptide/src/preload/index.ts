import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/channels'
import type {
  AddDownloadInput,
  AppInfo,
  DownloadView,
  Notice,
  Settings,
  UpdateState
} from '@shared/types'
import type { TransferStats } from '@shared/channels'
import type { RiptideApi } from './api'

/** Subscribe to a main->renderer channel and return an unsubscribe function. */
function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: RiptideApi = {
  downloads: {
    list: () => ipcRenderer.invoke(IPC.downloadsList),
    add: (input: AddDownloadInput) => ipcRenderer.invoke(IPC.downloadsAdd, input),
    addBatch: (inputs: AddDownloadInput[]) => ipcRenderer.invoke(IPC.downloadsAddBatch, inputs),
    pause: (id) => ipcRenderer.invoke(IPC.downloadsPause, id),
    resume: (id) => ipcRenderer.invoke(IPC.downloadsResume, id),
    stop: (id) => ipcRenderer.invoke(IPC.downloadsStop, id),
    retry: (id) => ipcRenderer.invoke(IPC.downloadsRetry, id),
    restart: (id) => ipcRenderer.invoke(IPC.downloadsRestart, id),
    remove: (id, deleteFile) => ipcRenderer.invoke(IPC.downloadsRemove, id, deleteFile),
    removeMany: (ids, deleteFiles) => ipcRenderer.invoke(IPC.downloadsRemoveMany, ids, deleteFiles),
    removeCompleted: (deleteFiles) => ipcRenderer.invoke(IPC.downloadsRemoveCompleted, deleteFiles),
    pauseAll: () => ipcRenderer.invoke(IPC.downloadsPauseAll),
    resumeAll: () => ipcRenderer.invoke(IPC.downloadsResumeAll),
    stopAll: () => ipcRenderer.invoke(IPC.downloadsStopAll),
    startNext: () => ipcRenderer.invoke(IPC.downloadsStartNext),
    setPriority: (id, priority) => ipcRenderer.invoke(IPC.downloadsSetPriority, id, priority),
    reorder: (ids) => ipcRenderer.invoke(IPC.downloadsReorder, ids),
    probe: (url, headers) => ipcRenderer.invoke(IPC.downloadsProbe, url, headers),
    openFile: (id) => ipcRenderer.invoke(IPC.downloadsOpenFile, id),
    reveal: (id) => ipcRenderer.invoke(IPC.downloadsReveal, id)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch: Partial<Settings>) => ipcRenderer.invoke(IPC.settingsSet, patch),
    reset: () => ipcRenderer.invoke(IPC.settingsReset)
  },
  dialogs: {
    chooseDir: (defaultPath) => ipcRenderer.invoke(IPC.dialogChooseDir, defaultPath),
    chooseFile: (filters) => ipcRenderer.invoke(IPC.dialogChooseFile, filters),
    saveFile: (defaultPath) => ipcRenderer.invoke(IPC.dialogSaveFile, defaultPath)
  },
  shell: {
    openPath: (path: string) => ipcRenderer.invoke(IPC.shellOpenPath, path),
    openExternal: (url: string) => ipcRenderer.invoke(IPC.shellOpenExternal, url)
  },
  clipboard: {
    read: () => ipcRenderer.invoke(IPC.clipboardRead),
    write: (text: string) => ipcRenderer.invoke(IPC.clipboardWrite, text)
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize),
    close: () => ipcRenderer.invoke(IPC.windowClose),
    isMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized)
  },
  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo),
    diskUsage: () => ipcRenderer.invoke(IPC.appDiskUsage),
    openLogs: () => ipcRenderer.invoke(IPC.appOpenLogs),
    setLaunchOnStartup: (enabled: boolean) => ipcRenderer.invoke(IPC.appSetLaunchOnStartup, enabled)
  },
  update: {
    state: (): Promise<UpdateState> => ipcRenderer.invoke(IPC.updateState),
    check: (): Promise<UpdateState> => ipcRenderer.invoke(IPC.updateCheck),
    download: () => ipcRenderer.invoke(IPC.updateDownload),
    install: () => ipcRenderer.invoke(IPC.updateInstall)
  },
  events: {
    onDownloadItem: (cb) => subscribe<DownloadView>(IPC.evDownloadItem, cb),
    onDownloadsList: (cb) => subscribe<DownloadView[]>(IPC.evDownloadsList, cb),
    onDownloadsRemoved: (cb) => subscribe<string[]>(IPC.evDownloadsRemoved, cb),
    onStats: (cb) => subscribe<TransferStats>(IPC.evStats, cb),
    onUpdate: (cb) => subscribe<UpdateState>(IPC.evUpdate, cb),
    onNotice: (cb) => subscribe<Notice>(IPC.evNotice, cb),
    onClipboardUrl: (cb) => subscribe<string>(IPC.evClipboardUrl, cb),
    onSettings: (cb) => subscribe<Settings>(IPC.evSettings, cb),
    onWindowMaximized: (cb) => subscribe<boolean>(IPC.evWindowMaximized, cb)
  }
}

contextBridge.exposeInMainWorld('riptide', api)
