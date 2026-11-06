// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fromAlphaMask } from '../../core/contour'
import type { RgbaImage } from '../../core/mask'
import { autoSelection } from '../../core/segmentation'
import { createFakeEngine, EngineUnavailable } from './index'

const image = (width: number, height: number): RgbaImage => ({
  width,
  height,
  data: new Uint8Array(width * height * 4),
})

describe('fake engine', () => {
  it('should_report_rising_progress_then_segment_discs (AC-1)', async () => {
    const engine = createFakeEngine()
    const progress: [number, number][] = []
    await engine.load((loaded, total) => progress.push([loaded, total]))
    expect(progress).toEqual([
      [25, 100],
      [50, 100],
      [75, 100],
      [100, 100],
    ])
    await engine.setImage('a', image(100, 100))
    const { alpha, selection } = await engine.segment('a', [
      { imagePt: { x: 50, y: 50 }, mode: 'add' },
    ])
    expect(alpha.data[50 * 100 + 50]).toBe(255)
    expect(alpha.data[50 * 100 + 75]).toBe(0)
    expect(selection).toEqual(autoSelection(fromAlphaMask(alpha)))
    expect(selection?.rings).toHaveLength(1)

    const failing = createFakeEngine({ failLoad: 'storage' })
    const error = await failing.load(() => undefined).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EngineUnavailable)
    expect((error as EngineUnavailable).reason).toBe('storage')
  })

  it('should_refuse_segmenting_before_load_and_outside_the_image (AC-2)', async () => {
    const engine = createFakeEngine({ name: 'precise' })
    expect(engine.name).toBe('precise')
    await expect(engine.setImage('a', image(100, 50))).resolves.toBeUndefined()
    await expect(engine.segment('a', [])).rejects.toThrow(/not loaded/)
    await engine.load(() => undefined)
    await expect(
      engine.segment('a', [{ imagePt: { x: 100, y: 1 }, mode: 'add' }]),
    ).rejects.toThrow(RangeError)
    const empty = await engine.segment('a', [])
    expect({ width: empty.alpha.width, height: empty.alpha.height }).toEqual({
      width: 100,
      height: 50,
    })
    expect(empty.alpha.data.every((v) => v === 0)).toBe(true)
    expect(empty.selection).toBeNull()
    await expect(engine.segment('b', [])).rejects.toThrow(/unknown image/)
  })

  it('should_remove_with_a_remove_tap_and_wait_its_delay', async () => {
    const engine = createFakeEngine({ delayMs: 5 })
    await engine.load(() => undefined)
    await engine.setImage('a', image(100, 100))
    const t0 = Date.now()
    const { alpha, selection } = await engine.segment('a', [
      { imagePt: { x: 50, y: 50 }, mode: 'add' },
      { imagePt: { x: 50, y: 50 }, mode: 'remove' },
    ])
    expect(Date.now() - t0).toBeGreaterThanOrEqual(4)
    expect(alpha.data.every((v) => v === 0)).toBe(true)
    expect(selection).toBeNull()
  })
})
