import { describe, expect, it } from 'vitest'
import type { Point } from '../geometry/types'
import type { RgbaImage } from '../mask'
import { arc, softMask } from '../../test/maskFixtures'
import { mulberry32 } from '../../test/random'
import { autoSelection, inferenceImage, upscaleMask } from './index'

const FULL = { width: 4032, height: 3024 }
const SMALL = { width: 1024, height: 768 }

const ellipse = (c: Point, rx: number, ry: number): Point[] =>
  arc({ x: 0, y: 0 }, 1, 0, 2 * Math.PI, false).map((p) => ({
    x: c.x + rx * p.x,
    y: c.y + ry * p.y,
  }))

describe('auto cutout pre/post-processing performance', () => {
  it('should_prepare_and_finish_a_12mp_photo_quickly (AC-8)', () => {
    const rand = mulberry32(3)
    const photo: RgbaImage = {
      ...FULL,
      data: Uint8Array.from({ length: FULL.width * FULL.height * 4 }, () =>
        Math.floor(rand() * 256),
      ),
    }
    // A person-like inference mask at 1024×768.
    const mask = softMask(
      [
        { op: 'add', points: ellipse({ x: 512.3, y: 482.2 }, 230, 290) },
        { op: 'add', points: ellipse({ x: 512.7, y: 152.4 }, 92, 106) },
        { op: 'subtract', points: ellipse({ x: 380.2, y: 508.6 }, 41, 152) },
      ],
      SMALL,
    )
    let best = Infinity
    for (let run = 0; run < 3; run++) {
      const t0 = Date.now()
      inferenceImage(photo)
      const sel = autoSelection(upscaleMask(mask, FULL))
      best = Math.min(best, Date.now() - t0)
      expect(sel?.rings.length).toBe(2)
    }
    expect(best).toBeLessThan(1000)
  }, 120_000)
})
