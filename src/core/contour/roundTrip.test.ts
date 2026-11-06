import { describe, expect, it } from 'vitest'
import type { Point } from '../geometry/types'
import { feather } from '../mask/feather'
import { renderMask } from '../mask/render'
import { traceDistance } from '../../test/curveCheck'
import {
  blob,
  circle,
  halfDisc,
  hardMask,
  roundedRect,
  softMask,
  star,
} from '../../test/maskFixtures'
import { maskToRings, traceContours, type CoverageMask } from './index'

const SIZE = { width: 256, height: 256 }
const C = { x: 128.3, y: 127.6 }

function blurredBlob(): CoverageMask {
  const m = softMask([{ op: 'add', points: circle(C, 80) }], SIZE)
  feather(m.data, SIZE, 3)
  return m
}

const fixtures: [string, CoverageMask][] = [
  ['circle', softMask([{ op: 'add', points: circle(C, 90) }], SIZE)],
  [
    'rounded rectangle',
    softMask(
      [{ op: 'add', points: roundedRect(30.4, 50.2, 220.7, 200.9, 25) }],
      SIZE,
    ),
  ],
  [
    'donut',
    softMask(
      [
        { op: 'add', points: circle(C, 100) },
        { op: 'subtract', points: circle(C, 45) },
      ],
      SIZE,
    ),
  ],
  [
    'two blobs',
    softMask(
      [
        { op: 'add', points: blob(3, { x: 70.2, y: 80.4 }, 50) },
        { op: 'add', points: blob(4, { x: 180.6, y: 170.1 }, 55) },
      ],
      SIZE,
    ),
  ],
  [
    'island in a hole',
    softMask(
      [
        { op: 'add', points: circle(C, 110) },
        { op: 'subtract', points: circle(C, 70) },
        { op: 'add', points: circle(C, 30) },
      ],
      SIZE,
    ),
  ],
  ['star', softMask([{ op: 'add', points: star(C, 115) }], SIZE)],
  [
    'D',
    softMask(
      [{ op: 'add', points: halfDisc({ x: 70.4, y: 127.7 }, 110) }],
      SIZE,
    ),
  ],
  ['soft blurred blob', blurredBlob()],
  ['random blob', softMask([{ op: 'add', points: blob(11, C, 95) }], SIZE)],
]

const cases = fixtures.flatMap(([name, soft]): [string, CoverageMask][] => [
  [`${name} (soft)`, soft],
  [`${name} (hard)`, hardMask(soft)],
])

/** Indices of pixels whose 50% side differs between the mask and its rings rendered back. */
function changedPixels(mask: CoverageMask): { changed: number[]; iou: number } {
  const out = renderMask(
    { rings: maskToRings(mask), strokes: [], feather: 0 },
    { width: mask.width, height: mask.height },
  ).data
  let inter = 0
  let union = 0
  const changed: number[] = []
  for (let k = 0; k < out.length; k++) {
    const a = (mask.data[k] as number) >= 0.5
    const b = (out[k] as number) >= 128
    if (a && b) inter++
    if (a || b) union++
    if (a !== b) changed.push(k)
  }
  return { changed, iou: union === 0 ? 1 : inter / union }
}

describe('maskToRings round trip', () => {
  it('should_round_trip_every_fixture_with_iou_0_99 (AC-14)', () => {
    expect(cases).toHaveLength(18)
    for (const [name, mask] of cases) {
      expect(changedPixels(mask).iou, name).toBeGreaterThanOrEqual(0.99)
    }
  }, 60_000)

  it('should_only_change_pixels_near_edges (AC-15)', () => {
    for (const [name, mask] of cases) {
      const near = traceDistance(traceContours(mask))
      for (const k of changedPixels(mask).changed) {
        const p: Point = {
          x: (k % mask.width) + 0.5,
          y: Math.floor(k / mask.width) + 0.5,
        }
        const { d, hard } = near(p)
        expect(
          d,
          `${name}: pixel (${String(p.x)}, ${String(p.y)})`,
        ).toBeLessThanOrEqual(hard ? 1.5 : 1)
      }
    }
  }, 60_000)
})
