import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'

const NUDGES = [
  ['left', '←', -1, 0],
  ['up', '↑', 0, -1],
  ['down', '↓', 0, 1],
  ['right', '→', 1, 0],
] as const

export interface DotsSheetProps {
  hasRings: boolean
  /** Fine mode for dot drags (AC-6). */
  fine: boolean
  onFine(fine: boolean): void
  onShape(kind: 'rectangle' | 'ellipse'): void
  canNudge: boolean
  /** Moves the selected dots by (dx, dy) image px (AC-14). */
  onNudge(dx: number, dy: number): void
  /** The slider is taken: the rings as they are now are the start (AC-15). */
  onDensityStart(): void
  onDensity(s: number): void
  /** The slider is let go at `s`; the thumb is back in the middle (AC-16). */
  onDensityEnd(s: number): void
}

/**
 * The Dots tool's options (spec 0010 AC-18), top to bottom: the hint; Fine,
 * Rectangle and Ellipse; the "Dots" slider from Fewer to More, which springs
 * back to the middle; and the nudge pad.
 */
export function DotsSheet(props: DotsSheetProps) {
  const t = useT()
  const [value, setValue] = useState(0)
  /** The slider is held, and where it is (read when it is let go). */
  const held = useRef<number | null>(null)
  /** Stops listening for the finger lifting anywhere. */
  const detach = useRef<(() => void) | null>(null)
  useEffect(
    () => () => {
      detach.current?.()
    },
    [],
  )

  const end = () => {
    const s = held.current
    if (s === null) return
    held.current = null
    detach.current?.()
    detach.current = null
    setValue(0)
    props.onDensityEnd(s)
  }
  const start = () => {
    if (held.current !== null) return
    held.current = 0
    // A finger or mouse may lift off the slider (final review I-3).
    const lifted = () => {
      end()
    }
    window.addEventListener('pointerup', lifted)
    window.addEventListener('pointercancel', lifted)
    detach.current = () => {
      window.removeEventListener('pointerup', lifted)
      window.removeEventListener('pointercancel', lifted)
    }
    props.onDensityStart()
  }

  return (
    <div className="editor-dots">
      <p className="editor-hint">
        {t(props.hasRings ? 'dots.hint' : 'dots.emptyHint')}
      </p>
      <div className="editor-row">
        <button
          type="button"
          role="switch"
          aria-checked={props.fine}
          onClick={() => {
            props.onFine(!props.fine)
          }}
        >
          {t('dots.fine')}
        </button>
        <button
          type="button"
          onClick={() => {
            props.onShape('rectangle')
          }}
        >
          {t('dots.rectangle')}
        </button>
        <button
          type="button"
          onClick={() => {
            props.onShape('ellipse')
          }}
        >
          {t('dots.ellipse')}
        </button>
      </div>
      <div className="editor-density">
        <span aria-hidden="true">{t('dots.fewer')}</span>
        <input
          type="range"
          aria-label={t('dots.slider')}
          min={-1}
          max={1}
          step={0.01}
          value={value}
          disabled={!props.hasRings}
          onPointerDown={start}
          onChange={(e) => {
            start()
            const s = Number(e.currentTarget.value)
            held.current = s
            setValue(s)
            props.onDensity(s)
          }}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyUp={end}
          onBlur={end}
        />
        <span aria-hidden="true">{t('dots.more')}</span>
      </div>
      <div className="editor-row editor-nudge">
        {NUDGES.map(([name, arrow, dx, dy]) => (
          <button
            key={name}
            type="button"
            aria-label={t(`dots.nudge.${name}`)}
            disabled={!props.canNudge}
            onClick={() => {
              props.onNudge(dx, dy)
            }}
          >
            {arrow}
          </button>
        ))}
      </div>
    </div>
  )
}
