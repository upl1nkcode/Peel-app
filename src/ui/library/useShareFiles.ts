import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_FINISH,
  finishFileName,
  type FinishSettings,
  type OutputKind,
} from '../../core/sticker'
import { canShareFiles, shareFiles } from '../../services/export'
import type { StickerStore } from '../../services/storage'
import type { Cancelled } from '../../services/workerClient'
import type { FromRenderWorker } from '../../workers/protocol'
import { useT } from '../i18n'
import type { ShareState } from './LibraryScreen'

type Mime = 'image/png' | 'image/webp'

/** What Share needs from a render worker (`startRenderWorker` gives it). */
export interface ShareRenderer {
  finishSaved: (
    png: Uint8Array,
    settings: FinishSettings,
  ) => Promise<FromRenderWorker | Cancelled>
  terminate: () => void
}

export interface ShareDeps {
  store: StickerStore | null
  createRenderer: () => ShareRenderer
  now: () => Date
  nav?: Pick<Navigator, 'share' | 'canShare'> | undefined
}

type Prepared =
  | { status: 'pending' }
  | { status: 'ready'; bytes: Uint8Array; mime: Mime; output: OutputKind }
  /** Deleted (in another tab, say) since it was ticked: skipped. */
  | { status: 'gone' }
  | { status: 'failed' }

/** `name` with `-2`, `-3`… before its extension until it's unused (Review Focus 5). */
function unique(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf('.')
  let candidate = name
  for (let n = 2; used.has(candidate); n++) {
    candidate = `${name.slice(0, dot)}-${String(n)}${name.slice(dot)}`
  }
  used.add(candidate)
  return candidate
}

/**
 * Share from the Library (spec 0013 AC-8): makes each ticked sticker's file
 * in its saved finish, one at a time in tick order, ahead of the tap, so
 * Share calls `navigator.share` at once (Safari needs the tap's activation).
 * The render worker starts with the first tick and stops when none is left.
 */
export function useShareFiles(
  ticked: readonly string[],
  deps: ShareDeps,
): ShareState {
  const t = useT()
  const { store, createRenderer, now, nav } = deps
  const [prepared, setPrepared] = useState<ReadonlyMap<string, Prepared>>(
    () => new Map(),
  )
  // A message belongs to the ticks it was shown for; a new tick clears it.
  const [said, setSaid] = useState<{
    text: string
    for: readonly string[]
  } | null>(null)
  const message = said?.for === ticked ? said.text : null
  const renderer = useRef<ShareRenderer | null>(null)
  const generation = useRef(0)
  const working = useRef(false)
  const tickedRef = useRef(ticked)
  const preparedRef = useRef(prepared)

  const update = useCallback((fn: (m: Map<string, Prepared>) => void) => {
    const next = new Map(preparedRef.current)
    fn(next)
    preparedRef.current = next
    setPrepared(next)
  }, [])

  const pump = useCallback(async () => {
    if (working.current || !store) return
    working.current = true
    const gen = generation.current
    try {
      for (;;) {
        const id = tickedRef.current.find((i) => !preparedRef.current.has(i))
        const worker = renderer.current
        if (id === undefined || !worker) return
        update((m) => m.set(id, { status: 'pending' }))
        let result: Prepared
        try {
          const record = await store.get(id)
          if (gen !== generation.current) return
          if (!record) {
            result = { status: 'gone' }
          } else {
            const settings = record.finish ?? DEFAULT_FINISH
            const reply = await worker.finishSaved(record.sticker, settings)
            if (gen !== generation.current) return
            result =
              reply.type === 'finished'
                ? {
                    status: 'ready',
                    bytes: reply.bytes,
                    mime: reply.mime,
                    output: settings.output,
                  }
                : { status: 'failed' }
          }
        } catch {
          if (gen !== generation.current) return
          result = { status: 'failed' }
        }
        update((m) => {
          if (tickedRef.current.includes(id)) m.set(id, result)
          else m.delete(id)
        })
      }
    } finally {
      if (gen === generation.current) working.current = false
    }
  }, [store, update])

  useEffect(() => {
    tickedRef.current = ticked
    if (ticked.length === 0) {
      if (renderer.current) {
        renderer.current.terminate()
        renderer.current = null
        generation.current++
        working.current = false
      }
      if (preparedRef.current.size > 0) {
        update((m) => {
          m.clear()
        })
      }
      return
    }
    // Untick drops a file (a pending one is dropped when it ends).
    const stale = [...preparedRef.current].filter(
      ([id, p]) => p.status !== 'pending' && !ticked.includes(id),
    )
    if (stale.length > 0) {
      update((m) => {
        for (const [id] of stale) m.delete(id)
      })
    }
    renderer.current ??= createRenderer()
    void pump()
  }, [ticked, createRenderer, pump, update])

  useEffect(
    () => () => {
      renderer.current?.terminate()
      renderer.current = null
      generation.current++
    },
    [],
  )

  const states = ticked.map((id) => prepared.get(id))
  const preparing = states.some((p) => !p || p.status === 'pending')
  const mimes = useMemo(() => {
    const set = new Set<Mime>(['image/png'])
    for (const p of prepared.values()) {
      if (p.status === 'ready') set.add(p.mime)
    }
    return [...set].sort()
  }, [prepared])
  const mimeKey = mimes.join()
  // One probe per set of types, not per render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shown = useMemo(() => canShareFiles(nav, mimes), [nav, mimeKey])

  const onShare = () => {
    if (!nav || preparing) return
    if (states.some((p) => p?.status === 'failed')) {
      setSaid({ text: t('library.shareFailed'), for: ticked })
      return
    }
    const at = now()
    const used = new Set<string>()
    const files: File[] = []
    for (const p of states) {
      if (p?.status !== 'ready') continue
      const name = unique(finishFileName(at, p.output), used)
      files.push(
        new File([p.bytes as Uint8Array<ArrayBuffer>], name, { type: p.mime }),
      )
    }
    if (files.length === 0) return
    setSaid(null)
    // Called at once, within the tap (spec 0012 Decision 5).
    shareFiles(nav, files).then(
      () => undefined,
      () => {
        setSaid({ text: t('library.shareFailed'), for: ticked })
      },
    )
  }

  return { shown, preparing, message, onShare }
}
