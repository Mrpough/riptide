import type { TransferStats } from '@shared/channels'
import type {
  AddDownloadInput,
  AddResult,
  AppInfo,
  DiskUsage,
  DownloadView,
  Notice,
  ProbePreview,
  Settings,
  UpdateState
} from '@shared/types'

export interface RiptideApi {
  downloads: {
    list(): Promise<DownloadView[]>
    add(input: AddDownloadInput): Promise<AddResult>
    addBatch(inputs: AddDownloadInput[]): Promise<AddResult[]>
    pause(id: string): Promise<void>
    resume(id: string): Promise<void>
    stop(id: string): Promise<void>
    /** Retry an errored download, continuing from where it stopped. */
    retry(id: string): Promise<void>
    /** Start a download over from the beginning. */
    restart(id: string): Promise<void>
    remove(id: string, deleteFile?: boolean): Promise<boolean>
    removeMany(ids: string[], deleteFiles?: boolean): Promise<number>
    removeCompleted(deleteFiles?: boolean): Promise<number>
    pauseAll(): Promise<void>
    resumeAll(): Promise<void>
    stopAll(): Promise<void>
    startNext(): Promise<void>
    setPriority(id: string, priority: number): Promise<void>
    reorder(ids: string[]): Promise<void>
    probe(url: string, headers?: Record<string, string>): Promise<ProbePreview>
    openFile(id: string): Promise<{ ok: boolean; error?: string }>
    reveal(id: string): Promise<boolean>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
    reset(): Promise<Settings>
  }
  dialogs: {
    chooseDir(defaultPath?: string): Promise<string | null>
    chooseFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null>
    saveFile(defaultPath?: string): Promise<string | null>
  }
  shell: {
    openPath(path: string): Promise<string>
    openExternal(url: string): Promise<void>
  }
  clipboard: {
    read(): Promise<string>
    write(text: string): Promise<boolean>
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<boolean>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
  }
  app: {
    info(): Promise<AppInfo>
    diskUsage(): Promise<DiskUsage | null>
    openLogs(): Promise<boolean>
    setLaunchOnStartup(enabled: boolean): Promise<boolean>
  }
  update: {
    state(): Promise<UpdateState>
    check(): Promise<UpdateState>
    download(): Promise<void>
    install(): Promise<void>
  }
  events: {
    onDownloadItem(callback: (item: DownloadView) => void): () => void
    onDownloadsList(callback: (items: DownloadView[]) => void): () => void
    onDownloadsRemoved(callback: (ids: string[]) => void): () => void
    onStats(callback: (stats: TransferStats) => void): () => void
    onUpdate(callback: (state: UpdateState) => void): () => void
    onNotice(callback: (notice: Notice) => void): () => void
    onClipboardUrl(callback: (url: string) => void): () => void
    onSettings(callback: (settings: Settings) => void): () => void
    onWindowMaximized(callback: (maximized: boolean) => void): () => void
  }
}
