import { describe, expect, it } from 'vitest'
import { maskToRings } from '../contour/rings'
import type { Point } from '../geometry/types'
import { renderMask } from '../mask/render'
import type { Selection } from '../selection/types'
import { arc, softMask } from '../../test/maskFixtures'
import { paintScene } from '../../test/sceneFixtures'
import { smartEdgeRefiner } from './smartEdge'

const SIZE = { width: 4032, height: 3024 }

const ellipse = (c: Point, rx: number, ry: number): Point[] =>
  arc({ x: 0, y: 0 }, 1, 0, 2 * Math.PI, false).map((p) => ({
    x: c.x + rx * p.x,
    y: c.y + ry * p.y,
  }))

function bestOf(runs: number, f: () => void): number {
  let best = Infinity
  for (let r = 0; r < runs; r++) {
    const t0 = Date.now()
    f()
    best = Math.min(best, Date.now() - t0)
  }
  return best
}

describe('smart edge speed', () => {
  it('should_add_under_600_ms_on_12_mp (AC-22)', () => {
    // Spec 0005 AC-16's person mask, painted as a scene.
    const person = softMask(
      [
        { op: 'add', points: ellipse({ x: 2016.3, y: 1900.2 }, 900, 1150) },
        { op: 'add', points: ellipse({ x: 2016.7, y: 600.4 }, 360, 420) },
        { op: 'subtract', points: ellipse({ x: 1500.2, y: 2000.6 }, 160, 600) },
        { op: 'subtract', points: ellipse({ x: 2530.8, y: 2000.1 }, 160, 600) },
      ],
      SIZE,
    )
    const image = paintScene(
      person.data,
      SIZE,
      [0.8, 0.3, 0.2],
      [0.2, 0.5, 0.8],
      {
        noise: 0.02,
        seed: 5,
      },
    )
    const plain: Selection = {
      rings: maskToRings(person),
      strokes: [],
      feather: 0,
    }
    const soft: Selection = {
      ...plain,
      softEdge: { source: 'guided', bandPx: 20 },
    }
    const refiner = smartEdgeRefiner(image)
    const without = bestOf(2, () => renderMask(plain, SIZE))
    const withEdge = bestOf(2, () =>
      renderMask(soft, SIZE, { refineEdge: refiner }),
    )
    const added = withEdge - without
    expect(added, `${String(added)} ms added`).toBeLessThan(600)
  })
})
