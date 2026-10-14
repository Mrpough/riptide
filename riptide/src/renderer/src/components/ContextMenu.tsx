import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useApp } from '../state/store'
import {
  IconExternal,
  IconFolder,
  IconLink,
  IconPause,
  IconPlay,
  IconRefresh,
  IconTrash,
  IconZap
} from './Icons'

interface MenuAction {
  label: string
  icon: JSX.Element
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

type MenuEntry = MenuAction | 'separator'

/** Right-click menu for a single download row. Closes on outside click, Esc or scroll. */
export function ContextMenu(): JSX.Element | null {
  const menu = useApp((s) => s.contextMenu)
  const closeMenu = useApp((s) => s.closeContextMenu)
  const item = useApp((s) => (menu ? s.downloads.find((d) => d.id === menu.id) : undefined))
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!menu) return
    const onDown = (): void => closeMenu()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeMenu()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onDown)
    window.addEventListener('scroll', onDown, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onDown)
      window.removeEventListener('scroll', onDown, true)
    }
  }, [menu, closeMenu])

  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const x = Math.min(menu.x, window.innerWidth - rect.width - 8)
    const y = Math.min(menu.y, window.innerHeight - rect.height - 8)
    setPos({ x: Math.max(8, x), y: Math.max(8, y) })
  }, [menu])

  if (!menu || !item) return null

  const api = window.riptide
  const confirmRemove = useApp.getState().settings?.confirmOnRemove ?? true

  const run = (fn: () => void) => () => {
    fn()
    closeMenu()
  }

  const running = item.status === 'downloading' || item.status === 'connecting' || item.status === 'queued'
  const canResume =
    item.status === 'paused' || item.status === 'stopped' || item.status === 'error'
  const done = item.status === 'completed'

  const entries: MenuEntry[] = []

  if (done) {
    entries.push({
      label: 'Open file',
      icon: <IconExternal size={14} />,
      shortcut: 'Enter',
      onSelect: run(() => void api.downloads.openFile(item.id))
    })
  }

  entries.push(
    {
      label: 'Open containing folder',
      icon: <IconFolder size={14} />,
      onSelect: run(() => void api.downloads.reveal(item.id))
    },
    {
      label: 'Copy link',
      icon: <IconLink size={14} />,
      shortcut: 'Ctrl+C',
      onSelect: run(() => void api.clipboard.write(item.url))
    },
    {
      label: 'Open link in browser',
      icon: <IconExternal size={14} />,
      onSelect: run(() => void api.shell.openExternal(item.url))
    }
  )

  entries.push('separator')

  if (running) {
    entries.push({
      label: 'Pause',
      icon: <IconPause size={14} />,
      shortcut: 'Space',
      onSelect: run(() => void api.downloads.pause(item.id))
    })
  } else if (canResume) {
    entries.push({
      label: item.status === 'error' ? 'Retry' : 'Resume',
      icon: <IconPlay size={14} />,
      shortcut: 'Space',
      onSelect: run(() => void api.downloads.resume(item.id))
    })
  }

  if (item.status !== 'completed') {
    entries.push({
      label: 'Restart from the beginning',
      icon: <IconRefresh size={14} />,
      onSelect: run(() => void api.downloads.restart(item.id))
    })
  }

  entries.push({
    label: 'Start next',
    icon: <IconZap size={14} />,
    disabled: item.status === 'completed',
    onSelect: run(() => void api.downloads.setPriority(item.id, Date.now()))
  })

  entries.push('separator')

  entries.push({
    label: 'Remove from list',
    icon: <IconTrash size={14} />,
    danger: true,
    shortcut: 'Del',
    onSelect: run(() => {
      if (confirmRemove && !window.confirm(`Remove "${item.fileName}" from the list?`)) return
      void api.downloads.remove(item.id, false)
    })
  })

  if (done) {
    entries.push({
      label: 'Delete file and remove',
      icon: <IconTrash size={14} />,
      danger: true,
      onSelect: run(() => {
        if (!window.confirm(`Delete "${item.fileName}" from disk? This cannot be undone.`)) return
        void api.downloads.remove(item.id, true)
      })
    })
  }

  return (
    <div
      ref={ref}
      className="ctx"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, index) =>
        entry === 'separator' ? (
          <div key={`sep-${index}`} className="ctx__sep" role="separator" />
        ) : (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            className={`ctx__item${entry.danger ? ' ctx__item--danger' : ''}`}
            disabled={entry.disabled}
            onClick={entry.onSelect}
          >
            {entry.icon}
            <span>{entry.label}</span>
            {entry.shortcut && <span className="ctx__shortcut">{entry.shortcut}</span>}
          </button>
        )
      )}
    </div>
  )
}
