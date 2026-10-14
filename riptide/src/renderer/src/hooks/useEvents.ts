import { useEffect } from 'react'
import { useApp } from '../state/store'

/**
 * Wire every main-process event into the store exactly once, and load the
 * initial snapshot. Returns nothing; the store is the single source of truth.
 */
export function useAppEvents(): void {
  useEffect(() => {
    const api = window.riptide
    const store = useApp.getState()

    const unsubscribers = [
      api.events.onDownloadsList((items) => store.setDownloads(items)),
      api.events.onDownloadItem((item) => useApp.getState().upsertDownload(item)),
      api.events.onDownloadsRemoved((ids) => useApp.getState().removeDownloads(ids)),
      api.events.onStats((stats) => useApp.getState().setStats(stats)),
      api.events.onUpdate((update) => useApp.getState().setUpdate(update)),
      api.events.onSettings((settings) => useApp.getState().setSettings(settings)),
      api.events.onNotice((notice) =>
        useApp.getState().pushToast({
          kind: notice.kind,
          message: notice.message,
          detail: notice.detail
        })
      ),
      api.events.onClipboardUrl((url) => useApp.getState().setClipboardSuggestion(url)),
      api.events.onWindowMaximized((maximized) => useApp.getState().setMaximized(maximized)),
      api.events.onSpider((state) => useApp.getState().setSpiderState(state))
    ]

    void (async () => {
      const [downloads, settings, update, appInfo, maximized] = await Promise.all([
        api.downloads.list(),
        api.settings.get(),
        api.update.state(),
        api.app.info(),
        api.window.isMaximized()
      ])
      const state = useApp.getState()
      state.setDownloads(downloads)
      state.setSettings(settings)
      state.setUpdate(update)
      state.setAppInfo(appInfo)
      state.setMaximized(maximized)
    })()

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [])
}
