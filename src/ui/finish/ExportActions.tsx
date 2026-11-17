import { useEffect, useRef, useState } from 'react'
import type { Selection } from '../../core/selection/types'
import {
  OUTPUT_MIME,
  sameFinish,
  type FinishSettings,
} from '../../core/sticker'
import {
  canCopyPng,
  canShareType,
  copyPng,
  downloadBlob,
  shareFile,
} from '../../services/export'
import type { FinishedFile } from './useFinishOutput'

/** The browser parts the actions use; tests pass their own. */
export interface ExportEnv {
  nav?: Pick<Navigator, 'canShare' | 'share'> | undefined
  clipboard?: Pick<Clipboard, 'write'> | undefined
  ClipboardItem?: typeof ClipboardItem | undefined
  doc?: Document
}

export const SHARE_FAILED = "Couldn't share. Try Download instead."
export const COPY_FAILED = "Couldn't copy. Try Share or Download instead."
/** AC-15: how long "Copied" shows. */
export const COPIED_MS = 2000

function browserEnv(): ExportEnv {
  return {
    nav: navigator,
    clipboard: (navigator as Partial<Navigator>).clipboard,
    ClipboardItem: (globalThis as { ClipboardItem?: typeof ClipboardItem })
      .ClipboardItem,
    doc: document,
  }
}

export interface ExportActionsProps {
  file: FinishedFile | null
  preparing: boolean
  /** What the screen shows now: a file made from anything else is stale. */
  settings: FinishSettings
  selection: Selection
  env?: ExportEnv
}

/**
 * Share, Copy and Download (spec 0012 AC-13 to AC-17), each shown only
 * where it works, all disabled until the file for the current settings is
 * ready (Review Focus 1). Share and Copy run inside the tap (Decision 5).
 */
export function ExportActions(props: ExportActionsProps) {
  // Detected once, at mount, for each type (AC-13).
  const [env] = useState(() => props.env ?? browserEnv())
  const [can] = useState(() => ({
    share: {
      'image/png': canShareType(env.nav, 'image/png'),
      'image/webp': canShareType(env.nav, 'image/webp'),
    },
    copy: canCopyPng(env),
  }))
  const [message, setMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  useEffect(
    () => () => {
      clearTimeout(copiedTimer.current)
    },
    [],
  )

  const mime = OUTPUT_MIME[props.settings.output]
  const { file } = props
  const ready =
    file !== null &&
    !props.preparing &&
    file.selection === props.selection &&
    sameFinish(file.settings, props.settings)
      ? file
      : null

  const share = () => {
    if (!ready || !env.nav) return
    setMessage(null)
    const asFile = new File([ready.blob], ready.name, { type: ready.blob.type })
    shareFile(env.nav, asFile).catch(() => {
      setMessage(SHARE_FAILED)
    })
  }
  const copy = () => {
    if (!ready || !env.clipboard || !env.ClipboardItem) return
    setMessage(null)
    copyPng(env.clipboard, ready.blob, env.ClipboardItem).then(
      () => {
        setCopied(true)
        clearTimeout(copiedTimer.current)
        copiedTimer.current = setTimeout(() => {
          setCopied(false)
        }, COPIED_MS)
      },
      () => {
        setMessage(COPY_FAILED)
      },
    )
  }
  const download = () => {
    if (!ready) return
    setMessage(null)
    downloadBlob(ready.blob, ready.name, env.doc)
  }

  return (
    <div className="finish-actions">
      <div className="finish-action-buttons">
        {can.share[mime] && (
          <button type="button" disabled={!ready} onClick={share}>
            Share
          </button>
        )}
        {mime === 'image/png' && can.copy && (
          <button type="button" disabled={!ready} onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
        <button type="button" disabled={!ready} onClick={download}>
          Download
        </button>
      </div>
      <p className="finish-action-message" role="status">
        {message}
      </p>
    </div>
  )
}
