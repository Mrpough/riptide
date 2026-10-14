import { create } from 'zustand'
import type { TransferStats } from '@shared/channels'
import type {
  AppInfo,
  CategoryId,
  DownloadView,
  Notice,
  Settings,
  UpdateState
} from '@shared/types'

export type StatusFilter = 'all' | 'active' | 'queued' | 'paused' | 'completed' | 'error'

export interface Toast {
  id: string
  kind: Notice['kind']
  message: string
  detail?: string
}

export interface ContextMenuState {
  id: string
  x: number
  y: number
}

const EMPTY_STATS: TransferStats = {
  totalSpeed: 0,
  activeCount: 0,
  queuedCount: 0,
  completedCount: 0,
  totalConnections: 0,
  speedLimit: 0
}

interface AppState {
  downloads: DownloadView[]
  stats: TransferStats
  settings: Settings | null
  update: UpdateState
  appInfo: AppInfo | null
  toasts: Toast[]
  selection: Set<string>
  category: CategoryId
  status: StatusFilter
  search: string
  addDialogOpen: boolean
  addDialogInitialUrl: string
  settingsOpen: boolean
  contextMenu: ContextMenuState | null
  clipboardSuggestion: string | null
  maximized: boolean

  setMaximized: (maximized: boolean) => void
  setDownloads: (items: DownloadView[]) => void
  upsertDownload: (item: DownloadView) => void
  removeDownloads: (ids: string[]) => void
  setStats: (stats: TransferStats) => void
  setSettings: (settings: Settings) => void
  setUpdate: (update: UpdateState) => void
  setAppInfo: (info: AppInfo) => void

  pushToast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void

  setSelection: (ids: string[]) => void
  toggleSelection: (id: string, additive: boolean) => void
  selectAll: (ids: string[]) => void
  clearSelection: () => void

  setCategory: (category: CategoryId) => void
  setStatus: (status: StatusFilter) => void
  setSearch: (search: string) => void

  openAddDialog: (initialUrl?: string) => void
  closeAddDialog: () => void
  openSettings: () => void
  closeSettings: () => void
  openContextMenu: (menu: ContextMenuState) => void
  closeContextMenu: () => void
  setClipboardSuggestion: (url: string | null) => void
}

let toastSeq = 0

export const useApp = create<AppState>()((set) => ({
  downloads: [],
  stats: EMPTY_STATS,
  settings: null,
  update: { stage: 'idle' },
  appInfo: null,
  toasts: [],
  selection: new Set<string>(),
  category: 'all',
  status: 'all',
  search: '',
  addDialogOpen: false,
  addDialogInitialUrl: '',
  settingsOpen: false,
  contextMenu: null,
  clipboardSuggestion: null,
  maximized: false,

  setMaximized: (maximized) => set({ maximized }),
  setDownloads: (items) => set({ downloads: items }),
  upsertDownload: (item) =>
    set((state) => {
      const index = state.downloads.findIndex((d) => d.id === item.id)
      if (index === -1) return { downloads: [item, ...state.downloads] }
      const next = state.downloads.slice()
      next[index] = item
      return { downloads: next }
    }),
  removeDownloads: (ids) =>
    set((state) => {
      const removing = new Set(ids)
      const selection = new Set(state.selection)
      for (const id of ids) selection.delete(id)
      return {
        downloads: state.downloads.filter((d) => !removing.has(d.id)),
        selection
      }
    }),
  setStats: (stats) => set({ stats }),
  setSettings: (settings) => set({ settings }),
  setUpdate: (update) => set({ update }),
  setAppInfo: (appInfo) => set({ appInfo }),

  pushToast: (toast) =>
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id: `t${++toastSeq}` }].slice(-4)
    })),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  setSelection: (ids) => set({ selection: new Set(ids) }),
  toggleSelection: (id, additive) =>
    set((state) => {
      if (!additive) return { selection: new Set([id]) }
      const selection = new Set(state.selection)
      if (selection.has(id)) selection.delete(id)
      else selection.add(id)
      return { selection }
    }),
  selectAll: (ids) => set({ selection: new Set(ids) }),
  clearSelection: () => set({ selection: new Set() }),

  setCategory: (category) => set({ category, selection: new Set() }),
  setStatus: (status) => set({ status, selection: new Set() }),
  setSearch: (search) => set({ search }),

  openAddDialog: (initialUrl = '') => set({ addDialogOpen: true, addDialogInitialUrl: initialUrl }),
  closeAddDialog: () => set({ addDialogOpen: false, addDialogInitialUrl: '' }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),
  setClipboardSuggestion: (clipboardSuggestion) => set({ clipboardSuggestion })
}))

const ACTIVE_STATUSES = new Set(['downloading', 'connecting'])
const PAUSED_STATUSES = new Set(['paused', 'stopped'])

/** Apply the sidebar filter and search box to the download list. */
export function selectVisible(
  downloads: DownloadView[],
  category: CategoryId,
  status: StatusFilter,
  search: string
): DownloadView[] {
  const needle = search.trim().toLowerCase()
  const filtered = downloads.filter((item) => {
    if (category !== 'all' && item.category !== category) return false
    if (status === 'active' && !ACTIVE_STATUSES.has(item.status)) return false
    if (status === 'paused' && !PAUSED_STATUSES.has(item.status)) return false
    if (status === 'queued' && item.status !== 'queued') return false
    if (status === 'completed' && item.status !== 'completed') return false
    if (status === 'error' && item.status !== 'error') return false
    if (needle) {
      const haystack = `${item.fileName} ${item.url}`.toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    return true
  })
  return filtered.sort((a, b) => b.createdAt - a.createdAt)
}
