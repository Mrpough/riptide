import { useEffect, useMemo } from 'react'
import { useApp, selectVisible } from './state/store'
import { useAppEvents } from './hooks/useEvents'
import { AddDownloadDialog } from './components/AddDownloadDialog'
import { ContextMenu } from './components/ContextMenu'
import { DownloadTable } from './components/DownloadTable'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { SiteGrabberDialog } from './components/SiteGrabberDialog'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { Toasts } from './components/Toasts'
import { Toolbar } from './components/Toolbar'
import { UpdateBanner } from './components/UpdateBanner'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function App(): JSX.Element {
  useAppEvents()

  const downloads = useApp((s) => s.downloads)
  const category = useApp((s) => s.category)
  const status = useApp((s) => s.status)
  const search = useApp((s) => s.search)
  const settings = useApp((s) => s.settings)
  const addDialogOpen = useApp((s) => s.addDialogOpen)
  const settingsOpen = useApp((s) => s.settingsOpen)
  const grabberOpen = useApp((s) => s.grabberOpen)
  const contextMenu = useApp((s) => s.contextMenu)

  const visible = useMemo(
    () => selectVisible(downloads, category, status, search),
    [downloads, category, status, search]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const state = useApp.getState()
      const mod = event.ctrlKey || event.metaKey

      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        state.openAddDialog()
        return
      }

      if (isTypingTarget(event.target)) return
      if (state.addDialogOpen || state.settingsOpen || state.grabberOpen) return

      if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        const ids = selectVisible(
          state.downloads,
          state.category,
          state.status,
          state.search
        ).map((d) => d.id)
        state.selectAll(ids)
        return
      }

      if (event.key === 'Delete' && state.selection.size > 0) {
        event.preventDefault()
        const ids = [...state.selection]
        const confirm = state.settings?.confirmOnRemove
        if (confirm && !window.confirm(`Remove ${ids.length} item(s) from the list?`)) return
        void window.riptide.downloads.removeMany(ids, false)
        return
      }

      if (event.key === ' ' && state.selection.size > 0) {
        event.preventDefault()
        for (const id of state.selection) {
          const item = state.downloads.find((d) => d.id === id)
          if (!item) continue
          if (item.status === 'downloading' || item.status === 'connecting' || item.status === 'queued')
            void window.riptide.downloads.pause(id)
          else void window.riptide.downloads.resume(id)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="app">
      <TitleBar />
      <UpdateBanner />

      <div className="body">
        <Sidebar />
        <div className="main">
          <Toolbar />
          <DownloadTable items={visible} />
        </div>
      </div>

      <StatusBar />

      {settingsOpen && settings && <SettingsDialog />}
      {grabberOpen && <SiteGrabberDialog />}
      {addDialogOpen && <AddDownloadDialog />}
      {contextMenu && <ContextMenu />}
      <Toasts />
    </div>
  )
}
