import type { Handler, Reply } from './protocol'

interface Cancelled {
  type: 'cancelled'
  jobId: number
}

/**
 * Runs only the newest waiting job of each type (spec 0006 AC-25). Messages
 * without a `jobId` (setImage) run at once, in order. Jobs wait until the
 * deferred drain; then, per type in order of arrival, every older job posts
 * `cancelled` and the newest runs.
 */
export function newestWins<Req extends { type: string; jobId?: number }, Res>(
  handle: Handler<Req, Res>,
  post: (reply: Reply<Res | Cancelled>) => void,
  defer: (f: () => void) => void = (f) => {
    setTimeout(f, 0)
  },
): (req: Req) => void {
  const waiting = new Map<string, Req[]>()
  let scheduled = false

  const run = (req: Req) => {
    const reply = handle(req)
    if (reply) post(reply)
  }

  const drain = () => {
    scheduled = false
    const jobs = [...waiting.values()]
    waiting.clear()
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
    if (!scheduled) {
      scheduled = true
      defer(drain)
    }
  }
}
