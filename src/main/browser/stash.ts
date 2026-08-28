/**
 * Captures too big to paste.
 *
 * The Claude CLI collapses any paste over ten thousand characters into a
 * `[Pasted text #1 +240 lines]` placeholder held outside the prompt, and a
 * placeholder can age out before the model ever reads it. So a large capture
 * is written to a file and the paste becomes one short line naming it — which
 * is also the only way to hand a prompt to a session that has not started yet,
 * since a fresh `claude` takes its prompt as an argument.
 *
 * The files live in userData, next to the state file, and the last few are
 * kept so that "the one I sent five minutes ago" is still readable.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

/** Captures kept on disk. Older ones are deleted on each new write. */
const KEEP = 40

export type StashResult = { ok: true; path: string; dir: string } | { ok: false; error: string }

export class CaptureStash {
  private seq = 0

  constructor(private userDataDir: string) {}

  get root(): string {
    return path.join(this.userDataDir, 'captures')
  }

  /**
   * Each capture gets a folder of its own, holding one file.
   *
   * That is not tidiness: a new session is started with `--add-dir` pointing at
   * the folder, and a folder per capture means the session is granted the one
   * file it was opened for rather than every capture ever taken.
   */
  async write(text: string, hint: string): Promise<StashResult> {
    try {
      this.seq += 1
      // The sequence is padded so that pruning by name is still pruning by age
      // when several captures land inside the same second.
      const ordinal = String(this.seq).padStart(3, '0')
      const dir = path.join(this.root, `${stamp()}-${ordinal}-${slug(hint)}`)
      await fs.mkdir(dir, { recursive: true })
      const file = path.join(dir, 'capture.md')
      await fs.writeFile(file, text, 'utf8')
      void this.prune()
      return { ok: true, path: file, dir }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private async prune(): Promise<void> {
    try {
      const entries = await fs.readdir(this.root, { withFileTypes: true })
      const names = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
      for (const name of names.slice(0, Math.max(0, names.length - KEEP))) {
        await fs.rm(path.join(this.root, name), { recursive: true, force: true })
      }
    } catch {
      /* pruning is housekeeping; never let it fail a send */
    }
  }
}

/** Sortable, so pruning by name is pruning by age. */
function stamp(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
}

function slug(hint: string): string {
  const clean = hint
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return clean.slice(0, 40) || 'capture'
}
