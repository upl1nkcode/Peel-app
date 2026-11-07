import { useState } from 'react'
import manifest from 'virtual:peel-models'
import {
  browserDeflate,
  browserInflate,
  browserInflateRaw,
} from './services/deflate'
import {
  createModelStore,
  createWorkerEngine,
  sha256Hex,
} from './services/segmentation'
import { startRenderWorker, startSegmentationWorker } from './services/workers'
import { loadPhoto } from './services/photo'
import { openStickerStore } from './services/storage'
import { AutoScreen } from './ui/auto/AutoScreen'
import type { StickerDeps } from './ui/auto/useStickers'

// Nothing here touches the network or starts a worker until a photo is picked (spec 0007 AC-19).
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
  // The panel handles a failure; this only stops an "unhandled rejection" before it mounts.
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

export default function App() {
  const [stickers] = useState(stickerDeps)
  return (
    <main>
      <h1>Peel</h1>
      <p>Cut anything out of a photo.</p>
      <AutoScreen
        engines={engines}
        missingBytes={(files) => store.missingBytes(files)}
        createRenderer={startRenderWorker}
        loadPhoto={loadPhoto}
        supported={canRunEngines}
        stickers={stickers}
      />
    </main>
  )
}
