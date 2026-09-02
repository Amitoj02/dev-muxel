/**
 * Which Claude lives on this machine — and there can be more than one.
 *
 * Claude Code keeps everything it knows in a configuration directory, `.claude`
 * in your home directory by default, and `CLAUDE_CONFIG_DIR` moves it. Somebody
 * running two accounts on one machine ends up with two of them side by side:
 * `.claude` and, say, `.claude-work`, each launched by its own shortcut. A skill
 * written into one is invisible from the other.
 *
 * DevLobby used to look only at `.claude`, which made the second profile
 * unreachable in the worst way: with the skill installed under the first name
 * the comments bar reported everything current and took its own install button
 * off the screen, so the session that could not find `/devlobby-browser` had no
 * way to ask for it. Every profile is found instead, and the button stays until
 * all of them have a current copy.
 *
 * A directory beside `.claude` is only a profile if it looks like one. The name
 * alone is not enough — `.claude-backup-oct` is somebody's copy, not a place to
 * write files — so one of the things Claude Code itself puts there has to be
 * present.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Something Claude Code writes into a configuration directory of its own. */
const PROOF = ['settings.json', '.claude.json', 'projects', 'sessions', 'skills']

/**
 * The directories worth looking in, in the order they should be named: the
 * default first, then whatever `CLAUDE_CONFIG_DIR` points at, then the profiles
 * sitting beside the default, alphabetically.
 *
 * Pure, and takes the home directory's entries rather than reading them, so the
 * rule can be checked without a home directory full of fixtures.
 */
export function claudeDirsFrom(
  homedir: string,
  entries: readonly string[],
  configDirEnv?: string
): string[] {
  const found: string[] = [path.join(homedir, '.claude')]

  const named = configDirEnv?.trim()
  if (named) found.push(path.resolve(named))

  for (const entry of [...entries].sort()) {
    // `.claude-work` is a second profile; `.claude.json` is the first one's
    // file, and would be a directory entry here only by accident.
    if (/^\.claude-/.test(entry)) found.push(path.join(homedir, entry))
  }

  const seen = new Set<string>()
  return found.filter((dir) => {
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Every Claude configuration directory on this machine.
 *
 * A candidate has to prove it is one, with two exceptions: a directory named
 * outright by `CLAUDE_CONFIG_DIR` is taken at its word, and if nothing at all
 * proves itself the default is returned anyway — a machine where Claude Code
 * has never run still needs somewhere for the button to write.
 */
export async function claudeDirs(): Promise<string[]> {
  const home = os.homedir()
  const named = process.env.CLAUDE_CONFIG_DIR?.trim()

  let entries: string[] = []
  try {
    const found = await fs.readdir(home, { withFileTypes: true })
    entries = found.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    // No home directory to read is not a state worth reporting: the default
    // below still gives the button somewhere to write.
  }

  const candidates = claudeDirsFrom(home, entries, named)
  const kept: string[] = []
  for (const dir of candidates) {
    if (named && path.resolve(named) === dir) kept.push(dir)
    else if (await isProfile(dir)) kept.push(dir)
  }
  return kept.length > 0 ? kept : [path.join(home, '.claude')]
}

async function isProfile(dir: string): Promise<boolean> {
  for (const proof of PROOF) {
    try {
      await fs.access(path.join(dir, proof))
      return true
    } catch {
      // Not that one; try the next.
    }
  }
  return false
}
