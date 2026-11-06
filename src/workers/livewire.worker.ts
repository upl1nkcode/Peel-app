import { createLiveWireHandler } from './liveWireHandler'
import { wireWorker, type WorkerScope } from './wire'

wireWorker(self as unknown as WorkerScope, createLiveWireHandler())
