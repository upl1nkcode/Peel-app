import manifest from 'virtual:peel-models'
import {
  createModelStore,
  createWorkerEngine,
  sha256Hex,
} from './services/segmentation'
import { startRenderWorker, startSegmentationWorker } from './services/workers'
import { AutoScreen } from './ui/auto/AutoScreen'
import { loadPhoto } from './ui/auto/loadPhoto'

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

export default function App() {
  return (
    <main>
      <h1>Peel</h1>
      <p>Cut anything out of a photo.</p>
      <AutoScreen
        engines={engines}
        missingBytes={(files) => store.missingBytes(files)}
        createRenderer={startRenderWorker}
        loadPhoto={loadPhoto}
      />
    </main>
  )
}
