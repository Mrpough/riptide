import { useMemo } from 'react'
import { CATEGORIES, CATEGORY_LABEL } from '@shared/categories'
import type { CategoryId } from '@shared/types'
import type { StatusFilter } from '../state/store'
import { useApp } from '../state/store'
import {
  IconAlert,
  IconArchive,
  IconCheck,
  IconClock,
  IconCode,
  IconFile,
  IconGlobe,
  IconList,
  IconMusic,
  IconPause,
  IconPulse,
  IconVideo
} from './Icons'

interface NavRow {
  id: string
  label: string
  icon: JSX.Element
  count: number
  current: boolean
  onClick: () => void
}

const STATUS_ROWS: Array<{ id: StatusFilter; label: string; icon: JSX.Element }> = [
  { id: 'all', label: 'All Downloads', icon: <IconList size={15} /> },
  { id: 'active', label: 'Active', icon: <IconPulse size={15} /> },
  { id: 'queued', label: 'Queued', icon: <IconClock size={15} /> },
  { id: 'paused', label: 'Paused', icon: <IconPause size={15} /> },
  { id: 'completed', label: 'Completed', icon: <IconCheck size={15} /> },
  { id: 'error', label: 'Failed', icon: <IconAlert size={15} /> }
]

const CATEGORY_ICON: Record<CategoryId, JSX.Element> = {
  all: <IconList size={15} />,
  compressed: <IconArchive size={15} />,
  documents: <IconFile size={15} />,
  music: <IconMusic size={15} />,
  video: <IconVideo size={15} />,
  programs: <IconCode size={15} />,
  other: <IconGlobe size={15} />
}

const ACTIVE_STATUSES = new Set(['downloading', 'connecting'])
const PAUSED_STATUSES = new Set(['paused', 'stopped'])

function countFor(
  downloads: ReturnType<typeof useApp.getState>['downloads'],
  status: StatusFilter
): number {
  switch (status) {
    case 'all':
      return downloads.length
    case 'active':
      return downloads.filter((d) => ACTIVE_STATUSES.has(d.status)).length
    case 'queued':
      return downloads.filter((d) => d.status === 'queued').length
    case 'paused':
      return downloads.filter((d) => PAUSED_STATUSES.has(d.status)).length
    case 'completed':
      return downloads.filter((d) => d.status === 'completed').length
    case 'error':
      return downloads.filter((d) => d.status === 'error').length
    default:
      return 0
  }
}

function NavItem({ row }: { row: NavRow }): JSX.Element {
  return (
    <button
      type="button"
      className="navitem"
      aria-current={row.current ? 'true' : 'false'}
      onClick={row.onClick}
    >
      <span className="navitem__icon">{row.icon}</span>
      <span className="navitem__label">{row.label}</span>
      {row.count > 0 && <span className="navitem__count">{row.count}</span>}
    </button>
  )
}

export function Sidebar(): JSX.Element {
  const downloads = useApp((s) => s.downloads)
  const category = useApp((s) => s.category)
  const status = useApp((s) => s.status)
  const setCategory = useApp((s) => s.setCategory)
  const setStatus = useApp((s) => s.setStatus)

  const statusRows = useMemo<NavRow[]>(
    () =>
      STATUS_ROWS.map((row) => ({
        id: `status:${row.id}`,
        label: row.label,
        icon: row.icon,
        count: countFor(downloads, row.id),
        current: status === row.id,
        onClick: () => setStatus(row.id)
      })),
    [downloads, status, setStatus]
  )

  const categoryRows = useMemo<NavRow[]>(() => {
    const total = downloads.length
    return [
      {
        id: 'cat:all',
        label: CATEGORY_LABEL.all,
        icon: CATEGORY_ICON.all,
        count: total,
        current: category === 'all',
        onClick: () => setCategory('all')
      },
      ...CATEGORIES.map((meta) => ({
        id: `cat:${meta.id}`,
        label: meta.label,
        icon: CATEGORY_ICON[meta.id],
        count: downloads.filter((d) => d.category === meta.id).length,
        current: category === meta.id,
        onClick: () => setCategory(meta.id)
      }))
    ]
  }, [downloads, category, setCategory])

  return (
    <nav className="sidebar" aria-label="Filters">
      <div>
        <div className="sidebar__label">Transfers</div>
        {statusRows.map((row) => (
          <NavItem key={row.id} row={row} />
        ))}
      </div>
      <div>
        <div className="sidebar__label">Categories</div>
        {categoryRows.map((row) => (
          <NavItem key={row.id} row={row} />
        ))}
      </div>
    </nav>
  )
}
