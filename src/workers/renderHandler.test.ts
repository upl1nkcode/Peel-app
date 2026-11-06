import { describe, expect, it } from 'vitest'
import { smartEdgeRefiner } from '../core/matting'
import { renderMask } from '../core/mask/render'
import type { Selection } from '../core/selection/types'
import { blurredModel, discScene } from '../test/sceneFixtures'
import type { FromRenderWorker } from './protocol'
import { createRenderHandler } from './renderHandler'

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
})
