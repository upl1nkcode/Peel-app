import { useEffect, useRef, type PointerEvent } from 'react'

/** AC-7: how long a touch is held, and how far it may wander, to start selecting. */
export const LONG_PRESS_MS = 500
export const LONG_PRESS_SLOP_PX = 10

/**
 * Touch-and-hold on items keyed by id (spec 0013 AC-7). `fired(id)` is true
 * once for the click that follows a long press, so lifting the finger
 * neither opens nor unticks what the press just ticked (Review Focus 1).
 */
export function useLongPress(onLongPress: (id: string) => void) {
  const timer = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const firedFor = useRef<string | null>(null)
  const callback = useRef(onLongPress)
  useEffect(() => {
    callback.current = onLongPress
  }, [onLongPress])

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    start.current = null
  }
  useEffect(() => cancel, [])

  return {
    handlers: (id: string) => ({
      onPointerDown: (e: PointerEvent) => {
        cancel()
        firedFor.current = null
        start.current = { x: e.clientX, y: e.clientY }
        timer.current = window.setTimeout(() => {
          timer.current = null
          firedFor.current = id
          callback.current(id)
        }, LONG_PRESS_MS)
      },
      onPointerMove: (e: PointerEvent) => {
        const s = start.current
        if (!s) return
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > LONG_PRESS_SLOP_PX) {
          cancel()
        }
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
    }),
    /** True once for the click right after a long press on `id`. */
    fired: (id: string) => {
      const was = firedFor.current === id
      firedFor.current = null
      return was
    },
  }
}
