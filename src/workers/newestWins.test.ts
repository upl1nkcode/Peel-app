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

  it('should_post_an_async_reply_when_it_settles (spec 0012 AC-9)', async () => {
    const posted: Reply<Res>[] = []
    let settle: (() => void) | undefined
    const onMessage = newestWins<Req, Res>(
      (req) =>
        req.type === 'setImage'
          ? undefined
          : new Promise((resolve) => {
              settle = () => {
                resolve({
                  message: { type: 'done', jobId: req.jobId },
                  transfer: [],
                })
              }
            }),
      (reply) => posted.push(reply),
      (f) => {
        f()
      },
    )
    onMessage({ type: 'render', jobId: 1 })
    expect(posted).toEqual([])
    settle?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(posted.map((r) => r.message)).toEqual([{ type: 'done', jobId: 1 }])
  })

  it('should_hold_a_type_while_its_async_job_runs (spec 0012 AC-7)', async () => {
    const handled: string[] = []
    const posted: Reply<Res>[] = []
    const queue: (() => void)[] = []
    const settle = new Map<number, () => void>()
    const onMessage = newestWins<Req, Res>(
      (req) => {
        if (req.type === 'setImage') return undefined
        handled.push(`${req.type} ${String(req.jobId)}`)
        if (req.type === 'snap') {
          return { message: { type: 'done', jobId: req.jobId }, transfer: [] }
        }
        return new Promise((resolve) => {
          settle.set(req.jobId, () => {
            resolve({
              message: { type: 'done', jobId: req.jobId },
              transfer: [],
            })
          })
        })
      },
      (reply) => posted.push(reply),
      (f) => queue.push(f),
    )
    const drain = () => {
      while (queue.length > 0) queue.shift()?.()
    }
    const flush = async () => {
      for (let k = 0; k < 4; k++) await Promise.resolve()
    }
    onMessage({ type: 'render', jobId: 1 })
    drain()
    expect(handled).toEqual(['render 1'])
    // Two more while job 1 is still being made: neither starts beside it
    // (two 12 MP Originals at once could run the phone out of memory).
    onMessage({ type: 'render', jobId: 2 })
    onMessage({ type: 'render', jobId: 3 })
    // Another type isn't held.
    onMessage({ type: 'snap', jobId: 4 })
    drain()
    expect(handled).toEqual(['render 1', 'snap 4'])
    settle.get(1)?.()
    await flush()
    drain()
    // Once job 1 settles, only the newest waiting job runs.
    expect(handled).toEqual(['render 1', 'snap 4', 'render 3'])
    expect(posted.map((r) => r.message)).toEqual([
      { type: 'done', jobId: 4 },
      { type: 'done', jobId: 1 },
      { type: 'cancelled', jobId: 2 },
    ])
    settle.get(3)?.()
    await flush()
    expect(posted.at(-1)?.message).toEqual({ type: 'done', jobId: 3 })
  })
})
