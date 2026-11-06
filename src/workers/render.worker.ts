import { createRenderHandler } from './renderHandler'
import { wireWorker, type WorkerScope } from './wire'

wireWorker(self as unknown as WorkerScope, createRenderHandler())
