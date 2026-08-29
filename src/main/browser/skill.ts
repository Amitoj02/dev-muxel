/**
 * The `/devlobby-browser` skill, and putting it where Claude will find it.
 *
 * The skill is the far end of the bridge in `bridge.ts`: it knows the manifest
 * file, the routes and the shape of the wait. Two halves of one protocol, so
 * shipping them together is what stops them drifting — a user who copied the
 * script by hand once has no way of knowing when DevLobby changed the other
 * side.
 *
 * The text is imported rather than written out here. `?raw` inlines it at build
 * time, so the skill stays a real file in the repository — readable, greppable,
 * and copyable by hand for anyone who would rather not press a button — while
 * the packaged app carries it inside the asar with nothing to unpack.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SkillStatus } from '../../shared/types'
import { legacySkillDirs } from '../migrate'
import skillMarkdown from '../../../resources/skills/devlobby-browser/SKILL.md?raw'
import skillScript from '../../../resources/skills/devlobby-browser/devlobby-browser.ps1?raw'

/**
 * Bumped whenever the shipped skill changes. It is stamped into SKILL.md so an
 * installed copy can say which DevLobby wrote it; a copy with no stamp was
 * written by hand, and is treated as out of date because the shipped one is
 * canonical.
 *
 * 1 -> 2, 2 -> 3: the two renames. Both the slug and the stamp changed each
 * time, so a copy left over from GRID or DevMuxel does not match this regex at
 * all and reads as "written by hand" — which is the right answer for it anyway,
 * since it points at a bridge route spelled the old way.
 */
export const SKILL_VERSION = 3

const STAMP = /<!--\s*devlobby-skill-version:\s*(\d+)\s*-->/

/** Where Claude Code looks for a user-level skill. */
export function skillDir(): string {
  return path.join(os.homedir(), '.claude', 'skills', 'devlobby-browser')
}

export async function skillStatus(): Promise<SkillStatus> {
  const dir = skillDir()
  const legacyDirs = await legacySkills()
  try {
    const body = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8')
    const found = STAMP.exec(body)
    const version = found ? Number(found[1]) : null
    return { installed: true, version, current: version === SKILL_VERSION, dir, legacyDirs }
  } catch {
    return { installed: false, version: null, current: false, dir, legacyDirs }
  }
}

/**
 * The pre-rename `/devmuxel-browser` and `/grid-browser` skills, whichever of
 * them the user still has.
 *
 * Reported rather than deleted: this is inside their `.claude` directory, and
 * an app that quietly removes files from there is not one you would trust with
 * the rest. Leaving them costs a slash command apiece that no longer works, so
 * they are worth naming — once, in the tooltip that is already about the skill.
 */
async function legacySkills(): Promise<string[]> {
  const found: string[] = []
  for (const dir of legacySkillDirs(os.homedir())) {
    try {
      await fs.access(path.join(dir, 'SKILL.md'))
      found.push(dir)
    } catch {
      // Not installed under that name; nothing to report.
    }
  }
  return found
}

/**
 * Write both halves out, overwriting whatever is there.
 *
 * Only ever reached from a button the user pressed, which is why it is allowed
 * to overwrite: the two files are one unit, and installing half of a newer
 * skill next to half of an older one is the failure this exists to avoid.
 */
export async function installSkill(): Promise<
  { ok: true; dir: string } | { ok: false; error: string }
> {
  const dir = skillDir()
  try {
    await fs.mkdir(dir, { recursive: true })
    // Endings are normalised rather than inherited: what `?raw` carries depends
    // on how the repository happened to be checked out, and a PowerShell script
    // that reaches a machine with bare LFs is a needless thing to debug.
    await fs.writeFile(path.join(dir, 'SKILL.md'), lineEndings(skillMarkdown, '\n'), 'utf8')
    await fs.writeFile(
      path.join(dir, 'devlobby-browser.ps1'),
      lineEndings(skillScript, '\r\n'),
      'utf8'
    )
    return { ok: true, dir }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function lineEndings(text: string, eol: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n/g, eol)
}
