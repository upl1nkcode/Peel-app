import type { AsyncHandler, Reply } from './protocol'

interface Cancelled {
  type: 'cancelled'
  jobId: number
}

/**
 * Runs only the newest waiting job of each type (spec 0006 AC-25). Messages
 * without a `jobId` (setImage) run at once, in order. Jobs wait until the
 * deferred drain; then, per type in order of arrival, every older job posts
 * `cancelled` and the newest runs. A reply that is a promise is posted when
 * it settles (the caller turns rejections into replies, as `wireWorker` does);
 * until then its type is held, so two jobs of one type never run side by side
 * (spec 0012: two 12 MP Originals at once could run a phone out of memory).
 */
export function newestWins<Req extends { type: string; jobId?: number }, Res>(
  handle: AsyncHandler<Req, Res>,
  post: (reply: Reply<Res | Cancelled>) => void,
  defer: (f: () => void) => void = (f) => {
    setTimeout(f, 0)
  },
): (req: Req) => void {
  const waiting = new Map<string, Req[]>()
  const busy = new Set<string>()
  let scheduled = false

  const schedule = () => {
    if (scheduled || waiting.size === 0) return
    scheduled = true
    defer(drain)
  }

  const run = (req: Req) => {
    const reply = handle(req)
    if (reply instanceof Promise) {
      if (req.jobId === undefined) {
        void reply.then((r) => {
          if (r) post(r)
        })
        return
      }
      busy.add(req.type)
      void reply
        .then((r) => {
          if (r) post(r)
        })
        .finally(() => {
          busy.delete(req.type)
          schedule()
        })
    } else if (reply) post(reply)
  }

  function drain() {
    scheduled = false
    const jobs: Req[][] = []
    for (const [type, list] of waiting) {
      if (busy.has(type)) continue
      jobs.push(list)
      waiting.delete(type)
    }
    for (const list of jobs) {
      for (let k = 0; k < list.length - 1; k++) {
        post({
          message: { type: 'cancelled', jobId: list[k]?.jobId as number },
          transfer: [],
        })
      }
      const newest = list[list.length - 1]
      if (newest) run(newest)
    }
  }

  return (req: Req) => {
    if (req.jobId === undefined) {
      run(req)
      return
    }
    const list = waiting.get(req.type)
    if (list) list.push(req)
    else waiting.set(req.type, [req])
    schedule()
  }
}
