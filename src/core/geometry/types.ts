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

/** An editable dot. `corner` makes a sharp point; `smooth` a C¹-continuous curve. */
export interface Node extends Point {
  kind: 'corner' | 'smooth'
}

/** A cubic Bézier from p0 to p3 with control points c1, c2. */
export interface BezierSegment {
  p0: Point
  c1: Point
  c2: Point
  p3: Point
}
