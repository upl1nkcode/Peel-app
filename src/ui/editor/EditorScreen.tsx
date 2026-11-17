import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react'
import {
  defaultBrushSize,
  densityTolerance,
  sameRings,
  startingShape,
  type ViewMode,
} from '../../core/editor'
import { emptySelection } from '../../core/selection/model'
import { DEFAULT_FINISH, type FinishSettings } from '../../core/sticker'
import type { Command, NodeRef, Selection } from '../../core/selection/types'
import {
  statusLines,
  type AutoState,
  type ModelFile,
  type SegmentationEngine,
} from '../../services/segmentation'
import type { StickerRecord } from '../../core/backup'
import { parseSelection } from '../../core/selection/serialize'
import { say, useT, type Message, type MessageKey } from '../i18n'
import { PhotoUnreadableError, type LoadedPhoto } from '../../services/photo'
import { inflateModelAlpha } from '../../services/sticker'
import { BrushSheet } from './BrushSheet'
import type { BrushSettings } from './brushTool'
import { DotsSheet } from './DotsSheet'
import { LassoSheet } from './LassoSheet'
import {
  EditorCanvas,
  type EditorCanvasHandle,
  type EditorTool,
} from './EditorCanvas'
import {
  copyMask,
  createSession,
  type Photo,
  type Renderer,
  type Snapper,
} from './session'
import { Toolbar, ToolSheet } from './Toolbar'
import { useLasso } from './useLasso'
import { useSave, type SaveHost } from './useSave'
import { messageFor, type Library } from '../library/useLibrary'
import { FinishFlow } from '../finish/FinishFlow'
import './EditorScreen.css'

export type { Renderer }

/** Shown when a re-opened photo decodes at another size (spec 0008 AC-9). */
export const DIFFERENT_SIZE: MessageKey = 'editor.differentSize'

const NO_REFS: readonly NodeRef[] = []

/** A slide of the density slider, from finger down until its commit (AC-15). */
interface DensityDrag {
  /** The selection when the finger went down; every result is computed from it. */
  start: Selection
  /** The newest slider position. */
  want: number
  /** The finger has lifted; `want` is the release position. */
  released: boolean
  /** A computation is running. */
  busy: boolean
}

export interface EditorScreenProps {
  engines: { fast: SegmentationEngine; precise: SegmentationEngine }
  missingBytes(files: readonly ModelFile[]): Promise<number>
  createRenderer(): Renderer
  /** The live-wire worker for snapping lasso sections (spec 0011 AC-11). */
  createSnapper?(): Snapper
  /** Decodes a picked file; rejects (e.g. `PhotoUnreadableError`) when it can't. */
  loadPhoto(file: Blob): Promise<LoadedPhoto>
  /** Whether the browser can run the engines; checked before any download. */
  supported?: () => boolean
  now?: () => number
  /** Saving and opening stickers (spec 0008, spec 0013); without it there is no Save. */
  library?: Library
  /** What the app asks of the editor (spec 0013). */
  handle?: Ref<EditorHandle>
  /** The top bar's "Library" button (spec 0013 AC-5); without it there is none. */
  onLibrary?: () => void
  /** False while the Library shows: the editor is hidden and inert. */
  visible?: boolean
}

/** What the app asks of the editor (spec 0013). */
export interface EditorHandle {
  /** Shows a picked photo; resolves to an error to show on the Library, or null (AC-3). */
  openFile: (file: File) => Promise<MessageKey | null>
  /** Shows a saved sticker as saved (AC-4); false when it's gone or can't be shown. */
  openSticker: (id: string) => Promise<boolean>
  /** What leaving would lose (AC-5): nothing, a new sticker, or changes to a saved one. */
  unsaved: () => 'none' | 'new' | 'changed'
  /** Saves what's shown; false with the error in the status strip. */
  save: () => Promise<boolean>
  /** These stickers were deleted; the open one is saved as new next time (Review Focus 2). */
  deleted: (ids: readonly string[]) => void
  /** Closes the Finish screen if it's open; true when it was (Decision 14). */
  back: () => boolean
}

/**
 * The editor (spec 0009). Top to bottom: a top bar (Library, Save, Done), the
 * canvas with the status strip over it, the action row (Undo, Redo, Reset
 * to auto, Compare), the options sheet, and the toolbar (Auto, Lasso, Dots,
 * Brush, View). The
 * canvas shows the cutout against the chosen view, at screen resolution
 * below 100% and at full resolution above.
 */
export function EditorScreen(props: EditorScreenProps) {
  const t = useT()
  const [state, setState] = useState<AutoState | null>(null)
  const [photo, setPhoto] = useState<Photo | null>(null)
  /** The chosen view; it stays across tools and photos (AC-11). */
  const [viewMode, setViewMode] = useState<ViewMode>('overlay')
  const [tool, setTool] = useState<EditorTool>('auto')
  /** The active tool's options sheet (AC-23). */
  const [sheetOpen, setSheetOpen] = useState(true)
  /** Hold-to-compare (AC-18). */
  const [comparing, setComparing] = useState(false)
  const [selection, setSelection] = useState<Selection>(emptySelection())
  // One controller, history and renderer for the screen's life.
  const [session] = useState(() =>
    createSession({ ...props, onState: setState, onSelection: setSelection }),
  )
  /** The Finish settings (spec 0012): kept for a new photo, gone on reload (Decision 8). */
  const [finish, setFinishState] = useState<FinishSettings>(DEFAULT_FINISH)
  const setFinish = (settings: FinishSettings) => {
    session.setFinish(settings)
    setFinishState(settings)
  }
  /** The Finish screen is open over the editor (spec 0012 AC-8). */
  const [finishing, setFinishing] = useState(false)
  /** The iPhone guide opens on the first Finish screen of a session only (AC-18). */
  const [guideSeen, setGuideSeen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const canvasRef = useRef<EditorCanvasHandle>(null)
  /**
   * The selected dots and the selection they belong to. Any other selection
   * means a change from outside the Dots tool, which clears them (spec 0010
   * AC-13).
   */
  const [dots, setDots] = useState<{
    selection: Selection
    refs: readonly NodeRef[]
  } | null>(null)
  const selectedDots = dots?.selection === selection ? dots.refs : NO_REFS
  /** Fine mode for dot drags, on by default (spec 0010 decision 5). */
  const [fine, setFine] = useState(true)
  /** The density slider's drag (AC-15, AC-16). */
  const density = useRef<DensityDrag | null>(null)
  /** The newest density result, shown until the slider is let go. */
  const [densityPreview, setDensityPreview] = useState<Selection | null>(null)
  /** The open lasso and its options (spec 0011). A closed ring opens Dots (AC-16). */
  const lasso = useLasso(session, {
    onFinished: () => {
      dropDensity()
      setDots(null)
      setTool('dots')
      setSheetOpen(true)
    },
    hasRings: selection.rings.length > 0,
  })
  /** The brush (spec 0011 AC-18, AC-19): mode and hardness stay; the size is per photo. */
  const [brushMode, setBrushMode] = useState<BrushSettings['mode']>('erase')
  const [hardness, setHardness] = useState(1)
  const [brushSize, setBrushSize] = useState<{
    photoId: string
    px: number
  } | null>(null)
  /** 40 CSS px at the zoom Brush first opens at on this photo (AC-19). */
  const sizeBrushFor = (
    photoId: string,
    image?: { width: number; height: number },
  ) => {
    if (brushSize?.photoId === photoId) return
    const k = canvasRef.current?.cssPerImagePx(image) ?? null
    setBrushSize({ photoId, px: defaultBrushSize(k ?? 1) })
  }
  const brush: BrushSettings | undefined =
    tool === 'brush' && photo && brushSize?.photoId === photo.id
      ? { mode: brushMode, sizePx: brushSize.px, hardness }
      : undefined
  /** Undo and Redo work on the open lasso's sections (AC-8). */
  const lassoUndo = tool === 'lasso' && lasso.open !== null

  const visible = props.visible ?? true
  // Only the canvas moves; the page itself never scrolls (AC-21).
  useEffect(() => {
    if (!visible) return
    document.body.classList.add('editor-open')
    return () => {
      document.body.classList.remove('editor-open')
    }
  }, [visible])

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

  /** The current photo and cutout stay when `file` can't be read (spec 0008 AC-3). */
  const pick = async (file: File): Promise<MessageKey | null> => {
    let next: Photo
    try {
      next = await session.pick(file)
    } catch (e) {
      return messageFor(e)
    }
    setDots(null)
    dropDensity()
    lasso.drop()
    if (tool === 'brush') sizeBrushFor(next.id, next.image)
    setPhoto(next)
    return null
  }

  /** One dot edit as one undo step, then the dots to select (spec 0010). */
  const edit = (command: Command, selectAfter: readonly NodeRef[]) => {
    // Refs from the canvas point into the density preview; drop them.
    if (density.current) return
    const next = session.edit(command)
    setDots({ selection: next, refs: [...selectAfter] })
  }

  const addShape = (kind: 'rectangle' | 'ellipse') => {
    const visible = canvasRef.current?.visiblePhotoRect()
    if (!visible || density.current) return
    edit({ type: 'addRing', nodes: startingShape(kind, visible) }, [])
  }

  /** Ends a slide without committing it: the real selection shows again. */
  const dropDensity = () => {
    density.current = null
    setDensityPreview(null)
  }

  /**
   * Computes the start's rings at the slider's newest position, off the main
   * thread, one computation at a time (AC-15, final review I-2). Each result
   * is shown as it arrives, then the newest position is computed next; the
   * release position's own result becomes one undo step, unless it changes
   * nothing or something else changed the selection meanwhile (AC-16,
   * Review Focus 3).
   */
  const computeDensity = (d: DensityDrag) => {
    if (d.busy || density.current !== d) return
    const s = d.want
    const tolerancePx = densityTolerance(s)
    const renderer = session.renderer
    if (tolerancePx === null || !renderer) {
      setDensityPreview(null)
      if (d.released) dropDensity()
      return
    }
    d.busy = true
    void renderer.resimplify(d.start, tolerancePx).then((res) => {
      d.busy = false
      if (density.current !== d) return
      const result = res.type === 'resimplified' ? res.selection : null
      if (!d.released) {
        if (result) setDensityPreview(result)
        if (d.want !== s) computeDensity(d)
        return
      }
      // Released at another position: compute that one.
      if (d.want !== s) {
        computeDensity(d)
        return
      }
      dropDensity()
      if (
        result &&
        session.snapshot()?.selection === d.start &&
        !sameRings(d.start, result)
      ) {
        edit({ type: 'restore', selection: result }, [])
      }
    })
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

  const host: SaveHost = {
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
    open: async (record) => {
      const loaded = await loadSaved(record)
      const saved = parseSelection(record.selection).selection
      const sameSize =
        loaded.image.width === record.imageSize.width &&
        loaded.image.height === record.imageSize.height
      const alpha =
        sameSize && record.modelAlpha && props.library
          ? await inflateModelAlpha(
              record.modelAlpha,
              props.library.deps.codecs.inflate,
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
      const { photo: shown, finish: reopened } = await session.reopen(
        record,
        loaded,
        alpha,
        restore,
      )
      setFinish(reopened)
      setDots(null)
      dropDensity()
      lasso.drop()
      if (tool === 'brush') sizeBrushFor(shown.id, shown.image)
      setPhoto(shown)
      return {
        photoId: shown.id,
        selection: session.snapshot()?.selection ?? restore,
        finish: reopened,
        warning: sameSize ? null : DIFFERENT_SIZE,
      }
    },
  }
  const saver = useSave(
    props.library,
    host,
    photo?.id ?? null,
    selection,
    finish,
  )

  const openFinish = () => {
    dropDensity()
    setGuideOpen(!guideSeen)
    setGuideSeen(true)
    setFinishing(true)
    // Android Back closes it (Decision 14).
    window.history.pushState({ peel: 'finish' }, '')
  }

  useImperativeHandle(props.handle, () => ({
    openFile: pick,
    openSticker: (id) => saver.open(id),
    unsaved: () => {
      const snap = session.snapshot()
      if (!snap || !saver.canSave || saver.saved) return 'none'
      if (snap.selection.rings.length === 0) return 'none'
      return snap.sticker ? 'changed' : 'new'
    },
    save: () => saver.save(),
    deleted: (ids) => {
      const open = session.snapshot()?.sticker?.id
      for (const id of ids) session.deleted(id)
      if (open !== undefined && ids.includes(open)) saver.forget()
    },
    back: () => {
      if (!finishing) return false
      setFinishing(false)
      return true
    },
  }))

  const lines: Message[] = [
    ...(state ? statusLines(state) : []),
    ...(lasso.notice ? [{ key: lasso.notice }] : []),
  ]
  const release = () => {
    setComparing(false)
  }

  const chooseTool = (next: EditorTool) => {
    // The sheet goes, so its slider never sees the finger lift (I-3).
    dropDensity()
    if (next === 'brush' && photo) sizeBrushFor(photo.id)
    if (next === tool) {
      setSheetOpen((open) => !open)
    } else {
      setTool(next)
      setSheetOpen(true)
    }
  }

  return (
    <>
      <section
        className="editor"
        data-testid="editor"
        data-phase={state?.phase ?? 'idle'}
        data-fallback={state?.fallbackTool ?? undefined}
        hidden={!visible}
        inert={finishing || !visible}
      >
        <header className="editor-top">
          {props.onLibrary && (
            <button
              type="button"
              className="editor-library"
              onClick={() => {
                dropDensity()
                props.onLibrary?.()
              }}
            >
              <span aria-hidden="true">‹</span>
              {t('editor.library')}
            </button>
          )}
          <div className="editor-top-actions">
            {props.library && (
              <button
                type="button"
                className="editor-save"
                disabled={!saver.canSave || saver.busy}
                onClick={() => {
                  void saver.save()
                }}
              >
                {t(saver.saved ? 'common.saved' : 'common.save')}
              </button>
            )}
            <button
              type="button"
              className="editor-done"
              disabled={!photo || selection.rings.length === 0}
              onClick={openFinish}
            >
              {t('editor.done')}
            </button>
          </div>
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
            ref={canvasRef}
            selection={densityPreview ?? selection}
            renderMask={renderMask}
            viewMode={viewMode}
            comparing={comparing}
            tool={tool}
            onIntent={(intent) => {
              session.tap({ imagePt: intent.imagePt, mode: intent.type })
            }}
            selectedDots={densityPreview ? NO_REFS : selectedDots}
            fine={fine}
            onEdit={edit}
            onSelectDots={(refs) => {
              if (density.current) return
              setDots({ selection, refs: [...refs] })
            }}
            lasso={lasso.open}
            snap={lasso.liveSnap}
            snapOn={lasso.snapOn}
            onLassoSection={lasso.addSection}
            brush={brush}
            {...(props.now && { now: props.now })}
          />
          <div className="editor-status" role="status" aria-live="polite">
            {saver.message && (
              <p className="editor-error" role="alert">
                {t(saver.message)}
              </p>
            )}
            {lines
              .map((m) => say(t, m))
              .map((line) => (
                <p key={line}>{line}</p>
              ))}
            {state?.unavailable && tool === 'auto' && (
              <button
                type="button"
                onClick={() => {
                  session.useLasso()
                  chooseTool('lasso')
                }}
              >
                {t('auto.useLasso')}
              </button>
            )}
          </div>
        </div>
        <div className="editor-actions">
          <button
            type="button"
            disabled={lassoUndo ? lasso.open?.busy : !session.canUndo}
            onClick={() => {
              if (lassoUndo) lasso.undoSection()
              else session.undo()
            }}
          >
            {t('editor.undo')}
          </button>
          <button
            type="button"
            disabled={lassoUndo || !session.canRedo}
            onClick={() => {
              session.redo()
            }}
          >
            {t('editor.redo')}
          </button>
          {state?.hasAutoResult && (
            <button
              type="button"
              disabled={selection === state.autoResultSelection}
              onClick={() => {
                session.resetToAuto()
              }}
            >
              {t('editor.resetAuto')}
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
            {t('editor.compare')}
          </button>
        </div>
        {sheetOpen && (
          <div className="editor-sheet" data-testid="sheet">
            {tool === 'lasso' ? (
              <LassoSheet
                isOpen={lasso.open !== null}
                busy={lasso.open?.busy ?? false}
                closing={lasso.closing}
                hasRings={selection.rings.length > 0}
                mode={lasso.mode}
                onMode={lasso.setMode}
                snapOn={lasso.snapOn}
                onSnap={lasso.setSnapOn}
                smoothing={lasso.smoothing}
                onSmoothing={lasso.setSmoothing}
                onFinish={lasso.finish}
                onDiscard={lasso.discard}
              />
            ) : tool === 'brush' ? (
              brush && (
                <BrushSheet
                  mode={brushMode}
                  onMode={setBrushMode}
                  sizePx={brush.sizePx}
                  onSize={(px) => {
                    if (photo) setBrushSize({ photoId: photo.id, px })
                  }}
                  hardness={hardness}
                  onHardness={setHardness}
                />
              )
            ) : tool === 'dots' ? (
              <DotsSheet
                hasRings={selection.rings.length > 0}
                fine={fine}
                onFine={setFine}
                onShape={addShape}
                canNudge={selectedDots.length > 0}
                onNudge={(dx, dy) => {
                  edit(
                    {
                      type: 'nudge',
                      refs: selectedDots,
                      delta: { x: dx, y: dy },
                    },
                    selectedDots,
                  )
                }}
                onDensityStart={() => {
                  density.current = {
                    start: selection,
                    want: 0,
                    released: false,
                    busy: false,
                  }
                }}
                onDensity={(s) => {
                  const d = density.current
                  if (!d) return
                  d.want = s
                  computeDensity(d)
                }}
                onDensityEnd={(s) => {
                  const d = density.current
                  if (!d) return
                  d.want = s
                  d.released = true
                  computeDensity(d)
                }}
              />
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
      {finishing && visible && photo && (
        <FinishFlow
          renderer={session.renderer}
          photoId={photo.id}
          selection={selection}
          settings={finish}
          onSettings={setFinish}
          onFeather={(px) => {
            edit({ type: 'setFeather', px }, [])
          }}
          save={{
            label: t(saver.saved ? 'common.saved' : 'common.save'),
            disabled: !props.library || !saver.canSave || saver.busy,
            onSave: () => {
              void saver.save()
            },
          }}
          onBack={() => {
            setFinishing(false)
            // Its history entry goes too; the app ignores the popstate (Decision 14).
            window.history.back()
          }}
          guideOpen={guideOpen}
        />
      )}
    </>
  )
}
