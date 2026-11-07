import { useCallback, useEffect, useRef, useState } from 'react'
import type { ViewMode } from '../../core/editor'
import { emptySelection } from '../../core/selection/model'
import type { Selection } from '../../core/selection/types'
import {
  statusLines,
  USE_LASSO_LABEL,
  type AutoState,
  type ModelFile,
  type SegmentationEngine,
} from '../../services/segmentation'
import type { StickerRecord } from '../../core/backup'
import { parseSelection } from '../../core/selection/serialize'
import { PhotoUnreadableError, type LoadedPhoto } from '../../services/photo'
import { inflateModelAlpha } from '../../services/sticker'
import { EditorCanvas, type EditorTool } from './EditorCanvas'
import { StickerPanel } from './StickerPanel'
import { copyMask, createSession, type Photo, type Renderer } from './session'
import { Toolbar, ToolSheet } from './Toolbar'
import { useStickers, type StickerDeps, type StickerHost } from './useStickers'
import './EditorScreen.css'

export type { Renderer }

/** Shown when a re-opened photo decodes at another size (spec 0008 AC-9). */
export const DIFFERENT_SIZE =
  'This photo opened at a different size here; the outline may be off.'

export interface EditorScreenProps {
  engines: { fast: SegmentationEngine; precise: SegmentationEngine }
  missingBytes(files: readonly ModelFile[]): Promise<number>
  createRenderer(): Renderer
  /** Decodes a picked file; rejects (e.g. `PhotoUnreadableError`) when it can't. */
  loadPhoto(file: Blob): Promise<LoadedPhoto>
  /** Whether the browser can run the engines; checked before any download. */
  supported?: () => boolean
  now?: () => number
  /** Saving and keeping stickers (spec 0008); without it there is no panel. */
  stickers?: StickerDeps
}

/**
 * The editor (spec 0009). Top to bottom: a top bar (Photo, Stickers), the
 * canvas with the status strip over it, the action row (Undo, Redo, Reset
 * to auto, Compare), the options sheet, and the toolbar (Auto, View). The
 * canvas shows the cutout against the chosen view, at screen resolution
 * below 100% and at full resolution above.
 */
export function EditorScreen(props: EditorScreenProps) {
  const [state, setState] = useState<AutoState | null>(null)
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  /** The chosen view; it stays across tools and photos (AC-11). */
  const [viewMode, setViewMode] = useState<ViewMode>('overlay')
  const [tool, setTool] = useState<EditorTool>('auto')
  /** The active tool's options sheet (AC-23). */
  const [sheetOpen, setSheetOpen] = useState(true)
  /** The spec 0008 panel, in the sheet's place while open (AC-21). */
  const [stickersOpen, setStickersOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  /** Hold-to-compare (AC-18). */
  const [comparing, setComparing] = useState(false)
  const [selection, setSelection] = useState<Selection>(emptySelection())
  // One controller, history and renderer for the screen's life.
  const [session] = useState(() =>
    createSession({ ...props, onState: setState, onSelection: setSelection }),
  )

  // Only the canvas moves; the page itself never scrolls (AC-21).
  useEffect(() => {
    document.body.classList.add('editor-open')
    return () => {
      document.body.classList.remove('editor-open')
    }
  }, [])

  // A download that failed offline is tried again when the connection returns.
  useEffect(() => {
    const retry = () => {
      session.retry()
    }
    window.addEventListener('online', retry)
    return () => {
      window.removeEventListener('online', retry)
    }
  }, [session])

  const renderMask = useCallback(
    async (sel: Selection, scale: number) => {
      const renderer = session.renderer
      if (!renderer || !photo) return null
      const res = await renderer.render(photo.id, sel, scale)
      return res.type === 'rendered' ? res.mask : null
    },
    [session, photo],
  )

  const pick = async (file: File) => {
    let next: Photo
    try {
      next = await session.pick(file)
    } catch (e) {
      if (!(e instanceof PhotoUnreadableError)) throw e
      // The current photo and cutout stay as they were (spec 0008 AC-3).
      setPhotoError(e.message)
      return
    }
    setPhotoError(null)
    setPhoto(next)
  }

  const loadSaved = async (record: StickerRecord): Promise<LoadedPhoto> => {
    try {
      return await props.loadPhoto(
        new Blob([record.photo.bytes as BlobPart], { type: record.photo.type }),
      )
    } catch (e) {
      throw e instanceof PhotoUnreadableError
        ? e
        : new PhotoUnreadableError({ cause: e })
    }
  }

  const host: StickerHost = {
    snapshot: () => session.snapshot(),
    renderFull: async (photoId, sel, alpha) => {
      const renderer = session.renderer
      if (!renderer) throw new Error('no renderer yet')
      const res = await renderer.renderFull(
        photoId,
        sel,
        alpha ? copyMask(alpha) : undefined,
      )
      if (res.type !== 'rendered') throw new Error(`full render: ${res.type}`)
      return res.mask
    },
    saved: (photoId, ref) => {
      session.saved(photoId, ref)
    },
    deleted: (id) => {
      session.deleted(id)
    },
    open: async (record) => {
      const loaded = await loadSaved(record)
      const saved = parseSelection(record.selection).selection
      const sameSize =
        loaded.image.width === record.imageSize.width &&
        loaded.image.height === record.imageSize.height
      const alpha =
        sameSize && record.modelAlpha && props.stickers
          ? await inflateModelAlpha(
              record.modelAlpha,
              props.stickers.codecs.inflate,
            )
          : null
      // A model soft edge can't be drawn without a model alpha of this size.
      const restore: Selection =
        saved.softEdge?.source === 'model' && !alpha
          ? {
              rings: saved.rings,
              strokes: saved.strokes,
              feather: saved.feather,
            }
          : saved
      const shown = await session.reopen(record, loaded, alpha, restore)
      setPhotoError(null)
      setPhoto(shown)
      return sameSize ? null : DIFFERENT_SIZE
    },
  }
  const panel = useStickers(props.stickers, host, photo?.id ?? null, selection)

  const lines = state ? statusLines(state) : []
  const release = () => {
    setComparing(false)
  }

  const choosePhoto = () => {
    fileRef.current?.click()
  }
  const chooseTool = (next: EditorTool) => {
    if (next === tool && !stickersOpen) {
      setSheetOpen((open) => !open)
    } else {
      setTool(next)
      setSheetOpen(true)
    }
    setStickersOpen(false)
  }
  const showPanel = stickersOpen && panel !== null

  return (
    <section
      className="editor"
      data-testid="editor"
      data-phase={state?.phase ?? 'idle'}
      data-fallback={state?.fallbackTool ?? undefined}
    >
      <header className="editor-top">
        <h1 className="editor-title">Peel</h1>
        <button type="button" onClick={choosePhoto}>
          Photo
        </button>
        {panel && (
          <button
            type="button"
            aria-expanded={stickersOpen}
            onClick={() => {
              setStickersOpen((open) => !open)
            }}
          >
            Stickers
          </button>
        )}
        <input
          ref={fileRef}
          className="editor-file"
          type="file"
          accept="image/*"
          aria-label="Pick a photo"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0]
            if (file) void pick(file)
            e.currentTarget.value = ''
          }}
        />
      </header>
      <div className="editor-main">
        <EditorCanvas
          photo={
            photo && {
              id: photo.id,
              width: photo.image.width,
              height: photo.image.height,
              source: photo.source,
            }
          }
          selection={selection}
          renderMask={renderMask}
          viewMode={viewMode}
          comparing={comparing}
          tool={tool}
          onIntent={(intent) => {
            session.tap({ imagePt: intent.imagePt, mode: intent.type })
          }}
          {...(props.now && { now: props.now })}
        />
        {!photo && (
          <div className="editor-empty">
            <button type="button" onClick={choosePhoto}>
              Pick a photo
            </button>
          </div>
        )}
        <div className="editor-status" role="status" aria-live="polite">
          {photoError && (
            <p className="editor-error" role="alert">
              {photoError}
            </p>
          )}
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {state?.unavailable && (
            <button
              type="button"
              onClick={() => {
                session.useLasso()
              }}
            >
              {USE_LASSO_LABEL}
            </button>
          )}
        </div>
      </div>
      <div className="editor-actions">
        <button
          type="button"
          disabled={!session.canUndo}
          onClick={() => {
            session.undo()
          }}
        >
          Undo
        </button>
        <button
          type="button"
          disabled={!session.canRedo}
          onClick={() => {
            session.redo()
          }}
        >
          Redo
        </button>
        {state?.hasAutoResult && (
          <button
            type="button"
            disabled={selection === state.autoResultSelection}
            onClick={() => {
              session.resetToAuto()
            }}
          >
            Reset to auto
          </button>
        )}
        <button
          type="button"
          disabled={!photo}
          onPointerDown={() => {
            setComparing(true)
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onPointerLeave={release}
          onBlur={release}
          onKeyDown={(e) => {
            if (e.key !== ' ' && e.key !== 'Enter') return
            e.preventDefault()
            if (!e.repeat) setComparing(true)
          }}
          onKeyUp={(e) => {
            if (e.key === ' ' || e.key === 'Enter') release()
          }}
          onContextMenu={(e) => {
            e.preventDefault()
          }}
        >
          Compare
        </button>
      </div>
      {(showPanel || sheetOpen) && (
        <div className="editor-sheet" data-testid="sheet">
          {showPanel ? (
            <StickerPanel {...panel} />
          ) : (
            <ToolSheet
              tool={tool}
              viewMode={viewMode}
              onViewMode={setViewMode}
            />
          )}
        </div>
      )}
      <Toolbar tool={tool} disabled={!photo} onTool={chooseTool} />
    </section>
  )
}
