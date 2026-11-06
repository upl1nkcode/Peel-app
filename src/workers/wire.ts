import { newestWins } from './newestWins'
import type { Handler } from './protocol'

/** The part of a worker's global scope the wiring uses. */
export interface WorkerScope {
  onmessage: ((event: { data: unknown }) => void) | null
  postMessage(message: unknown, transfer: Transferable[]): void
}

interface ErrorReply {
  type: 'error'
  jobId: number
  message: string
}

/**
 * Connects a handler to a worker scope through `newestWins` (spec 0006
 * AC-25, AC-26). A message that is not an object with a string `type`, or a
 * handler that throws, posts `{ type: 'error', jobId, message }` (jobId −1
 * when the message has none) and the worker keeps serving.
 */
export function wireWorker<Req extends { type: string; jobId?: number }, Res>(
  scope: WorkerScope,
  handle: Handler<Req, Res>,
  defer?: (f: () => void) => void,
): void {
  const errorReply = (jobId: number, e: unknown) => ({
    message: {
      type: 'error' as const,
      jobId,
      message: e instanceof Error ? e.message : String(e),
    },
    transfer: [],
  })
  const safe: Handler<Req, Res | ErrorReply> = (req) => {
    try {
      return handle(req)
    } catch (e) {
      return errorReply(req.jobId ?? -1, e)
    }
  }
  const onMessage = newestWins<Req, Res | ErrorReply>(
    safe,
    (reply) => {
      scope.postMessage(reply.message, reply.transfer)
    },
    defer,
  )
  scope.onmessage = (event) => {
    const data = event.data
    if (
      typeof data !== 'object' ||
      data === null ||
      typeof (data as { type?: unknown }).type !== 'string'
    ) {
      const { message, transfer } = errorReply(
        -1,
        new Error('not a worker message'),
      )
      scope.postMessage(message, transfer)
      return
    }
    onMessage(data as Req)
  }
}
