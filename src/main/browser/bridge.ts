/**
 * The door a Claude session knocks on.
 *
 * `/devmuxel-browser` runs a script in whatever session you happen to be in,
 * and that script has to reach the DevMuxel that is already running — arm the
 * element picker in it, then wait for you to finish marking the page up and
 * press send. A running Electron app cannot be driven by pointing at its
 * executable, so it listens instead.
 *
 * Loopback only, on a port the OS picks, behind a token generated fresh each
 * launch. Both go in `bridge.json` next to the state file, which is how the
 * script finds them; the file is removed on the way out so a stale one never
 * sends somebody to a port that has been handed to something else.
 *
 * One waiter at a time. Two sessions both holding the line for the same set of
 * comments is a race with no right answer, so the second is told so plainly.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import type { CommentBatch } from '../../shared/browser'

/** How long a script may hold the line before it is told to try again. */
const MAX_WAIT_MS = 30 * 60 * 1000

/** Refuse a body big enough to be an attack rather than a request. */
const MAX_BODY_BYTES = 64 * 1024

export type BridgeDeps = {
  /**
   * Arm the element picker on the last browser pane that had focus. Resolves
   * false when there is no browser pane open — which the script reports as a
   * failure, because there is nothing to comment on.
   */
  armPicker: () => Promise<boolean>
  /** Tell the pane its comments were taken, so it can clear them. */
  acknowledge: (batch: string) => void
  /** Whether anything is listening at all, for a useful refusal. */
  hasBrowserPane: () => boolean
  /** A session started or stopped holding the line, so a pane can say so. */
  onWaiting: (waiting: boolean) => void
}

/** What the script receives: the batch, plus it already written out. */
export type DeliveredBatch = CommentBatch & { text: string }

type Waiter = {
  resolve: (batch: DeliveredBatch) => void
  timer: NodeJS.Timeout
}

export class BrowserBridge {
  private server: Server | null = null
  private token = ''
  private waiter: Waiter | null = null

  constructor(
    private userDataDir: string,
    private deps: BridgeDeps
  ) {}

  private get manifestPath(): string {
    return path.join(this.userDataDir, 'bridge.json')
  }

  async start(): Promise<void> {
    this.token = randomBytes(24).toString('hex')
    const server = createServer((req, res) => void this.route(req, res))

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      // Loopback explicitly: the default would take every interface.
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })

    this.server = server
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    await fs.mkdir(this.userDataDir, { recursive: true })
    await fs.writeFile(
      this.manifestPath,
      JSON.stringify({ port, token: this.token, pid: process.pid }, null, 2),
      'utf8'
    )
  }

  async stop(): Promise<void> {
    if (this.waiter) {
      clearTimeout(this.waiter.timer)
      this.setWaiter(null)
    }
    this.server?.close()
    this.server = null
    // A manifest outliving the process would point the next script at a port
    // the OS has since given to somebody else.
    await fs.rm(this.manifestPath, { force: true }).catch(() => {})
  }

  /**
   * Called when a pane's send button is pressed. Hands the batch to whoever is
   * holding the line, and says whether anybody was.
   */
  deliver(batch: DeliveredBatch): boolean {
    const waiter = this.waiter
    if (!waiter) return false
    this.setWaiter(null)
    clearTimeout(waiter.timer)
    waiter.resolve(batch)
    return true
  }

  /** One place to change it, so the panes are never told the wrong thing. */
  private setWaiter(waiter: Waiter | null): void {
    const was = this.waiter !== null
    this.waiter = waiter
    if (was !== (waiter !== null)) this.deps.onWaiting(waiter !== null)
  }

  /** True while a session is waiting, so a pane can say so on its button. */
  get waiting(): boolean {
    return this.waiter !== null
  }

  // -------------------------------------------------------------------------

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (req.headers.authorization !== `Bearer ${this.token}`) {
      return send(res, 401, { error: 'bad token' })
    }

    try {
      if (req.method === 'POST' && url.pathname === '/v1/select') {
        if (!this.deps.hasBrowserPane()) {
          return send(res, 409, { error: 'no browser pane is open in DevMuxel' })
        }
        const armed = await this.deps.armPicker()
        return send(res, armed ? 200 : 409, armed ? { ok: true } : { error: 'no browser pane is open in DevMuxel' })
      }

      if (req.method === 'GET' && url.pathname === '/v1/comments') {
        return await this.waitForComments(url, res)
      }

      if (req.method === 'POST' && url.pathname === '/v1/ack') {
        const body = await readJson(req)
        const batch = typeof body?.batch === 'string' ? body.batch : ''
        if (!batch) return send(res, 400, { error: 'no batch given' })
        this.deps.acknowledge(batch)
        return send(res, 200, { ok: true })
      }

      return send(res, 404, { error: 'no such endpoint' })
    } catch (err) {
      return send(res, 500, { error: err instanceof Error ? err.message : String(err) })
    }
  }

  private waitForComments(url: URL, res: ServerResponse): Promise<void> {
    if (this.waiter) {
      send(res, 409, { error: 'another Claude session is already waiting for comments' })
      return Promise.resolve()
    }

    const asked = Number(url.searchParams.get('timeout') ?? '0') * 1000
    const wait = Math.min(MAX_WAIT_MS, asked > 0 ? asked : MAX_WAIT_MS)

    return new Promise<void>((done) => {
      const timer = setTimeout(() => {
        this.setWaiter(null)
        send(res, 408, { error: 'timed out waiting for comments' })
        done()
      }, wait)
      timer.unref?.()

      this.setWaiter({
        timer,
        resolve: (batch) => {
          send(res, 200, batch)
          done()
        }
      })

      // A script that gives up — Ctrl+C, or the session ending — must not leave
      // the line held against the next one.
      res.on('close', () => {
        if (this.waiter?.timer !== timer) return
        clearTimeout(timer)
        this.setWaiter(null)
        done()
      })
    })
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
    // Nothing here is for a browser, and saying so costs one header.
    'x-content-type-options': 'nosniff'
  })
  res.end(text)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}
