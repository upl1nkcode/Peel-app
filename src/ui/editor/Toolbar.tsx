import type { KeyboardEvent } from 'react'
import { VIEW_LABELS, VIEW_MODES, type ViewMode } from '../../core/editor'
import type { EditorTool } from './EditorCanvas'

/** The Auto tool's options sheet (spec 0009 AC-23). */
export const AUTO_HINT = 'Tap to add · Hold to remove · Slide to aim'

const TOOLS: readonly EditorTool[] = ['auto', 'lasso', 'dots', 'brush', 'view']
const TOOL_LABELS: Record<EditorTool, string> = {
  auto: 'Auto',
  lasso: 'Lasso',
  dots: 'Dots',
  brush: 'Brush',
  view: 'View',
}

export interface ToolbarProps {
  tool: EditorTool
  disabled: boolean
  onTool: (tool: EditorTool) => void
}

/** The bottom toolbar: Auto · Lasso · Dots · Brush · View (spec 0011 AC-23). */
export function Toolbar({ tool, disabled, onTool }: ToolbarProps) {
  return (
    <nav className="editor-tools" aria-label="Tools">
      {TOOLS.map((t) => (
        <button
          key={t}
          type="button"
          aria-pressed={t === tool}
          disabled={disabled}
          onClick={() => {
            onTool(t)
          }}
        >
          {TOOL_LABELS[t]}
        </button>
      ))}
    </nav>
  )
}

export interface ToolSheetProps {
  /** Lasso, Dots and Brush have their own sheets. */
  tool: 'auto' | 'view'
  viewMode: ViewMode
  onViewMode: (mode: ViewMode) => void
}

/** The active tool's options: Auto's hint, or View's five backgrounds (AC-11, AC-23). */
export function ToolSheet({ tool, viewMode, onViewMode }: ToolSheetProps) {
  if (tool === 'auto') return <p className="editor-hint">{AUTO_HINT}</p>

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
    const i = VIEW_MODES.indexOf(viewMode)
    const n = VIEW_MODES.length
    const next = (i + step + n) % n
    const mode = VIEW_MODES[next]
    if (!mode) return
    onViewMode(mode)
    const radios =
      e.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
        '[role=radio]',
      )
    radios?.[next]?.focus()
  }

  return (
    <div className="editor-views" role="radiogroup" aria-label="View">
      {VIEW_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={mode === viewMode}
          tabIndex={mode === viewMode ? 0 : -1}
          onClick={() => {
            onViewMode(mode)
          }}
          onKeyDown={onKeyDown}
        >
          {VIEW_LABELS[mode]}
        </button>
      ))}
    </div>
  )
}
