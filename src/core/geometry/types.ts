/** A 2D point. Unless a name says otherwise, geometry is in image pixels (float, y down). */
export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}
