/**
 * Checks the porcelain=v2 parser against real repositories.
 *
 * Every field DevMuxel puts in a pane header comes out of one `git status`
 * call, so a parsing slip shows up as a wrong number rather than an error. This
 * walks a set of fixture repos covering each state and asserts the numbers.
 *
 *   npm run check:git
 *
 * Run with Node's type stripping; there is no build step involved.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readGitState, probeRepo, scanForRepos } from '../src/main/git/status.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = process.argv[2] ?? path.join(here, '..', '.git-fixtures')

const cases = ['atlas-api', 'ledger-cli', 'mercury-web', 'conflicted', 'plain-folder', 'does-not-exist']

let failures = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
}

for (const name of cases) {
  const p = path.join(root, name)
  const s = await readGitState(p)
  console.log(
    `\n--- ${name}\n    isRepo=${s.isRepo} branch=${s.branch} detached=${s.detached} upstream=${s.upstream}` +
      ` ahead=${s.ahead} behind=${s.behind} staged=${s.staged} modified=${s.modified}` +
      ` untracked=${s.untracked} conflicted=${s.conflicted} dirty=${s.dirty} op=${s.operation} err=${s.error}`
  )

  if (name === 'atlas-api') {
    check('atlas branch', s.branch, 'feat/webhook-retry')
    check('atlas ahead', s.ahead, 2)
    check('atlas behind', s.behind, 0)
    check('atlas staged', s.staged, 1)
    check('atlas modified', s.modified, 1)
    check('atlas untracked', s.untracked, 3)
    check('atlas conflicted', s.conflicted, 0)
    check('atlas dirty', s.dirty, 2)
    check('atlas upstream', s.upstream, 'origin/feat/webhook-retry')
  }
  if (name === 'ledger-cli') {
    check('ledger branch', s.branch, 'fix/tz-parse')
    check('ledger dirty', s.dirty, 0)
    check('ledger untracked', s.untracked, 0)
    check('ledger ahead/behind', [s.ahead, s.behind], [0, 0])
  }
  if (name === 'mercury-web') {
    check('mercury behind', s.behind, 1)
    check('mercury modified', s.modified, 1)
  }
  if (name === 'conflicted') {
    check('conflicted count', s.conflicted, 1)
    check('conflicted op', s.operation, 'merge')
    check('conflicted dirty>0', s.dirty > 0, true)
  }
  if (name === 'plain-folder') {
    check('plain isRepo', s.isRepo, false)
    check('plain error', s.error, null)
  }
  if (name === 'does-not-exist') {
    check('missing isRepo', s.isRepo, false)
    check('missing error', s.error, 'folder is missing')
  }
}

// --- probe -----------------------------------------------------------------
const probe = await probeRepo(path.join(root, 'atlas-api'))
console.log('\n--- probe atlas-api:', JSON.stringify(probe))
check('probe isRepo', probe.isRepo, true)
check('probe name', probe.name, 'atlas-api')
check('probe worktree', probe.worktree, false)
check('probe submodule', probe.submodule, false)

const probeSub = await probeRepo(path.join(root, 'atlas-api', 'sub'))
console.log('--- probe atlas-api/sub:', JSON.stringify(probeSub))
check('probe subdir resolves to root', probeSub.name, 'atlas-api')

const probePlain = await probeRepo(path.join(root, 'plain-folder'))
check('probe plain not a repo', probePlain.isRepo, false)

// --- scan ------------------------------------------------------------------
const found = await scanForRepos(root)
console.log('\n--- scan:', JSON.stringify(found.map((f) => path.basename(f))))
check(
  'scan finds the four work trees',
  found.map((f) => path.basename(f)).sort(),
  ['atlas-api', 'conflicted', 'ledger-cli', 'mercury-web']
)

console.log(failures === 0 ? '\nALL GIT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
