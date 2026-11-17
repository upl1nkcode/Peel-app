import { useEffect, useId, useRef } from 'react'

export interface DialogAction {
  label: string
  kind: 'primary' | 'danger' | 'plain'
  onClick: () => void
}

export interface ConfirmDialogProps {
  title: string
  body?: string
  actions: readonly DialogAction[]
  /** Escape and a tap outside do this. */
  onCancel: () => void
  /** Every action is disabled, and Escape and outside taps do nothing. */
  busy?: boolean
}

/**
 * An in-page dialog (spec 0013 AC-5, AC-11): never `window.confirm`. Focus
 * starts on the first action; Escape cancels.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const titleId = useId()
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    first.current?.focus()
  }, [])
  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !props.busy) props.onCancel()
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={props.busy ?? false}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            if (!props.busy) props.onCancel()
          }
        }}
      >
        <h2 id={titleId} className="dialog-title">
          {props.title}
        </h2>
        {props.body && <p className="dialog-body">{props.body}</p>}
        <div className="dialog-actions">
          {props.actions.map((a, i) => (
            <button
              key={a.label}
              ref={i === 0 ? first : undefined}
              type="button"
              className={`dialog-${a.kind}`}
              disabled={props.busy ?? false}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
