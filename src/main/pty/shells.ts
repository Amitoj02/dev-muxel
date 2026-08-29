/**
 * Which shells this machine actually has.
 *
 * Discovered once at startup and merged with whatever the user has added by
 * hand, so a fresh install offers PowerShell / cmd / Git Bash without anyone
 * having to type a path, and a machine without PowerShell 7 simply does not
 * list it.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ShellProfile } from '../../shared/types'

type Candidate = {
  id: string
  label: string
  paths: string[]
  args: string[]
  env?: Record<string, string>
}

function firstExisting(paths: string[]): string | null {
  for (const p of paths) {
    if (!p) continue
    try {
      if (existsSync(p)) return p
    } catch {
      /* unreadable, treat as missing */
    }
  }
  return null
}

function programFiles(): string[] {
  return [
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)'
  ].filter((p): p is string => Boolean(p))
}

function candidates(): Candidate[] {
  const sysRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const localAppData = process.env.LOCALAPPDATA ?? ''

  const pwshPaths = programFiles().flatMap((root) => [
    path.join(root, 'PowerShell', '7', 'pwsh.exe'),
    path.join(root, 'PowerShell', '7-preview', 'pwsh.exe')
  ])

  const gitPaths = [
    ...programFiles().map((root) => path.join(root, 'Git', 'bin', 'bash.exe')),
    localAppData ? path.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe') : ''
  ]

  return [
    {
      id: 'pwsh',
      label: 'PowerShell 7',
      paths: pwshPaths,
      args: ['-NoLogo'],
      env: { TERM_PROGRAM: 'devlobby' }
    },
    {
      id: 'powershell',
      label: 'Windows PowerShell',
      paths: [path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')],
      args: ['-NoLogo'],
      env: { TERM_PROGRAM: 'devlobby' }
    },
    {
      id: 'cmd',
      label: 'Command Prompt',
      paths: [path.join(sysRoot, 'System32', 'cmd.exe')],
      args: []
    },
    {
      id: 'gitbash',
      label: 'Git Bash',
      paths: gitPaths,
      // -i without -l keeps startup fast; ConPTY already gives it a real tty.
      args: ['--login', '-i'],
      env: { TERM: 'xterm-256color', CHERE_INVOKING: '1' }
    },
    {
      id: 'wsl',
      label: 'WSL',
      paths: [path.join(sysRoot, 'System32', 'wsl.exe')],
      args: [],
      env: { TERM: 'xterm-256color' }
    }
  ]
}

/** Shells found on this machine, in the order they should be offered. */
export function discoverShells(): ShellProfile[] {
  const found: ShellProfile[] = []
  for (const c of candidates()) {
    const exe = firstExisting(c.paths)
    if (!exe) continue
    found.push({ id: c.id, label: c.label, path: exe, args: c.args, env: c.env, builtin: true })
  }
  return found
}

/**
 * Discovered shells plus the user's own, with the user's winning on id clash
 * so a hand-edited path is never silently replaced by the discovered one.
 */
export function mergeShells(discovered: ShellProfile[], custom: ShellProfile[]): ShellProfile[] {
  const byId = new Map<string, ShellProfile>()
  for (const s of discovered) byId.set(s.id, s)
  for (const s of custom) byId.set(s.id, { ...s, builtin: false })
  return [...byId.values()]
}

/** Best default for a fresh install: PowerShell 7 if present, else 5.1, else anything. */
export function pickDefaultShell(shells: ShellProfile[]): string {
  const order = ['pwsh', 'powershell', 'gitbash', 'cmd', 'wsl']
  for (const id of order) {
    if (shells.some((s) => s.id === id)) return id
  }
  return shells[0]?.id ?? 'cmd'
}
