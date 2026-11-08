import { describe, expect, it } from 'vitest'
import { smartEdgeRefiner } from '../core/matting'
import { renderMask } from '../core/mask/render'
import type { Selection } from '../core/selection/types'
import { blurredModel, discScene } from '../test/sceneFixtures'
import type { FromRenderWorker } from './protocol'
import { createRenderHandler } from './renderHandler'
import { newestWins } from './newestWins'
import { applyCommand } from '../core/selection/commands'
import type { Node } from '../core/geometry/types'

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
})
