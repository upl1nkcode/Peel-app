import type { Point } from '../geometry/types'

/** A tap on the photo: `add` selects what is under it, `remove` takes it out. */
export interface Tap {
  imagePt: Point
  mode: 'add' | 'remove'
}

/** A Tap v2 stroke point, normalised to [0, 1) of the image's width and height. */
export interface Stroke {
  mode: 'positive' | 'negative'
  x: number
  y: number
}
