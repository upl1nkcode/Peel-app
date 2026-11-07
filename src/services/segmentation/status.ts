import type { AutoState } from './autoCutout'
import type { UnavailableReason } from './types'

/** The fallback button (spec 0007 AC-20). */
export const USE_LASSO_LABEL = 'Use Lasso'

const UNAVAILABLE: Record<UnavailableReason, string> = {
  offline: "You're offline. The cutout model needs one download first.",
  download:
    "The cutout model didn't download. Check the connection and try again.",
  storage: 'Not enough storage for the cutout model.',
  unsupported: "Auto cutout doesn't work in this browser.",
}

const NOTICE = {
  nothingFound: 'Nothing found there. Tap on the subject.',
  sharperReady: 'Sharper cutout ready',
  preciseUnavailable: 'Sharper cutout not available on this device',
} as const

const mb = (bytes: number) => (bytes / 1e6).toFixed(1)

/** The status text for a state, in display order (spec 0007 copy; MB = 10⁶ bytes). */
export function statusLines(state: AutoState): string[] {
  if (state.unavailable) return [UNAVAILABLE[state.unavailable]]
  const lines: string[] = []
  if (state.phase === 'cutting') lines.push('Cutting out…')
  if (state.phase === 'sharpening') lines.push('Sharpening…')
  if (state.download) {
    lines.push(
      `Downloading cutout model: ${mb(state.download.loadedBytes)} of ${mb(state.download.totalBytes)} MB`,
    )
  }
  if (state.notice) lines.push(NOTICE[state.notice])
  return lines
}
