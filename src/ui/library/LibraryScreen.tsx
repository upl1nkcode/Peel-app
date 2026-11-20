import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { StickerSummary } from '../../services/storage'
import { useT } from '../i18n'
import { ConfirmDialog } from './ConfirmDialog'
import { useLongPress } from './useLongPress'
import './LibraryScreen.css'

/** The most stickers Share sends at once (#153): each file is held in memory. */
export const SHARE_LIMIT = 15

/** Share from the Library (Task 8 fills it). */
export interface ShareState {
  /** The browser can share the ticked stickers' files. */
  shown: boolean
  /** A ticked sticker's file is still being made. */
  preparing: boolean
  /** More are ticked than Share takes at once (#153). */
  limited: boolean
  /** The last share error, already worded. */
  message: string | null
  onShare: () => void
}

export interface LibraryProps {
  /** Newest first (spec 0013 AC-1). */
  stickers: readonly StickerSummary[]
  /** Shown in place of the grid when stickers can't be read (AC-12). */
  blocked: string | null
  /** The last result or error, already worded. */
  message: string | null
  /** An action is running; the bar's actions wait. */
  busy: boolean
  onNew: (file: File) => void
  onOpen: (id: string) => void
  onDuplicate: (ids: readonly string[]) => Promise<void>
  onExport: (ids: readonly string[]) => Promise<void>
  onDelete: (ids: readonly string[]) => Promise<void>
  /** The ticked ids, in grid order, whenever they change. */
  onTicked: (ids: readonly string[]) => void
  share: ShareState
  /** The ⋯ menu (Task 7). */
  menu: ReactNode
  /** The install card and the update bar, above the grid (Task 7). */
  top: ReactNode
}

function pngDataUrl(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:image/png;base64,${btoa(binary)}`
}

/**
 * The home screen (spec 0013 AC-1 to AC-12): the saved stickers in a grid.
 * Tap to open; touch and hold (or "Select") to tick several, then Share,
 * Duplicate, Export or Delete them from the bar.
 */
export function LibraryScreen(props: LibraryProps) {
  const t = useT()
  const fileRef = useRef<HTMLInputElement>(null)
  const [selecting, setSelecting] = useState(false)
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const { stickers, onTicked } = props

  const tickedIds = useMemo(
    () => stickers.filter((s) => ticked.has(s.id)).map((s) => s.id),
    [stickers, ticked],
  )
  useEffect(() => {
    onTicked(tickedIds)
  }, [tickedIds, onTicked])

  const thumbnails = useMemo(
    () => new Map(stickers.map((s) => [s.id, pngDataUrl(s.thumbnail)])),
    [stickers],
  )

  const toggle = (id: string) => {
    setTicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const stopSelecting = () => {
    setSelecting(false)
    setTicked(new Set())
    setConfirming(false)
  }
  const longPress = useLongPress((id) => {
    setSelecting(true)
    setTicked((prev) => new Set(prev).add(id))
  })

  const blocked = props.blocked !== null
  const none = tickedIds.length === 0
  const actionsOff = none || props.busy
  const run =
    (action: (ids: readonly string[]) => Promise<void>, end: boolean) => () => {
      const ids = tickedIds
      void action(ids).then(() => {
        if (end) stopSelecting()
      })
    }

  return (
    <section className="library" aria-labelledby="library-title">
      <header className="library-top">
        {selecting ? (
          <p className="library-count" id="library-title">
            {t('library.selected_plural', { count: tickedIds.length })}
          </p>
        ) : (
          <h1 className="library-title" id="library-title">
            Peel
          </h1>
        )}
        <div className="library-top-actions">
          <button
            type="button"
            disabled={!selecting && (blocked || stickers.length === 0)}
            onClick={() => {
              if (selecting) stopSelecting()
              else setSelecting(true)
            }}
          >
            {t(selecting ? 'library.done' : 'library.select')}
          </button>
          {!selecting && props.menu}
        </div>
      </header>
      {props.top}
      {props.message && (
        <p className="library-message" role="status">
          {props.message}
        </p>
      )}
      {blocked ? (
        <p className="library-blocked" role="alert">
          {props.blocked}
        </p>
      ) : stickers.length === 0 ? (
        <div className="library-empty">
          <p className="library-empty-title">{t('library.emptyTitle')}</p>
          <p>{t('library.emptyBody')}</p>
        </div>
      ) : (
        <ul className="library-grid" data-selecting={selecting || undefined}>
          {stickers.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="library-tile"
                data-id={s.id}
                aria-label={t('library.open')}
                aria-pressed={selecting ? ticked.has(s.id) : undefined}
                onContextMenu={(e) => {
                  e.preventDefault()
                }}
                {...longPress.handlers(s.id)}
                onClick={() => {
                  if (longPress.fired(s.id)) return
                  if (selecting) toggle(s.id)
                  else props.onOpen(s.id)
                }}
              >
                <img src={thumbnails.get(s.id)} alt="" draggable={false} />
                {selecting && (
                  <span
                    className="library-tick"
                    data-on={ticked.has(s.id) || undefined}
                    aria-hidden="true"
                  >
                    {ticked.has(s.id) ? '✓' : ''}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selecting ? (
        <div className="library-bar">
          {(props.share.preparing ||
            props.share.limited ||
            props.share.message) && (
            <p className="library-bar-note" role="status">
              {props.share.limited
                ? t('library.shareLimit', { count: SHARE_LIMIT })
                : props.share.preparing
                  ? t('library.preparing')
                  : props.share.message}
            </p>
          )}
          <div className="library-bar-actions">
            {props.share.shown && (
              <button
                type="button"
                disabled={
                  actionsOff || props.share.preparing || props.share.limited
                }
                onClick={props.share.onShare}
              >
                {t('library.share')}
              </button>
            )}
            <button
              type="button"
              disabled={actionsOff}
              onClick={run(props.onDuplicate, true)}
            >
              {t('library.duplicate')}
            </button>
            <button
              type="button"
              disabled={actionsOff}
              onClick={run(props.onExport, false)}
            >
              {t('library.export')}
            </button>
            <button
              type="button"
              className="library-danger"
              disabled={actionsOff}
              onClick={() => {
                setConfirming(true)
              }}
            >
              {t('library.delete')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="library-new"
          aria-label={t('library.new')}
          onClick={() => fileRef.current?.click()}
        >
          +
        </button>
      )}
      <input
        ref={fileRef}
        className="library-file"
        type="file"
        accept="image/*"
        aria-label={t('editor.pickPhoto')}
        tabIndex={-1}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (file) props.onNew(file)
        }}
      />
      {confirming && (
        <ConfirmDialog
          title={
            tickedIds.length === 1
              ? t('library.deleteOne')
              : t('library.deleteMany_plural', { count: tickedIds.length })
          }
          body={t('library.cantUndo')}
          actions={[
            {
              label: t('common.delete'),
              kind: 'danger',
              onClick: run(props.onDelete, true),
            },
            {
              label: t('common.cancel'),
              kind: 'plain',
              onClick: () => {
                setConfirming(false)
              },
            },
          ]}
          onCancel={() => {
            setConfirming(false)
          }}
        />
      )}
    </section>
  )
}
