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
 *
 * A declared path may also be a **folder of repositories** rather than one
 * work tree, which is what the two maps below are for. `units` is every work
 * tree actually polled — declared directly, or found inside a folder, or both.
 * `groups` is the folders, each holding the units it sums. Reading a unit
 * publishes its own state if it was declared, and re-sums every folder
 * counting it in; that sum is what the renderer sees under the folder's path,
 * and `shared/git.ts` does the summing.
 *
 * The cost of a folder is the thing to keep an eye on: thirty repositories is
 * thirty `git status` calls and thirty watch handles. Three things hold that
 * down — `MAX_GROUP_MEMBERS` caps the membership, members poll on a floor of
 * their own rather than the window's interval (their `.git` watches keep them
 * responsive without it), and that floor is jittered per path so they do not
 * all come due on the same tick for the rest of the session.
 */

import { watch, promises as fs, type FSWatcher } from 'node:fs'
import path from 'node:path'
import type { GitState, WatchedRepo } from '../../shared/types'
import { aggregate, clampDepth, emptyState, MAX_GROUP_MEMBERS } from '../../shared/git'
import { forgetRepo, readGitState, scanForRepos } from './status'

/** One work tree being polled. */
type Unit = {
  /** Normalised, cased as it is on disk — this is what gets published. */
  repoPath: string
  /** Repo ids declaring this exact path. Empty means it is only a member. */
  refs: Set<string>
  /** Keys of the folders that sum this path. */
  groups: Set<string>
  state: GitState
  running: boolean
  /** A change arrived while a read was running. */
  again: boolean
  /** Offset into the member poll floor, so members do not come due together. */
  jitter: number
  watcher: FSWatcher | null
  debounce: NodeJS.Timeout | null
}

/** A repository found inside a folder: its map key, and its path on disk. */
type Member = { key: string; path: string }

/** One declared folder, and the units it sums. */
type Group = {
  root: string
  depth: number
  /** In the order `scanForRepos` returned them, which is sorted and stable. */
  members: Member[]
  state: GitState
  /** Nothing is published for a folder until its first walk finishes. */
  scanned: boolean
  scanning: boolean
  scannedAt: number
  /** Watch on the folder itself, so a fresh clone inside it is noticed. */
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

/**
 * The fastest a repository found inside a folder is re-read.
 *
 * Deliberately slower than the window's own poll interval. A folder can hold
 * dozens of repositories and the timer fires them all at once, so honouring a
 * 5-second interval across thirty of them would mean six `git status` calls a
 * second for as long as the app is open. Each member still has an `fs.watch`
 * on its `.git`, so anything you actually do in one shows up immediately and
 * this is only the backstop.
 */
const MEMBER_POLL_FLOOR_MS = 15_000

/** How often a folder is walked again looking for repositories it has gained. */
const RESCAN_EVERY_MS = 5 * 60_000

/** A clone writes a lot of files; let it finish before asking what it is. */
const RESCAN_DEBOUNCE_MS = 900

/**
 * Spacing between the first read of each unit a scan turns up.
 *
 * The steady state is handled by the jitter on the poll floor, but the moment
 * a scan lands there is nothing to stagger — every member is equally stale, so
 * without this a hundred `git status` processes start in the same tick.
 */
const FIRST_READ_STAGGER_MS = 80

export class GitWatcher {
  private units = new Map<string, Unit>()
  private groups = new Map<string, Group>()
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
  setRepos(repos: WatchedRepo[]): void {
    const wantedGroups = new Map<string, { root: string; depth: number }>()
    const declared = new Map<string, { path: string; refs: Set<string> }>()

    for (const r of repos) {
      if (!r.path) continue
      const root = path.normalize(r.path)
      const k = key(root)
      if (r.scan) {
        // Last declaration of a path wins its depth. Two repos on one folder is
        // already a degenerate case, and the alternative is walking it twice.
        wantedGroups.set(k, { root, depth: clampDepth(r.scanDepth) })
      } else {
        const entry = declared.get(k) ?? { path: root, refs: new Set<string>() }
        entry.refs.add(r.id)
        declared.set(k, entry)
      }
    }

    for (const [k, group] of this.groups) {
      const wanted = wantedGroups.get(k)
      if (!wanted) {
        this.teardownGroup(group)
        this.groups.delete(k)
        continue
      }
      // A folder looked at one level deeper is a different set of members, so
      // it has to be walked again before its sum means anything.
      if (wanted.depth !== group.depth) {
        group.depth = wanted.depth
        group.scannedAt = 0
      }
    }

    for (const [k, wanted] of wantedGroups) {
      if (this.groups.has(k)) continue
      const group: Group = {
        root: wanted.root,
        depth: wanted.depth,
        members: [],
        state: emptyState(wanted.root),
        scanned: false,
        scanning: false,
        scannedAt: 0,
        watcher: null,
        debounce: null
      }
      this.groups.set(k, group)
      this.attachGroupWatcher(group)
    }

    this.reconcileUnits(declared)

    // The walks go last, so a folder whose members are already units from an
    // earlier declaration keeps them through the reconcile above.
    for (const group of this.groups.values()) {
      if (group.scannedAt === 0) void this.rescan(group.root)
    }
  }

  /** Cached state for every declared path: work trees and folders alike. */
  snapshot(): Record<string, GitState> {
    const out: Record<string, GitState> = {}
    for (const [k, unit] of this.units) {
      if (unit.refs.size > 0) out[k] = unit.state
    }
    for (const [k, group] of this.groups) {
      if (group.scanned) out[k] = group.state
    }
    return out
  }

  setFocused(focused: boolean): void {
    if (this.focused === focused) return
    this.focused = focused
    this.restartTimer()
    // Coming back to the window is exactly when stale data is most obvious.
    if (focused) this.refreshAll()
  }

  /**
   * Re-read everything due. `rescan` additionally walks every folder again,
   * which is what the Refresh button means by it — the timer's own ticks leave
   * that to `RESCAN_EVERY_MS`.
   */
  refreshAll(rescan = false): void {
    const now = Date.now()
    for (const [k, unit] of this.units) {
      if (rescan || this.due(unit, now)) void this.refresh(k)
    }
    for (const group of this.groups.values()) {
      if (rescan || now - group.scannedAt >= RESCAN_EVERY_MS) void this.rescan(group.root)
    }
  }

  async refreshOne(repoPath: string): Promise<GitState | null> {
    const k = key(repoPath)

    const group = this.groups.get(k)
    if (group) {
      await this.rescan(group.root)
      await Promise.all(group.members.map((m) => this.refresh(m.key)))
      return this.groups.get(k)?.state ?? null
    }

    if (!this.units.has(k)) return null
    await this.refresh(k)
    return this.units.get(k)?.state ?? null
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const unit of this.units.values()) this.teardown(unit)
    for (const group of this.groups.values()) this.teardownGroup(group)
    this.units.clear()
    this.groups.clear()
  }

  // -------------------------------------------------------------------------

  private restartTimer(): void {
    if (this.timer) clearInterval(this.timer)
    const every = this.focused ? this.opts.focusedIntervalMs : this.opts.blurredIntervalMs
    this.timer = setInterval(() => this.refreshAll(), Math.max(1000, every))
    // A background timer must never hold the app open.
    this.timer.unref?.()
  }

  /**
   * Whether this unit is due a read on this tick.
   *
   * A declared repository is read every time, as it always has been. One that
   * is only a member of a folder waits for its own floor — see the constant.
   */
  private due(unit: Unit, now: number): boolean {
    if (unit.refs.size > 0) return true
    return now - unit.state.at >= MEMBER_POLL_FLOOR_MS + unit.jitter
  }

  // --- units ---------------------------------------------------------------

  /**
   * Bring `units` in line with what the declared paths and the folders' current
   * membership add up to, keeping the state and the watch handle of every
   * survivor.
   *
   * The one place that decides what is polled, so a member two folders both
   * claim is not torn down when one of them loses it.
   */
  private reconcileUnits(declared: Map<string, { path: string; refs: Set<string> }>): void {
    const wanted = new Map<string, { repoPath: string; refs: Set<string>; groups: Set<string> }>()

    for (const [k, entry] of declared) {
      wanted.set(k, { repoPath: entry.path, refs: entry.refs, groups: new Set() })
    }

    for (const [gk, group] of this.groups) {
      for (const member of group.members) {
        const existing = wanted.get(member.key)
        if (existing) {
          existing.groups.add(gk)
          continue
        }
        wanted.set(member.key, {
          repoPath: member.path,
          refs: new Set(),
          groups: new Set([gk])
        })
      }
    }

    for (const [k, unit] of this.units) {
      if (wanted.has(k)) continue
      this.teardown(unit)
      this.units.delete(k)
      forgetRepo(unit.repoPath)
    }

    let fresh = 0
    for (const [k, want] of wanted) {
      const existing = this.units.get(k)
      if (existing) {
        existing.refs = want.refs
        existing.groups = want.groups
        continue
      }
      const unit: Unit = {
        repoPath: want.repoPath,
        refs: want.refs,
        groups: want.groups,
        state: emptyState(want.repoPath),
        running: false,
        again: false,
        jitter: jitterFor(k),
        watcher: null,
        debounce: null
      }
      this.units.set(k, unit)
      this.attachWatcher(unit)
      // Spaced out rather than fired together: a folder of a hundred
      // repositories would otherwise start a hundred processes at once.
      const first = setTimeout(
        () => void this.refresh(k, true),
        Math.min(fresh, 60) * FIRST_READ_STAGGER_MS
      )
      first.unref?.()
      fresh += 1
    }
  }

  private attachWatcher(unit: Unit): void {
    const gitDir = path.join(unit.repoPath, '.git')
    try {
      // Non-recursive: we only care about the handful of files in .git itself,
      // and recursive watching of refs/ on a busy repo is a firehose.
      unit.watcher = watch(gitDir, { persistent: false }, (_event, filename) => {
        const name = typeof filename === 'string' ? filename : String(filename ?? '')
        if (name && !INTERESTING.test(name) && !name.startsWith('refs')) return
        if (unit.debounce) clearTimeout(unit.debounce)
        // git writes index.lock then renames; wait for the dust to settle.
        unit.debounce = setTimeout(() => void this.refresh(key(unit.repoPath)), 280)
        unit.debounce.unref?.()
      })
      unit.watcher.on('error', () => {
        unit.watcher?.close()
        unit.watcher = null
      })
    } catch {
      // Not a repo yet, or a worktree with a .git file rather than a directory.
      unit.watcher = null
    }
  }

  private teardown(unit: Unit): void {
    if (unit.debounce) clearTimeout(unit.debounce)
    unit.debounce = null
    try {
      unit.watcher?.close()
    } catch {
      /* already gone */
    }
    unit.watcher = null
  }

  private async refresh(k: string, force = false): Promise<void> {
    if (this.disposed) return
    const unit = this.units.get(k)
    if (!unit) return

    if (unit.running) {
      unit.again = true
      return
    }

    unit.running = true
    try {
      const next = await readGitState(unit.repoPath)

      // The await above is long enough for setRepos() to have removed this
      // repository. Publishing its state — or worse, re-attaching a watcher to
      // an entry nobody holds any more — would leak a handle for the rest of
      // the session.
      if (this.disposed || this.units.get(k) !== unit) return

      const moved = changed(unit.state, next)
      unit.state = next
      if (unit.refs.size > 0 && (force || moved)) this.opts.onUpdate(unit.repoPath, next)
      // A folder's sum is only worth recomputing when a member actually moved
      // — but a forced first read has moved it from nothing to something.
      if (force || moved) {
        for (const gk of unit.groups) this.publishGroup(gk)
      }

      // A folder that only just became a repo needs a watcher now.
      if (next.isRepo && !unit.watcher) this.attachWatcher(unit)
    } finally {
      unit.running = false
      if (unit.again) {
        unit.again = false
        if (this.units.get(k) === unit) void this.refresh(k)
      }
    }
  }

  // --- groups --------------------------------------------------------------

  private attachGroupWatcher(group: Group): void {
    try {
      // Non-recursive, so this sees a repository appearing or disappearing
      // directly inside the folder and nothing of what goes on within one.
      // Anything deeper waits for the backstop rescan, which is the right
      // trade: cloning into a sub-folder is rarer than cloning into the folder
      // itself, and a recursive watch here would follow every build directory
      // underneath it.
      group.watcher = watch(group.root, { persistent: false }, () => {
        if (group.debounce) clearTimeout(group.debounce)
        group.debounce = setTimeout(() => void this.rescan(group.root), RESCAN_DEBOUNCE_MS)
        group.debounce.unref?.()
      })
      group.watcher.on('error', () => {
        group.watcher?.close()
        group.watcher = null
      })
    } catch {
      // The folder is gone, or was never there. `rescan` is what says so.
      group.watcher = null
    }
  }

  private teardownGroup(group: Group): void {
    if (group.debounce) clearTimeout(group.debounce)
    group.debounce = null
    try {
      group.watcher?.close()
    } catch {
      /* already gone */
    }
    group.watcher = null
  }

  /** Walk a folder again and bring its membership up to date. */
  private async rescan(root: string): Promise<void> {
    if (this.disposed) return
    const k = key(root)
    const group = this.groups.get(k)
    if (!group || group.scanning) return

    group.scanning = true
    try {
      const found = await scanForRepos(group.root, group.depth, MAX_GROUP_MEMBERS)
      if (this.disposed || this.groups.get(k) !== group) return

      group.scannedAt = Date.now()

      const members: Member[] = found.map((p) => {
        const normalised = path.normalize(p)
        return { key: key(normalised), path: normalised }
      })
      const same =
        members.length === group.members.length &&
        members.every((m, i) => m.key === group.members[i].key)

      group.members = members

      // A member arriving or leaving changes which paths are polled at all.
      if (!same) this.rebuildUnits()

      // A folder that is not there says so, rather than reporting itself as
      // empty — those are different problems, and only one of them is yours.
      if (members.length === 0 && !(await isDirectory(group.root))) {
        if (this.disposed || this.groups.get(k) !== group) return
        const next = emptyState(group.root, 'folder is missing')
        next.members = []
        const first = !group.scanned
        group.scanned = true
        if (first || changed(group.state, next)) {
          group.state = next
          this.opts.onUpdate(group.root, next)
        }
        return
      }

      // A folder that did not exist when it was declared has no watcher, and
      // the backstop rescan is the only thing that would ever have found it.
      // Now that it is there, watch it like any other.
      if (!group.watcher) this.attachGroupWatcher(group)

      const first = !group.scanned
      group.scanned = true
      this.publishGroup(k, first)
    } finally {
      group.scanning = false
    }
  }

  /** Re-derive the polled set after a folder's membership moved. */
  private rebuildUnits(): void {
    const declared = new Map<string, { path: string; refs: Set<string> }>()
    for (const [k, unit] of this.units) {
      if (unit.refs.size > 0) declared.set(k, { path: unit.repoPath, refs: unit.refs })
    }
    this.reconcileUnits(declared)
  }

  /** Re-sum a folder and push it at the renderer if the answer moved. */
  private publishGroup(k: string, force = false): void {
    const group = this.groups.get(k)
    if (!group || !group.scanned) return

    const members = group.members
      .map((m) => this.units.get(m.key)?.state)
      .filter((s): s is GitState => Boolean(s))

    const next = aggregate(group.root, members)
    if (!force && !changed(group.state, next)) return
    group.state = next
    this.opts.onUpdate(group.root, next)
  }
}

// ---------------------------------------------------------------------------

/**
 * Map key for a path. Case-folded as well as normalised, because a folder's
 * scan turns up `C:\Dev\api` where the user may well have declared `c:\dev\api`
 * — and two units on one work tree is two pollers fighting over it.
 */
function key(p: string): string {
  return path.normalize(p).toLowerCase()
}

/**
 * A stable offset into the member poll floor, derived from the path so it
 * survives a rescan. Without it every member of a folder comes due on the same
 * tick for ever, which is the burst the floor exists to prevent.
 */
function jitterFor(k: string): number {
  let h = 0
  for (let i = 0; i < k.length; i += 1) h = (h * 31 + k.charCodeAt(i)) | 0
  return Math.abs(h) % MEMBER_POLL_FLOOR_MS
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

/** Ignore the timestamp so an unchanged repo produces no IPC traffic. */
function changed(a: GitState, b: GitState): boolean {
  return fieldsChanged(a, b) || membersChanged(a.members, b.members)
}

function fieldsChanged(a: GitState, b: GitState): boolean {
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

/**
 * A folder's sum can be identical while the repositories under it are not —
 * one gaining a commit as another loses one, or simply changing branch. The
 * card names them one by one, so the members are part of what changed.
 */
function membersChanged(a: GitState[] | undefined, b: GitState[] | undefined): boolean {
  if (!a || !b) return Boolean(a) !== Boolean(b)
  if (a.length !== b.length) return true
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].path !== b[i].path) return true
    if (fieldsChanged(a[i], b[i])) return true
  }
  return false
}
