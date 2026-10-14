/**
 * IPC channel names. Imported by main, preload and the renderer so a channel
 * can never drift out of sync between the two ends.
 */
export const IPC = {
  // ---- downloads (renderer -> main, invoke) ----
  downloadsList: 'downloads:list',
  downloadsAdd: 'downloads:add',
  downloadsAddBatch: 'downloads:add-batch',
  downloadsPause: 'downloads:pause',
  downloadsResume: 'downloads:resume',
  downloadsStop: 'downloads:stop',
  downloadsRemove: 'downloads:remove',
  downloadsRemoveMany: 'downloads:remove-many',
  downloadsRetry: 'downloads:retry',
  downloadsRestart: 'downloads:restart',
  downloadsPauseAll: 'downloads:pause-all',
  downloadsResumeAll: 'downloads:resume-all',
  downloadsStopAll: 'downloads:stop-all',
  downloadsRemoveCompleted: 'downloads:remove-completed',
  downloadsOpenFile: 'downloads:open-file',
  downloadsReveal: 'downloads:reveal',
  downloadsSetPriority: 'downloads:set-priority',
  downloadsReorder: 'downloads:reorder',
  downloadsStartNext: 'downloads:start-next',
  downloadsProbe: 'downloads:probe',

  // ---- settings (renderer -> main, invoke) ----
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsReset: 'settings:reset',

  // ---- dialogs / shell ----
  dialogChooseDir: 'dialog:choose-dir',
  dialogChooseFile: 'dialog:choose-file',
  dialogSaveFile: 'dialog:save-file',
  shellOpenPath: 'shell:open-path',
  shellOpenExternal: 'shell:open-external',
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write',

  // ---- window controls (frameless titlebar) ----
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',

  // ---- app / system ----
  appInfo: 'app:info',
  appDiskUsage: 'app:disk-usage',
  appOpenLogs: 'app:open-logs',
  appSetLaunchOnStartup: 'app:set-launch-on-startup',

  // ---- updates ----
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  updateState: 'update:get-state',

  // ---- main -> renderer (send) ----
  evDownloadsList: 'ev:downloads:list',
  evDownloadItem: 'ev:downloads:item',
  evDownloadsRemoved: 'ev:downloads:removed',
  evStats: 'ev:stats',
  evUpdate: 'ev:update',
  evNotice: 'ev:notice',
  evClipboardUrl: 'ev:clipboard:url',
  evSettings: 'ev:settings',
  evWindowMaximized: 'ev:window:maximized',
  evNavigate: 'ev:navigate'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** Aggregate transfer stats pushed ~4x/second alongside item updates. */
export interface TransferStats {
  totalSpeed: number
  activeCount: number
  queuedCount: number
  completedCount: number
  totalConnections: number
  speedLimit: number
}
