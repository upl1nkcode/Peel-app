import { useEffect, useRef, useState } from 'react'
import type { OfflineStatus } from '../../services/segmentation'
import { useT, type LangChoice, type MessageKey } from '../i18n'
import type { InstallOffer } from './installOffer'

export interface MoreMenuProps {
  /** There's at least one sticker to export. */
  canExportAll: boolean
  onExportAll: () => void
  onImport: (file: File) => void
  choice: LangChoice
  onChoice: (choice: LangChoice) => void
  /** `null` hides "Install Peel" (AC-14). */
  install: InstallOffer | null
  /** The storage status line, already worded (spec 0008 AC-14). */
  storageLine: string
  /** `null` before the offline status is known. */
  offline: OfflineStatus | null
}

const CHOICES: readonly [LangChoice, MessageKey][] = [
  ['auto', 'lang.auto'],
  ['en', 'lang.en'],
  ['ro', 'lang.ro'],
]

function offlineKey(status: OfflineStatus): MessageKey {
  switch (status.kind) {
    case 'downloading':
      return 'offline.downloading'
    case 'ready':
      return 'offline.ready'
    case 'needsInternet':
      return 'offline.needsInternet'
  }
}

/**
 * The Library's ⋯ menu (spec 0013 AC-13): Export all, Import, Language,
 * Install Peel, then the storage and offline lines. Escape, a tap outside or
 * an action closes it; a language choice applies at once and keeps it open.
 */
export function MoreMenu(props: MoreMenuProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => {
      document.removeEventListener('pointerdown', outside)
    }
  }, [open])

  const close = () => {
    setOpen(false)
    button.current?.focus()
  }

  return (
    <div className="menu-root" ref={root}>
      <button
        ref={button}
        type="button"
        className="menu-button"
        aria-label={t('menu.more')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o)
        }}
      >
        ⋯
      </button>
      {open && (
        <div
          className="menu"
          role="menu"
          aria-label={t('menu.more')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              close()
            }
          }}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!props.canExportAll}
            onClick={() => {
              close()
              props.onExportAll()
            }}
          >
            {t('menu.exportAll')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close()
              fileRef.current?.click()
            }}
          >
            {t('menu.import')}
          </button>
          <div
            className="menu-group"
            role="group"
            aria-label={t('menu.language')}
          >
            <p className="menu-label" aria-hidden="true">
              {t('menu.language')}
            </p>
            {CHOICES.map(([choice, key]) => (
              <button
                key={choice}
                type="button"
                role="menuitemradio"
                aria-checked={props.choice === choice}
                onClick={() => {
                  props.onChoice(choice)
                }}
              >
                <span className="menu-check" aria-hidden="true">
                  {props.choice === choice ? '✓' : ''}
                </span>
                {t(key)}
              </button>
            ))}
          </div>
          {props.install && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close()
                props.install?.open()
              }}
            >
              {t('menu.install')}
            </button>
          )}
          <div className="menu-separator" role="separator" />
          <p className="menu-status" role="none">
            {props.storageLine}
          </p>
          {props.offline && (
            <p className="menu-status" role="none">
              {t(
                offlineKey(props.offline),
                props.offline.kind === 'downloading'
                  ? { percent: props.offline.percent }
                  : undefined,
              )}
            </p>
          )}
        </div>
      )}
      <input
        ref={fileRef}
        className="library-file"
        type="file"
        accept=".zip,application/zip"
        aria-label={t('menu.import')}
        tabIndex={-1}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (file) props.onImport(file)
        }}
      />
    </div>
  )
}
