/**
 * The pty side of GRID.
 *
 * One ConPTY per terminal pane. Two things here are worth more than they look:
 *
 * 1. Coalescing. A build or a test run emits thousands of tiny writes; sending
 *    each one over IPC melts the renderer. Chunks are buffered and flushed on a
 *    short timer (or immediately once they get big), which turns a firehose
 *    into a few dozen messages a second.
 *
 * 2. Flow control. If the renderer falls behind, unacked bytes pile up. Past a
 *    high-water mark the pty is paused until xterm has caught up, so `cat` on a
 *    huge file slows down instead of locking up the window.
 */

import { execFile } from 'node:child_process'
// node-pty is a native module. electron-vite externalizes every `dependencies`
// entry, so this import survives as a bare require() in the built main bundle
// and resolves to the asar-unpacked copy at runtime.
import { spawn as spawnPty, type IPty } from 'node-pty'
import type { ShellProfile } from '../../shared/types'

/** Flush buffered output at most this often. 8ms keeps typing feeling instant. */
const FLUSH_MS = 8
/** Flush early once a batch reaches this size, so big output stays smooth. */
const FLUSH_BYTES = 32 * 1024
/** Pause the pty once this many bytes are in flight without an ack. */
const HIGH_WATER = 1 * 1024 * 1024
/** Resume once the backlog drops back under this. */
const LOW_WATER = 256 * 1024

export type PtyEvents = {
  onData: (paneId: string, data: string, seq: number) => void
  /** `solicited` is true when GRID asked for the kill, so the UI can stay quiet. */
  onExit: (paneId: string, exitCode: number, solicited: boolean) => void
}

type Session = {
  paneId: string
  pty: IPty
  shellLabel: string
  cwd: string
  /** Bytes handed to the renderer so far. */
  sent: number
  /** Bytes the renderer has confirmed written into xterm. */
  acked: number
  paused: boolean
  buffer: string[]
  bufferedBytes: number
  timer: NodeJS.Timeout | null
  exited: boolean
  /** We asked for this to die, so its exit code is meaningless. */
  killing: boolean
  disposables: Array<{ dispose: () => void }>
}

export class PtyManager {
  private sessions = new Map<string, Session>()

  constructor(private events: PtyEvents) {}

  get count(): number {
    return this.sessions.size
  }

  has(paneId: string): boolean {
    return this.sessions.has(paneId)
  }

  spawn(
    paneId: string,
    shell: ShellProfile,
    cwd: string,
    cols: number,
    rows: number
  ): { pid: number; shellLabel: string } {
    this.kill(paneId)

    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') env[k] = v
    }
    Object.assign(env, shell.env ?? {})
    // Tell anything that cares it is inside a real terminal in GRID.
    env.TERM_PROGRAM = 'grid'
    env.GRID_PANE = paneId
    // Electron leaks these into children and they confuse node tooling.
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_NO_ATTACH_CONSOLE

    const pty = spawnPty(shell.path, shell.args ?? [], {
      name: 'xterm-256color',
      cols: Math.max(2, Math.floor(cols) || 80),
      rows: Math.max(1, Math.floor(rows) || 24),
      cwd,
      env,
      // ConPTY is what makes modern console apps (and colours) behave on
      // Windows; the winpty fallback only matters on very old builds.
      useConpty: process.platform === 'win32' ? true : undefined
    })

    const session: Session = {
      paneId,
      pty,
      shellLabel: shell.label,
      cwd,
      sent: 0,
      acked: 0,
      paused: false,
      buffer: [],
      bufferedBytes: 0,
      timer: null,
      exited: false,
      killing: false,
      disposables: []
    }

    session.disposables.push(
      pty.onData((data) => this.enqueue(session, data)),
      pty.onExit(({ exitCode }) => {
        session.exited = true
        this.flush(session)
        this.events.onExit(paneId, exitCode, session.killing)
        this.dispose(session)
        this.sessions.delete(paneId)
      })
    )

    this.sessions.set(paneId, session)
    return { pid: pty.pid, shellLabel: shell.label }
  }

  write(paneId: string, data: string): void {
    const s = this.sessions.get(paneId)
    if (!s || s.exited) return
    try {
      s.pty.write(data)
    } catch {
      /* the child died between the check and the write */
    }
  }

  resize(paneId: string, cols: number, rows: number): void {
    const s = this.sessions.get(paneId)
    if (!s || s.exited) return
    const c = Math.max(2, Math.floor(cols) || 80)
    const r = Math.max(1, Math.floor(rows) || 24)
    try {
      s.pty.resize(c, r)
    } catch {
      // ConPTY throws if the pipe closed between the check and the resize.
    }
  }

  /**
   * The renderer confirming it has written `bytes` total into xterm. This is
   * the other half of flow control: without it we would happily queue a
   * gigabyte of `yes` output in the renderer's write buffer.
   */
  ack(paneId: string, bytes: number): void {
    const s = this.sessions.get(paneId)
    if (!s) return
    s.acked = Math.max(s.acked, bytes)
    if (s.paused && s.sent - s.acked < LOW_WATER) {
      s.paused = false
      try {
        s.pty.resume()
      } catch {
        /* already gone */
      }
    }
  }

  /**
   * @param immediate reap any surviving process tree at once instead of after
   *   a grace period. Used on quit, where there is no "later" to wait for.
   */
  kill(paneId: string, immediate = false): void {
    const s = this.sessions.get(paneId)
    if (!s) return
    s.killing = true
    this.sessions.delete(paneId)
    this.dispose(s)

    const pid = s.pty.pid
    try {
      // kill() takes no argument on Windows — passing a signal throws.
      s.pty.kill()
    } catch {
      /* already exited */
    }

    // node-pty's console-process-list cleanup is broken on Windows 11 26200
    // (its agent dies with "AttachConsole failed"), so a grandchild that
    // allocated its own console can outlive the shell. With a dozen Claude
    // CLIs running that adds up, so check and clean up afterwards.
    if (process.platform !== 'win32' || pid <= 0) return

    if (immediate) {
      // On quit there is no grace period to wait out: the app is about to
      // exit and an unref'd timer would never fire.
      reapTree(pid, true)
      return
    }
    const timer = setTimeout(() => reapTree(pid), 1500)
    timer.unref?.()
  }

  killAll(immediate = false): void {
    for (const paneId of [...this.sessions.keys()]) this.kill(paneId, immediate)
  }

  // -------------------------------------------------------------------------

  private enqueue(session: Session, data: string): void {
    session.buffer.push(data)
    session.bufferedBytes += data.length

    if (session.bufferedBytes >= FLUSH_BYTES) {
      this.flush(session)
      return
    }
    if (session.timer) return
    session.timer = setTimeout(() => this.flush(session), FLUSH_MS)
  }

  private flush(session: Session): void {
    if (session.timer) {
      clearTimeout(session.timer)
      session.timer = null
    }
    if (session.buffer.length === 0) return

    const data = session.buffer.join('')
    session.buffer.length = 0
    session.bufferedBytes = 0
    session.sent += data.length

    this.events.onData(session.paneId, data, session.sent)

    if (!session.paused && session.sent - session.acked > HIGH_WATER) {
      session.paused = true
      try {
        session.pty.pause()
      } catch {
        /* pause is best effort */
      }
    }
  }

  private dispose(session: Session): void {
    if (session.timer) {
      clearTimeout(session.timer)
      session.timer = null
    }
    for (const d of session.disposables) {
      try {
        d.dispose()
      } catch {
        /* ignore */
      }
    }
    session.disposables.length = 0
  }
}

/**
 * Force-terminate a process tree that outlived its pty.
 *
 * `process.kill(pid, 0)` is the liveness probe; taskkill /T /F is the only
 * reliable way to take a whole console tree down on Windows. This only ever
 * runs after GRID has already asked the shell to exit, so nothing is being
 * killed that the user did not close.
 */
function reapTree(pid: number, detach = false): void {
  try {
    process.kill(pid, 0)
  } catch {
    return // already gone, which is the normal case
  }
  const child = execFile(
    'taskkill',
    ['/PID', String(pid), '/T', '/F'],
    { windowsHide: true },
    () => {
      /* best effort */
    }
  )
  // On quit we do not outlive taskkill, so let it finish on its own.
  if (detach) child.unref()
}
