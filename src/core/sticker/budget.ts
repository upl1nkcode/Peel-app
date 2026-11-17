/** AC-5: the WhatsApp-style file's size limit and the lossy qualities tried, in order. */
export const WHATSAPP_BUDGET_BYTES = 102_400
export const WHATSAPP_QUALITIES: readonly number[] = [90, 80, 70, 60, 50, 40]

/** No quality made a file within the budget (AC-5). */
export class TooLargeError extends Error {
  constructor() {
    super('The file is over its size budget at every quality')
    this.name = 'TooLargeError'
  }
}

/** AC-5: tries qualities in order and returns the first file ≤ budget. */
export async function encodeWithinBudget(
  encode: (quality: number) => Promise<Uint8Array>,
  budgetBytes: number,
  qualities: readonly number[],
): Promise<Uint8Array> {
  for (const quality of qualities) {
    const bytes = await encode(quality)
    if (bytes.length <= budgetBytes) return bytes
  }
  throw new TooLargeError()
}
