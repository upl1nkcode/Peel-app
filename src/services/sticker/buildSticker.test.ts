// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { smartEdgeRefiner } from '../../core/matting'
import {
  applyMask,
  cropRgba,
  EmptyMaskError,
  renderMask,
  resizeRgba,
  trimBounds,
} from '../../core/mask'
import { encodePng, storedDeflate } from '../../core/png'
import type { Selection } from '../../core/selection/types'
import { testDeflate, testInflate } from '../../core/testing/codecs'
import { blurredModel, discScene } from '../../test/sceneFixtures'
import {
  buildSticker,
  inflateModelAlpha,
  THUMBNAIL_LONG_SIDE_PX,
  thumbnailSize,
} from './index'

const ihdrSize = (png: Uint8Array) => {
  const v = new DataView(png.buffer, png.byteOffset)
  return { width: v.getUint32(16), height: v.getUint32(20) }
}

describe('buildSticker', () => {
  const scene = discScene('contrast', 2)
  const model = blurredModel(scene.truth, scene.size)
  const selection: Selection = {
    ...scene.selection,
    softEdge: { source: 'model', bandPx: 8 },
  }
  const renderFull = (sel: Selection) =>
    Promise.resolve(
      renderMask(sel, scene.size, {
        scale: 1,
        refineEdge: smartEdgeRefiner(scene.image, model),
      }),
    )

  it('should_render_the_full_resolution_sticker (AC-6)', async () => {
    const built = await buildSticker(
      { image: scene.image, selection, modelAlpha: model },
      { renderFull, deflate: storedDeflate },
    )
    const mask = await renderFull(selection)
    const expected = await encodePng(
      cropRgba(applyMask(scene.image, mask), trimBounds(mask, 0)),
      storedDeflate,
    )
    expect(built.sticker).toEqual(expected)
  })

  it('should_make_a_256px_thumbnail (AC-7)', async () => {
    expect(THUMBNAIL_LONG_SIDE_PX).toBe(256)
    expect(thumbnailSize(1000, 500)).toEqual({ width: 256, height: 128 })
    expect(thumbnailSize(500, 1000)).toEqual({ width: 128, height: 256 })
    expect(thumbnailSize(100, 80)).toEqual({ width: 100, height: 80 })
    expect(thumbnailSize(3000, 1)).toEqual({ width: 256, height: 1 })
    expect(thumbnailSize(1, 1)).toEqual({ width: 1, height: 1 })
    expect(thumbnailSize(300, 299)).toEqual({ width: 256, height: 255 })

    const built = await buildSticker(
      { image: scene.image, selection, modelAlpha: model },
      { renderFull, deflate: storedDeflate },
    )
    const mask = await renderFull(selection)
    const cropped = cropRgba(applyMask(scene.image, mask), trimBounds(mask, 0))
    const size = thumbnailSize(cropped.width, cropped.height)
    expect(ihdrSize(built.thumbnail)).toEqual(size)
    expect(built.thumbnail).toEqual(
      await encodePng(
        resizeRgba(cropped, size.width, size.height),
        storedDeflate,
      ),
    )
  })

  it('should_keep_the_model_alpha_exactly (AC-5, AC-9)', async () => {
    const built = await buildSticker(
      { image: scene.image, selection, modelAlpha: model },
      { renderFull, deflate: testDeflate },
    )
    const saved = built.modelAlpha
    expect(saved).toBeDefined()
    if (!saved) return
    expect({ width: saved.width, height: saved.height }).toEqual(scene.size)
    expect(await inflateModelAlpha(saved, testInflate)).toEqual(model)

    const without = await buildSticker(
      { image: scene.image, selection: scene.selection, modelAlpha: null },
      { renderFull, deflate: storedDeflate },
    )
    expect(without).not.toHaveProperty('modelAlpha')
  })

  it('should_reject_a_model_alpha_of_the_wrong_length (AC-9)', async () => {
    const deflated = await testDeflate(new Uint8Array(5))
    await expect(
      inflateModelAlpha({ width: 2, height: 3, deflated }, testInflate),
    ).rejects.toThrow(RangeError)
  })

  it('should_refuse_an_empty_cutout (AC-20)', async () => {
    const tiny: Selection = {
      rings: [
        {
          op: 'add',
          nodes: [
            // Covers ~0.00005 of a pixel: rounds to alpha 0 everywhere.
            { x: 0.5, y: 0.5, kind: 'corner' },
            { x: 0.51, y: 0.5, kind: 'corner' },
            { x: 0.51, y: 0.51, kind: 'corner' },
          ],
        },
      ],
      strokes: [],
      feather: 0,
    }
    await expect(
      buildSticker(
        { image: scene.image, selection: tiny, modelAlpha: null },
        { renderFull, deflate: storedDeflate },
      ),
    ).rejects.toThrow(EmptyMaskError)
  })
})
