import type { Bounds } from '../geometry/types'
import { addOutline } from '../mask/outline'
import { resizeRgba } from '../mask/resize'
import { cropRgba } from '../mask/trim'
import { EmptyMaskError, type RgbaImage } from '../mask/types'

export type OutputKind = 'sticker' | 'original' | 'whatsapp'

export interface FinishSettings {
  output: OutputKind
  outline: { on: boolean; widthPct: number; color: 'white' | 'black' }
  paddingPct: number
}

/** Decision 3 and AC-12: Sticker, outline off (3%, white), no padding. */
export const DEFAULT_FINISH: FinishSettings = {
  output: 'sticker',
  outline: { on: false, widthPct: 3, color: 'white' },
  paddingPct: 0,
}

export const OUTLINE_WIDTH_PCT = { min: 1, max: 6, step: 0.5 } as const
export const PADDING_PCT = { min: 0, max: 20, step: 1 } as const
export const FEATHER_PX = { min: 0, max: 3, step: 0.25 } as const

/** AC-2: the Sticker output's long side, outline and padding included. */
export const STICKER_MAX_PX = 1024
/** AC-4: the WhatsApp-style canvas and the box its content fits in. */
export const WHATSAPP_SIZE_PX = 512
export const WHATSAPP_CONTENT_PX = 480

export const OUTPUT_MIME: Record<OutputKind, 'image/png' | 'image/webp'> = {
  sticker: 'image/png',
  original: 'image/png',
  whatsapp: 'image/webp',
}

const OUTLINE_RGB = {
  white: [255, 255, 255],
  black: [0, 0, 0],
} as const

const OUTPUTS: readonly OutputKind[] = ['sticker', 'original', 'whatsapp']

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

/** A number in range, snapped to its step; anything else is the default (spec Data). */
function ranged(
  v: unknown,
  range: { min: number; max: number; step: number },
  fallback: number,
): number {
  if (typeof v !== 'number' || !(v >= range.min && v <= range.max)) {
    return fallback
  }
  const snapped = Math.round(v / range.step) * range.step
  return Math.min(range.max, Math.max(range.min, snapped))
}

/** Reads stored or imported settings; each bad or missing field gets its default. */
export function readFinish(raw: unknown): FinishSettings {
  const r = isRecord(raw) ? raw : {}
  const o = isRecord(r.outline) ? r.outline : {}
  const d = DEFAULT_FINISH
  return {
    output: OUTPUTS.find((k) => k === r.output) ?? d.output,
    outline: {
      on: typeof o.on === 'boolean' ? o.on : d.outline.on,
      widthPct: ranged(o.widthPct, OUTLINE_WIDTH_PCT, d.outline.widthPct),
      color:
        o.color === 'black' || o.color === 'white' ? o.color : d.outline.color,
    },
    paddingPct: ranged(r.paddingPct, PADDING_PCT, d.paddingPct),
  }
}

export function sameFinish(a: FinishSettings, b: FinishSettings): boolean {
  return (
    a.output === b.output &&
    a.outline.on === b.outline.on &&
    a.outline.widthPct === b.outline.widthPct &&
    a.outline.color === b.outline.color &&
    a.paddingPct === b.paddingPct
  )
}

/**
 * How far past the subject `addOutline` leaves alpha > 0: the largest whole
 * distance d with round((widthPx + 0.5 − d) · 255) > 0.
 */
const outlineReach = (widthPx: number): number =>
  Math.floor(widthPx + 0.5 - 1 / 510)

/**
 * AC-2: the scaled cutout's long side T (so s = T / L) for a long side of at
 * most `cap` with outline and padding. Starts from the spec's
 * s = min(1, cap / (L(1 + 2w + 2p))) and steps down while the whole-pixel
 * outline and padding still overshoot.
 */
function stickerLongSide(
  L: number,
  settings: FinishSettings,
  cap: number,
): number {
  const w = settings.outline.on ? settings.outline.widthPct / 100 : 0
  const p = settings.paddingPct / 100
  const total = (t: number) =>
    t + 2 * (w > 0 ? outlineReach(w * t) : 0) + 2 * Math.round(p * t)
  let t = Math.min(L, Math.ceil(cap / (1 + 2 * w + 2 * p)) + 2)
  while (t > 1 && total(t) > cap) t--
  return t
}

/** Bounds (max exclusive) of the pixels with alpha > 0 (AC-1 step 3). */
function alphaBounds(img: RgbaImage): Bounds {
  const { width: w, height: h, data } = img
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    let k = y * w * 4 + 3
    for (let x = 0; x < w; x++, k += 4) {
      if (data[k] === 0) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      maxY = y
    }
  }
  if (maxX < 0) throw new EmptyMaskError()
  return { minX, minY, maxX: maxX + 1, maxY: maxY + 1 }
}

const scaleTo = (img: RgbaImage, f: number): RgbaImage =>
  f >= 1
    ? img
    : resizeRgba(
        img,
        Math.max(1, Math.round(img.width * f)),
        Math.max(1, Math.round(img.height * f)),
      )

/**
 * AC-1 to AC-4: the output's pixels from a trimmed cutout. Scale, outline,
 * trim, pad; WhatsApp-style then fits that in 480 × 480 on a 512 × 512 canvas.
 * Throws `EmptyMaskError` when no pixel is left.
 */
export function finishImage(
  cutout: RgbaImage,
  settings: FinishSettings,
): RgbaImage {
  const L = Math.max(cutout.width, cutout.height)
  const t =
    settings.output === 'original'
      ? L
      : stickerLongSide(L, settings, STICKER_MAX_PX)
  let img = scaleTo(cutout, t / L)
  if (settings.outline.on) {
    img = addOutline(img, {
      widthPx: (settings.outline.widthPct / 100) * t,
      color: OUTLINE_RGB[settings.outline.color],
    })
  }
  const pad = Math.round((settings.paddingPct / 100) * t)
  const b = alphaBounds(img)
  const out = cropRgba(img, {
    minX: b.minX - pad,
    minY: b.minY - pad,
    maxX: b.maxX + pad,
    maxY: b.maxY + pad,
  })
  if (settings.output !== 'whatsapp') return out

  const fitted = scaleTo(
    out,
    WHATSAPP_CONTENT_PX / Math.max(out.width, out.height),
  )
  // The odd leftover pixel goes to the right or bottom margin.
  const left = Math.floor((WHATSAPP_SIZE_PX - fitted.width) / 2)
  const top = Math.floor((WHATSAPP_SIZE_PX - fitted.height) / 2)
  return cropRgba(fitted, {
    minX: -left,
    minY: -top,
    maxX: WHATSAPP_SIZE_PX - left,
    maxY: WHATSAPP_SIZE_PX - top,
  })
}

const two = (n: number) => String(n).padStart(2, '0')

/** AC-16: `peel-sticker-YYYY-MM-DD-HHMM[-original].png` or `…-whatsapp.webp`, local time. */
export function finishFileName(now: Date, kind: OutputKind): string {
  const stamp = `${String(now.getFullYear())}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`
  const suffix =
    kind === 'original'
      ? '-original.png'
      : kind === 'whatsapp'
        ? '-whatsapp.webp'
        : '.png'
  return `peel-sticker-${stamp}${suffix}`
}
