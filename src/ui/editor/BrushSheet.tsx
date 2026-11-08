import type { KeyboardEvent } from 'react'
import { brushSizeAt, brushSliderAt } from '../../core/editor'
import type { BrushSettings } from './brushTool'

/** The Brush tool's hints (spec 0011 AC-24). */
export const ERASE_HINT = 'Paint over what to remove'
export const RESTORE_HINT = 'Paint over what to bring back'

type BrushMode = BrushSettings['mode']
const MODES: readonly [BrushMode, string][] = [
  ['erase', 'Erase'],
  ['restore', 'Restore'],
]

export interface BrushSheetProps {
  mode: BrushMode
  onMode: (mode: BrushMode) => void
  /** Whole image px, 1 to 1000. */
  sizePx: number
  onSize: (px: number) => void
  /** 0 to 1. */
  hardness: number
  onHardness: (h: number) => void
}

/**
 * The Brush tool's options (spec 0011 AC-24), top to bottom: the hint; Erase |
 * Restore; the logarithmic Size slider in image px; the Hardness slider.
 */
export function BrushSheet(props: BrushSheetProps) {
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
    if (!entry) return
    props.onMode(entry[0])
    const radios =
      e.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
        '[role=radio]',
      )
    radios?.[next]?.focus()
  }

  const sizeText = `Size ${String(props.sizePx)} px`
  const percent = Math.round(props.hardness * 100)
  const hardnessText = `Hardness ${String(percent)}%`

  return (
    <div className="editor-dots">
      <p className="editor-hint">
        {props.mode === 'erase' ? ERASE_HINT : RESTORE_HINT}
      </p>
      <div className="editor-views" role="radiogroup" aria-label="Brush mode">
        {MODES.map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={m === props.mode}
            tabIndex={m === props.mode ? 0 : -1}
            onClick={() => {
              props.onMode(m)
            }}
            onKeyDown={onKeyDown}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="editor-density">
        <input
          type="range"
          aria-label="Size"
          aria-valuetext={sizeText}
          min={0}
          max={1}
          step="any"
          value={brushSliderAt(props.sizePx)}
          onChange={(e) => {
            props.onSize(brushSizeAt(Number(e.currentTarget.value)))
          }}
        />
        <span className="editor-value">{sizeText}</span>
      </div>
      <div className="editor-density">
        <input
          type="range"
          aria-label="Hardness"
          aria-valuetext={hardnessText}
          min={0}
          max={100}
          step={1}
          value={percent}
          onChange={(e) => {
            props.onHardness(Number(e.currentTarget.value) / 100)
          }}
        />
        <span className="editor-value">{hardnessText}</span>
      </div>
    </div>
  )
}
