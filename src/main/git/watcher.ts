/**
 * Keeps every declared repository's git state fresh and pushes changes at the
 * renderer.
 *
 * Two triggers, because polling alone is either laggy or wasteful:
 *   - a timer (fast while the window has focus, slow while it does not), and
 *   - an fs watch on the repo's `.git` directory, so switching a branch or
 *     making a commit in a terminal shows up in the header immediately.
 *
 * Only one `git status` per path is ever in flight; a request arriving while
 * one is running just marks the path dirty and re-runs afterwards.
 */

import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import type { GitState } from '../../shared/types'
import { emptyState, forgetRepo, readGitState } from './status'

type Entry = {
  repoPath: string
  /** Repo ids pointing at this path — several repos may share a work tree. */
  refs: Set<string>
  state: GitState
  running: boolean
  /** A change arrived while a read was running. */
  again: boolean
  watcher: FSWatcher | null
  debounce: NodeJS.Timeout | null
}

export type GitWatcherOptions = {
  focusedIntervalMs: number
  blurredIntervalMs: number
  onUpdate: (repoPath: string, state: GitState) => void
}

/** `.git` files whose change means the working tree state may have moved. */
const INTERESTING = /^(HEAD|index|MERGE_HEAD|REBASE_HEAD|CHERRY_PICK_HEAD|ORIG_HEAD|packed-refs)$/

export class GitWatcher {
  private entries = new Map<string, Entry>()
  private timer: NodeJS.Timeout | null = null
  private focused = true
  private disposed = false

  constructor(
    private opts: GitWatcherOptions,
    focused = true
  ) {
    this.focused = focused
    this.restartTimer()
  }

  /** Replace the whole set of watched paths, keeping cached state for survivors. */
  setRepos(repos: Array<{ id: string; path: string }>): void {
    const wanted = new Map<string, Set<string>>()
    for (const r of repos) {
      if (!r.path) continue
      const key = path.normalize(r.path)
      const set = wanted.get(key) ?? new Set<string>()
      set.add(r.id)
      wanted.set(key, set)
    }

    for (const [key, entry] of this.entries) {
      if (!wanted.has(key)) {
        this.teardown(entry)
        this.entries.delete(key)
        forgetRepo(entry.repoPath)
      }
    }

    for (const [key, refs] of wanted) {
      const existing = this.entries.get(key)
      if (existing) {
        existing.refs = refs
        continue
      }
      const entry: Entry = {
        repoPath: key,
        refs,
        state: emptyState(key),
        running: false,
        again: false,
        watcher: null,
        debounce: null
      }
      this.entries.set(key, entry)
      this.attachWatcher(entry)
      void this.refresh(key, true)
    }
  }

  /** Cached state for every watched path. */
  snapshot(): Record<string, GitState> {
    const out: Record<string, GitState> = {}
    for (const [key, entry] of this.entries) out[key] = entry.state
    return out
  }

  setFocused(focused: boolean): void {
    if (this.focused === focused) return
    this.focused = focused
    this.restartTimer()
    // Coming back to the window is exactly when stale data is most obvious.
    if (focused) this.refreshAll()
  }

  refreshAll(): void {
    for (const key of this.entries.keys()) void this.refresh(key)
  }

  async refreshOne(repoPath: string): Promise<GitState | null> {
    const key = path.normalize(repoPath)
    if (!this.entries.has(key)) return null
    await this.refresh(key)
    return this.entries.get(key)?.state ?? null
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const entry of this.entries.values()) this.teardown(entry)
    this.entries.clear()
  }

  // -------------------------------------------------------------------------

  private restartTimer(): void {
    if (this.timer) clearInterval(this.timer)
    const every = this.focused ? this.opts.focusedIntervalMs : this.opts.blurredIntervalMs
    this.timer = setInterval(() => this.refreshAll(), Math.max(1000, every))
    // A background timer must never hold the app open.
    this.timer.unref?.()
  }

  private attachWatcher(entry: Entry): void {
    const gitDir = path.join(entry.repoPath, '.git')
    try {
      // Non-recursive: we only care about the handful of files in .git itself,
      // and recursive watching of refs/ on a busy repo is a firehose.
      entry.watcher = watch(gitDir, { persistent: false }, (_event, filename) => {
        const name = typeof filename === 'string' ? filename : String(filename ?? '')
        if (name && !INTERESTING.test(name) && !name.startsWith('refs')) return
        if (entry.debounce) clearTimeout(entry.debounce)
        // git writes index.lock then renames; wait for the dust to settle.
        entry.debounce = setTimeout(() => void this.refresh(entry.repoPath), 280)
        entry.debounce.unref?.()
      })
      entry.watcher.on('error', () => {
        entry.watcher?.close()
        entry.watcher = null
      })
    } catch {
      // Not a repo yet, or a worktree with a .git file rather than a directory.
      entry.watcher = null
    }
  }

  private teardown(entry: Entry): void {
    if (entry.debounce) clearTimeout(entry.debounce)
    entry.debounce = null
    try {
      entry.watcher?.close()
    } catch {
      /* already gone */
    }
    entry.watcher = null
  }

  private async refresh(key: string, force = false): Promise<void> {
    if (this.disposed) return
    const entry = this.entries.get(key)
    if (!entry) return

    if (entry.running) {
      entry.again = true
      return
    }

    entry.running = true
    try {
      const next = await readGitState(entry.repoPath)

      // The await above is long enough for setRepos() to have removed this
      // repository. Publishing its state — or worse, re-attaching a watcher to
      // an entry nobody holds any more — would leak a handle for the rest of
      // the session.
      if (this.disposed || this.entries.get(key) !== entry) return

      const prev = entry.state
      entry.state = next
      if (force || changed(prev, next)) this.opts.onUpdate(entry.repoPath, next)

      // A folder that only just became a repo needs a watcher now.
      if (next.isRepo && !entry.watcher) this.attachWatcher(entry)
    } finally {
      entry.running = false
      if (entry.again) {
        entry.again = false
        if (this.entries.get(key) === entry) void this.refresh(key)
      }
    }
  }
}

/** Ignore the timestamp so an unchanged repo produces no IPC traffic. */
function changed(a: GitState, b: GitState): boolean {
  return (
    a.isRepo !== b.isRepo ||
    a.branch !== b.branch ||
    a.head !== b.head ||
    a.detached !== b.detached ||
    a.unborn !== b.unborn ||
    a.upstream !== b.upstream ||
    a.ahead !== b.ahead ||
    a.behind !== b.behind ||
    a.staged !== b.staged ||
    a.modified !== b.modified ||
    a.untracked !== b.untracked ||
    a.conflicted !== b.conflicted ||
    a.operation !== b.operation ||
    a.error !== b.error
  )
}
