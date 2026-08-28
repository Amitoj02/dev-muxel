/**
 * Persistence.
 *
 * Everything GRID remembers between launches lives in one JSON file in
 * userData. Writes are debounced and atomic (temp file + rename) because the
 * renderer saves on every layout nudge and a half-written state file would
 * cost the user their whole grid.
 *
 * A `.bak` copy of the last good file is kept, so a corrupt write — a power
 * cut mid-rename, a disk full — degrades to "yesterday's layout" rather than
 * "first run again".
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { VIEWPORT_ORDER, isWebUrl } from '../../shared/browser'
import { CLAUDE_EFFORTS, isSafeFlagValue } from '../../shared/claude'
import { sanitiseLayout } from '../../shared/layout'
import type {
  BrowserPane,
  Pane,
  PersistedState,
  Settings,
  TabState,
  WindowBounds
} from '../../shared/types'
import { STATE_VERSION, defaultSettings, defaultState } from './defaults'

const WRITE_DEBOUNCE_MS = 400

export class Store {
  private state: PersistedState = defaultState()
  private bounds: WindowBounds = { width: 1440, height: 900, maximized: false }
  private timer: NodeJS.Timeout | null = null
  /** Tail of the write chain, so writes never interleave. */
  private writing: Promise<void> | null = null

  constructor(private dir: string) {}

  private get statePath(): string {
    return path.join(this.dir, 'grid-state.json')
  }

  private get backupPath(): string {
    return path.join(this.dir, 'grid-state.bak.json')
  }

  private get boundsPath(): string {
    return path.join(this.dir, 'window.json')
  }

  async load(): Promise<PersistedState> {
    await fs.mkdir(this.dir, { recursive: true })

    const parsed =
      (await readJson<PersistedState>(this.statePath)) ??
      (await readJson<PersistedState>(this.backupPath))

    this.state = migrate(parsed)

    const bounds = await readJson<WindowBounds>(this.boundsPath)
    if (bounds && Number.isFinite(bounds.width) && Number.isFinite(bounds.height)) {
      this.bounds = {
        x: Number.isFinite(bounds.x as number) ? bounds.x : undefined,
        y: Number.isFinite(bounds.y as number) ? bounds.y : undefined,
        width: Math.max(640, Math.round(bounds.width)),
        height: Math.max(400, Math.round(bounds.height)),
        maximized: Boolean(bounds.maximized)
      }
    }

    return this.state
  }

  get(): PersistedState {
    return this.state
  }

  getBounds(): WindowBounds {
    return this.bounds
  }

  /** Replace the whole persisted state (the renderer owns it) and schedule a write. */
  set(next: PersistedState): void {
    this.state = migrate(next)
    this.schedule()
  }

  patchSettings(patch: Partial<Settings>): Settings {
    // Range-checked, not merely merged: this is renderer input, and an
    // out-of-range lineHeight would make xterm throw on the next pane.
    this.state.settings = migrateSettings({ ...this.state.settings, ...patch })
    this.schedule()
    return this.state.settings
  }

  setBounds(bounds: WindowBounds): void {
    this.bounds = bounds
    this.schedule()
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), WRITE_DEBOUNCE_MS)
    this.timer.unref?.()
  }

  /**
   * Write now, and resolve only once the state as of *this* call is on disk.
   *
   * Returning an already-running write would be wrong for the quit path: that
   * write started before the last layout change, so awaiting it and exiting
   * would drop exactly the thing the user expects to come back. So each call
   * appends its own write to the chain.
   */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    const mine = (this.writing ?? Promise.resolve()).then(() => this.write())
    this.writing = mine
    try {
      await mine
    } finally {
      // Only clear if nothing queued behind us.
      if (this.writing === mine) this.writing = null
    }
  }

  private async write(): Promise<void> {
    try {
      await fs.mkdir(this.dir, { recursive: true })
      const body = JSON.stringify(this.state, null, 2)

      // Keep the previous good file before replacing it.
      try {
        await fs.copyFile(this.statePath, this.backupPath)
      } catch {
        /* nothing to back up yet */
      }

      await writeAtomic(this.statePath, body)
      await writeAtomic(this.boundsPath, JSON.stringify(this.bounds, null, 2))
    } catch (err) {
      console.error('[store] write failed:', err)
    }
  }
}

async function writeAtomic(file: string, body: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, body, 'utf8')
  await fs.rename(tmp, file)
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}


/**
 * Settings, range-checked rather than merely type-checked.
 *
 * A matching `typeof` is not enough. `lineHeight: 0.5` makes xterm's setter
 * throw outright, which takes the whole renderer down before a single pane
 * appears — and this file is plain JSON that a user may well open and edit. So
 * every number is clamped to a range the app can actually render, and every
 * enum is checked against its allowed values.
 */
function migrateSettings(input: unknown): Settings {
  const out: Settings = { ...defaultSettings }
  if (!input || typeof input !== 'object') return out
  const raw = input as Record<string, unknown>

  const num = (key: keyof Settings, min: number, max: number): void => {
    const v = raw[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) return
    ;(out[key] as number) = Math.min(max, Math.max(min, v))
  }
  const bool = (key: keyof Settings): void => {
    const v = raw[key]
    if (typeof v === 'boolean') (out[key] as boolean) = v
  }
  const str = (key: keyof Settings, allowed?: readonly string[]): void => {
    const v = raw[key]
    if (typeof v !== 'string' || v.length === 0 || v.length > 400) return
    if (allowed && !allowed.includes(v)) return
    ;(out[key] as string) = v
  }

  str('defaultShellId')
  str('fontFamily')
  num('fontSize', 6, 48)
  num('lineHeight', 1, 3)
  num('gutter', 0, 40)
  num('zoomInset', 0, 200)
  num('glowStrength', 0, 80)
  num('scrollback', 0, 500_000)
  num('gitPollFocused', 1000, 600_000)
  num('gitPollBlurred', 1000, 3_600_000)
  num('idleAttentionMs', 0, 600_000)
  bool('bellIsAttention')
  bool('confirmClose')
  bool('restoreSession')
  bool('restoreRunsStartup')
  bool('cursorBlink')
  bool('copyOnSelect')
  bool('rightClickPastes')
  bool('showGridLines')
  str('cursorStyle', ['block', 'underline', 'bar'])
  str('renderer', ['dom', 'webgl'])
  num('browserNetLimit', 20, 5000)
  bool('browserCaptureBodies')
  str('claudeEffort', CLAUDE_EFFORTS)
  // The model ends up on a command line GRID types into a shell, so it is
  // checked against the shape of a model name rather than merely its length.
  // This file is plain JSON that a user may well open and edit.
  if (typeof raw.claudeModel === 'string' && isSafeFlagValue(raw.claudeModel)) {
    out.claudeModel = raw.claudeModel
  }

  return out
}

/**
 * The two fields of a browser pane that are handed straight to a live web
 * view, checked on the way in.
 *
 * This file is plain JSON a user can edit, and neither field is validated
 * anywhere else on the restore path: the URL goes to `loadURL`, which does not
 * fire the navigation guards, and an unrecognised viewport would be looked up
 * in a table that does not have it.
 */
function sanitiseBrowserPane(pane: BrowserPane): BrowserPane {
  const viewport = VIEWPORT_ORDER.includes(pane.viewport) ? pane.viewport : 'desktop'
  const url = typeof pane.url === 'string' && isWebUrl(pane.url) ? pane.url : 'about:blank'
  return { ...pane, url, viewport }
}

/**
 * The tabs, however they were written.
 *
 * A version 1 file has one grid at the top of `session` and no tabs at all;
 * that becomes the single tab everything carries on inside, so upgrading GRID
 * costs nobody their layout.
 *
 * Every layout goes through `sanitiseLayout` because it is the one deeply
 * nested thing in this file and the one thing the renderer cannot survive
 * being malformed: a bad node makes `normalise` throw inside hydrate, and the
 * app comes up as a blank grid with no message and no way back.
 */
function migrateTabs(raw: Record<string, unknown>): TabState[] {
  const list = Array.isArray(raw.tabs)
    ? (raw.tabs as unknown[])
    : [{ id: 'tab_1', name: '', layout: raw.layout, focusedPaneId: raw.focusedPaneId }]

  const seen = new Set<string>()
  const tabs: TabState[] = []

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const t = entry as Record<string, unknown>
    // Two tabs sharing an id would make every lookup ambiguous, and the file
    // is plain JSON somebody may well have copy-pasted a block inside.
    let id = typeof t.id === 'string' && t.id ? t.id : `tab_${tabs.length + 1}`
    while (seen.has(id)) id = `${id}_${tabs.length + 1}`
    seen.add(id)

    tabs.push({
      id,
      name: typeof t.name === 'string' ? t.name.slice(0, 40) : '',
      layout: sanitiseLayout(t.layout),
      focusedPaneId: typeof t.focusedPaneId === 'string' ? t.focusedPaneId : null
    })
  }

  // There is no app without a grid to put panes in.
  return tabs.length > 0 ? tabs : [{ id: 'tab_1', name: '', layout: null, focusedPaneId: null }]
}

/**
 * Bring any older or hand-edited file up to the current shape. Every field is
 * defaulted individually so a partially written or manually trimmed file still
 * boots instead of throwing on a missing key.
 */
function migrate(input: PersistedState | null): PersistedState {
  const base = defaultState()
  if (!input || typeof input !== 'object') return base

  const settings = migrateSettings(input.settings)

  const repos = Array.isArray(input.repos)
    ? input.repos.filter((r) => r && typeof r.id === 'string' && typeof r.path === 'string')
    : []

  const notes = Array.isArray(input.notes)
    ? input.notes
        .filter((n) => n && typeof n.id === 'string')
        .map((n) => ({
          id: n.id,
          title: typeof n.title === 'string' ? n.title : 'scratch',
          body: typeof n.body === 'string' ? n.body : '',
          updatedAt: typeof n.updatedAt === 'number' ? n.updatedAt : Date.now()
        }))
    : []

  const session = base.session
  if (input.session && typeof input.session === 'object') {
    // Read loosely: this is the one part of the file whose shape changed
    // between versions, and a v1 file has a grid here where v2 has a list.
    const raw = input.session as unknown as Record<string, unknown>

    if (Array.isArray(raw.panes)) {
      session.panes = (raw.panes as Pane[])
        .filter(
          (p) =>
            p &&
            typeof p.id === 'string' &&
            (p.kind === 'terminal' || p.kind === 'note' || p.kind === 'browser')
        )
        .map((p) => (p.kind === 'browser' ? sanitiseBrowserPane(p) : p))
    }

    session.tabs = migrateTabs(raw)
    const activeTabId = raw.activeTabId
    session.activeTabId =
      typeof activeTabId === 'string' && session.tabs.some((t) => t.id === activeTabId)
        ? activeTabId
        : (session.tabs[0]?.id ?? null)
  }

  const shells = Array.isArray(input.shells)
    ? input.shells.filter((s) => s && typeof s.id === 'string' && typeof s.path === 'string')
    : []

  return { version: STATE_VERSION, settings, repos, notes, session, shells }
}
