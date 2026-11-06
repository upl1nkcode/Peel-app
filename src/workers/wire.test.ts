import { describe, expect, it } from 'vitest'
import { lineScene } from '../test/sceneFixtures'
import { createLiveWireHandler } from './liveWireHandler'
import { wireWorker, type WorkerScope } from './wire'

function fakeScope() {
  const posted: { message: unknown; transfer: Transferable[] }[] = []
  const scope: WorkerScope = {
    onmessage: null,
    postMessage(message, transfer) {
      posted.push({ message, transfer })
    },
  }
  return { scope, posted }
}

describe('wireWorker', () => {
  it('should_report_errors_and_keep_serving (AC-26)', () => {
    const { scope, posted } = fakeScope()
    const queue: (() => void)[] = []
    wireWorker(scope, createLiveWireHandler(), (f) => queue.push(f))
    const send = (data: unknown) => {
      scope.onmessage?.({ data })
      while (queue.length > 0) queue.shift()?.()
    }
    const scene = lineScene()
    send({ type: 'snap', jobId: 1, imageId: 'a', finger: [], reachPx: 12 })
    expect(posted.at(-1)?.message).toEqual({
      type: 'error',
      jobId: 1,
      message: 'unknown image id a',
    })
    send({ type: 'setImage', imageId: 'a', image: scene.image })
    send({
      type: 'snap',
      jobId: 2,
      imageId: 'a',
      finger: [scene.at(0)],
      reachPx: -1,
    })
    expect(posted.at(-1)?.message).toMatchObject({ type: 'error', jobId: 2 })
    send({
      type: 'snap',
      jobId: 3,
      imageId: 'a',
      finger: [scene.at(0)],
      reachPx: 12,
    })
    expect(posted.at(-1)?.message).toMatchObject({ type: 'snapped', jobId: 3 })
    // Not a message of the contract: an error, and the worker carries on.
    send(42)
    expect(posted.at(-1)?.message).toMatchObject({ type: 'error', jobId: -1 })
    send({
      type: 'snap',
      jobId: 4,
      imageId: 'a',
      finger: [scene.at(0)],
      reachPx: 12,
    })
    expect(posted.at(-1)?.message).toMatchObject({ type: 'snapped', jobId: 4 })
  })
})
