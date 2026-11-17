import manifest from 'virtual:peel-models'
import {
  browserDeflate,
  browserInflate,
  browserInflateRaw,
} from './services/deflate'
import type { InstallPrompt } from './services/install'
import {
  createModelStore,
  createWorkerEngine,
  prefetchModels,
  sha256Hex,
  type OfflineStatus,
} from './services/segmentation'
import type { UpdateWatch } from './services/update'
import {
  startLiveWireWorker,
  startRenderWorker,
  startSegmentationWorker,
} from './services/workers'
import { loadPhoto } from './services/photo'
import { openStickerStore } from './services/storage'
import { Shell, type ShellEnv } from './Shell'
import type { StickerDeps } from './ui/library/useLibrary'

// Nothing here touches the network or starts a worker at import (spec 0007 AC-19); the
// first-visit download starts once the Library shows (spec 0013 AC-18).
const store = createModelStore({
  fetch: (input, init) => fetch(input, init),
  caches: { open: (name) => caches.open(name) },
  digest: sha256Hex,
  online: () => navigator.onLine,
})
const { engineLoader, engineWasm, fast, precise } = manifest.files
const engines = {
  fast: createWorkerEngine(
    'fast',
    [engineLoader, engineWasm, fast],
    store,
    () => startSegmentationWorker('fast'),
  ),
  precise: createWorkerEngine(
    'precise',
    [engineLoader, engineWasm, precise],
    store,
    () => startSegmentationWorker('precise'),
  ),
}

/** The engines need WebAssembly and OffscreenCanvas (in workers; the main thread stands in for them). */
const canRunEngines = () =>
  typeof WebAssembly === 'object' && typeof OffscreenCanvas === 'function'

/** The sticker store on this device (spec 0008); opening it needs no network. */
function stickerDeps(): StickerDeps {
  const store =
    typeof indexedDB === 'undefined'
      ? Promise.reject(new Error('this browser has no IndexedDB'))
      : openStickerStore(indexedDB)
  // The Library handles a failure; this only stops an "unhandled rejection" before it mounts.
  store.catch(() => undefined)
  return {
    store,
    storage:
      typeof navigator.storage === 'object' ? navigator.storage : undefined,
    codecs: {
      deflate: browserDeflate,
      inflate: browserInflate,
      inflateRaw: browserInflateRaw,
    },
  }
}

/** Every engine and model file, downloaded on the first visit (spec 0013 AC-18). */
const ALL_FILES = [engineLoader, engineWasm, fast, precise]

function prefetch(onStatus: (status: OfflineStatus) => void) {
  const connection = (navigator as { connection?: { saveData?: boolean } })
    .connection
  void prefetchModels(
    store,
    ALL_FILES,
    { saveData: connection?.saveData === true },
    onStatus,
  )
}

function localStore(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function browserEnv(): ShellEnv {
  return {
    ua: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    ...(typeof window.matchMedia === 'function' && {
      matchMedia: (q: string) => window.matchMedia(q),
    }),
    navigator: navigator as { standalone?: boolean },
    languages: navigator.languages,
    storage: localStore(),
  }
}

export interface AppProps {
  /** The kept install prompt (spec 0013 AC-15). */
  install?: InstallPrompt
  /** Whether a new version waits (spec 0013 AC-22). */
  update?: UpdateWatch
}

const stickers = stickerDeps()
const env = browserEnv()

export default function App(props: AppProps) {
  return (
    <Shell
      editor={{
        engines,
        missingBytes: (files) => store.missingBytes(files),
        createRenderer: startRenderWorker,
        createSnapper: startLiveWireWorker,
        loadPhoto,
        supported: canRunEngines,
      }}
      stickers={stickers}
      env={env}
      {...(props.install && { install: props.install })}
      {...(props.update && { update: props.update })}
      prefetch={prefetch}
      share={{
        createRenderer: startRenderWorker,
        nav: typeof navigator.share === 'function' ? navigator : undefined,
      }}
    />
  )
}
