import type { ModelStore } from './modelStore'
import type { ModelFile } from './types'

/** The offline status line (spec 0013 AC-19). */
export type OfflineStatus =
  | { kind: 'downloading'; percent: number }
  | { kind: 'ready' }
  | { kind: 'needsInternet' }

/**
 * Downloads every engine and model file not cached yet, so Auto works offline
 * (spec 0013 AC-18). With Save-Data it downloads nothing (Decision 13). A
 * failure is reported once; the next app start tries again.
 */
export async function prefetchModels(
  store: ModelStore,
  files: readonly ModelFile[],
  env: { saveData: boolean },
  onStatus: (status: OfflineStatus) => void,
): Promise<void> {
  if (env.saveData) {
    onStatus({ kind: 'needsInternet' })
    return
  }
  let shown = -1
  try {
    await store.ensure(files, (loaded, total) => {
      const percent = total > 0 ? Math.floor((loaded * 100) / total) : 100
      if (percent > shown) {
        shown = percent
        onStatus({ kind: 'downloading', percent })
      }
    })
    onStatus({ kind: 'ready' })
  } catch {
    onStatus({ kind: 'needsInternet' })
  }
}
