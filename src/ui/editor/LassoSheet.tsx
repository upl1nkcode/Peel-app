import type { KeyboardEvent } from 'react'
import type { SmoothStrength } from '../../core/geometry/smooth'
import type { LassoMode } from './useLasso'

/** The Lasso tool's hints (spec 0011 AC-24). */
export const LASSO_HINT = 'Trace around it with one finger · Lift to pause'
export const LASSO_OPEN_HINT =
  'Drag the end dot to go on · End at the start to close'
export const LASSO_BUSY_HINT = 'Making dots…'

const MODES: readonly [LassoMode, string][] = [
  ['add', 'Add'],
  ['subtract', 'Subtract'],
]

export interface LassoSheetProps {
  /** A lasso is open (paused or busy). */
  isOpen: boolean
  busy: boolean
  /** The ring is being made. */
  closing: boolean
  /** Subtract needs something to cut from (AC-14). */
  hasRings: boolean
  mode: LassoMode
  onMode: (mode: LassoMode) => void
  snapOn: boolean
  onSnap: (on: boolean) => void
  smoothing: SmoothStrength
  onSmoothing: (s: SmoothStrength) => void
  onFinish: () => void
  onDiscard: () => void
}

/**
 * The Lasso tool's options (spec 0011 AC-24), top to bottom: the hint; Add |
 * Subtract and "Snap to edges"; the Smoothing slider from Raw to Smooth;
 * Finish and Discard.
 */
export function LassoSheet(props: LassoSheetProps) {
  const enabled = (m: LassoMode) => m === 'add' || props.hasRings
  // Arrow keys move the choice, as in any radio group.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (step === 0) return
    e.preventDefault()
    const i = MODES.findIndex(([m]) => m === props.mode)
    const next = (i + step + MODES.length) % MODES.length
    const entry = MODES[next]
    if (!entry || !enabled(entry[0])) return
    props.onMode(entry[0])
    const radios =
      e.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
        '[role=radio]',
      )
    radios?.[next]?.focus()
  }

  const hint = props.closing
    ? LASSO_BUSY_HINT
    : props.isOpen
      ? LASSO_OPEN_HINT
      : LASSO_HINT
  const canAct = props.isOpen && !props.busy

  return (
    <div className="editor-dots">
      <p className="editor-hint">{hint}</p>
      <div className="editor-row">
        <div
          className="editor-views editor-modes"
          role="radiogroup"
          aria-label="Lasso mode"
        >
          {MODES.map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={m === props.mode}
              tabIndex={m === props.mode ? 0 : -1}
              disabled={!enabled(m)}
              onClick={() => {
                props.onMode(m)
              }}
              onKeyDown={onKeyDown}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={props.snapOn}
          onClick={() => {
            props.onSnap(!props.snapOn)
          }}
        >
          Snap to edges
        </button>
      </div>
      <div className="editor-density">
        <span aria-hidden="true">Raw</span>
        <input
          type="range"
          aria-label="Smoothing"
          min={0}
          max={4}
          step={1}
          value={props.smoothing}
          onChange={(e) => {
            props.onSmoothing(Number(e.currentTarget.value) as SmoothStrength)
          }}
        />
        <span aria-hidden="true">Smooth</span>
      </div>
      <div className="editor-row">
        <button type="button" disabled={!canAct} onClick={props.onFinish}>
          Finish
        </button>
        <button
          type="button"
          disabled={!props.isOpen}
          onClick={props.onDiscard}
        >
          Discard
        </button>
      </div>
    </div>
  )
}
