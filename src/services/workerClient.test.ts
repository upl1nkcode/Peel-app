import { describe, expect, it } from 'vitest'
import type { Selection } from '../core/selection/types'
import {
  createWorkerClient,
  liveWireWorkerClient,
  renderWorkerClient,
  type Port,
} from './workerClient'

function fakePort() {
  const sent: { message: unknown; transfer: Transferable[] }[] = []
  const port: Port = {
    onmessage: null,
    postMessage(message, transfer) {
      sent.push({ message, transfer })
    },
  }
  const reply = (data: unknown) => port.onmessage?.({ data } as MessageEvent)
  return { port, sent, reply }
}

const selection: Selection = { rings: [], strokes: [], feather: 0 }

describe('worker client', () => {
  it('should_run_only_the_newest_job (AC-25)', async () => {
    const { port, sent, reply } = fakePort()
    const client = createWorkerClient<
      | { type: 'render'; jobId: number; scale: number }
      | { type: 'snap'; jobId: number },
      | { type: 'rendered'; jobId: number }
      | { type: 'snapped'; jobId: number }
      | { type: 'cancelled'; jobId: number }
    >(port)
    const p1 = client.request({ type: 'render', scale: 1 }, [])
    const p2 = client.request({ type: 'render', scale: 0.5 }, [])
    const s1 = client.request({ type: 'snap' }, [])
    const p3 = client.request({ type: 'render', scale: 0.25 }, [])
    expect(sent.map((s) => s.message)).toEqual([
      { type: 'render', scale: 1, jobId: 1 },
      { type: 'render', scale: 0.5, jobId: 2 },
      { type: 'snap', jobId: 3 },
      { type: 'render', scale: 0.25, jobId: 4 },
    ])
    expect(await p1).toEqual({ type: 'cancelled' })
    expect(await p2).toEqual({ type: 'cancelled' })
    // Late replies to superseded jobs are ignored.
    reply({ type: 'rendered', jobId: 1 })
    reply({ type: 'cancelled', jobId: 2 })
    reply({ type: 'snapped', jobId: 3 })
    reply({ type: 'rendered', jobId: 4 })
    expect(await s1).toEqual({ type: 'snapped', jobId: 3 })
    expect(await p3).toEqual({ type: 'rendered', jobId: 4 })
    // Replies with no pending job, or that are not objects, are ignored.
    reply({ type: 'rendered', jobId: 99 })
    reply(null)
  })

  it('should_transfer_buffers (AC-27)', async () => {
    const { port, sent, reply } = fakePort()
    const render = renderWorkerClient(port)
    const image = { width: 1, height: 1, data: new Uint8Array(4) }
    const modelAlpha = { width: 1, height: 1, data: new Uint8Array(1) }
    render.setImage('a', image, modelAlpha)
    expect(sent[0]).toEqual({
      message: { type: 'setImage', imageId: 'a', image, modelAlpha },
      transfer: [image.data.buffer, modelAlpha.data.buffer],
    })
    const job = render.render('a', selection, 0.5)
    expect(sent[1]?.message).toEqual({
      type: 'render',
      imageId: 'a',
      selection,
      scale: 0.5,
      jobId: 1,
    })
    const mask = { width: 1, height: 1, data: new Uint8Array(1) }
    reply({ type: 'rendered', jobId: 1, mask })
    expect(await job).toEqual({ type: 'rendered', jobId: 1, mask })

    const { port: port2, sent: sent2 } = fakePort()
    const wire = liveWireWorkerClient(port2)
    const image2 = { width: 1, height: 1, data: new Uint8Array(4) }
    wire.setImage('b', image2)
    expect(sent2[0]?.transfer).toEqual([image2.data.buffer])
    void wire.snap('b', [{ x: 0.5, y: 0.5 }], 12)
    expect(sent2[1]?.message).toEqual({
      type: 'snap',
      imageId: 'b',
      finger: [{ x: 0.5, y: 0.5 }],
      reachPx: 12,
      jobId: 1,
    })
  })
})
