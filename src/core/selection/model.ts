import type { Selection } from './types'

/** A selection with nothing selected. */
export function emptySelection(): Selection {
  return { rings: [], strokes: [], feather: 0 }
}
