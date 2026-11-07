import { useCallback, useEffect, useState } from 'react'
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
import { EditorCanvas } from './EditorCanvas'
import { StickerPanel } from './StickerPanel'
import { copyMask, createSession, type Photo, type Renderer } from './session'
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
 * The editor (spec 0009): pick a photo, then tap to add, long-press to
 * remove. The canvas shows the cutout against the chosen view, at screen
 * resolution below 100% and at full resolution above.
 */
export function EditorScreen(props: EditorScreenProps) {
  const [state, setState] = useState<AutoState | null>(null)
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  /** The chosen view; it stays across tools and photos (AC-11). */
  const [viewMode] = useState<ViewMode>('overlay')
  /** Hold-to-compare (AC-18). */
  const [comparing, setComparing] = useState(false)
  const [selection, setSelection] = useState<Selection>(emptySelection())
  // One controller, history and renderer for the screen's life.
  const [session] = useState(() =>
    createSession({ ...props, onState: setState, onSelection: setSelection }),
  )

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

  return (
    <section
      className="auto-screen"
      data-testid="editor"
      data-phase={state?.phase ?? 'idle'}
      data-fallback={state?.fallbackTool ?? undefined}
    >
      <label className="auto-pick">
        Pick a photo
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0]
            if (file) void pick(file)
          }}
        />
      </label>
      {photoError && (
        <p className="auto-error" role="alert">
          {photoError}
        </p>
      )}
      <div className="auto-status" role="status" aria-live="polite">
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
        tool="auto"
        onIntent={(intent) => {
          session.tap({ imagePt: intent.imagePt, mode: intent.type })
        }}
        {...(props.now && { now: props.now })}
      />
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
      {panel && <StickerPanel {...panel} />}
    </section>
  )
}
