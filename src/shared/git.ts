/**
 * The pure half of git state: the empty value, and everything to do with a
 * folder that is watched for the repositories *inside* it rather than being
 * one itself.
 *
 * That second case is the reason this file exists. A folder full of projects
 * publishes one `GitState` under its own path like any repository does — the
 * counts in it are simply the sum of the repositories found inside, and the
 * states they were summed from ride along in `members` for the hover card.
 * Everything downstream (the pane header's chips, the spine colour, the
 * repository row) goes on reading one flat state and needs no idea any of this
 * happened.
 *
 * Pure on purpose: no `node:` imports and no electron, because main sums here
 * before publishing and the renderer reads the same helpers back out to label
 * a header. `npm run check:git` covers it directly for the same reason.
 */

import type { GitState } from './types'

/** Levels below a folder to look in. 1 is the folders directly inside it. */
export const MIN_SCAN_DEPTH = 1
export const MAX_SCAN_DEPTH = 3
/** Matches `Scan folder` in the repository manager, which has the same job. */
export const DEFAULT_SCAN_DEPTH = 2

/**
 * Repositories watched inside one folder.
 *
 * A budget rather than a formality: each member is a `git status` on a timer
 * and an `fs.watch` handle, so a folder pointed at a whole drive would
 * otherwise poll it for the rest of the session.
 */
export const MAX_GROUP_MEMBERS = 100

/** Rows the hover card draws before it starts counting the rest. */
export const SUMMARY_ROWS = 12

export function emptyState(repoPath: string, error: string | null = null): GitState {
  return {
    path: repoPath,
    isRepo: false,
    branch: null,
    head: null,
    detached: false,
    unborn: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicted: 0,
    dirty: 0,
    operation: null,
    error,
    at: Date.now()
  }
}

export function clampDepth(depth: number | undefined): number {
  if (typeof depth !== 'number' || !Number.isFinite(depth)) return DEFAULT_SCAN_DEPTH
  return Math.min(MAX_SCAN_DEPTH, Math.max(MIN_SCAN_DEPTH, Math.round(depth)))
}

/** True when this state is a folder's sum rather than one work tree's own. */
export function isGroup(git: GitState | null | undefined): git is GitState & {
  members: GitState[]
} {
  return Boolean(git && Array.isArray(git.members))
}

/**
 * Roll a folder's repositories up into the single state published for it.
 *
 * Only repositories that could actually be read are summed. One that errored
 * still appears in `members` — the card names it — but adding its zeroes to
 * the totals would quietly report a folder as clean because half of it is
 * unreadable.
 */
export function aggregate(root: string, members: GitState[]): GitState {
  const state = emptyState(root)
  state.members = members

  const live = members.filter((m) => m.isRepo && !m.error)
  state.isRepo = live.length > 0

  for (const m of live) {
    state.ahead += m.ahead
    state.behind += m.behind
    state.staged += m.staged
    state.modified += m.modified
    state.untracked += m.untracked
    state.conflicted += m.conflicted
    // The first half-finished operation is enough to say the folder has one;
    // which repository it is in is the card's job to say.
    state.operation ??= m.operation
  }

  state.dirty = state.staged + state.modified + state.conflicted

  // A branch name is only true of the folder when it is true of every
  // repository in it — which does happen, and is worth saying when it does.
  const branches = new Set<string>()
  let sharable = live.length > 0
  for (const m of live) {
    if (m.detached || !m.branch) {
      sharable = false
      break
    }
    branches.add(m.branch)
  }
  state.branch = sharable && branches.size === 1 ? [...branches][0] : null

  // Never reached before the first scan finishes — the watcher publishes
  // nothing for a folder until then — so an empty list really is an answer.
  if (members.length === 0) state.error = 'nothing inside'

  state.at = Date.now()
  return state
}

/**
 * What the branch slot says for a folder: the shared branch when there is one,
 * and otherwise how many repositories were summed.
 */
export function groupLabel(git: GitState): string {
  const members = isGroup(git) ? git.members : []
  if (git.branch) return git.branch
  const n = members.length
  return `${n} ${n === 1 ? 'repo' : 'repos'}`
}

/** Whether the label above is a branch name, which decides the icon. */
export function groupLabelIsBranch(git: GitState): boolean {
  return Boolean(git.branch)
}

/**
 * A member's name, relative to the folder it was found in: `atlas-api`, or
 * `client-x\api` when it was two levels down. Paths are compared without
 * regard to case or separator but sliced out of the original, so what is shown
 * is what is on disk.
 */
export function memberName(root: string, memberPath: string): string {
  const r = trimSlash(root)
  const m = trimSlash(memberPath)
  if (comparable(m).startsWith(comparable(r) + '\\')) {
    const rel = m.slice(r.length + 1)
    if (rel) return rel
  }
  return lastSegment(m) || m
}

/** What a repository's branch column reads, whatever state it is in. */
export function branchText(git: GitState): string {
  if (git.error) return git.error
  if (!git.isRepo) return 'not a repo'
  if (git.detached) return `detached ${git.head ?? ''}`.trim()
  return git.branch ?? git.head ?? '—'
}

export type SummaryRow = {
  /** Absolute path, so a row can be told apart from a same-named sibling. */
  path: string
  /** Name relative to the folder. */
  name: string
  branch: string
  dirty: number
  untracked: number
  conflicted: number
  ahead: number
  behind: number
  operation: GitState['operation']
  error: string | null
  /** Nothing owed and nothing to sync. */
  clean: boolean
}

/**
 * The folder's repositories, worst first.
 *
 * The order is the point: a folder of thirty projects is read by looking at
 * the top of the list, so anything unreadable or half-merged comes first, then
 * whatever owes the most, and the clean ones settle alphabetically at the
 * bottom where they can be summarised away by a count.
 */
export function summaryRows(git: GitState): SummaryRow[] {
  if (!isGroup(git)) return []
  const root = git.path

  const rows = git.members.map((m): SummaryRow => {
    const broken = Boolean(m.error) || !m.isRepo
    return {
      path: m.path,
      name: memberName(root, m.path),
      branch: branchText(m),
      dirty: m.dirty,
      untracked: m.untracked,
      conflicted: m.conflicted,
      ahead: m.ahead,
      behind: m.behind,
      operation: m.operation,
      error: m.error,
      clean:
        !broken &&
        m.dirty === 0 &&
        m.untracked === 0 &&
        m.ahead === 0 &&
        m.behind === 0 &&
        !m.operation
    }
  })

  return rows.sort((a, b) => {
    const w = weight(b) - weight(a)
    if (w !== 0) return w
    return a.name.localeCompare(b.name)
  })
}

function weight(row: SummaryRow): number {
  // Unreadable outranks everything: a folder cannot be called clean while one
  // of the repositories in it could not be read at all.
  if (row.error) return Number.MAX_SAFE_INTEGER
  if (row.operation) return 1e12
  return row.conflicted * 1e9 + (row.dirty + row.untracked) * 1e4 + row.ahead + row.behind
}

// ---------------------------------------------------------------------------

/**
 * Windows paths, matching `normalisePath` in the renderer's store: separators
 * folded one way and case dropped, because `C:\Dev` and `c:/dev` are the same
 * folder and the two halves of the app have to agree on that.
 */
function comparable(p: string): string {
  return p.replace(/\//g, '\\').toLowerCase()
}

function trimSlash(p: string): string {
  return p.replace(/[\\/]+$/, '')
}

function lastSegment(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}
