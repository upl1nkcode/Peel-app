import { createMediapipeBackend } from './mediapipeBackend'
import { wireSegmentationWorker } from './segmentationHandler'
import type { WorkerScope } from './wire'

// The worker's name (set by startSegmentationWorker) picks the engine.
const engine = self.name === 'precise' ? 'precise' : 'fast'
wireSegmentationWorker(
  self as unknown as WorkerScope,
  engine,
  createMediapipeBackend,
)
