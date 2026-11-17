import type { AutoState } from './autoCutout'
import type { UnavailableReason } from './types'
import type { Message, MessageKey } from '../../ui/i18n'

const UNAVAILABLE: Record<UnavailableReason, MessageKey> = {
  offline: 'auto.offline',
  download: 'auto.download',
  storage: 'auto.storage',
  unsupported: 'auto.unsupported',
}

const NOTICE = {
  nothingFound: 'auto.nothingFound',
  sharperReady: 'auto.sharperReady',
  preciseUnavailable: 'auto.preciseUnavailable',
} as const satisfies Record<string, MessageKey>

const mb = (bytes: number) => (bytes / 1e6).toFixed(1)

/** The status lines for a state, in display order (spec 0007 copy; MB = 10⁶ bytes), for the UI to word (spec 0013). */
export function statusLines(state: AutoState): Message[] {
  if (state.unavailable) return [{ key: UNAVAILABLE[state.unavailable] }]
  const lines: Message[] = []
  if (state.phase === 'cutting') lines.push({ key: 'auto.cutting' })
  if (state.phase === 'sharpening') lines.push({ key: 'auto.sharpening' })
  if (state.download) {
    lines.push({
      key: 'auto.downloading',
      params: {
        loaded: mb(state.download.loadedBytes),
        total: mb(state.download.totalBytes),
      },
    })
  }
  if (state.notice) lines.push({ key: NOTICE[state.notice] })
  return lines
}
