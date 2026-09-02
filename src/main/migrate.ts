/**
 * Carrying an install across a rename.
 *
 * `app.setName` decides where userData lives, so renaming the app moves the
 * whole profile out from under an existing install: repositories, notes,
 * layout, captures and the browser pane's cookies are all still sitting in
 * `%APPDATA%\<old name>` while the new name looks in an empty one. Nothing is
 * lost, but a user upgrading would be shown a first run, which is
 * indistinguishable from having lost it.
 *
 * So: move the folder once, then rename the files and the directory inside it
 * that carry an old name. Everything else in there — `bridge.json`,
 * `captures/`, `window.json` — is named after what it holds rather than after
 * the app, and comes across untouched.
 *
 * This app has now been renamed twice, GRID -> DevMuxel -> DevLobby, and an
 * install can be sitting at either of the earlier names: the GRID hop only ever
 * ran for someone who actually launched a DevMuxel build. So every old name is
 * tried, newest first, and the older ones only fill in what the newer one did
 * not bring.
 *
 * Synchronous on purpose. This has to finish before Chromium opens anything in
 * the profile directory, and before `Store.load` reads the state file, which
 * rules out doing it inside `whenReady`.
 */

import fs from 'node:fs'
import path from 'node:path'

/**
 * Every name the profile directory has lived under, newest first.
 *
 * Order is the precedence rule: a DevMuxel profile is more recent than a GRID
 * one, so it is taken first and GRID only supplies what is still missing.
 */
export const LEGACY_APP_NAMES: readonly string[] = ['DevMuxel', 'GRID']

/**
 * Files and directories whose names carried an old brand, newest spelling
 * first so that where both exist the newer one keeps the name.
 */
const RENAMES: ReadonlyArray<readonly [from: string, to: string]> = [
  ['devmuxel-state.json', 'devlobby-state.json'],
  ['grid-state.json', 'devlobby-state.json'],
  ['devmuxel-state.bak.json', 'devlobby-state.bak.json'],
  ['grid-state.bak.json', 'devlobby-state.bak.json'],
  // Electron names a partition's folder after the string in `persist:<name>`,
  // so `BROWSER_PARTITION` changing would otherwise log you out of every dev
  // server you had signed into in a browser pane.
  [path.join('Partitions', 'devmuxel-browser'), path.join('Partitions', 'devlobby-browser')],
  [path.join('Partitions', 'grid-browser'), path.join('Partitions', 'devlobby-browser')]
]

/**
 * Carry a profile written under any earlier name across to `newDir`.
 *
 * `oldDirs` is newest-first. Each is moved in turn, taking only what is not
 * already present, so a newer profile is never overwritten by an older one —
 * then the names that carried an old brand are fixed up once at the end.
 *
 * Never throws. A migration that fails degrades to a first run, which is bad;
 * a migration that fails *and* stops the app coming up is worse, and the user
 * would have no way to get at the data either way.
 */
export function migrateProfile(oldDirs: readonly string[], newDir: string): void {
  try {
    for (const oldDir of oldDirs) {
      if (oldDir === newDir) continue
      if (!fs.existsSync(oldDir)) continue

      if (fs.existsSync(newDir)) {
        // The new profile already exists — Electron may have created it, a
        // previous run got part way, or a newer old name was already taken.
        // Take only what is not already there, so a half-finished migration
        // can be finished but a real DevLobby profile is never overwritten.
        for (const entry of fs.readdirSync(oldDir)) {
          const to = path.join(newDir, entry)
          if (fs.existsSync(to)) continue
          fs.renameSync(path.join(oldDir, entry), to)
        }
      } else {
        fs.renameSync(oldDir, newDir)
      }
    }

    if (!fs.existsSync(newDir)) return

    for (const [from, to] of RENAMES) {
      const src = path.join(newDir, from)
      const dest = path.join(newDir, to)
      if (fs.existsSync(src) && !fs.existsSync(dest)) fs.renameSync(src, dest)
    }
  } catch (err) {
    console.error('[main] could not carry the earlier profile over to DevLobby:', err)
  }
}

/**
 * Where the browser skill was written under each earlier name, within one
 * Claude profile.
 *
 * Installing `/devlobby-browser` does not remove them — this is inside the
 * user's `.claude` directory, which the app has no business deleting from — so
 * the comments bar offers to say they are there and what they are. A stale copy
 * is not harmful, just another slash command that talks to a bridge route the
 * app no longer serves. There can be two of them per profile: someone who ran
 * GRID, then DevMuxel, and installed the skill from each.
 */
export function legacySkillDirs(configDir: string): string[] {
  return ['devmuxel-browser', 'grid-browser'].map((slug) => path.join(configDir, 'skills', slug))
}
