import type { Point } from './types'

/** Points closer than this (image px) to the last kept point are dropped. */
export const LASSO_MIN_DISTANCE = 0.5

export class InvalidLassoError extends Error {
  override name = 'InvalidLassoError'
}

export interface Lasso {
  add(p: Point): void
  /** The coalesced touch samples of one frame, in order. */
  addMany(ps: readonly Point[]): void
  points(): readonly Point[]
  /** Returns the ring (first point not repeated). Throws `InvalidLassoError` if < 3 points remain. */
  close(): Point[]
}

const dist = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y)

/** Records a freehand lasso path in imagePts, dropping sub-0.5 px jitter. */
export function createLasso(): Lasso {
  const kept: Point[] = []
  let closed = false

  const assertOpen = (): void => {
    if (closed) throw new InvalidLassoError('lasso is already closed')
  }

  const add = (p: Point): void => {
    assertOpen()
    const last = kept.at(-1)
    if (last === undefined || dist(last, p) >= LASSO_MIN_DISTANCE) {
      kept.push({ x: p.x, y: p.y })
    }
  }

  return {
    add,
    addMany(ps) {
      assertOpen()
      for (const p of ps) add(p)
    },
    points: () => kept.map((p) => ({ ...p })),
    close() {
      assertOpen()
      const ring = kept.map((p) => ({ ...p }))
      const first = ring[0]
      while (
        first !== undefined &&
        ring.length > 1 &&
        dist(ring.at(-1) as Point, first) < LASSO_MIN_DISTANCE
      ) {
        ring.pop()
      }
      if (ring.length < 3) {
        throw new InvalidLassoError(
          `a lasso needs at least 3 distinct points, got ${String(ring.length)}`,
        )
      }
      closed = true
      return ring
    },
  }
}
