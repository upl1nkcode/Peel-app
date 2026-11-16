import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  FEATHER_PX,
  OUTLINE_WIDTH_PCT,
  PADDING_PCT,
  type FinishSettings,
  type OutputKind,
} from '../../core/sticker'
import type { FinishOutput } from './useFinishOutput'
import './FinishScreen.css'

export interface FinishScreenProps {
  settings: FinishSettings
  onSettings: (settings: FinishSettings) => void
  /** The selection's edge softness, in photo px (Decision 4). */
  feather: number
  /** Called once, when the softness slider is let go (AC-10). */
  onFeather: (px: number) => void
  output: FinishOutput
  save: { label: 'Save' | 'Saved'; disabled: boolean; onSave: () => void }
  onBack: () => void
  /** Share, Copy and Download (AC-13). */
  actions: ReactNode
  /** The iPhone guide (AC-18). */
  guide: ReactNode
}

const OUTPUTS: readonly { kind: OutputKind; label: string }[] = [
  { kind: 'sticker', label: 'Sticker' },
  { kind: 'original', label: 'Original' },
  { kind: 'whatsapp', label: 'WhatsApp-style' },
]

/** "PNG · 1024 × 768 px · 412 KB" (AC-8). */
export function fileLine(file: {
  blob: Blob
  width: number
  height: number
}): string {
  const kind = file.blob.type === 'image/webp' ? 'WEBP' : 'PNG'
  const kb = Math.max(1, Math.round(file.blob.size / 1024))
  return `${kind} · ${String(file.width)} × ${String(file.height)} px · ${String(kb)} KB`
}

/** Shows `blob` in an <img> through an object URL, revoked when replaced or unmounted. */
function usePreviewImage(blob: Blob | null) {
  const img = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const el = img.current
    if (!el || !blob) return
    const url = URL.createObjectURL(blob)
    el.src = url
    return () => {
      URL.revokeObjectURL(url)
      el.removeAttribute('src')
    }
  }, [blob])
  return img
}

/**
 * The Finish screen (spec 0012 AC-8 to AC-10, AC-17, AC-20): the preview on
 * a checkerboard, the file line, the output choice, outline, edge softness
 * and padding, then the export actions and the guide.
 */
export function FinishScreen(props: FinishScreenProps) {
  const { settings, output } = props
  const set = (patch: Partial<FinishSettings>) => {
    props.onSettings({ ...settings, ...patch })
  }
  const setOutline = (patch: Partial<FinishSettings['outline']>) => {
    set({ outline: { ...settings.outline, ...patch } })
  }
  // Softness shows while dragged and is applied once, on release (AC-10).
  const [dragFeather, setDragFeather] = useState<number | null>(null)
  const feather = dragFeather ?? props.feather
  const commitFeather = () => {
    if (dragFeather === null) return
    setDragFeather(null)
    if (dragFeather !== props.feather) props.onFeather(dragFeather)
  }
  const previewImg = usePreviewImage(output.preview)
  const outlineOff = !settings.outline.on

  return (
    <section className="finish" aria-label="Finish sticker">
      <header className="finish-top">
        <button type="button" onClick={props.onBack}>
          Back
        </button>
        <h2 className="finish-title">Finish</h2>
        <button
          type="button"
          disabled={props.save.disabled}
          onClick={props.save.onSave}
        >
          {props.save.label}
        </button>
      </header>
      <div className="finish-preview" data-testid="finish-preview">
        <img ref={previewImg} alt="Sticker preview" hidden={!output.preview} />
      </div>
      <div className="finish-controls">
        <p
          className="finish-file"
          data-testid="finish-file"
          role={!output.preparing && output.error ? 'alert' : undefined}
          aria-live="polite"
        >
          {output.preparing
            ? 'Preparing…'
            : (output.error ?? (output.file ? fileLine(output.file) : ''))}
        </p>
        <div className="finish-choice" role="radiogroup" aria-label="Output">
          {OUTPUTS.map((o) => (
            <label key={o.kind}>
              <input
                type="radio"
                name="finish-output"
                checked={settings.output === o.kind}
                onChange={() => {
                  set({ output: o.kind })
                }}
              />
              {o.label}
            </label>
          ))}
        </div>
        <div className="finish-row">
          <label className="finish-switch">
            <input
              type="checkbox"
              role="switch"
              checked={settings.outline.on}
              onChange={(e) => {
                setOutline({ on: e.currentTarget.checked })
              }}
            />
            Outline
          </label>
          <div
            className="finish-choice"
            role="radiogroup"
            aria-label="Outline colour"
          >
            {(['white', 'black'] as const).map((color) => (
              <label key={color}>
                <input
                  type="radio"
                  name="finish-outline-colour"
                  disabled={outlineOff}
                  checked={settings.outline.color === color}
                  onChange={() => {
                    setOutline({ color })
                  }}
                />
                {color === 'white' ? 'White' : 'Black'}
              </label>
            ))}
          </div>
        </div>
        <label className="finish-slider">
          <span>Width {String(settings.outline.widthPct)}%</span>
          <input
            type="range"
            aria-label="Width"
            disabled={outlineOff}
            min={OUTLINE_WIDTH_PCT.min}
            max={OUTLINE_WIDTH_PCT.max}
            step={OUTLINE_WIDTH_PCT.step}
            value={settings.outline.widthPct}
            onChange={(e) => {
              setOutline({ widthPct: Number(e.currentTarget.value) })
            }}
          />
        </label>
        <label className="finish-slider">
          <span>Softness {String(feather)} px</span>
          <input
            type="range"
            aria-label="Edge softness"
            min={FEATHER_PX.min}
            max={FEATHER_PX.max}
            step={FEATHER_PX.step}
            value={feather}
            onChange={(e) => {
              setDragFeather(Number(e.currentTarget.value))
            }}
            onPointerUp={commitFeather}
            onKeyUp={commitFeather}
            onBlur={commitFeather}
          />
        </label>
        <label className="finish-slider">
          <span>Padding {String(settings.paddingPct)}%</span>
          <input
            type="range"
            aria-label="Padding"
            min={PADDING_PCT.min}
            max={PADDING_PCT.max}
            step={PADDING_PCT.step}
            value={settings.paddingPct}
            onChange={(e) => {
              set({ paddingPct: Number(e.currentTarget.value) })
            }}
          />
        </label>
        {props.actions}
        {props.guide}
      </div>
    </section>
  )
}
