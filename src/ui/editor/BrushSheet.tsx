import type { KeyboardEvent } from 'react'
import { brushSizeAt, brushSliderAt } from '../../core/editor'
import { useT, type MessageKey } from '../i18n'
import type { BrushSettings } from './brushTool'

type BrushMode = BrushSettings['mode']
const MODES: readonly [BrushMode, MessageKey][] = [
  ['erase', 'brush.erase'],
  ['restore', 'brush.restore'],
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
  const t = useT()
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

  const sizeText = t('brush.sizeValue', { px: props.sizePx })
  const percent = Math.round(props.hardness * 100)
  const hardnessText = t('brush.hardnessValue', { percent })

  return (
    <div className="editor-dots">
      <p className="editor-hint">
        {t(props.mode === 'erase' ? 'brush.eraseHint' : 'brush.restoreHint')}
      </p>
      <div
        className="editor-views"
        role="radiogroup"
        aria-label={t('brush.mode')}
      >
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
            {t(label)}
          </button>
        ))}
      </div>
      <div className="editor-density">
        <input
          type="range"
          aria-label={t('brush.size')}
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
          aria-label={t('brush.hardness')}
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
