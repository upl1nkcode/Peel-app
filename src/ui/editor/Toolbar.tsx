import type { KeyboardEvent } from 'react'
import { VIEW_MODES, type ViewMode } from '../../core/editor'
import { useT, type MessageKey } from '../i18n'
import type { EditorTool } from './EditorCanvas'

const TOOLS: readonly EditorTool[] = ['auto', 'lasso', 'dots', 'brush', 'view']
const TOOL_LABELS: Record<EditorTool, MessageKey> = {
  auto: 'tool.auto',
  lasso: 'tool.lasso',
  dots: 'tool.dots',
  brush: 'tool.brush',
  view: 'tool.view',
}

export interface ToolbarProps {
  tool: EditorTool
  disabled: boolean
  onTool: (tool: EditorTool) => void
}

/** The bottom toolbar: Auto · Lasso · Dots · Brush · View (spec 0011 AC-23). */
export function Toolbar({ tool, disabled, onTool }: ToolbarProps) {
  const t = useT()
  return (
    <nav className="editor-tools" aria-label={t('editor.tools')}>
      {TOOLS.map((tl) => (
        <button
          key={tl}
          type="button"
          aria-pressed={tl === tool}
          disabled={disabled}
          onClick={() => {
            onTool(tl)
          }}
        >
          {t(TOOL_LABELS[tl])}
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
  const t = useT()
  if (tool === 'auto') return <p className="editor-hint">{t('auto.hint')}</p>

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
    <div className="editor-views" role="radiogroup" aria-label={t('tool.view')}>
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
          {t(`view.${mode}`)}
        </button>
      ))}
    </div>
  )
}
