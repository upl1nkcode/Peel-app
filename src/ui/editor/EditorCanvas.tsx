import { useCallback, useEffect, useState } from 'react'
import {
  createCanvasController,
  EMPTY_SNAPSHOT,
  type CanvasInputs,
  type CanvasSnapshot,
} from './canvasController'

export type { CanvasPhoto, EditorTool, ToolIntent } from './canvasController'
export type EditorCanvasProps = CanvasInputs

const fixed = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : n.toFixed(4)

/**
 * The editor's canvas (spec 0009 AC-1 to AC-11): the photo, fitted and
 * zoomable, drawn against the chosen view. Hidden beside it: the full-size
 * `photo` and the `cutout` (photo × mask at the mask's size), for tests.
 */
export function EditorCanvas(props: EditorCanvasProps) {
  const [snap, setSnap] = useState<CanvasSnapshot>(EMPTY_SNAPSHOT)
  const [ctl] = useState(() => createCanvasController(setSnap))
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
      <canvas ref={cutoutRef} data-testid="cutout" hidden />
      <div ref={photoHostRef} hidden />
    </div>
  )
}
