import { describe, expect, it } from 'vitest'
import { newestWins } from './newestWins'
import type { Reply } from './protocol'

type Req =
  | { type: 'setImage'; imageId: string }
  | { type: 'render'; jobId: number }
  | { type: 'snap'; jobId: number }
type Res =
  { type: 'done'; jobId: number } | { type: 'cancelled'; jobId: number }

function harness() {
  const handled: string[] = []
  const posted: Reply<Res>[] = []
  const queue: (() => void)[] = []
  const onMessage = newestWins<Req, Res>(
    (req) => {
      handled.push(
        req.type === 'setImage'
          ? `set ${req.imageId}`
          : `${req.type} ${String(req.jobId)}`,
      )
      return req.type === 'setImage'
        ? undefined
        : { message: { type: 'done', jobId: req.jobId }, transfer: [] }
    },
    (reply) => posted.push(reply),
    (f) => queue.push(f),
  )
  const drain = () => {
    while (queue.length > 0) queue.shift()?.()
  }
  return { handled, posted, onMessage, drain }
}

describe('newestWins', () => {
  it('should_run_only_the_newest_job (AC-25)', () => {
    const h = harness()
    h.onMessage({ type: 'render', jobId: 1 })
    h.onMessage({ type: 'render', jobId: 2 })
    h.onMessage({ type: 'snap', jobId: 3 })
    h.onMessage({ type: 'render', jobId: 4 })
    // Messages without a job (setImage) run at once, in order.
    h.onMessage({ type: 'setImage', imageId: 'a' })
    expect(h.handled).toEqual(['set a'])
    h.drain()
    expect(h.handled).toEqual(['set a', 'render 4', 'snap 3'])
    expect(h.posted.map((r) => r.message)).toEqual([
      { type: 'cancelled', jobId: 1 },
      { type: 'cancelled', jobId: 2 },
      { type: 'done', jobId: 4 },
      { type: 'done', jobId: 3 },
    ])
    // A later job after the drain runs on its own.
    h.onMessage({ type: 'render', jobId: 5 })
    h.drain()
    expect(h.posted.at(-1)?.message).toEqual({ type: 'done', jobId: 5 })
  })
})
