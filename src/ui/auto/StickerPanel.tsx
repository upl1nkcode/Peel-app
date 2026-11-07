import { useMemo, useState } from 'react'
import type { StickerSummary } from '../../services/storage'
import './StickerPanel.css'

export interface StickerPanelProps {
  stickers: readonly StickerSummary[]
  canSave: boolean
  /** The cutout on screen is the one just saved. */
  saved: boolean
  /** Saving, opening, importing and exporting are off (storage unavailable or outdated). */
  disabled: boolean
  onSave: () => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onExport: () => void
  onImport: (file: File) => void
  /** The storage status line (spec 0008 AC-14). */
  status: string | null
  /** The last result or error. */
  message: string | null
}

function pngDataUrl(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:image/png;base64,${btoa(binary)}`
}

/**
 * The temporary sticker panel on the tap-to-cut screen (spec 0008 AC-20):
 * save, the saved stickers (tap to re-open, delete after an inline check),
 * export and import, and the storage status. Phase 9's Library replaces it.
 */
export function StickerPanel(props: StickerPanelProps) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const thumbnails = useMemo(
    () => new Map(props.stickers.map((s) => [s.id, pngDataUrl(s.thumbnail)])),
    [props.stickers],
  )
  return (
    <section className="sticker-panel" aria-label="Saved stickers">
      <div className="sticker-actions">
        <button
          type="button"
          disabled={!props.canSave || props.disabled}
          onClick={props.onSave}
        >
          {props.saved ? 'Saved' : 'Save'}
        </button>
        <button
          type="button"
          disabled={props.stickers.length === 0 || props.disabled}
          onClick={props.onExport}
        >
          Export all
        </button>
        <label
          className="sticker-import"
          data-disabled={props.disabled || undefined}
        >
          Import
          <input
            type="file"
            accept=".zip,application/zip"
            disabled={props.disabled}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0]
              e.currentTarget.value = ''
              if (file) props.onImport(file)
            }}
          />
        </label>
      </div>
      {props.message && (
        <p className="sticker-message" aria-live="polite">
          {props.message}
        </p>
      )}
      {props.stickers.length > 0 && (
        <ul className="sticker-list">
          {props.stickers.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="sticker-thumb"
                aria-label="Open sticker"
                disabled={props.disabled}
                onClick={() => {
                  props.onOpen(s.id)
                }}
              >
                <img src={thumbnails.get(s.id)} alt="" />
              </button>
              {confirming === s.id ? (
                <span className="sticker-confirm">
                  Delete this sticker?
                  <button
                    type="button"
                    onClick={() => {
                      setConfirming(null)
                      props.onDelete(s.id)
                    }}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirming(null)
                    }}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={props.disabled}
                  onClick={() => {
                    setConfirming(s.id)
                  }}
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {props.status && <p className="sticker-status">{props.status}</p>}
    </section>
  )
}
