/**
 * Checks the one-time GRID -> DevMuxel profile migration.
 *
 * It runs before anything opens a file in userData, on every launch, against a
 * directory holding the user's repositories and layout — so the two things
 * worth asserting are that it moves everything across exactly once, and that
 * it never destroys a profile that is already there.
 *
 *   npm run check:migrate
 *
 * Run with Node's type stripping; there is no build step involved.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { legacySkillDir, migrateFromGrid } from '../src/main/migrate.ts'

let failures = 0
function check(name: string, ok: boolean): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) failures++
}

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'muxmig-'))
}

function seedOldProfile(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'grid-state.json'), '{"repos":["atlas-api"]}')
  fs.writeFileSync(path.join(dir, 'grid-state.bak.json'), '{"repos":[]}')
  fs.writeFileSync(path.join(dir, 'window.json'), '{"width":1440}')
  fs.mkdirSync(path.join(dir, 'captures'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'captures', 'a.md'), 'a capture')
  fs.mkdirSync(path.join(dir, 'Partitions', 'grid-browser'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'Partitions', 'grid-browser', 'Cookies'), 'session=1')
}

const read = (p: string): string => fs.readFileSync(p, 'utf8')
const has = (p: string): boolean => fs.existsSync(p)

// --- 1. the ordinary upgrade: old profile, no new one ------------------------
{
  const base = tmp()
  const oldDir = path.join(base, 'GRID')
  const newDir = path.join(base, 'DevMuxel')
  seedOldProfile(oldDir)

  migrateFromGrid(oldDir, newDir)

  check('move: the old profile is gone', !has(oldDir))
  check('move: state arrives under the new name', has(path.join(newDir, 'devmuxel-state.json')))
  check('move: and keeps its contents', read(path.join(newDir, 'devmuxel-state.json')).includes('atlas-api'))
  check('move: the backup is renamed too', has(path.join(newDir, 'devmuxel-state.bak.json')))
  check('move: no old state name survives', !has(path.join(newDir, 'grid-state.json')))
  check('move: window bounds come across untouched', read(path.join(newDir, 'window.json')).includes('1440'))
  check('move: captures come across', read(path.join(newDir, 'captures', 'a.md')) === 'a capture')
  check(
    'move: the browser partition follows BROWSER_PARTITION',
    read(path.join(newDir, 'Partitions', 'devmuxel-browser', 'Cookies')) === 'session=1'
  )
  check('move: the old partition name is gone', !has(path.join(newDir, 'Partitions', 'grid-browser')))
}

// --- 2. nothing to migrate ---------------------------------------------------
{
  const base = tmp()
  const newDir = path.join(base, 'DevMuxel')
  fs.mkdirSync(newDir, { recursive: true })
  fs.writeFileSync(path.join(newDir, 'devmuxel-state.json'), '{"fresh":true}')

  migrateFromGrid(path.join(base, 'GRID'), newDir)

  check('fresh: an install with no GRID profile is untouched', read(path.join(newDir, 'devmuxel-state.json')).includes('fresh'))
}

// --- 3. both exist: a real DevMuxel profile must win -------------------------
{
  const base = tmp()
  const oldDir = path.join(base, 'GRID')
  const newDir = path.join(base, 'DevMuxel')
  seedOldProfile(oldDir)
  fs.mkdirSync(newDir, { recursive: true })
  fs.writeFileSync(path.join(newDir, 'devmuxel-state.json'), '{"repos":["newer"]}')
  fs.writeFileSync(path.join(newDir, 'window.json'), '{"width":900}')

  migrateFromGrid(oldDir, newDir)

  check('merge: the newer state file is not clobbered', read(path.join(newDir, 'devmuxel-state.json')).includes('newer'))
  check('merge: nor are newer window bounds', read(path.join(newDir, 'window.json')).includes('900'))
  check('merge: but what was missing is taken', read(path.join(newDir, 'captures', 'a.md')) === 'a capture')
  check(
    'merge: including the partition',
    has(path.join(newDir, 'Partitions', 'devmuxel-browser', 'Cookies'))
  )
  // The old state file comes across under its old name and stays there, because
  // the newer one already holds the name it would be renamed to. Left rather
  // than deleted: it is the user's data, and nothing reads it any more.
  check('merge: the superseded state file is kept, not destroyed', has(path.join(newDir, 'grid-state.json')))

  migrateFromGrid(oldDir, newDir)
  check('merge: re-running still does not clobber', read(path.join(newDir, 'devmuxel-state.json')).includes('newer'))
}

// --- 4. re-running is a no-op ------------------------------------------------
{
  const base = tmp()
  const oldDir = path.join(base, 'GRID')
  const newDir = path.join(base, 'DevMuxel')
  seedOldProfile(oldDir)
  migrateFromGrid(oldDir, newDir)
  const first = read(path.join(newDir, 'devmuxel-state.json'))
  migrateFromGrid(oldDir, newDir)
  migrateFromGrid(oldDir, newDir)
  check('idempotent: a second and third run change nothing', read(path.join(newDir, 'devmuxel-state.json')) === first)
}

// --- 5. it must never throw --------------------------------------------------
{
  let threw = false
  try {
    migrateFromGrid('\0::not-a-path', '\0::also-not')
    const base = tmp()
    migrateFromGrid(path.join(base, 'GRID'), path.join(base, 'GRID')) // same dir
  } catch {
    threw = true
  }
  check('safety: a broken path is swallowed, not thrown', !threw)
}

// --- 6. the legacy skill location -------------------------------------------
{
  const dir = legacySkillDir('C:\\Users\\me')
  check(
    'legacy: names the pre-rename skill folder',
    dir === path.join('C:\\Users\\me', '.claude', 'skills', 'grid-browser')
  )
}

console.log(failures === 0 ? `\nALL MIGRATION CHECKS PASSED` : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
