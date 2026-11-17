import { describe, expect, it } from 'vitest'
import {
  encodeWithinBudget,
  TooLargeError,
  WHATSAPP_BUDGET_BYTES,
  WHATSAPP_QUALITIES,
} from './budget'

describe('encodeWithinBudget', () => {
  it('should_try_qualities_until_the_file_fits (AC-5)', async () => {
    expect(WHATSAPP_BUDGET_BYTES).toBe(102_400)
    expect(WHATSAPP_QUALITIES).toEqual([90, 80, 70, 60, 50, 40])
    const tried: number[] = []
    const out = await encodeWithinBudget(
      (q) => {
        tried.push(q)
        return Promise.resolve(new Uint8Array(q * 2000))
      },
      WHATSAPP_BUDGET_BYTES,
      WHATSAPP_QUALITIES,
    )
    expect(out.length).toBe(100_000)
    expect(tried).toEqual([90, 80, 70, 60, 50])
  })

  it('should_reject_when_nothing_fits (AC-5)', async () => {
    await expect(
      encodeWithinBudget(
        () => Promise.resolve(new Uint8Array(200_000)),
        WHATSAPP_BUDGET_BYTES,
        WHATSAPP_QUALITIES,
      ),
    ).rejects.toBeInstanceOf(TooLargeError)
  })
})
