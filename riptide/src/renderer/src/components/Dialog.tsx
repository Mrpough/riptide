import { useEffect, type MouseEvent, type ReactNode } from 'react'
import { IconX } from './Icons'

interface DialogProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  /** aria-label override when the visible heading is not the accessible name. */
  describedBy?: string
}

/** Shared modal shell: scrim, framed panel, sticky header/footer, Esc to close. */
export function Dialog({ title, onClose, children, footer, wide, describedBy }: DialogProps): JSX.Element {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  const stopPropagation = (event: MouseEvent<HTMLDivElement>): void => event.stopPropagation()

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        className={`dialog${wide ? ' dialog--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={describedBy}
        onMouseDown={stopPropagation}
      >
        <div className="dialog__head">
          <h2>{title}</h2>
          <button type="button" className="iconbtn" aria-label="Close dialog" onClick={onClose}>
            <IconX size={15} />
          </button>
        </div>
        <div className="dialog__body">{children}</div>
        {footer && <div className="dialog__foot">{footer}</div>}
      </div>
    </div>
  )
}
