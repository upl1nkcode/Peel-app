import { describe, expect, it } from 'vitest'
import { smartEdgeRefiner } from '../core/matting'
import { renderMask } from '../core/mask/render'
import type { Selection } from '../core/selection/types'
import { blurredModel, discScene } from '../test/sceneFixtures'
import type { FromRenderWorker } from './protocol'
import {
  createRenderHandler as createAsyncRenderHandler,
  type RenderDeps,
} from './renderHandler'
import { storedDeflate } from '../core/png/zlib'
import { decodePng, inflateStored } from '../test/png'
import { encodePng } from '../core/png/encode'
import { cropRgba, trimBounds } from '../core/mask/trim'
import { applyMask } from '../core/mask/cutout'
import type { RgbaImage } from '../core/mask/types'
import {
  DEFAULT_FINISH,
  finishImage,
  TooLargeError,
  type FinishSettings,
} from '../core/sticker'
import { EncoderUnavailableError } from '../services/webp'
import { newestWins } from './newestWins'
import { applyCommand } from '../core/selection/commands'
import type { Node } from '../core/geometry/types'
import { InvalidLassoError } from '../core/geometry/lasso'
import { fitRing } from '../core/selection/density'

/** The handler for jobs that reply at once (all but `finish`). */
function createRenderHandler(deps?: RenderDeps) {
  const handle = createAsyncRenderHandler(deps)
  return (msg: Parameters<typeof handle>[0]) => {
    const reply = handle(msg)
    if (reply instanceof Promise) throw new Error('unexpected async reply')
    return reply
  }
}

function rendered(reply: { message: FromRenderWorker } | undefined) {
  if (reply?.message.type !== 'rendered') {
    throw new Error(`expected rendered, got ${JSON.stringify(reply?.message)}`)
  }
  return reply.message
}

describe('render worker handler', () => {
  it('should_match_direct_calls (AC-23)', () => {
    const scene = discScene('contrast', 2)
    const model = blurredModel(scene.truth, scene.size)
    const handle = createRenderHandler()
    expect(
      handle({
        type: 'setImage',
        imageId: 'a',
        image: scene.image,
        modelAlpha: model,
      }),
    ).toBeUndefined()
    const modelSel: Selection = {
      ...scene.selection,
      softEdge: { source: 'model', bandPx: 8 },
    }
    let jobId = 1
    for (const selection of [scene.selection, modelSel]) {
      for (const scale of [1, 0.5]) {
        const reply = rendered(
          handle({ type: 'render', jobId, imageId: 'a', selection, scale }),
        )
        expect(reply.jobId).toBe(jobId++)
        expect(reply.mask).toEqual(
          renderMask(selection, scene.size, {
            scale,
            refineEdge: smartEdgeRefiner(scene.image, model),
          }),
        )
      }
    }
  })

  it('should_reuse_images_by_id (AC-24)', () => {
    const scene = discScene('contrast', 2)
    const handle = createRenderHandler()
    handle({ type: 'setImage', imageId: 'a', image: scene.image })
    const render = (jobId: number, imageId: string) =>
      handle({
        type: 'render',
        jobId,
        imageId,
        selection: scene.selection,
        scale: 1,
      })
    expect(rendered(render(1, 'a')).mask.width).toBe(96)
    expect(rendered(render(2, 'a')).mask.width).toBe(96)
    expect(() => render(3, 'nope')).toThrow(/unknown image/)
    handle({ type: 'setImage', imageId: 'b', image: scene.image })
    expect(rendered(render(4, 'b')).jobId).toBe(4)
    expect(() => render(5, 'a')).toThrow(/unknown image/)
  })

  it('should_reject_unknown_messages (AC-23)', () => {
    const handle = createRenderHandler()
    expect(() => handle({ type: 'paint' } as never)).toThrow(/unknown message/)
  })

  it('should_transfer_buffers (AC-27)', () => {
    const scene = discScene('contrast', 2)
    const handle = createRenderHandler()
    handle({ type: 'setImage', imageId: 'a', image: scene.image })
    const reply = handle({
      type: 'render',
      jobId: 1,
      imageId: 'a',
      selection: scene.selection,
      scale: 1,
    })
    expect(reply?.transfer).toEqual([rendered(reply).mask.data.buffer])
  })

  it('should_swap_the_model_alpha_without_resending_the_photo', () => {
    const scene = discScene('contrast', 2)
    const model = blurredModel(scene.truth, scene.size)
    const selection: Selection = {
      ...scene.selection,
      softEdge: { source: 'model', bandPx: 8 },
    }
    const swapped = createRenderHandler()
    swapped({ type: 'setImage', imageId: 'a', image: scene.image })
    expect(
      swapped({ type: 'setModelAlpha', imageId: 'a', modelAlpha: model }),
    ).toBeUndefined()
    const fresh = createRenderHandler()
    fresh({
      type: 'setImage',
      imageId: 'a',
      image: scene.image,
      modelAlpha: model,
    })
    const job = {
      type: 'render',
      jobId: 1,
      imageId: 'a',
      selection,
      scale: 1,
    } as const
    expect(rendered(swapped(job)).mask).toEqual(rendered(fresh(job)).mask)
    expect(() =>
      swapped({ type: 'setModelAlpha', imageId: 'b', modelAlpha: model }),
    ).toThrow('unknown image id b')
  })

  it('should_render_full_size_on_its_own_message (AC-6)', () => {
    const scene = discScene('contrast', 2)
    const model = blurredModel(scene.truth, scene.size)
    const selection: Selection = {
      ...scene.selection,
      softEdge: { source: 'model', bandPx: 8 },
    }
    const handle = createRenderHandler()
    handle({
      type: 'setImage',
      imageId: 'a',
      image: scene.image,
      modelAlpha: model,
    })
    const reply = rendered(
      handle({
        type: 'renderFull',
        jobId: 7,
        imageId: 'a',
        selection,
        modelAlpha: model,
      }),
    )
    expect(reply.jobId).toBe(7)
    expect(reply.mask).toEqual(
      renderMask(selection, scene.size, {
        scale: 1,
        refineEdge: smartEdgeRefiner(scene.image, model),
      }),
    )
    expect(() =>
      handle({ type: 'renderFull', jobId: 8, imageId: 'b', selection }),
    ).toThrow('unknown image id b')
  })

  it('should_render_full_size_with_the_model_alpha_it_was_sent (spec 0008 AC-6)', () => {
    const scene = discScene('contrast', 2)
    const model = blurredModel(scene.truth, scene.size)
    const other = { ...model, data: model.data.map((v) => 255 - v) }
    const selection: Selection = {
      ...scene.selection,
      softEdge: { source: 'model', bandPx: 8 },
    }
    const handle = createRenderHandler()
    handle({
      type: 'setImage',
      imageId: 'a',
      image: scene.image,
      modelAlpha: other,
    })
    const withModel = rendered(
      handle({
        type: 'renderFull',
        jobId: 1,
        imageId: 'a',
        selection,
        modelAlpha: model,
      }),
    )
    expect(withModel.mask).toEqual(
      renderMask(selection, scene.size, {
        refineEdge: smartEdgeRefiner(scene.image, model),
      }),
    )
    // Without one, the worker's current model alpha is not used either.
    const guided: Selection = {
      ...scene.selection,
      softEdge: { source: 'guided', bandPx: 8 },
    }
    const without = rendered(
      handle({ type: 'renderFull', jobId: 2, imageId: 'a', selection: guided }),
    )
    expect(without.mask).toEqual(
      renderMask(guided, scene.size, {
        refineEdge: smartEdgeRefiner(scene.image),
      }),
    )
  })

  describe('resimplify (spec 0010 AC-15)', () => {
    const circle = (cx: number, r: number): Node[] =>
      Array.from({ length: 64 }, (_, i) => {
        const a = (i / 64) * 2 * Math.PI
        return {
          x: cx + r * Math.cos(a),
          y: 200 + r * Math.sin(a),
          kind: 'smooth' as const,
        }
      })
    const two: Selection = {
      rings: [
        { op: 'add', nodes: circle(200, 150) },
        { op: 'subtract', nodes: circle(200, 60) },
      ],
      strokes: [],
      feather: 0,
    }

    it('should_resimplify_every_ring (AC-15)', () => {
      const reply = createRenderHandler()({
        type: 'resimplify',
        jobId: 7,
        selection: two,
        tolerancePx: 2,
      })
      expect(reply?.message.type).toBe('resimplified')
      if (reply?.message.type !== 'resimplified') throw new Error('no reply')
      const local = [0, 1].reduce(
        (sel, ring) =>
          applyCommand(sel, { type: 'setDensity', ring, tolerancePx: 2 }),
        two,
      )
      expect(reply.message).toEqual({
        type: 'resimplified',
        jobId: 7,
        selection: local,
      })
      for (const ring of reply.message.selection.rings) {
        expect(ring.nodes.length).toBeLessThan(64)
      }
    })

    it('should_keep_only_the_newest_resimplify (AC-15)', () => {
      const posted: FromRenderWorker[] = []
      const deferred: (() => void)[] = []
      const onMessage = newestWins(
        createRenderHandler(),
        (reply) => posted.push(reply.message),
        (f) => {
          deferred.push(f)
        },
      )
      const image = { width: 4, height: 4, data: new Uint8Array(64) }
      onMessage({ type: 'setImage', imageId: 'a', image })
      onMessage({
        type: 'resimplify',
        jobId: 1,
        selection: two,
        tolerancePx: 2,
      })
      onMessage({
        type: 'render',
        jobId: 2,
        imageId: 'a',
        selection: { rings: [], strokes: [], feather: 0 },
        scale: 1,
      })
      onMessage({
        type: 'resimplify',
        jobId: 3,
        selection: two,
        tolerancePx: 4,
      })
      for (const f of deferred) f()
      expect(posted.map((m) => [m.type, m.jobId])).toEqual([
        ['cancelled', 1],
        ['resimplified', 3],
        ['rendered', 2],
      ])
    })
  })

  describe('fitRing (spec 0011 AC-15, AC-27)', () => {
    const square = Array.from({ length: 40 }, (_, i) => {
      const side = Math.floor(i / 10)
      const t = (i % 10) / 10
      return [
        { x: 10 + 100 * t, y: 10 },
        { x: 110, y: 10 + 100 * t },
        { x: 110 - 100 * t, y: 110 },
        { x: 10, y: 110 - 100 * t },
      ][side] as { x: number; y: number }
    })

    it('should_fit_a_ring_in_the_worker (AC-27)', () => {
      const reply = createRenderHandler()({
        type: 'fitRing',
        jobId: 4,
        path: square,
        tolerancePx: 0.5,
      })
      expect(reply?.message).toEqual({
        type: 'fitted',
        jobId: 4,
        nodes: fitRing(square, 0.5),
      })
    })

    it('should_throw_for_a_lasso_that_is_not_a_ring (AC-10)', () => {
      // wireWorker turns a throw into an `error` reply (wire.test.ts).
      expect(() =>
        createRenderHandler()({
          type: 'fitRing',
          jobId: 5,
          path: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { x: 2, y: 2 },
          ],
          tolerancePx: 1,
        }),
      ).toThrow(InvalidLassoError)
    })
  })
})

describe('render worker finish jobs (spec 0012)', () => {
  /** A 40 × 20 photo of position colours; the ring covers x 8..28, y 4..16. */
  function photo(): RgbaImage {
    const data = new Uint8Array(40 * 20 * 4)
    for (let k = 0; k < 800; k++) {
      data.set([(k * 7) & 255, (k * 3) & 255, 90, 255], k * 4)
    }
    return { width: 40, height: 20, data }
  }
  const corner = (x: number, y: number): Node => ({ x, y, kind: 'corner' })
  const square: Selection = {
    rings: [
      {
        op: 'add',
        nodes: [corner(8, 4), corner(28, 4), corner(28, 16), corner(8, 16)],
      },
    ],
    strokes: [],
    feather: 0,
  }
  const settings = (patch: Partial<FinishSettings> = {}): FinishSettings => ({
    ...DEFAULT_FINISH,
    ...patch,
  })

  function setup(deps: RenderDeps = {}) {
    const handle = createAsyncRenderHandler({ deflate: storedDeflate, ...deps })
    void handle({ type: 'setImage', imageId: 'a', image: photo() })
    const finish = async (
      jobId: number,
      selection: Selection,
      s: FinishSettings,
    ) =>
      await handle({
        type: 'finish',
        jobId,
        imageId: 'a',
        selection,
        settings: s,
      })
    return { handle, finish }
  }

  it('should_finish_a_sticker_png (AC-2)', async () => {
    const { finish } = setup()
    const reply = await finish(1, square, settings({ paddingPct: 10 }))
    const msg = reply?.message
    if (msg?.type !== 'finished') throw new Error(JSON.stringify(msg))
    const mask = renderMask(square, { width: 40, height: 20 })
    const expected = finishImage(
      cropRgba(applyMask(photo(), mask), trimBounds(mask, 0)),
      settings({ paddingPct: 10 }),
    )
    expect(msg.jobId).toBe(1)
    expect(msg.mime).toBe('image/png')
    expect([msg.width, msg.height]).toEqual([expected.width, expected.height])
    expect(decodePng(msg.bytes)).toEqual(expected)
    expect(reply?.transfer).toEqual([msg.bytes.buffer])
  })

  it('should_report_an_empty_cutout (Review Focus 3)', async () => {
    const { finish } = setup()
    const onlySubtract: Selection = {
      ...square,
      rings: [{ op: 'subtract', nodes: square.rings[0]?.nodes ?? [] }],
    }
    const reply = await finish(2, onlySubtract, settings())
    expect(reply?.message).toEqual({
      type: 'finishFailed',
      jobId: 2,
      reason: 'empty',
    })
  })

  it('should_report_too_large_and_unavailable (AC-5, AC-6)', async () => {
    const big = setup({
      loadWebp: () =>
        Promise.resolve(() => Promise.resolve(new Uint8Array(200_000))),
    })
    expect(
      (await big.finish(3, square, settings({ output: 'whatsapp' })))?.message,
    ).toEqual({ type: 'finishFailed', jobId: 3, reason: 'tooLarge' })
    const offline = setup({
      loadWebp: () => Promise.reject(new EncoderUnavailableError()),
    })
    expect(
      (await offline.finish(4, square, settings({ output: 'whatsapp' })))
        ?.message,
    ).toEqual({ type: 'finishFailed', jobId: 4, reason: 'encoderUnavailable' })
    expect(new TooLargeError()).toBeInstanceOf(Error)
  })

  it('should_encode_whatsapp_as_webp_at_512 (AC-4)', async () => {
    const qualities: number[] = []
    const { finish } = setup({
      loadWebp: () =>
        Promise.resolve((image: RgbaImage, quality: number) => {
          qualities.push(quality)
          return Promise.resolve(new Uint8Array([image.width & 255, quality]))
        }),
    })
    const msg = (await finish(5, square, settings({ output: 'whatsapp' })))
      ?.message
    expect(msg).toMatchObject({
      type: 'finished',
      jobId: 5,
      mime: 'image/webp',
      width: 512,
      height: 512,
    })
    expect(qualities).toEqual([90])
  })

  it('should_render_the_mask_once_for_settings_changes (AC-7)', async () => {
    let renders = 0
    const { handle, finish } = setup({
      render: (...args) => {
        renders++
        return renderMask(...args)
      },
    })
    for (const paddingPct of [0, 5, 10]) {
      await finish(10 + paddingPct, square, settings({ paddingPct }))
    }
    expect(renders).toBe(1)
    await finish(30, { ...square, feather: 1 }, settings())
    expect(renders).toBe(2)
    void handle({ type: 'setImage', imageId: 'a', image: photo() })
    await finish(31, { ...square, feather: 1 }, settings())
    expect(renders).toBe(3)
  })

  it('should_preview_with_its_own_job_type (AC-9)', async () => {
    const { handle } = setup()
    const reply = await handle({
      type: 'finishPreview',
      jobId: 40,
      imageId: 'a',
      selection: square,
      settings: settings(),
    })
    expect(reply?.message).toMatchObject({ type: 'finished', jobId: 40 })
  })
})

describe('render worker finishSaved (spec 0013)', () => {
  it('should_finish_a_saved_sticker_exactly (AC-8)', async () => {
    const data = new Uint8Array(100 * 60 * 4)
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 100; x++) {
        // An opaque red rectangle with a transparent margin and soft edge.
        const inside = x >= 10 && x < 90 && y >= 10 && y < 50
        const edge = x === 9 || x === 90 || y === 9 || y === 50
        data.set(
          [220, 30, 40, inside ? 255 : edge ? 128 : 0],
          (y * 100 + x) * 4,
        )
      }
    }
    const red: RgbaImage = { width: 100, height: 60, data }
    const settings: FinishSettings = {
      ...DEFAULT_FINISH,
      outline: { on: true, widthPct: 4, color: 'white' },
    }
    const handle = createAsyncRenderHandler({
      deflate: storedDeflate,
      inflate: (z) => Promise.resolve(inflateStored(z)),
    })
    const png = await encodePng(red, storedDeflate)
    const reply = await handle({ type: 'finishSaved', jobId: 7, png, settings })
    const msg = reply?.message
    if (msg?.type !== 'finished') throw new Error(JSON.stringify(msg))
    const expected = finishImage(red, settings)
    expect(msg.jobId).toBe(7)
    expect(msg.mime).toBe('image/png')
    expect(decodePng(msg.bytes)).toEqual(expected)
  })
})
