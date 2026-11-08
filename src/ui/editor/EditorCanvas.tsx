import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
  type Ref,
} from 'react'
import type { Rect } from '../../core/editor'
import {
  createCanvasController,
  EMPTY_SNAPSHOT,
  type CanvasInputs,
  type CanvasSnapshot,
} from './canvasController'
import { Loupe } from './Loupe'

export type { CanvasPhoto, EditorTool, ToolIntent } from './canvasController'
export type EditorCanvasProps = CanvasInputs

/** What the screen can ask the canvas (spec 0010 AC-17). */
export interface EditorCanvasHandle {
  /** The part of the photo on screen, in image px; null before it is laid out. */
  visiblePhotoRect(): Rect | null
  /**
   * CSS px per image px, for the photo on screen or, with `image`, for a
   * photo of that size just shown at fit (spec 0011 AC-19).
   */
  cssPerImagePx(image?: { width: number; height: number }): number | null
}

const fixed = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : n.toFixed(4)

/**
 * The editor's canvas (spec 0009 AC-1 to AC-11): the photo, fitted and
 * zoomable, drawn against the chosen view. Hidden beside it: the full-size
 * `photo` and the `cutout` (photo × mask at the mask's size), for tests.
 */
export function EditorCanvas({
  ref,
  ...props
}: EditorCanvasProps & { ref?: Ref<EditorCanvasHandle> }) {
  const [snap, setSnap] = useState<CanvasSnapshot>(EMPTY_SNAPSHOT)
  const [ctl] = useState(() => createCanvasController(setSnap))
  useImperativeHandle(
    ref,
    () => ({
      visiblePhotoRect: () => ctl.visibleRect(),
      cssPerImagePx: (image) => ctl.cssPerImagePx(image),
    }),
    [ctl],
  )
  const canvasRef = useCallback(
    (el: HTMLCanvasElement | null) => {
      ctl.attachCanvas(el)
    },
    [ctl],
  )
  const cutoutRef = useCallback(
    (el: HTMLCanvasElement | null) => {
      ctl.attachCutout(el)
    },
    [ctl],
  )
  const loupeRef = useCallback(
    (el: HTMLCanvasElement | null) => {
      ctl.attachLoupe(el)
    },
    [ctl],
  )
  const photoHostRef = useCallback(
    (el: HTMLDivElement | null) => {
      ctl.attachPhotoHost(el)
    },
    [ctl],
  )

  useEffect(() => {
    ctl.setInputs(props)
  })
  useEffect(
    () => () => {
      ctl.destroy()
    },
    [ctl],
  )

  const { photo } = props
  return (
    <div className="editor-stage">
      <canvas
        ref={canvasRef}
        className="editor-canvas"
        data-testid="canvas"
        data-zoom={fixed(snap.zoom)}
        data-display-scale={fixed(snap.displayScale)}
        data-mask-scale={fixed(snap.maskScale)}
        data-center={
          snap.center ? `${fixed(snap.center.x)},${fixed(snap.center.y)}` : ''
        }
        data-view={props.viewMode}
        data-tool={props.tool}
        data-dot-count={props.selection.rings.reduce(
          (n, r) => n + r.nodes.length,
          0,
        )}
        data-selected-count={props.selectedDots?.length ?? 0}
        data-lasso={snap.lasso}
        data-lasso-points={snap.lassoPoints}
        data-comparing={props.comparing ? 'true' : 'false'}
        data-image-size={
          photo ? `${String(photo.width)}x${String(photo.height)}` : undefined
        }
        onPointerDown={(e) => {
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            // Not every pointer can be captured (e.g. one already lifted).
          }
          ctl.pointerDown(e)
        }}
        onPointerMove={(e) => {
          // Every touch sample between frames, where the browser has them (spec 0011 AC-1).
          const native = e.nativeEvent as PointerEvent & {
            getCoalescedEvents?: () => PointerEvent[]
          }
          const all =
            typeof native.getCoalescedEvents === 'function'
              ? native.getCoalescedEvents()
              : []
          if (all.length > 1) for (const c of all) ctl.pointerMove(c)
          else ctl.pointerMove(e)
        }}
        onPointerUp={(e) => {
          ctl.pointerUp(e)
        }}
        onPointerCancel={(e) => {
          ctl.pointerCancel(e)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
        }}
      />
      {snap.loupe && <Loupe {...snap.loupe} canvasRef={loupeRef} />}
      <canvas ref={cutoutRef} data-testid="cutout" hidden />
      <div ref={photoHostRef} hidden />
    </div>
  )
}
