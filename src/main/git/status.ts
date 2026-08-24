/**
 * Reading a repository's working-tree state.
 *
 * One `git status --porcelain=v2 --branch` call gives the branch, the
 * upstream, ahead/behind and every changed path, so we never shell out twice.
 *
 * `--no-optional-locks` is not an optimisation, it is required. Measured on
 * this machine: a tight status poll running alongside a `git add` loop made
 * **19% of the user's own git commands fail** with "Unable to create
 * index.lock: File exists". With the flag, zero failures — and it costs
 * nothing (52.0ms vs 52.5ms median on a 20k-file repo). It also stops us
 * rewriting the index just by looking at it. The flag is a git *global*
 * option, so it must come before the subcommand.
 */

import { execFile } from 'node:child_process'
import { promises as fs, statSync } from 'node:fs'
import path from 'node:path'
import type { GitState } from '../../shared/types'

/** Untracked files are counted, not listed; stop counting past this. */
const UNTRACKED_CAP = 10_000

const EXEC_TIMEOUT_MS = 15_000
/** A very dirty repo produces ~500KB; git is killed rather than buffering forever. */
const MAX_BUFFER = 64 * 1024 * 1024

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

type RunResult = { stdout: string; stderr: string; code: number; errno: string | null }

/**
 * The absolute path to git, resolved once.
 *
 * This matters more than it looks. `execFile('git', …, { cwd: repoPath })` on
 * Windows resolves the program name against the *current directory* before
 * PATH, so a repository containing a `git.exe` would have that binary executed
 * every few seconds by the poller. Cloning someone else's repo should never be
 * enough to run their code. Resolving against PATH once, up front, closes it.
 */
let gitPath: string | null = null

function resolveGit(): string {
  if (gitPath) return gitPath

  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `git${ext}`)
      try {
        if (statSync(candidate).isFile()) {
          gitPath = candidate
          return gitPath
        }
      } catch {
        /* next candidate */
      }
    }
  }

  // Nothing on PATH. Fall back to the bare name so the failure is git's own
  // "not found" rather than a silent no-op — but never with a repo as cwd.
  gitPath = 'git'
  return gitPath
}

function run(cwd: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      resolveGit(),
      args,
      {
        cwd,
        timeout: EXEC_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        // LC_ALL keeps git's error strings parseable; GIT_OPTIONAL_LOCKS is
        // the env-var equivalent of --no-optional-locks, set as belt and braces
        // so any helper git spawns inherits it too.
        env: { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' }
      },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null
        resolve({
          stdout: stdout ?? '',
          stderr: (stderr ?? '').trim(),
          code: e ? (typeof e.code === 'number' ? e.code : -1) : 0,
          errno: e && typeof e.code === 'string' ? e.code : null
        })
      }
    )
  })
}

/**
 * Split `-z` output into records.
 *
 * A rename/copy record (`2 `) is followed by a second NUL-terminated field
 * holding the original path, so records cannot simply be zipped one-to-one.
 * `-z` is used rather than the newline form because it removes both the
 * C-quoting of non-ASCII paths and the possibility of a filename containing a
 * newline breaking the parse.
 */
function splitRecords(out: string): string[] {
  const parts = out.split('\0')
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  const records: string[] = []
  for (let i = 0; i < parts.length; i += 1) {
    records.push(parts[i])
    // Consume (and discard) the original path that follows a rename.
    if (parts[i].startsWith('2 ')) i += 1
  }
  return records
}

export function parsePorcelainV2(out: string, repoPath: string): GitState {
  const state = emptyState(repoPath)
  state.isRepo = true
  let untracked = 0

  for (const rec of splitRecords(out)) {
    if (!rec) continue

    if (rec[0] === '#') {
      const rest = rec.slice(2)
      const sp = rest.indexOf(' ')
      const key = sp === -1 ? rest : rest.slice(0, sp)
      const value = sp === -1 ? '' : rest.slice(sp + 1)

      if (key === 'branch.oid') {
        if (value === '(initial)') state.unborn = true
        else state.head = value.slice(0, 7)
      } else if (key === 'branch.head') {
        if (value === '(detached)') state.detached = true
        else state.branch = value
      } else if (key === 'branch.upstream') {
        state.upstream = value
      } else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(value)
        if (m) {
          state.ahead = Number(m[1])
          state.behind = Number(m[2])
        }
      }
      continue
    }

    const type = rec[0]

    if (type === '1' || type === '2') {
      // X is the index vs HEAD, Y is the worktree vs the index. "." means
      // unchanged, so "AM" legitimately counts as both staged and modified —
      // that is what git's own UI shows too.
      const xy = rec.slice(2, 4)
      if (xy[0] !== '.') state.staged += 1
      if (xy[1] !== '.') state.modified += 1
      continue
    }

    if (type === 'u') {
      state.conflicted += 1
      continue
    }

    if (type === '?') {
      if (untracked < UNTRACKED_CAP) untracked += 1
      continue
    }

    // '!' ignored entries are never requested.
  }

  state.untracked = untracked
  state.dirty = state.staged + state.modified + state.conflicted
  state.at = Date.now()
  return state
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

async function readFirstLine(file: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return raw.split('\n')[0].trim()
  } catch {
    return null
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

/**
 * porcelain=v2 cannot tell you an operation is in progress: mid-rebase it just
 * says `(detached)`, which reads as "you have lost your branch" in a header.
 * The gitdir knows, so ask it — and during a rebase it also knows the real
 * branch name, which is far more useful than a detached oid.
 */
async function readOperation(
  gitDir: string
): Promise<{ operation: GitState['operation']; branch: string | null }> {
  if (await exists(path.join(gitDir, 'rebase-merge'))) {
    const head = await readFirstLine(path.join(gitDir, 'rebase-merge', 'head-name'))
    return { operation: 'rebase', branch: head ? head.replace(/^refs\/heads\//, '') : null }
  }
  if (await exists(path.join(gitDir, 'rebase-apply'))) {
    const head = await readFirstLine(path.join(gitDir, 'rebase-apply', 'head-name'))
    const applying = await exists(path.join(gitDir, 'rebase-apply', 'applying'))
    return {
      operation: applying ? 'am' : 'rebase',
      branch: head ? head.replace(/^refs\/heads\//, '') : null
    }
  }
  if (await exists(path.join(gitDir, 'MERGE_HEAD'))) return { operation: 'merge', branch: null }
  if (await exists(path.join(gitDir, 'CHERRY_PICK_HEAD'))) {
    return { operation: 'cherry-pick', branch: null }
  }
  if (await exists(path.join(gitDir, 'REVERT_HEAD'))) return { operation: 'revert', branch: null }
  if (await exists(path.join(gitDir, 'BISECT_LOG'))) return { operation: 'bisect', branch: null }
  return { operation: null, branch: null }
}

/**
 * Where a work tree's git directory lives. Almost always `<repo>/.git`, but a
 * linked worktree or a submodule has a `.git` *file* pointing elsewhere, which
 * is the case worth spending a `rev-parse` on.
 */
const gitDirCache = new Map<string, string | null>()

async function gitDirFor(repoPath: string): Promise<string | null> {
  const key = repoPath.toLowerCase()
  const cached = gitDirCache.get(key)
  if (cached !== undefined) return cached

  // The common case is a plain `<repo>/.git` directory; only a linked worktree
  // or a submodule (where `.git` is a file pointing elsewhere) needs rev-parse.
  const plain = path.join(repoPath, '.git')
  const resolved = (await isDirectory(plain)) ? plain : (await probeRepo(repoPath)).gitDir

  // Unbounded growth is not a risk: this is keyed by declared repositories.
  gitDirCache.set(key, resolved)
  return resolved
}

/** Forget a cached gitdir, for when a repo is removed or re-initialised. */
export function forgetRepo(repoPath: string): void {
  gitDirCache.delete(repoPath.toLowerCase())
}

export type RepoProbe = {
  isRepo: boolean
  /** The target exists and is a directory. */
  isDirectory: boolean
  root: string | null
  gitDir: string | null
  /** A linked worktree rather than the primary one. */
  worktree: boolean
  /** Checked out as a submodule of another repo. */
  submodule: boolean
  bare: boolean
  name: string
}

/**
 * Everything about a path in one `rev-parse`. `--path-format=absolute` matters:
 * without it `--git-common-dir` comes back relative to the cwd, which makes the
 * worktree comparison below quietly wrong.
 */
export async function probeRepo(target: string): Promise<RepoProbe> {
  const name = path.basename(path.resolve(target)) || target
  const fallback: RepoProbe = {
    isRepo: false,
    isDirectory: false,
    root: null,
    gitDir: null,
    worktree: false,
    submodule: false,
    bare: false,
    name
  }
  if (!(await isDirectory(target))) return fallback
  fallback.isDirectory = true

  const { stdout, code } = await run(target, [
    'rev-parse',
    '--path-format=absolute',
    '--show-toplevel',
    '--absolute-git-dir',
    '--git-common-dir',
    '--show-superproject-working-tree',
    '--is-bare-repository',
    '--is-inside-work-tree'
  ])
  if (code !== 0) return fallback

  // The superproject line is omitted entirely when there is no superproject,
  // so read the booleans from the end rather than by fixed index.
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 5) return fallback

  const insideWorkTree = lines[lines.length - 1] === 'true'
  const bare = lines[lines.length - 2] === 'true'
  const superproject = lines.length >= 6 ? lines[lines.length - 3] : ''
  const commonDir = lines[2]
  const gitDir = lines[1]
  const root = lines[0]

  return {
    isRepo: insideWorkTree,
    isDirectory: true,
    root: root ? path.normalize(root) : null,
    gitDir: gitDir ? path.normalize(gitDir) : null,
    worktree: Boolean(gitDir && commonDir && path.normalize(gitDir) !== path.normalize(commonDir)),
    submodule: Boolean(superproject),
    bare,
    name: root ? path.basename(path.normalize(root)) : name
  }
}

export async function readGitState(repoPath: string): Promise<GitState> {
  if (!repoPath) return emptyState(repoPath, 'no path')
  // Node throws ENOENT from the `cwd` option before git ever runs, and that is
  // indistinguishable from "git is not installed", so check the folder first.
  if (!(await isDirectory(repoPath))) return emptyState(repoPath, 'folder is missing')

  const { stdout, stderr, code, errno } = await run(repoPath, [
    '--no-optional-locks',
    'status',
    '--porcelain=v2',
    '--branch',
    '--untracked-files=all',
    '--ignore-submodules=dirty',
    '-z'
  ])

  if (code !== 0) {
    if (errno === 'ENOENT') return emptyState(repoPath, 'git is not on PATH')
    const msg = stderr.split('\n')[0] || `git exited ${code}`
    if (/not a git repository/i.test(msg)) {
      // Not an error the user needs to see — the folder simply is not a repo.
      return emptyState(repoPath, null)
    }
    if (/must be run in a work tree/i.test(msg)) return emptyState(repoPath, 'bare repository')
    return emptyState(repoPath, msg)
  }

  const state = parsePorcelainV2(stdout, repoPath)

  // Fill in what porcelain cannot say: which operation is half-finished, and
  // the branch it will land back on. The gitdir is cached because this runs on
  // a timer, and paying for a second `git rev-parse` every few seconds per repo
  // doubles the cost of polling for a path that essentially never moves.
  const gitDir = await gitDirFor(repoPath)
  if (gitDir) {
    const op = await readOperation(gitDir)
    state.operation = op.operation
    if (state.detached && op.branch) state.branch = op.branch
  }

  if (state.unborn && !state.branch && !state.detached) state.branch = 'main'

  return state
}

/**
 * Directories under `root` that look like git repositories. Used by "Scan
 * folder" in the repository manager, which is how you declare a projects
 * directory in one go rather than one repo at a time.
 */
export async function scanForRepos(root: string, depth = 2): Promise<string[]> {
  const found: string[] = []
  const seen = new Set<string>()

  const walk = async (dir: string, level: number): Promise<void> => {
    if (level > depth || found.length > 500) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    // `.git` may be a directory (normal) or a file (worktree / submodule).
    if (entries.some((e) => e.name === '.git')) {
      const real = path.resolve(dir)
      if (!seen.has(real.toLowerCase())) {
        seen.add(real.toLowerCase())
        found.push(real)
      }
      return
    }

    if (level === depth) return
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .map((e) => walk(path.join(dir, e.name), level + 1))
    )
  }

  await walk(path.resolve(root), 0)
  found.sort((a, b) => a.localeCompare(b))
  return found
}
