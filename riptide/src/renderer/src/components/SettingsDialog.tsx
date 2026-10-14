import { useState } from 'react'
import { CATEGORIES } from '@shared/categories'
import { MAX_CONNECTIONS } from '@shared/defaults'
import type { Settings, StorageCategoryId } from '@shared/types'
import { useApp } from '../state/store'
import { Dialog } from './Dialog'
import { IconFolder, IconRefresh } from './Icons'

function bytesToKb(bytes: number): number {
  return bytes > 0 ? Math.round(bytes / 1024) : 0
}

/** Full settings editor. Edits a local draft, then writes it in one patch. */
export function SettingsDialog(): JSX.Element {
  const loaded = useApp((s) => s.settings)
  const appInfo = useApp((s) => s.appInfo)
  const closeSettings = useApp((s) => s.closeSettings)
  const setAppSettings = useApp((s) => s.setSettings)

  const [draft, setDraft] = useState<Settings | null>(() =>
    loaded ? { ...loaded, proxy: { ...loaded.proxy }, categoryDirs: { ...loaded.categoryDirs } } : null
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [speedLimitKb, setSpeedLimitKb] = useState(() => String(bytesToKb(loaded?.speedLimit ?? 0)))

  const api = window.riptide

  const patch = <K extends keyof Settings>(key: K, value: Settings[K]): void =>
    setDraft((current) => (current ? { ...current, [key]: value } : current))

  const chooseDir = async (setter: (dir: string) => void, current: string): Promise<void> => {
    const dir = await api.dialogs.chooseDir(current || undefined)
    if (dir) setter(dir)
  }

  const save = async (): Promise<void> => {
    if (!draft || saving) return
    setSaving(true)
    setError(null)
    try {
      const limitBytes = Math.max(0, Number(speedLimitKb) || 0) * 1024
      const next = await api.settings.set({ ...draft, speedLimit: limitBytes })
      await api.app.setLaunchOnStartup(next.launchOnStartup)
      setAppSettings(next)
      closeSettings()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const reset = async (): Promise<void> => {
    try {
      const next = await api.settings.reset()
      await api.app.setLaunchOnStartup(next.launchOnStartup)
      setAppSettings(next)
      setDraft({ ...next, proxy: { ...next.proxy }, categoryDirs: { ...next.categoryDirs } })
      setSpeedLimitKb(String(bytesToKb(next.speedLimit)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const checkForUpdates = async (): Promise<void> => {
    const state = await api.update.check()
    if (state.stage === 'not-available' || state.stage === 'error') {
      setError(state.message ?? 'No update available.')
      window.setTimeout(() => setError(null), 4000)
    }
  }

  if (!draft) {
    return (
      <Dialog title="Settings" onClose={closeSettings}>
        <span className="field__help">Settings are still loading…</span>
      </Dialog>
    )
  }

  const switches: Array<{
    key: keyof Settings
    title: string
    desc: string
    onChange?: (enabled: boolean) => void
  }> = [
    {
      key: 'autoStart',
      title: 'Resume on launch',
      desc: 'Continue unfinished downloads when Riptide starts.'
    },
    {
      key: 'startOnAdd',
      title: 'Start new downloads immediately',
      desc: 'Otherwise new downloads wait in the queue.'
    },
    {
      key: 'categoryFolders',
      title: 'Subfolders per category',
      desc: 'Sort downloads into Documents, Video, Music, etc.'
    },
    { key: 'notifyOnComplete', title: 'Notify when finished', desc: 'Desktop notification on completion.' },
    { key: 'confirmOnRemove', title: 'Confirm removal', desc: 'Ask before deleting an item from the list.' },
    { key: 'clipboardMonitor', title: 'Watch the clipboard', desc: 'Offer to download URLs you copy.' },
    { key: 'minimizeToTray', title: 'Minimize to tray', desc: 'Keep running in the background when minimized.' },
    { key: 'closeToTray', title: 'Close to tray', desc: 'Keep running when the window is closed.' },
    { key: 'launchOnStartup', title: 'Launch at login', desc: 'Start Riptide with Windows.' },
    { key: 'autoCheckUpdates', title: 'Check for updates', desc: 'Look for new versions on startup.' },
    {
      key: 'catchServer',
      title: 'Local catch endpoint',
      desc: `Listen on 127.0.0.1:${draft.catchServerPort} for browser-extension captures.`
    }
  ]

  return (
    <Dialog
      title="Settings"
      wide
      onClose={closeSettings}
      footer={
        <>
          <button type="button" className="btn btn--danger" onClick={() => void reset()}>
            Reset defaults
          </button>
          <div className="toolbar__spacer" />
          <button type="button" className="btn" onClick={closeSettings}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={saving}
            onClick={() => void save()}
          >
            Save changes
          </button>
        </>
      }
    >
      {error && (
        <div className="probe" data-tone="error" role="alert">
          {error}
        </div>
      )}

      <div className="settings__section">
        <div className="settings__title">Folders</div>

        <div className="field">
          <label className="field__label" htmlFor="set-dir">
            Default download folder
          </label>
          <div className="field__row">
            <input
              id="set-dir"
              className="input"
              value={draft.downloadDir}
              spellCheck={false}
              onChange={(e) => patch('downloadDir', e.target.value)}
            />
            <button
              type="button"
              className="btn btn--icon btn--bordered"
              title="Browse…"
              aria-label="Choose default download folder"
              onClick={() => void chooseDir((dir) => patch('downloadDir', dir), draft.downloadDir)}
            >
              <IconFolder size={15} />
            </button>
          </div>
        </div>

        <div className="grid-2">
          {CATEGORIES.map((category) => (
            <div className="field" key={category.id}>
              <label className="field__label" htmlFor={`dir-${category.id}`}>
                {category.label} folder
              </label>
              <div className="field__row">
                <input
                  id={`dir-${category.id}`}
                  className="input"
                  spellCheck={false}
                  placeholder="Same as above"
                  value={draft.categoryDirs[category.id as StorageCategoryId]}
                  onChange={(e) =>
                    patch('categoryDirs', {
                      ...draft.categoryDirs,
                      [category.id]: e.target.value
                    })
                  }
                />
                <button
                  type="button"
                  className="btn btn--icon btn--bordered"
                  title="Browse…"
                  aria-label={`Choose ${category.label} folder`}
                  onClick={() =>
                    void chooseDir(
                      (dir) => patch('categoryDirs', { ...draft.categoryDirs, [category.id]: dir }),
                      draft.categoryDirs[category.id]
                    )
                  }
                >
                  <IconFolder size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="settings__section">
        <div className="settings__title">Transfers</div>
        <div className="grid-2">
          <div className="field">
            <label className="field__label" htmlFor="set-conn">
              Connections per download
            </label>
            <input
              id="set-conn"
              className="input"
              type="number"
              min={1}
              max={MAX_CONNECTIONS}
              value={draft.defaultConnections}
              onChange={(e) =>
                patch(
                  'defaultConnections',
                  Math.max(1, Math.min(MAX_CONNECTIONS, Number(e.target.value) || 1))
                )
              }
            />
            <span className="field__help">More connections speed up large files on servers that allow it.</span>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="set-concurrent">
              Parallel downloads
            </label>
            <input
              id="set-concurrent"
              className="input"
              type="number"
              min={1}
              max={16}
              value={draft.maxConcurrent}
              onChange={(e) =>
                patch('maxConcurrent', Math.max(1, Math.min(16, Number(e.target.value) || 1)))
              }
            />
            <span className="field__help">How many downloads may run at once.</span>
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="set-limit">
            Global speed cap (KB/s, 0 = unlimited)
          </label>
          <input
            id="set-limit"
            className="input"
            type="number"
            min={0}
            value={speedLimitKb}
            onChange={(e) => setSpeedLimitKb(e.target.value)}
          />
        </div>
      </div>

      <div className="settings__section">
        <div className="settings__title">Behavior</div>
        {switches.map((item) => (
          <label className="switch" key={String(item.key)}>
            <input
              type="checkbox"
              checked={Boolean(draft[item.key])}
              onChange={(e) =>
                setDraft((current) =>
                  current ? { ...current, [item.key]: e.target.checked } : current
                )
              }
            />
            <span className="switch__text">
              <span className="switch__title">{item.title}</span>
              <span className="switch__desc">{item.desc}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="settings__section">
        <div className="settings__title">Network</div>

        <div className="field">
          <label className="field__label" htmlFor="set-proxy">
            Proxy URL (leave empty to use the system default)
          </label>
          <div className="field__row">
            <input
              id="set-proxy"
              className="input"
              placeholder="http://user:pass@host:8080"
              value={draft.proxy.url}
              spellCheck={false}
              onChange={(e) =>
                patch('proxy', { ...draft.proxy, url: e.target.value, enabled: e.target.value.length > 0 })
              }
            />
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="set-ua">
            User agent
          </label>
          <textarea
            id="set-ua"
            className="textarea"
            value={draft.userAgent}
            spellCheck={false}
            onChange={(e) => patch('userAgent', e.target.value)}
          />
        </div>

        <div className="grid-2">
          <div className="field">
            <label className="field__label" htmlFor="set-channel">
              Update channel
            </label>
            <select
              id="set-channel"
              className="select"
              value={draft.updateChannel}
              onChange={(e) => patch('updateChannel', e.target.value as Settings['updateChannel'])}
            >
              <option value="stable">Stable</option>
              <option value="beta">Beta</option>
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="set-port">
              Catch endpoint port
            </label>
            <input
              id="set-port"
              className="input"
              type="number"
              min={1024}
              max={65535}
              value={draft.catchServerPort}
              onChange={(e) =>
                patch('catchServerPort', Math.max(1024, Math.min(65535, Number(e.target.value) || 7777)))
              }
            />
          </div>
        </div>
      </div>

      <div className="settings__section">
        <div className="settings__title">Updates</div>
        <div className="field__help">
          Riptide {appInfo?.version ?? ''} · Electron {appInfo?.electron ?? ''}
        </div>
        <div className="field__row">
          <button type="button" className="btn btn--bordered" onClick={() => void checkForUpdates()}>
            <IconRefresh size={14} />
            Check for updates now
          </button>
          <button type="button" className="btn btn--bordered" onClick={() => void api.app.openLogs()}>
            Open log folder
          </button>
        </div>
        <span className="field__help">
          Updates are delivered from GitHub Releases. In development builds no update feed is polled.
        </span>
      </div>
    </Dialog>
  )
}
