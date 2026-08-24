/**
 * Handing a folder off to the tools the user already lives in.
 *
 * The Windows hazard here is `code` being a `.cmd` shim. Node 24 refuses to
 * exec a batch file without a shell, and `shell: true` does no quoting at all —
 * it concatenates everything and hands the string to cmd.exe. A folder called
 * `R&D` would then simply fail, and one called `x & calc` would *run calc*.
 *
 * So the shim is never used. We locate `Code.exe` itself and spawn it with
 * `shell: false`, where every argument stays its own argv entry and the OS does
 * the quoting. Nothing the user's folder is named can change the command.
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'

export type LaunchResult = { ok: true } | { ok: false; error: string }

function programFiles(): string[] {
  return [
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)']
  ].filter((p): p is string => Boolean(p))
}

/**
 * Locate a VS Code family editor. Preference order matters: if someone has both
 * Insiders and stable installed, stable is the one they meant.
 */
function findEditor(): { exe: string } | null {
  const localAppData = process.env.LOCALAPPDATA ?? ''

  const candidates = [
    localAppData && path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    ...programFiles().map((r) => path.join(r, 'Microsoft VS Code', 'Code.exe')),
    localAppData && path.join(localAppData, 'Programs', 'Cursor', 'Cursor.exe'),
    localAppData &&
      path.join(localAppData, 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
    ...programFiles().map((r) => path.join(r, 'Microsoft VS Code Insiders', 'Code - Insiders.exe'))
  ].filter((p): p is string => Boolean(p))

  for (const exe of candidates) {
    if (existsSync(exe)) return { exe }
  }

  return null
}

let cachedEditor: { exe: string } | null | undefined

export function editorAvailable(): boolean {
  if (cachedEditor === undefined) cachedEditor = findEditor()
  return cachedEditor !== null
}

export function openInEditor(target: string): LaunchResult {
  if (!target) return { ok: false, error: 'no path' }
  if (!existsSync(target)) return { ok: false, error: 'folder is missing' }

  if (cachedEditor === undefined) cachedEditor = findEditor()
  if (!cachedEditor) {
    return { ok: false, error: 'VS Code was not found on this machine' }
  }

  try {
    const child = spawn(cachedEditor.exe, ['-n', target], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      // Explicit rather than implicit: nothing may re-parse the path.
      shell: false
    })
    child.unref()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * "Show in Explorer".
 *
 * `shell.openPath` on a *file* opens it with its default handler, which for an
 * .exe or a .bat means running it. This is only ever called with a declared
 * repository path — but "only ever" is exactly the assumption that rots, so a
 * non-directory is revealed in its parent folder rather than opened.
 */
export async function openInFileManager(target: string): Promise<LaunchResult> {
  if (!target) return { ok: false, error: 'no path' }

  const full = path.normalize(target)
  let isDirectory: boolean
  try {
    isDirectory = statSync(full).isDirectory()
  } catch {
    return { ok: false, error: 'folder is missing' }
  }

  if (!isDirectory) {
    shell.showItemInFolder(full)
    return { ok: true }
  }

  // shell.openPath handles Explorer's habit of returning a non-zero exit code
  // on success, which a raw spawn would report as a failure.
  const err = await shell.openPath(full)
  return err ? { ok: false, error: err } : { ok: true }
}
