import { useEffect, useRef, useState } from 'react'
import type { Selection } from '../../core/selection/types'
import { finishFileName, type FinishSettings } from '../../core/sticker'
import { toArrayBufferView } from '../../services/deflate'
import type { FinishFailure, FromRenderWorker } from '../../workers/protocol'
import type { Cancelled } from '../../services/workerClient'
import type { Renderer } from '../editor/session'

/** The file made for the current settings (spec 0012 Decision 5). */
export interface FinishedFile {
  blob: Blob
  name: string
  width: number
  height: number
  /** What it was made from: Share and Copy check these against the screen (Review Focus 1). */
  settings: FinishSettings
  selection: Selection
}

export interface FinishOutput {
  file: FinishedFile | null
  /** What the preview shows: the file, or the Sticker output for Original (AC-9). */
  preview: Blob | null
  preparing: boolean
  error: string | null
}

export const FINISH_ERRORS: Record<FinishFailure, string> = {
  empty: 'Nothing is selected yet.',
  tooLarge:
    'This sticker is too detailed for WhatsApp-style (over 100 KB). Try the Sticker output.',
  encoderUnavailable:
    "Couldn't load the WebP encoder. Connect to the internet and try again.",
}
/** A worker error outside the contract; it shouldn't happen. */
export const FINISH_FAILED = "Couldn't make the file. Try again."

/** AC-9: at most one request per 150 ms while a slider is dragged. */
export const FINISH_THROTTLE_MS = 150

type Result = FromRenderWorker | Cancelled
type Finished = Extract<FromRenderWorker, { type: 'finished' }>

const blobOf = (res: Finished) =>
  new Blob([toArrayBufferView(res.bytes)], { type: res.mime })

/**
 * The output file and the preview for `settings` (spec 0012 AC-9, AC-17).
 * Changes are throttled (leading and trailing, 150 ms); the newest request
 * always wins, and nothing that arrives after the screen is gone is shown
 * (Review Focus 5).
 */
export function useFinishOutput(
  renderer: Renderer | null,
  photoId: string | null,
  selection: Selection,
  settings: FinishSettings,
): FinishOutput {
  const [wanted, setWanted] = useState({ selection, settings })
  /** The newest result, and the request it answers: older ones mean "preparing". */
  const [result, setResult] = useState<{
    of: typeof wanted
    file: FinishedFile | null
    error: string | null
  } | null>(null)
  const [preview, setPreview] = useState<Blob | null>(null)
  /** When the last request went out; 0 until the first one. */
  const lastRequest = useRef(0)

  // Leading and trailing throttle: the first change in a window goes at once,
  // the newest one when the window ends.
  useEffect(() => {
    if (wanted.selection === selection && wanted.settings === settings) return
    const send = () => {
      setWanted({ selection, settings })
    }
    const wait = lastRequest.current + FINISH_THROTTLE_MS - Date.now()
    const timer = setTimeout(send, Math.max(0, wait))
    return () => {
      clearTimeout(timer)
    }
  }, [selection, settings, wanted])

  useEffect(() => {
    if (!renderer || !photoId) return
    let live = true
    lastRequest.current = Date.now()
    const req = wanted
    const { selection: sel, settings: set } = req
    const usePreviewJob = set.output === 'original'
    void renderer.finish(photoId, sel, set).then((res: Result) => {
      if (!live || res.type === 'cancelled') return
      if (res.type === 'finished') {
        const blob = blobOf(res)
        if (!usePreviewJob) setPreview(blob)
        setResult({
          of: req,
          file: {
            blob,
            name: finishFileName(new Date(), set.output),
            width: res.width,
            height: res.height,
            settings: set,
            selection: sel,
          },
          error: null,
        })
        return
      }
      setPreview(null)
      setResult({
        of: req,
        file: null,
        error:
          res.type === 'finishFailed'
            ? FINISH_ERRORS[res.reason]
            : FINISH_FAILED,
      })
    })
    if (usePreviewJob) {
      void renderer
        .finishPreview(photoId, sel, { ...set, output: 'sticker' })
        .then((res: Result) => {
          if (live && res.type === 'finished') setPreview(blobOf(res))
        })
    }
    return () => {
      live = false
    }
  }, [renderer, photoId, wanted])

  const done = result?.of === wanted ? result : null
  return {
    file: result?.file ?? null,
    preview,
    preparing: done === null,
    error: done?.error ?? null,
  }
}
