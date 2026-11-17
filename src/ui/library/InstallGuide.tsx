import { useEffect, useId, useRef } from 'react'
import { Rich, useT, type MessageKey } from '../i18n'

const STEPS: readonly MessageKey[] = [
  'install.step1',
  'install.step2',
  'install.step3',
]

/** The iPhone and iPad install steps (spec 0013 AC-16). */
export function InstallGuide(props: { onClose: () => void }) {
  const t = useT()
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
  }, [])
  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            props.onClose()
          }
        }}
      >
        <h2 id={titleId} className="dialog-title">
          {t('install.guideTitle')}
        </h2>
        <ol className="guide-steps">
          {STEPS.map((key) => (
            <li key={key}>
              <Rich text={t(key)} />
            </li>
          ))}
        </ol>
        <p className="dialog-body">{t('install.after')}</p>
        <div className="dialog-actions">
          <button
            ref={closeRef}
            type="button"
            className="dialog-primary"
            onClick={props.onClose}
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
