/** The canvas backgrounds that expose leftovers (spec 0009 AC-11). */
export type ViewMode = 'overlay' | 'checkerboard' | 'black' | 'white' | 'red'

export const VIEW_MODES: readonly ViewMode[] = [
  'overlay',
  'checkerboard',
  'black',
  'white',
  'red',
]

export const VIEW_LABELS: Record<ViewMode, string> = {
  overlay: 'Overlay',
  checkerboard: 'Checkerboard',
  black: 'Black',
  white: 'White',
  red: 'Red',
}

/** An sRGB colour, 0–255 per channel (not rounded). */
export type Rgb = readonly [number, number, number]

export const VIEW_BACKGROUNDS: Record<'black' | 'white' | 'red', Rgb> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
}

/** Checkerboard square size in CSS px, the same at every zoom. */
export const CHECKER_PX = 8
export const CHECKER_LIGHT: Rgb = [255, 255, 255]
export const CHECKER_DARK: Rgb = [207, 207, 214]

/** Removed pixels are shown at this fraction of their brightness in Overlay. */
const OVERLAY_SHADE = 0.5

/** The checkerboard colour at a canvas CSS point; the top-left square is light. */
export function checkerColourAt(cssX: number, cssY: number): Rgb {
  const even =
    (Math.floor(cssX / CHECKER_PX) + Math.floor(cssY / CHECKER_PX)) % 2 === 0
  return even ? CHECKER_LIGHT : CHECKER_DARK
}

const mix = (p: Rgb, b: Rgb, a: number): Rgb => [
  a * p[0] + (1 - a) * b[0],
  a * p[1] + (1 - a) * b[1],
  a * p[2] + (1 - a) * b[2],
]

/**
 * What the canvas shows for photo colour `p` with mask alpha `a` (0–1)
 * (spec 0009 AC-11). `checker` is the checkerboard colour at that point.
 */
export function viewPixel(
  mode: ViewMode,
  p: Rgb,
  a: number,
  checker: Rgb,
): Rgb {
  switch (mode) {
    case 'overlay': {
      const k = 1 - OVERLAY_SHADE * (1 - a)
      return [p[0] * k, p[1] * k, p[2] * k]
    }
    case 'checkerboard':
      return mix(p, checker, a)
    default:
      return mix(p, VIEW_BACKGROUNDS[mode], a)
  }
}
