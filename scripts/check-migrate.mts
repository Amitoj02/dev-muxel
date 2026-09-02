/**
 * Checks the profile migration across both renames, GRID -> DevMuxel -> DevLobby.
 *
 * It runs before anything opens a file in userData, on every launch, against a
 * directory holding the user's repositories and layout — so the things worth
 * asserting are that it moves everything across exactly once, from whichever
 * old name the install is sitting at, and that it never destroys a profile that
 * is already there.
 *
 *   npm run check:migrate
 *
 * Run with Node's type stripping; there is no build step involved.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LEGACY_APP_NAMES, legacySkillDirs, migrateProfile } from '../src/main/migrate.ts'

let failures = 0
function check(name: string, ok: boolean): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) failures++
}

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lobbymig-'))
}

/** A profile as some earlier version of the app left it. */
function seedProfile(dir: string, slug: string, marker: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${slug}-state.json`), `{"repos":["${marker}"]}`)
  fs.writeFileSync(path.join(dir, `${slug}-state.bak.json`), '{"repos":[]}')
  fs.writeFileSync(path.join(dir, 'window.json'), '{"width":1440}')
  fs.mkdirSync(path.join(dir, 'captures'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'captures', `${marker}.md`), `a ${marker} capture`)
  fs.mkdirSync(path.join(dir, 'Partitions', `${slug}-browser`), { recursive: true })
  fs.writeFileSync(path.join(dir, 'Partitions', `${slug}-browser`, 'Cookies'), `session=${marker}`)
}

const read = (p: string): string => fs.readFileSync(p, 'utf8')
const has = (p: string): boolean => fs.existsSync(p)

/** What the app itself passes, so the test exercises the real precedence. */
function oldDirs(base: string): string[] {
  return LEGACY_APP_NAMES.map((name) => path.join(base, name))
}

// --- 1. the ordinary upgrade from DevMuxel -----------------------------------
{
  const base = tmp()
  const newDir = path.join(base, 'DevLobby')
  seedProfile(path.join(base, 'DevMuxel'), 'devmuxel', 'atlas-api')

  migrateProfile(oldDirs(base), newDir)

  check('devmuxel: the old profile is gone', !has(path.join(base, 'DevMuxel')))
  check('devmuxel: state arrives under the new name', has(path.join(newDir, 'devlobby-state.json')))
  check(
    'devmuxel: and keeps its contents',
    read(path.join(newDir, 'devlobby-state.json')).includes('atlas-api')
  )
  check('devmuxel: the backup is renamed too', has(path.join(newDir, 'devlobby-state.bak.json')))
  check('devmuxel: no old state name survives', !has(path.join(newDir, 'devmuxel-state.json')))
  check(
    'devmuxel: window bounds come across untouched',
    read(path.join(newDir, 'window.json')).includes('1440')
  )
  check(
    'devmuxel: captures come across',
    read(path.join(newDir, 'captures', 'atlas-api.md')) === 'a atlas-api capture'
  )
  check(
    'devmuxel: the browser partition follows BROWSER_PARTITION',
    read(path.join(newDir, 'Partitions', 'devlobby-browser', 'Cookies')) === 'session=atlas-api'
  )
  check(
    'devmuxel: the old partition name is gone',
    !has(path.join(newDir, 'Partitions', 'devmuxel-browser'))
  )
}

// --- 2. an install that never left GRID --------------------------------------
{
  const base = tmp()
  const newDir = path.join(base, 'DevLobby')
  seedProfile(path.join(base, 'GRID'), 'grid', 'atlas-api')

  migrateProfile(oldDirs(base), newDir)

  check('grid: the old profile is gone', !has(path.join(base, 'GRID')))
  check(
    'grid: state arrives under the new name, skipping the middle one',
    read(path.join(newDir, 'devlobby-state.json')).includes('atlas-api')
  )
  check('grid: the backup is renamed too', has(path.join(newDir, 'devlobby-state.bak.json')))
  check('grid: no old state name survives', !has(path.join(newDir, 'grid-state.json')))
  check(
    'grid: the browser partition comes across',
    read(path.join(newDir, 'Partitions', 'devlobby-browser', 'Cookies')) === 'session=atlas-api'
  )
}

// --- 3. both old names present: the newer one wins ---------------------------
// Only reachable if the GRID hop half-failed or an old build was re-run, but it
// is exactly the case where picking the wrong one silently loses recent work.
{
  const base = tmp()
  const newDir = path.join(base, 'DevLobby')
  seedProfile(path.join(base, 'DevMuxel'), 'devmuxel', 'newer')
  seedProfile(path.join(base, 'GRID'), 'grid', 'older')
  fs.writeFileSync(path.join(base, 'GRID', 'only-in-grid.json'), '{"kept":true}')

  migrateProfile(oldDirs(base), newDir)

  check(
    'both: the DevMuxel state is the one that takes the new name',
    read(path.join(newDir, 'devlobby-state.json')).includes('newer')
  )
  check(
    'both: the DevMuxel partition is the one that survives',
    read(path.join(newDir, 'Partitions', 'devlobby-browser', 'Cookies')) === 'session=newer'
  )
  check(
    'both: what only GRID had is still taken',
    read(path.join(newDir, 'only-in-grid.json')).includes('kept')
  )
  check('both: the DevMuxel directory is taken wholesale', !has(path.join(base, 'DevMuxel')))
  // GRID stays, holding only what DevMuxel had already superseded. The merge is
  // one level deep and never deletes, so a directory the newer profile also had
  // — `captures/`, `Partitions/` — is left where it is rather than merged into
  // it or overwritten with it. Nothing is lost; it is simply not carried.
  check(
    'both: what GRID had that was superseded is left, not destroyed',
    read(path.join(base, 'GRID', 'captures', 'older.md')) === 'a older capture'
  )
}

// --- 4. nothing to migrate ---------------------------------------------------
{
  const base = tmp()
  const newDir = path.join(base, 'DevLobby')
  fs.mkdirSync(newDir, { recursive: true })
  fs.writeFileSync(path.join(newDir, 'devlobby-state.json'), '{"fresh":true}')

  migrateProfile(oldDirs(base), newDir)

  check(
    'fresh: an install with no earlier profile is untouched',
    read(path.join(newDir, 'devlobby-state.json')).includes('fresh')
  )
}

// --- 5. both exist: a real DevLobby profile must win -------------------------
{
  const base = tmp()
  const newDir = path.join(base, 'DevLobby')
  seedProfile(path.join(base, 'DevMuxel'), 'devmuxel', 'atlas-api')
  fs.mkdirSync(newDir, { recursive: true })
  fs.writeFileSync(path.join(newDir, 'devlobby-state.json'), '{"repos":["newest"]}')
  fs.writeFileSync(path.join(newDir, 'window.json'), '{"width":900}')

  migrateProfile(oldDirs(base), newDir)

  check(
    'merge: the newer state file is not clobbered',
    read(path.join(newDir, 'devlobby-state.json')).includes('newest')
  )
  check('merge: nor are newer window bounds', read(path.join(newDir, 'window.json')).includes('900'))
  check(
    'merge: but what was missing is taken',
    read(path.join(newDir, 'captures', 'atlas-api.md')) === 'a atlas-api capture'
  )
  check('merge: including the partition', has(path.join(newDir, 'Partitions', 'devlobby-browser', 'Cookies')))
  // The old state file comes across under its old name and stays there, because
  // the newer one already holds the name it would be renamed to. Left rather
  // than deleted: it is the user's data, and nothing reads it any more.
  check('merge: the superseded state file is kept, not destroyed', has(path.join(newDir, 'devmuxel-state.json')))

  migrateProfile(oldDirs(base), newDir)
  check(
    'merge: re-running still does not clobber',
    read(path.join(newDir, 'devlobby-state.json')).includes('newest')
  )
}

// --- 6. re-running is a no-op ------------------------------------------------
{
  const base = tmp()
  const newDir = path.join(base, 'DevLobby')
  seedProfile(path.join(base, 'DevMuxel'), 'devmuxel', 'atlas-api')
  migrateProfile(oldDirs(base), newDir)
  const first = read(path.join(newDir, 'devlobby-state.json'))
  migrateProfile(oldDirs(base), newDir)
  migrateProfile(oldDirs(base), newDir)
  check(
    'idempotent: a second and third run change nothing',
    read(path.join(newDir, 'devlobby-state.json')) === first
  )
}

// --- 7. it must never throw --------------------------------------------------
{
  let threw = false
  try {
    migrateProfile(['\0::not-a-path'], '\0::also-not')
    const base = tmp()
    migrateProfile([path.join(base, 'GRID')], path.join(base, 'GRID')) // same dir
    migrateProfile([], path.join(base, 'DevLobby')) // nothing to carry
  } catch {
    threw = true
  }
  check('safety: a broken path is swallowed, not thrown', !threw)
}

// --- 8. the legacy skill locations -------------------------------------------
{
  const dirs = legacySkillDirs(path.join('C:\\Users\\me', '.claude'))
  const base = path.join('C:\\Users\\me', '.claude', 'skills')
  check(
    'legacy: names both pre-rename skill folders, newest first',
    dirs.length === 2 &&
      dirs[0] === path.join(base, 'devmuxel-browser') &&
      dirs[1] === path.join(base, 'grid-browser')
  )
}

console.log(failures === 0 ? `\nALL MIGRATION CHECKS PASSED` : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
