import { describe, expect, it } from 'vitest'
import { maskToRings } from '../contour/rings'
import { fromAlphaMask } from '../contour/types'
import type { Size } from '../geometry/types'
import { rasterizeRings } from '../mask/rasterize'
import { renderMask } from '../mask/render'
import type { AlphaMask, RgbaImage } from '../mask/types'
import type { Selection, SoftEdge } from '../selection/types'
import { rect, softMask } from '../../test/maskFixtures'
import {
  blurredModel,
  discScene,
  donutScene,
  hairScene,
  paintScene,
  type SmartEdgeScene,
  type SmartEdgeSceneKind,
} from '../../test/sceneFixtures'
import { COLOUR_TRUST_DISTANCE, bandMask, smartEdgeRefiner } from './smartEdge'

const KINDS: SmartEdgeSceneKind[] = ['contrast', 'isoluminant', 'textured']

function render(
  selection: Selection,
  size: Size,
  image: RgbaImage,
  modelAlpha?: AlphaMask,
  scale = 1,
): Uint8Array {
  return renderMask(selection, size, {
    scale,
    refineEdge: smartEdgeRefiner(image, modelAlpha),
  }).data
}

const withoutSoftEdge = (s: Selection): Selection => ({
  rings: s.rings,
  strokes: s.strokes,
  feather: s.feather,
})

function bandOf(selection: Selection, size: Size): Uint8Array {
  return bandMask(
    rasterizeRings(selection.rings, size),
    size,
    selection.softEdge?.bandPx ?? 8,
  )
}

/** AC-16/17 measures over the band. */
function measure(
  alpha: Uint8Array,
  truth: Float32Array,
  band: Uint8Array,
  strands?: Float32Array,
) {
  let n = 0
  let abs = 0
  let wrong = 0
  let bg = 0
  let hazy = 0
  let fg = 0
  let kept = 0
  let clear = 0
  let strandN = 0
  let strandKept = 0
  for (let k = 0; k < band.length; k++) {
    if (band[k] !== 1) continue
    const a = (alpha[k] as number) / 255
    const t = truth[k] as number
    n++
    abs += Math.abs(a - t)
    if (a >= 0.5 !== t >= 0.5) wrong++
    if (t === 0) {
      bg++
      if (a > 0.1) hazy++
    }
    if (t >= 0.5) {
      fg++
      if (a >= 0.5) kept++
    } else if (a < 0.5) clear++
    if (strands && (strands[k] as number) >= 0.5 && t >= 0.5) {
      strandN++
      if (a >= 0.5) strandKept++
    }
  }
  return {
    mae: abs / n,
    wrong: wrong / n,
    hazy: bg > 0 ? hazy / bg : 0,
    keep: strandN > 0 ? strandKept / strandN : kept / fg,
    clear: clear / (n - fg),
  }
}

function expectSnapped(
  scene: SmartEdgeScene,
  label: string,
  modelAlpha?: AlphaMask,
) {
  const alpha = render(scene.selection, scene.size, scene.image, modelAlpha)
  const m = measure(alpha, scene.truth, bandOf(scene.selection, scene.size))
  expect(m.mae, `${label} mean error`).toBeLessThanOrEqual(0.02)
  expect(m.wrong, `${label} wrong side`).toBeLessThanOrEqual(0.01)
  expect(m.hazy, `${label} hazy background`).toBeLessThanOrEqual(0.005)
}

function expectHair(
  scene: ReturnType<typeof hairScene>,
  label: string,
  modelAlpha?: AlphaMask,
) {
  const alpha = render(scene.selection, scene.size, scene.image, modelAlpha)
  const m = measure(
    alpha,
    scene.truth,
    bandOf(scene.selection, scene.size),
    scene.strands,
  )
  expect(m.keep, `${label} strands kept`).toBeGreaterThanOrEqual(0.9)
  expect(m.clear, `${label} background clear`).toBeGreaterThanOrEqual(0.99)
  expect(m.mae, `${label} mean error`).toBeLessThanOrEqual(0.04)
}

/** Two discs side by side, and a disc cut off by the image's left border. */
function moreScenes(): [string, Selection, Size, RgbaImage][] {
  const size = { width: 96, height: 64 }
  const two = softMask(
    [
      { op: 'add', points: rect(8.3, 12.2, 40.6, 50.1) },
      { op: 'add', points: rect(52.4, 12.2, 88.1, 50.1) },
    ],
    size,
  ).data
  const cut = softMask(
    [{ op: 'add', points: rect(-20, 10.3, 30.4, 54.6) }],
    size,
  ).data
  const sel = (rings: [number, number, number, number][]): Selection => ({
    rings: rings.map(([x0, y0, x1, y1]) => ({
      op: 'add',
      nodes: rect(x0, y0, x1, y1).map(({ x, y }) => ({
        x,
        y,
        kind: 'corner' as const,
      })),
    })),
    strokes: [],
    feather: 0,
    softEdge: { source: 'guided', bandPx: 8 },
  })
  const paint = (cov: Float32Array) =>
    paintScene(cov, size, [0.8, 0.3, 0.2], [0.2, 0.5, 0.8], {
      noise: 0.02,
      seed: 3,
    })
  return [
    [
      'two discs',
      sel([
        [9.3, 13.2, 39.6, 49.1],
        [51.4, 11.2, 89.1, 51.1],
      ]),
      size,
      paint(two),
    ],
    ['cut off', sel([[-20, 11.3, 31.4, 53.6]]), size, paint(cut)],
  ]
}

describe('smart edge', () => {
  it('should_leave_pixels_outside_the_band_unchanged (AC-14)', () => {
    const cases: [string, Selection, Size, RgbaImage][] = [
      [
        'disc',
        ...((s: SmartEdgeScene) => [s.selection, s.size, s.image] as const)(
          discScene('contrast', 2),
        ),
      ],
      [
        'donut',
        ...((s: SmartEdgeScene) => [s.selection, s.size, s.image] as const)(
          donutScene('contrast', 2),
        ),
      ],
      ...moreScenes(),
    ]
    for (const [name, selection, size, image] of cases) {
      const soft = render(selection, size, image)
      const plain = renderMask(withoutSoftEdge(selection), size).data
      const band = bandOf(selection, size)
      let inBand = 0
      for (let k = 0; k < band.length; k++) {
        if (band[k] === 1) inBand++
        else expect(soft[k], `${name} pixel ${String(k)}`).toBe(plain[k])
      }
      expect(inBand, name).toBeGreaterThan(0)
      for (const v of soft) expect(Number.isNaN(v)).toBe(false)
    }
    // The hole's band takes its background colour from the hole.
    const donut = donutScene('contrast', 2)
    expectSnapped(donut, 'donut')
  })

  it('should_accept_bands_from_2_to_20_px (AC-15)', () => {
    for (const bandPx of [2, 20]) {
      const s = discScene('contrast', 0, { source: 'guided', bandPx })
      expect(() => render(s.selection, s.size, s.image)).not.toThrow()
    }
    const cov = rasterizeRings(discScene('contrast', 0).selection.rings, {
      width: 96,
      height: 96,
    })
    const band = bandMask(cov, { width: 96, height: 96 }, 2)
    for (let k = 0; k < band.length; k++) {
      if (band[k] !== 1) continue
      const x = (k % 96) + 0.5
      const y = Math.floor(k / 96) + 0.5
      expect(Math.abs(Math.hypot(x - 48.3, y - 47.8) - 25)).toBeLessThanOrEqual(
        1.01,
      )
    }
    for (const bandPx of [1.9, 20.1]) {
      const s = discScene('contrast', 0, { source: 'guided', bandPx })
      expect(() => render(s.selection, s.size, s.image)).toThrow(RangeError)
    }
  })

  it('should_snap_alpha_to_the_real_edge (AC-16)', () => {
    for (const kind of KINDS) {
      for (const delta of [0, 2, -2]) {
        expectSnapped(discScene(kind, delta), `${kind} δ${String(delta)}`)
      }
    }
  })

  it('should_keep_hair_strands (AC-17)', () => {
    for (const delta of [0, 2, -2])
      expectHair(hairScene(delta), `hair δ${String(delta)}`)
  })

  it('should_fall_back_where_colours_are_alike (AC-18)', () => {
    expect(COLOUR_TRUST_DISTANCE).toBe(0.15)
    const size = { width: 96, height: 96 }
    const disc = discScene('contrast', 2)
    // Same colour inside and out: the band keeps the fallback exactly.
    const flat = paintScene(
      disc.truth,
      size,
      [0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5],
      { noise: 0, seed: 1 },
    )
    expect(render(disc.selection, size, flat)).toEqual(
      renderMask(withoutSoftEdge(disc.selection), size).data,
    )
    const model = blurredModel(disc.truth, size)
    const modelSel: Selection = {
      ...disc.selection,
      softEdge: { source: 'model', bandPx: 8 },
    }
    const viaModel = render(modelSel, size, flat, model)
    const band = bandOf(modelSel, size)
    for (let k = 0; k < band.length; k++) {
      if (band[k] === 1) expect(viaModel[k]).toBe(model.data[k])
    }

    // Colours 19/255 ≈ 0.0745 apart (red channel only), no noise, line on the edge:
    // the window means are exactly the two colours, so the estimate is
    // (I − B) / (F − B) on the red byte, trusted by 0.0745 / 0.15.
    const exact = discScene('contrast', 0)
    const near = paintScene(
      exact.truth,
      size,
      [100 / 255, 0.5, 0.5],
      [81 / 255, 0.5, 0.5],
      { noise: 0, seed: 1 },
    )
    const out = render(exact.selection, size, near)
    const cov = rasterizeRings(exact.selection.rings, size)
    const w = 19 / 255 / COLOUR_TRUST_DISTANCE
    const exactBand = bandOf(exact.selection, size)
    for (let k = 0; k < exactBand.length; k++) {
      if (exactBand[k] !== 1) continue
      const est = Math.min(
        1,
        Math.max(0, ((near.data[k * 4] as number) - 81) / 19),
      )
      const expected = w * est + (1 - w) * (cov[k] as number)
      expect(Math.abs((out[k] as number) / 255 - expected)).toBeLessThanOrEqual(
        0.5 / 255 + 1e-6,
      )
    }
  })

  it('should_keep_the_fallback_without_known_colours (AC-19)', () => {
    const size = { width: 100, height: 40 }
    const bar = rect(20.2, 18.4, 80.6, 21.4)
    const cov = softMask([{ op: 'add', points: bar }], size).data
    const image = paintScene(cov, size, [0.8, 0.3, 0.2], [0.2, 0.5, 0.8], {
      noise: 0.02,
      seed: 2,
    })
    const selection: Selection = {
      rings: [
        {
          op: 'add',
          nodes: bar.map(({ x, y }) => ({ x, y, kind: 'corner' as const })),
        },
      ],
      strokes: [],
      feather: 0,
      softEdge: { source: 'guided', bandPx: 20 },
    }
    expect(render(selection, size, image)).toEqual(
      renderMask(withoutSoftEdge(selection), size).data,
    )
  })

  it('should_refine_model_alpha (AC-20)', () => {
    const size = { width: 96, height: 96 }
    const modelEdge: SoftEdge = { source: 'model', bandPx: 8 }
    const fromModel = <S extends SmartEdgeScene>(s: S) => {
      const model = blurredModel(s.truth, size)
      const rings = maskToRings(fromAlphaMask(model))
      return {
        scene: {
          ...s,
          selection: { rings, strokes: [], feather: 0, softEdge: modelEdge },
        },
        model,
      }
    }
    for (const kind of KINDS) {
      const { scene, model } = fromModel(discScene(kind, 0))
      expectSnapped(scene, `model ${kind}`, model)
    }
    const { scene, model } = fromModel(hairScene(0))
    expectHair(scene, 'model hair', model)

    const disc = discScene('contrast', 0, modelEdge)
    expect(() => render(disc.selection, size, disc.image)).toThrow(RangeError)
    const wrongSize: AlphaMask = {
      width: 48,
      height: 48,
      data: new Uint8Array(48 * 48),
    }
    expect(() => smartEdgeRefiner(disc.image, wrongSize)).toThrow(RangeError)
  })

  it('should_not_leak_previews (AC-21, Review Focus 5)', () => {
    // 101 × 77: preview sizes round up (0.3 → 31 × 24).
    const size = { width: 101, height: 77 }
    const cov = softMask(
      [{ op: 'add', points: rect(20.3, 15.6, 70.2, 60.9) }],
      size,
    ).data
    const image = paintScene(cov, size, [0.8, 0.3, 0.2], [0.2, 0.5, 0.8], {
      noise: 0.02,
      seed: 4,
    })
    const model = blurredModel(cov, size)
    for (const source of ['guided', 'model'] as const) {
      const selection: Selection = {
        rings: [
          {
            op: 'add',
            nodes: rect(21.3, 14.6, 71.2, 61.9).map(({ x, y }) => ({
              x,
              y,
              kind: 'corner' as const,
            })),
          },
        ],
        strokes: [],
        feather: 0,
        // A 2 px band is 0.6 px in the 0.3 preview: still valid at full resolution.
        softEdge: { source, bandPx: 2 },
      }
      const refiner = smartEdgeRefiner(image, model)
      for (const scale of [0.3, 0.5]) {
        const preview = renderMask(selection, size, {
          scale,
          refineEdge: refiner,
        })
        expect(preview.width).toBe(Math.ceil(101 * scale))
        expect(preview.height).toBe(Math.ceil(77 * scale))
      }
      const full = renderMask(selection, size, { refineEdge: refiner }).data
      const fresh = renderMask(selection, size, {
        refineEdge: smartEdgeRefiner(image, model),
      }).data
      expect(full).toEqual(fresh)
    }
  })
})
