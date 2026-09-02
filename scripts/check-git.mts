/**
 * Checks the porcelain=v2 parser against real repositories.
 *
 * Every field DevLobby puts in a pane header comes out of one `git status`
 * call, so a parsing slip shows up as a wrong number rather than an error. This
 * walks a set of fixture repos covering each state and asserts the numbers.
 *
 *   npm run check:git
 *
 * Run with Node's type stripping; there is no build step involved.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GitState } from '../src/shared/types.ts'
import { readGitState, probeRepo, scanForRepos } from '../src/main/git/status.ts'
import { aggregate, groupLabel, memberName, summaryRows } from '../src/shared/git.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(process.argv[2] ?? path.join(here, '..', '.git-fixtures'))

/*
 * Stop git walking up out of the fixtures.
 *
 * They live inside DevLobby's own work tree, so without this `plain-folder` —
 * the fixture whose whole job is to not be a repository — resolves to DevLobby
 * itself, and the two assertions about it fail against whatever happens to be
 * uncommitted here. `status.ts` spreads `process.env` into every git call, so
 * setting it once here is enough and nothing in the app has to know.
 */
process.env.GIT_CEILING_DIRECTORIES = root

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
  'scan finds every work tree at the default depth',
  found.map((f) => path.basename(f)).sort(),
  ['atlas-api', 'conflicted', 'inner', 'ledger-cli', 'mercury-web']
)

// Depth is the control a declared folder exposes, so the two answers have to
// differ — otherwise turning it up does nothing and says nothing.
const shallow = await scanForRepos(root, 1)
check(
  'depth 1 stops above the nested one',
  shallow.map((f) => path.basename(f)).sort(),
  ['atlas-api', 'conflicted', 'ledger-cli', 'mercury-web']
)
check('the member limit is a budget, not a suggestion', (await scanForRepos(root, 2, 2)).length, 2)

// --- folders ---------------------------------------------------------------
// The fixture root is exactly the shape of a declared folder: several work
// trees inside something that is not one. Its header shows their sum, so the
// sum is what is checked — against the parts rather than against numbers copied
// out of the fixtures, which would only re-assert the cases above.
const members = await Promise.all(found.map((f) => readGitState(f)))
const folder = aggregate(root, members)
const sum = (pick: (m: GitState) => number): number => members.reduce((n, m) => n + pick(m), 0)

console.log(
  `\n--- folder: ${groupLabel(folder)} dirty=${folder.dirty} untracked=${folder.untracked}` +
    ` ahead=${folder.ahead} behind=${folder.behind} conflicted=${folder.conflicted}` +
    ` op=${folder.operation} branch=${folder.branch} err=${folder.error}`
)

check('folder is a repo when anything in it is', folder.isRepo, true)
check('folder counts every member', folder.members?.length, found.length)
check('folder sums dirty', folder.dirty, sum((m) => m.dirty))
check('folder sums untracked', folder.untracked, sum((m) => m.untracked))
check('folder sums ahead', folder.ahead, sum((m) => m.ahead))
check('folder sums behind', folder.behind, sum((m) => m.behind))
check('folder sums conflicted', folder.conflicted, sum((m) => m.conflicted))
// dirty is staged + modified + conflicted, and stays that way once summed.
check(
  'folder dirty stays consistent',
  folder.dirty,
  folder.staged + folder.modified + folder.conflicted
)
// One half-finished merge inside the folder is a half-finished merge in it.
check('folder surfaces an operation', folder.operation, 'merge')
// The fixtures are on different branches, so there is no one branch to name.
check('folder has no shared branch', folder.branch, null)
check('folder labels itself by count', groupLabel(folder), `${found.length} repos`)

// Repositories that agree is the case worth naming a branch for.
const agreed = aggregate(root, [
  { ...members[0], branch: 'main', detached: false, error: null, isRepo: true },
  { ...members[1], branch: 'main', detached: false, error: null, isRepo: true }
])
check('folder names a branch they share', agreed.branch, 'main')
check('folder labels itself by that branch', groupLabel(agreed), 'main')

// A repository that could not be read must not be summed as zeroes — that is
// how a folder comes to report itself clean while half of it is unreadable.
const dirtiest = members.find((m) => m.dirty > 0)!
const broken: GitState = { ...dirtiest, path: root, dirty: 0, error: 'git is not on PATH' }
const withBroken = aggregate(root, [dirtiest, broken])
check('folder leaves a broken member out of the sum', withBroken.dirty, dirtiest.dirty)
check('folder still lists the broken member', withBroken.members?.length, 2)
check('a broken member sorts to the top', summaryRows(withBroken)[0].error, 'git is not on PATH')

// An empty folder is an answer, not a missing one.
check('empty folder says so', aggregate(root, []).error, 'nothing inside')

// --- rows ------------------------------------------------------------------
const rows = summaryRows(folder)
check('a row per member', rows.length, found.length)
// A half-finished merge outranks mere dirt: it is the one you have to go and
// deal with before anything else in the folder can move.
check('worst first', rows[0].name, 'conflicted')
check('clean ones sink', rows[rows.length - 1].clean, true)
check(
  'a nested member keeps its path',
  memberName(root, path.join(root, 'nest', 'inner')),
  ['nest', 'inner'].join(path.sep)
)
check('a member is named by its own folder', memberName(root, path.join(root, 'atlas-api')), 'atlas-api')
// Case and separator both vary between what git prints and what the user typed.
check(
  'names survive a mixed-up root',
  memberName(root.toUpperCase().split(path.sep).join('/'), path.join(root, 'atlas-api')),
  'atlas-api'
)

console.log(failures === 0 ? '\nALL GIT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
