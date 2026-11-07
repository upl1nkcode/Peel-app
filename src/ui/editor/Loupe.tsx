import { LOUPE_DIAMETER_PX } from '../../core/editor'
import type { Point } from '../../core/geometry/types'

export interface LoupeProps {
  /** The loupe's centre in canvas CSS px. */
  center: Point
  /** Shown below the finger because there was no room above (AC-14). */
  below: boolean
  /** The photo point under the crosshair (test hook). */
  aim: Point
  canvasRef: (el: HTMLCanvasElement | null) => void
}

const R = LOUPE_DIAMETER_PX / 2

/**
 * The magnifier shown while aiming (spec 0009 AC-13 to AC-15). The editor
 * canvas draws into it; this only places it.
 */
export function Loupe({ center, below, aim, canvasRef }: LoupeProps) {
  return (
    <canvas
      ref={canvasRef}
      className="editor-loupe"
      data-testid="loupe"
      data-below={below ? 'true' : 'false'}
      data-aim={`${aim.x.toFixed(4)},${aim.y.toFixed(4)}`}
      aria-hidden="true"
      style={{
        left: center.x - R,
        top: center.y - R,
        width: LOUPE_DIAMETER_PX,
        height: LOUPE_DIAMETER_PX,
      }}
    />
  )
}
