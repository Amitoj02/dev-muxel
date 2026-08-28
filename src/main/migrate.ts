/**
 * Carrying a GRID install across the rename to DevMuxel.
 *
 * `app.setName` decides where userData lives, so renaming the app moved the
 * whole profile out from under an existing install: repositories, notes,
 * layout, captures and the browser pane's cookies were all still sitting in
 * `%APPDATA%\GRID` while the new name looked in an empty `%APPDATA%\DevMuxel`.
 * Nothing was lost, but a user upgrading would have been shown a first run,
 * which is indistinguishable from having lost it.
 *
 * So: move the folder once, then rename the two files and the one directory
 * inside it that carry the old name. Everything else in there — `bridge.json`,
 * `captures/`, `window.json` — is named after what it holds rather than after
 * the app, and comes across untouched.
 *
 * Synchronous on purpose. This has to finish before Chromium opens anything in
 * the profile directory, and before `Store.load` reads the state file, which
 * rules out doing it inside `whenReady`.
 */

import fs from 'node:fs'
import path from 'node:path'

/** Files and directories whose names carried the old brand. */
const RENAMES: ReadonlyArray<readonly [from: string, to: string]> = [
  ['grid-state.json', 'devmuxel-state.json'],
  ['grid-state.bak.json', 'devmuxel-state.bak.json'],
  // Electron names a partition's folder after the string in `persist:<name>`,
  // so `BROWSER_PARTITION` changing would otherwise log you out of every dev
  // server you had signed into in a browser pane.
  [path.join('Partitions', 'grid-browser'), path.join('Partitions', 'devmuxel-browser')]
]

/**
 * Move `%APPDATA%\GRID` to `%APPDATA%\DevMuxel`, if it is still there.
 *
 * Never throws. A migration that fails degrades to a first run, which is bad;
 * a migration that fails *and* stops the app coming up is worse, and the user
 * would have no way to get at the data either way.
 */
export function migrateFromGrid(oldDir: string, newDir: string): void {
  if (oldDir === newDir) return
  try {
    if (!fs.existsSync(oldDir)) return

    if (fs.existsSync(newDir)) {
      // The new profile already exists — Electron may have created it, or a
      // previous run got part way. Take only what is not already there, so a
      // half-finished migration can be finished but a real DevMuxel profile is
      // never overwritten by a stale GRID one.
      for (const entry of fs.readdirSync(oldDir)) {
        const to = path.join(newDir, entry)
        if (fs.existsSync(to)) continue
        fs.renameSync(path.join(oldDir, entry), to)
      }
    } else {
      fs.renameSync(oldDir, newDir)
    }

    for (const [from, to] of RENAMES) {
      const src = path.join(newDir, from)
      const dest = path.join(newDir, to)
      if (fs.existsSync(src) && !fs.existsSync(dest)) fs.renameSync(src, dest)
    }
  } catch (err) {
    console.error('[main] could not carry the GRID profile over to DevMuxel:', err)
  }
}

/**
 * Where the `/grid-browser` skill was written before the rename.
 *
 * Installing `/devmuxel-browser` does not remove it — this is inside the user's
 * `.claude` directory, which the app has no business deleting from — so the
 * comments bar offers to say it is there and what it is. A stale copy is not
 * harmful, just a second slash command that talks to a bridge route the app no
 * longer serves.
 */
export function legacySkillDir(homedir: string): string {
  return path.join(homedir, '.claude', 'skills', 'grid-browser')
}
