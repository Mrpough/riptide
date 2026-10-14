import { useEffect } from 'react'
import type { Notice } from '@shared/types'
import { useApp, type Toast } from '../state/store'
import { IconAlert, IconCheck, IconInfo, IconX } from './Icons'

const DISMISS_MS = 5200

function iconFor(kind: Notice['kind']): JSX.Element {
  if (kind === 'success') return <IconCheck size={16} />
  if (kind === 'info') return <IconInfo size={16} />
  return <IconAlert size={16} />
}

function ToastItem({ toast }: { toast: Toast }): JSX.Element {
  const dismissToast = useApp((s) => s.dismissToast)

  useEffect(() => {
    const timer = window.setTimeout(() => dismissToast(toast.id), DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [toast.id, dismissToast])

  return (
    <div className="toast" data-kind={toast.kind} role="status">
      <span className="toast__icon">{iconFor(toast.kind)}</span>
      <div className="toast__text">
        <div className="toast__title">{toast.message}</div>
        {toast.detail && <div className="toast__detail">{toast.detail}</div>}
      </div>
      <button
        type="button"
        className="toast__close iconbtn"
        aria-label="Dismiss notification"
        onClick={() => dismissToast(toast.id)}
      >
        <IconX size={13} />
      </button>
    </div>
  )
}

/** Fixed stack in the lower-right; each toast retires itself. */
export function Toasts(): JSX.Element | null {
  const toasts = useApp((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
