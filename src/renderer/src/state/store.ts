/**
 * The renderer's single source of truth.
 *
 * A hand-rolled external store rather than a state library: the whole app is
 * one object, updates are coarse, and `useSyncExternalStore` gives us tearing-
 * free reads for free. One less dependency to keep in step with React.
 *
 * The renderer owns layout / panes / repos / notes / settings and pushes the
 * whole lot at the main process to be written to disk, debounced. The main
 * process owns ptys, git and the filesystem. Nothing crosses that line.
 *
 * One shape here is worth reading before anything else. `panes` is every pane
 * in the app, across every tab; a tab is only a layout tree naming some of
 * them. The tab you are looking at keeps its grid in the *top-level*
 * `layout` / `focusedPaneId` / `zoomedPaneId`, and its entry in `tabs` is
 * stale until `tabsSnapshot` reconciles the two. That looks like duplication
 * and is the opposite: it means every reader of `state.layout` is reading the
 * grid on screen without knowing tabs exist, and there is exactly one place —
 * this file — that has to.
 */

import type {
  BrowserPane,
  DockSide,
  GitState,
  LayoutNode,
  Note,
  Pane,
  PersistedState,
  Repo,
  Settings,
  ShellProfile,
  TabState,
  TerminalPane
} from '../../../shared/types'
import type { PageComment } from '../../../shared/browser'
import { hostLabel, normaliseUrl } from '../../../shared/browser'
// The one thing this file reads from outside itself. Comments live in the
// netlog registry so a page being marked up does not re-render the grid, but
// they belong in the state file all the same — so the save reaches over for
// them rather than the registry having to know what a save is.
import { allComments, commentCount } from '../browser/netlog'
import {
  anchorFor,
  autoAppend,
  claimLeaves,
  collectPaneIds,
  evenOut,
  findLeaf,
  measure,
  movePane,
  removePane,
  resizeSplit,
  splitPane,
  swapPanes,
  type Rect
} from '../../../shared/layout'

/**
 * How long a closed pane can be brought back.
 *
 * Inside this window nothing about it has actually been torn down: the shell
 * is still running and the scrollback is still in memory, so Ctrl+Shift+T is
 * a real undo rather than a fresh terminal that happens to look the same.
 */
export const REOPEN_WINDOW_MS = 5_000

// ---------------------------------------------------------------------------

export type PaneRuntime = {
  /** Set once the pty is alive. */
  pid: number | null
  shellLabel: string | null
  /** Process has exited; the pane shows a dead state until it is closed or restarted. */
  exited: boolean
  exitCode: number | null
  /** The pane wants the user: bell rang, or it went quiet mid-task. */
  attention: 'none' | 'bell' | 'idle'
  /** Output is currently flowing. */
  busy: boolean
  /** Wall-clock ms the attention state started, for the "waiting · 40s" label. */
  attentionSince: number | null
  /** Last title the shell reported via OSC 0/2. */
  title: string | null
  /**
   * The command DevLobby typed into this shell *and pressed Enter on*, if any.
   *
   * The distinction matters: a repository's "command on open" is typed into
   * every terminal whether or not "press Enter for me" is set, so the pane's
   * configuration says nothing about what is actually running. This does — and
   * it is what decides whether a captured request may be pasted into the pane
   * as one message, or has to go to a file because the pane is a bare shell.
   */
  ranStartup: string | null
}

/**
 * One grid, as the renderer holds it.
 *
 * `zoomedPaneId` is here as well as on the persisted shape because a zoom
 * should survive a trip to another tab and back, and should not survive a
 * restart — so it is remembered, and dropped on the way to disk.
 */
export type Tab = TabState & { zoomedPaneId: string | null }

/**
 * Something closed recently enough to be worth holding on to — a pane, or a
 * whole grid of them.
 *
 * `parked` means nothing behind it has actually been torn down. A parked pane
 * stays in `panes` and stays *mounted*, hidden exactly like a pane in a tab
 * you are not looking at, which is what makes the reopen the same thing rather
 * than a lookalike: the shell is still running, xterm still has its
 * scrollback, and a browser pane still has its page, its network log and its
 * comments. See `GridView`, which draws them.
 */
export type ClosedEntry = ClosedPaneEntry | ClosedTabEntry

export type ClosedPaneEntry = {
  kind: 'pane'
  pane: Pane
  /** Tab it was closed out of, so it goes back where it came from. */
  tabId: string
  /** The tree as it stood before the close, for an exact restore. */
  layout: LayoutNode | null
  /** Fallback address, for when the grid has been reshaped since. */
  anchor: { paneId: string; side: DockSide } | null
  parked: boolean
  expiresAt: number
  /** Label at the time of closing, for the toast. */
  label: string
}

export type ClosedTabEntry = {
  kind: 'tab'
  tab: Tab
  /** Where it sat in the strip, so it goes back in the same place. */
  index: number
  /** Every pane it held. All still alive while this entry stands. */
  paneIds: string[]
  parked: boolean
  expiresAt: number
  label: string
}

export type Overlay =
  | { kind: 'none' }
  | { kind: 'repositories' }
  | { kind: 'notes' }
  | { kind: 'settings' }
  | { kind: 'shortcuts' }
  | { kind: 'confirm-close'; paneId: string }
  /** Closing a whole grid at once, when something in it is still running. */
  | { kind: 'confirm-close-tab'; tabId: string }
  /** Requests picked out of a browser pane's log, on their way to a CLI. */
  | { kind: 'send-to-claude'; paneId: string; uids: string[] }
  /**
   * A page asked for a new tab. `guestId` is main's name for the guest that
   * asked, which is what the answer has to be addressed to.
   */
  | { kind: 'browser-popup'; paneId: string; guestId: number; url: string }

export type AppState = {
  ready: boolean
  /**
   * Windows build number, from the main process. xterm needs it to know
   * whether this ConPTY reflows on resize.
   */
  buildNumber: number
  settings: Settings
  repos: Repo[]
  notes: Note[]
  shells: ShellProfile[]
  /** Every grid. The active one's copy is stale — see `tabsSnapshot`. */
  tabs: Tab[]
  activeTabId: string
  /** The active tab's tree. */
  layout: LayoutNode | null
  /** Every pane in the app, across every tab. */
  panes: Pane[]
  focusedPaneId: string | null
  /** Last terminal pane to hold focus — where a note's "send" lands. */
  lastTerminalPaneId: string | null
  /**
   * Last browser pane to hold focus. A session running /devlobby-browser asks
   * for "the element picker" without knowing which pane it means; this is what
   * it means.
   */
  lastBrowserPaneId: string | null
  zoomedPaneId: string | null
  /** Keyed by normalised repo path. */
  git: Record<string, GitState>
  runtime: Record<string, PaneRuntime>
  overlay: Overlay
  /** Pane being dragged by its header, if any. */
  dragging: string | null
  /** Live drop target while dragging. */
  dropTarget: { paneId: string; side: DockSide | 'center' } | null
  /** Tab the dragged pane is hovering over, which moves it into that grid. */
  tabDropTarget: string | null
  /** Panes and grids still inside the reopen window, oldest first. */
  recentlyClosed: ClosedEntry[]
  /**
   * Panes that came back from the last session rather than being opened just
   * now. Used to honour `restoreRunsStartup`: reopening the app should not
   * silently re-run a command in every repository unless you asked for that.
   */
  restoredPaneIds: ReadonlySet<string>
  /** Measured content box of the grid, container-local px. */
  gridBox: Rect
  /** Transient toast, cleared by the UI. */
  toast: { id: number; text: string; tone: 'info' | 'error' } | null
}

/**
 * Any change to which grid is on screen ends a drag in flight: the pane the
 * pointer was over is not there any more, and a half-finished drop would land
 * somewhere nobody aimed at.
 */
const dragCleared = { dragging: null, dropTarget: null, tabDropTarget: null }

const emptyRuntime: PaneRuntime = {
  pid: null,
  shellLabel: null,
  exited: false,
  exitCode: null,
  attention: 'none',
  busy: false,
  attentionSince: null,
  title: null,
  ranStartup: null
}

// ---------------------------------------------------------------------------

type Listener = () => void

let state: AppState = {
  ready: false,
  buildNumber: 0,
  settings: {} as Settings,
  repos: [],
  notes: [],
  shells: [],
  tabs: [],
  activeTabId: '',
  layout: null,
  panes: [],
  focusedPaneId: null,
  lastTerminalPaneId: null,
  lastBrowserPaneId: null,
  zoomedPaneId: null,
  git: {},
  runtime: {},
  overlay: { kind: 'none' },
  dragging: null,
  dropTarget: null,
  recentlyClosed: [],
  tabDropTarget: null,
  restoredPaneIds: new Set<string>(),
  gridBox: { x: 0, y: 0, width: 0, height: 0 },
  toast: null
}

const listeners = new Set<Listener>()

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getState(): AppState {
  return state
}

function set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const next = typeof patch === 'function' ? patch(state) : patch
  let changed = false
  for (const key of Object.keys(next) as Array<keyof AppState>) {
    if (state[key] !== next[key]) {
      changed = true
      break
    }
  }
  if (!changed) return
  state = { ...state, ...next }
  for (const fn of listeners) fn()
}

// ---------------------------------------------------------------------------
// ids
// ---------------------------------------------------------------------------

let seq = 0
export function newId(prefix: string): string {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`
}

// ---------------------------------------------------------------------------
// derived
// ---------------------------------------------------------------------------

export function paneById(s: AppState, paneId: string | null): Pane | null {
  if (!paneId) return null
  return s.panes.find((p) => p.id === paneId) ?? null
}

export function repoById(s: AppState, repoId: string | null | undefined): Repo | null {
  if (!repoId) return null
  return s.repos.find((r) => r.id === repoId) ?? null
}

export function noteById(s: AppState, noteId: string): Note | null {
  return s.notes.find((n) => n.id === noteId) ?? null
}

export function gitFor(s: AppState, pane: Pane | null): GitState | null {
  if (!pane || pane.kind !== 'terminal') return null
  const key = normalisePath(pane.cwd)
  return s.git[key] ?? null
}

export function runtimeFor(s: AppState, paneId: string): PaneRuntime {
  return s.runtime[paneId] ?? emptyRuntime
}

// ---------------------------------------------------------------------------
// tabs
// ---------------------------------------------------------------------------

/**
 * The tabs, with the grid on screen written back into the active one.
 *
 * Everything that reads or rewrites the whole set of grids goes through this.
 * Read the note at the top of the file for why the active tab's stored copy is
 * allowed to be stale in the first place.
 */
export function tabsSnapshot(s: AppState): Tab[] {
  return s.tabs.map((t) =>
    t.id === s.activeTabId
      ? { ...t, layout: s.layout, focusedPaneId: s.focusedPaneId, zoomedPaneId: s.zoomedPaneId }
      : t
  )
}

/** Which grid a pane is in, or null if it is in none (it was just closed). */
export function tabOfPane(s: AppState, paneId: string | null): string | null {
  if (!paneId) return null
  if (findLeaf(s.layout, paneId)) return s.activeTabId
  for (const t of s.tabs) {
    if (t.id === s.activeTabId) continue
    if (findLeaf(t.layout, paneId)) return t.id
  }
  return null
}

/** Panes in one grid, in tree order. */
export function tabPaneIds(s: AppState, tabId: string): string[] {
  if (tabId === s.activeTabId) return collectPaneIds(s.layout)
  return collectPaneIds(s.tabs.find((t) => t.id === tabId)?.layout ?? null)
}

/** What a tab is called: its own name, else where it sits. */
export function tabTitle(s: AppState, tabId: string): string {
  const index = s.tabs.findIndex((t) => t.id === tabId)
  if (index < 0) return 'grid'
  return s.tabs[index].name || `grid ${index + 1}`
}

/** Panes in this grid that want the user, so a background tab can say so. */
export function tabAttention(s: AppState, tabId: string): number {
  return tabPaneIds(s, tabId).filter(
    (id) => id !== s.focusedPaneId && runtimeFor(s, id).attention !== 'none'
  ).length
}

/** Live shells in this grid — what closing it would actually cost. */
export function tabRunning(s: AppState, tabId: string): number {
  return tabPaneIds(s, tabId).filter((id) => {
    const pane = paneById(s, id)
    if (pane?.kind !== 'terminal') return false
    const rt = runtimeFor(s, id)
    return rt.pid !== null && !rt.exited
  }).length
}

/**
 * Comments in this grid that no session has taken yet.
 *
 * Kept apart from `tabRunning` because it is a different kind of loss: a shell
 * can be started again, and a page marked up cannot be marked up again.
 */
export function tabUnsent(s: AppState, tabId: string): number {
  let n = 0
  for (const id of tabPaneIds(s, tabId)) {
    if (paneById(s, id)?.kind === 'browser') n += commentCount(id)
  }
  return n
}

export function attentionCount(s: AppState): number {
  // Across every tab on purpose — a build finishing in a grid you are not
  // looking at is exactly the thing worth being told about. Never a pane you
  // have closed, though: it is still running and still mounted for another few
  // seconds, and it must not go on flashing the taskbar for them.
  const parked = parkedPaneIds(s)
  return s.panes.filter(
    (p) =>
      p.id !== s.focusedPaneId &&
      !parked.has(p.id) &&
      runtimeFor(s, p.id).attention !== 'none'
  ).length
}

/**
 * True while a closed pane is still being held for a reopen — on its own, or
 * as part of a grid that was closed around it.
 *
 * A parked pane is still in `panes` and still on the page. Everything that
 * asks "what panes are there" for a reason other than rendering has to skip
 * them, or a pane you just closed goes on flashing the taskbar and turning up
 * as somewhere to send things.
 */
export function isParked(s: AppState, paneId: string): boolean {
  return s.recentlyClosed.some(
    (e) => e.parked && (e.kind === 'pane' ? e.pane.id === paneId : e.paneIds.includes(paneId))
  )
}

/** The panes a reopen is currently holding, in no grid and on nobody's screen. */
export function parkedPaneIds(s: AppState): Set<string> {
  const out = new Set<string>()
  for (const e of s.recentlyClosed) {
    if (!e.parked) continue
    if (e.kind === 'pane') out.add(e.pane.id)
    else for (const id of e.paneIds) out.add(id)
  }
  return out
}

/** Windows paths are case-insensitive; the git map is keyed on a stable form. */
export function normalisePath(p: string): string {
  if (!p) return ''
  return p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

export function shellById(s: AppState, id: string | undefined): ShellProfile | null {
  if (!id) return null
  return s.shells.find((sh) => sh.id === id) ?? null
}

/** Label shown in a pane header: user label, then repo name, then folder name. */
export function paneLabel(s: AppState, pane: Pane): string {
  if (pane.kind === 'note') {
    return noteById(s, pane.noteId)?.title ?? 'note'
  }
  if (pane.kind === 'browser') {
    // The page's own title first: it changes as you navigate, which is what
    // makes one browser pane tell itself apart from the next.
    return pane.label || pane.title || hostLabel(pane.url) || 'browser'
  }
  if (pane.label) return pane.label
  const repo = repoById(s, pane.repoId)
  if (repo) return repo.name
  const parts = pane.cwd.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || pane.cwd
}

// ---------------------------------------------------------------------------
// hydration
// ---------------------------------------------------------------------------

export function hydrate(
  persisted: PersistedState,
  shells: ShellProfile[],
  buildNumber: number
): void {
  // "Reopen the last layout on launch" is a setting; honour it rather than
  // always restoring and leaving the checkbox as decoration.
  const restore = persisted.settings.restoreSession !== false
  const panes = restore ? (persisted.session.panes ?? []) : []
  const known = new Set(panes.map((p) => p.id))

  // Two tabs sharing an id would make every lookup ambiguous. Main dedupes on
  // the way in; this is the same guard on the way out of a file it may not
  // have been the one to write.
  const ids = new Set<string>()
  const raw = (restore ? (persisted.session.tabs ?? []) : []).filter((t) => {
    if (!t || typeof t.id !== 'string' || ids.has(t.id)) return false
    ids.add(t.id)
    return true
  })

  // A pane belongs to exactly one grid, and nothing in the file enforces it.
  const layouts = claimLeaves(
    raw.map((t) => t.layout),
    (paneId) => known.has(paneId)
  )

  const claimed = new Set<string>()
  const tabs: Tab[] = raw.map((t, i) => {
    const mine = collectPaneIds(layouts[i])
    for (const id of mine) claimed.add(id)
    return {
      id: t.id,
      name: typeof t.name === 'string' ? t.name : '',
      layout: layouts[i],
      focusedPaneId:
        t.focusedPaneId && mine.includes(t.focusedPaneId) ? t.focusedPaneId : (mine[0] ?? null),
      // A pane restored zoomed is disorienting; always start on the full grid.
      zoomedPaneId: null
    }
  })

  if (tabs.length === 0) tabs.push(freshTab())

  const keptPanes = panes.filter((p) => claimed.has(p.id))
  const runtime: Record<string, PaneRuntime> = {}
  for (const p of keptPanes) runtime[p.id] = { ...emptyRuntime }

  const activeTabId = tabs.some((t) => t.id === persisted.session.activeTabId)
    ? (persisted.session.activeTabId as string)
    : tabs[0].id
  const active = tabs.find((t) => t.id === activeTabId) as Tab

  set({
    ready: true,
    buildNumber,
    restoredPaneIds: new Set(keptPanes.map((p) => p.id)),
    settings: persisted.settings,
    repos: persisted.repos,
    notes: persisted.notes,
    shells,
    tabs,
    activeTabId,
    layout: active.layout,
    panes: keptPanes,
    focusedPaneId: active.focusedPaneId,
    zoomedPaneId: null,
    runtime
  })
}

function freshTab(name = ''): Tab {
  return { id: newId('tab'), name, layout: null, focusedPaneId: null, zoomedPaneId: null }
}

/** The slice that gets written to disk. Version 2 is the one with tabs in it. */
export function toPersisted(s: AppState): PersistedState {
  return {
    version: 2,
    settings: s.settings,
    repos: s.repos,
    notes: s.notes,
    shells: s.shells.filter((sh) => !sh.builtin),
    session: {
      // Panes being held for a reopen are in no grid, so nothing would bring
      // them back on the next launch anyway. Left out rather than written and
      // then dropped on the way in.
      panes: s.panes.filter((p) => !isParked(s, p.id)),
      // Zoom is remembered across a tab switch and not across a restart, so it
      // is the one field of a tab that does not go to disk.
      tabs: tabsSnapshot(s).map(({ id, name, layout, focusedPaneId }) => ({
        id,
        name,
        layout,
        focusedPaneId
      })),
      activeTabId: s.activeTabId,
      // Read out of the netlog registry rather than held here, for the reason
      // given at the top of that file — but written to disk, because a page
      // somebody has marked up is the one thing in a browser pane that
      // reloading cannot get back. Only for the panes actually being written:
      // a comment naming a pane that is not coming back has nothing to show.
      comments: commentsFor(s.panes.filter((p) => !isParked(s, p.id)).map((p) => p.id))
    }
  }
}

/** The saved comments of exactly these panes, or nothing at all. */
function commentsFor(paneIds: string[]): Record<string, PageComment[]> | undefined {
  const all = allComments()
  const out: Record<string, PageComment[]> = {}
  for (const id of paneIds) {
    if (all[id]) out[id] = all[id]
  }
  return Object.keys(out).length > 0 ? out : undefined
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

export const actions = {
  setGridBox(box: Rect): void {
    const cur = state.gridBox
    if (cur.width === box.width && cur.height === box.height && cur.x === box.x && cur.y === box.y) {
      return
    }
    set({ gridBox: box })
  },

  focusPane(paneId: string | null): void {
    // A pane in another grid has to have its grid brought forward first. This
    // is reached from the taskbar's "jump to what wants you", from a note
    // being sent to a terminal, and from a session arming a picker — none of
    // which knows or should know which tab their target ended up in.
    const owner = tabOfPane(state, paneId)
    if (owner && owner !== state.activeTabId) actions.switchTab(owner)

    // Not folded into the early return below: coming back to a grid whose
    // remembered focus is the pane that was shouting lands on it already
    // focused, and it still has to stop shouting.
    if (state.focusedPaneId !== paneId) {
      const pane = paneById(state, paneId)
      set({
        focusedPaneId: paneId,
        lastTerminalPaneId: pane?.kind === 'terminal' ? pane.id : state.lastTerminalPaneId,
        lastBrowserPaneId: pane?.kind === 'browser' ? pane.id : state.lastBrowserPaneId
      })
    }
    if (paneId) actions.clearAttention(paneId)
  },

  // --- tabs --------------------------------------------------------------

  /** A new, empty grid, brought to the front. */
  addTab(name = ''): string {
    const tab = freshTab(name)
    set((s) => ({
      tabs: [...tabsSnapshot(s), tab],
      activeTabId: tab.id,
      layout: null,
      focusedPaneId: null,
      zoomedPaneId: null,
      ...dragCleared
    }))
    return tab.id
  },

  /**
   * Show another grid.
   *
   * Nothing is unmounted by this — the panes of every tab stay in the tree and
   * the ones that are not on screen are hidden, which is the whole point:
   * shells keep running, scrollback stays put and pages stay loaded. See
   * `GridView`.
   */
  switchTab(tabId: string): void {
    if (tabId === state.activeTabId) return
    if (!state.tabs.some((t) => t.id === tabId)) return
    set((s) => {
      const tabs = tabsSnapshot(s)
      const next = tabs.find((t) => t.id === tabId) as Tab
      return {
        tabs,
        activeTabId: tabId,
        layout: next.layout,
        focusedPaneId: next.focusedPaneId,
        zoomedPaneId: next.zoomedPaneId,
        ...dragCleared
      }
    })
  },

  /** The tab `delta` along, wrapping. */
  cycleTab(delta: number): void {
    const index = state.tabs.findIndex((t) => t.id === state.activeTabId)
    if (index < 0 || state.tabs.length < 2) return
    const count = state.tabs.length
    actions.switchTab(state.tabs[(index + delta + count) % count].id)
  },

  renameTab(tabId: string, name: string): void {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, name: name.slice(0, 40) } : t))
    }))
  },

  /** Reorder the strip. `toIndex` is where the tab ends up. */
  moveTab(tabId: string, toIndex: number): void {
    const from = state.tabs.findIndex((t) => t.id === tabId)
    if (from < 0) return
    const to = Math.max(0, Math.min(state.tabs.length - 1, toIndex))
    if (to === from) return
    set((s) => {
      const tabs = [...s.tabs]
      const [moved] = tabs.splice(from, 1)
      tabs.splice(to, 0, moved)
      return { tabs }
    })
  },

  /**
   * Close a whole grid and everything in it.
   *
   * Parked exactly like a single pane, and for the same five seconds: the tab
   * comes off the strip but every pane it held stays in `panes`, mounted and
   * hidden, so Ctrl+Shift+T puts the whole grid back with every shell still
   * running and every page still loaded. Closing a grid full of agents is the
   * most expensive misclick in the app, so it is the one most worth undoing.
   *
   * Returns false when there is nothing to close, including the last tab:
   * there is no app without a grid.
   */
  closeTab(tabId: string): boolean {
    const snapshot = tabsSnapshot(state)
    if (snapshot.length < 2) return false
    const index = snapshot.findIndex((t) => t.id === tabId)
    if (index < 0) return false

    const doomed = snapshot[index]
    const paneIds = collectPaneIds(doomed.layout)
    const remaining = snapshot.filter((t) => t.id !== tabId)
    const entry: ClosedTabEntry = {
      kind: 'tab',
      tab: doomed,
      index,
      paneIds,
      parked: paneIds.length > 0,
      expiresAt: Date.now() + REOPEN_WINDOW_MS,
      label: tabTitle(state, tabId)
    }
    // Fall to the tab on the right, then to the left — the browser gesture.
    const next =
      state.activeTabId === tabId
        ? remaining[Math.min(index, remaining.length - 1)]
        : (remaining.find((t) => t.id === state.activeTabId) as Tab)

    set((s) => ({
      tabs: remaining,
      activeTabId: next.id,
      layout: next.layout,
      focusedPaneId: next.focusedPaneId,
      zoomedPaneId: next.zoomedPaneId,
      // The panes stay, and so stay mounted — see the note on the type.
      overlay: s.overlay.kind === 'confirm-close-tab' ? { kind: 'none' } : s.overlay,
      recentlyClosed: [...s.recentlyClosed, entry],
      ...dragCleared
    }))

    if (entry.parked) actions.toast(`Closed ${entry.label} — Ctrl+Shift+T brings it back`)
    return true
  },

  /**
   * Move a pane into another grid.
   *
   * The pane itself is untouched — only the two trees change — so the xterm
   * instance and the guest survive, for the same reason they survive a drag
   * across the grid. Nothing switches tab: you are tidying, not going.
   */
  movePaneToTab(paneId: string, tabId: string): void {
    const from = tabOfPane(state, paneId)
    if (!from || from === tabId) return
    if (!state.tabs.some((t) => t.id === tabId)) return

    const label = paneLabel(state, paneById(state, paneId) as Pane)
    const name = tabTitle(state, tabId)

    set((s) => {
      const tabs = tabsSnapshot(s).map((t) => {
        if (t.id === from) return withoutPane(t, paneId)
        if (t.id === tabId) {
          return {
            ...t,
            layout: autoAppend(t.layout, paneId, s.gridBox, s.settings.gutter),
            focusedPaneId: paneId
          }
        }
        return t
      })
      const active = tabs.find((t) => t.id === s.activeTabId) as Tab
      return {
        tabs,
        layout: active.layout,
        focusedPaneId: active.focusedPaneId,
        zoomedPaneId: active.zoomedPaneId,
        ...dragCleared
      }
    })

    actions.toast(`Moved ${label} to ${name}`)
  },

  setTabDropTarget(tabId: string | null): void {
    if (state.tabDropTarget === tabId) return
    // Exclusive with the in-grid preview. The grid stops seeing pointer moves
    // the moment the cursor is over the strip, so its indicator would freeze
    // where it last was and go on promising a landing spot that is not where
    // the pane is about to go.
    set(tabId ? { tabDropTarget: tabId, dropTarget: null } : { tabDropTarget: null })
  },

  // --- panes -------------------------------------------------------------

  addTerminal(
    opts: {
      repoId?: string | null
      cwd?: string
      shellId?: string
      /** Overrides the repo's command on open — and then runs it. */
      startupCommand?: string
      runStartup?: boolean
      label?: string
    } = {}
  ): string | null {
    const repo = repoById(state, opts.repoId ?? null)
    const cwd = opts.cwd ?? repo?.path
    if (!cwd) return null

    const shellId = opts.shellId ?? repo?.shellId ?? state.settings.defaultShellId
    const pane: TerminalPane = {
      id: newId('pane'),
      kind: 'terminal',
      repoId: repo?.id ?? null,
      cwd,
      shellId,
      startupCommand: opts.startupCommand ?? repo?.startupCommand,
      runStartup: opts.startupCommand ? (opts.runStartup ?? true) : undefined,
      label: opts.label
    }

    set((s) => ({
      panes: [...s.panes, pane],
      layout: autoAppend(s.layout, pane.id, s.gridBox, s.settings.gutter),
      focusedPaneId: pane.id,
      runtime: { ...s.runtime, [pane.id]: { ...emptyRuntime } },
      zoomedPaneId: null
    }))
    return pane.id
  },

  /**
   * "+ Terminal" with no folder chosen: reuse the focused pane's repo, else
   * the first declared repo. With nothing declared yet, send the user to the
   * repository manager rather than opening a shell in some arbitrary folder.
   */
  addTerminalSmart(): void {
    const focused = paneById(state, state.focusedPaneId)
    if (focused && focused.kind === 'terminal') {
      actions.addTerminal({ repoId: focused.repoId, cwd: focused.cwd, shellId: focused.shellId })
      return
    }
    // A browser pane knows its repository too, and "the project I am looking
    // at" is a better guess than "the first one I ever declared".
    if (focused && focused.kind === 'browser' && focused.repoId) {
      actions.addTerminal({ repoId: focused.repoId })
      return
    }
    const repo = state.repos[0]
    if (repo) {
      actions.addTerminal({ repoId: repo.id })
      return
    }
    actions.showOverlay({ kind: 'repositories' })
  },

  /**
   * Split an existing pane, opening a second one of the same kind: another
   * terminal on the same folder, or the same page again — which is how you end
   * up with one page at desktop width next to itself at phone width.
   */
  splitFrom(paneId: string, side: DockSide = 'right'): string | null {
    const source = paneById(state, paneId)
    if (!source || source.kind === 'note') return null

    const pane: Pane =
      source.kind === 'terminal'
        ? {
            id: newId('pane'),
            kind: 'terminal',
            repoId: source.repoId,
            cwd: source.cwd,
            shellId: source.shellId,
            startupCommand: undefined
          }
        : {
            id: newId('pane'),
            kind: 'browser',
            repoId: source.repoId,
            url: source.url,
            viewport: source.viewport,
            title: source.title
          }

    set((s) => ({
      panes: [...s.panes, pane],
      layout: splitPane(s.layout, paneId, side, pane.id),
      focusedPaneId: pane.id,
      runtime: { ...s.runtime, [pane.id]: { ...emptyRuntime } },
      zoomedPaneId: null
    }))
    return pane.id
  },

  addNote(opts: { title?: string; body?: string } = {}): string {
    const note: Note = {
      id: newId('note'),
      title: opts.title ?? nextNoteTitle(state.notes),
      body: opts.body ?? '',
      updatedAt: Date.now()
    }
    const pane: Pane = { id: newId('pane'), kind: 'note', noteId: note.id }

    set((s) => ({
      notes: [...s.notes, note],
      panes: [...s.panes, pane],
      layout: autoAppend(s.layout, pane.id, s.gridBox, s.settings.gutter),
      focusedPaneId: pane.id,
      runtime: { ...s.runtime, [pane.id]: { ...emptyRuntime } },
      zoomedPaneId: null
    }))
    return pane.id
  },

  /** Open an existing note in a new pane, or focus it if already on screen. */
  openNote(noteId: string): void {
    const existing = state.panes.find((p) => p.kind === 'note' && p.noteId === noteId)
    if (existing) {
      actions.focusPane(existing.id)
      return
    }
    const pane: Pane = { id: newId('pane'), kind: 'note', noteId }
    set((s) => ({
      panes: [...s.panes, pane],
      layout: autoAppend(s.layout, pane.id, s.gridBox, s.settings.gutter),
      focusedPaneId: pane.id,
      runtime: { ...s.runtime, [pane.id]: { ...emptyRuntime } },
      // Otherwise the new pane is focused but hidden behind the zoom scrim.
      zoomedPaneId: null
    }))
  },

  // --- browser -----------------------------------------------------------

  /**
   * A page in the grid. Unlike a terminal it needs no repository — you can
   * open one before you have declared anything — but it takes one when there
   * is one, because that is how a captured request finds its way to the Claude
   * session running on the project that served it.
   */
  addBrowser(opts: { repoId?: string | null; url?: string } = {}): string {
    const repo = repoById(state, opts.repoId ?? null)
    const wanted = opts.url ?? repo?.devUrl ?? ''
    const parsed = wanted ? normaliseUrl(wanted) : null

    const pane: BrowserPane = {
      id: newId('pane'),
      kind: 'browser',
      repoId: repo?.id ?? null,
      url: parsed?.ok ? parsed.url : 'about:blank',
      viewport: 'desktop'
    }

    set((s) => ({
      panes: [...s.panes, pane],
      layout: autoAppend(s.layout, pane.id, s.gridBox, s.settings.gutter),
      focusedPaneId: pane.id,
      runtime: { ...s.runtime, [pane.id]: { ...emptyRuntime } },
      zoomedPaneId: null
    }))
    return pane.id
  },

  /** `＋ Browser` with nothing chosen: inherit the focused pane's repository. */
  addBrowserSmart(): void {
    const focused = paneById(state, state.focusedPaneId)
    const repoId =
      focused && focused.kind !== 'note' ? focused.repoId : (state.repos[0]?.id ?? null)
    actions.addBrowser({ repoId })
  },

  /** Url, title and viewport all arrive from the guest as it navigates. */
  patchBrowser(paneId: string, patch: Partial<Omit<BrowserPane, 'id' | 'kind'>>): void {
    set((s) => {
      const pane = s.panes.find((p) => p.id === paneId)
      if (!pane || pane.kind !== 'browser') return {}
      let same = true
      for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
        if (pane[key] !== patch[key]) {
          same = false
          break
        }
      }
      if (same) return {}
      return { panes: s.panes.map((p) => (p.id === paneId ? { ...p, ...patch } : p)) }
    })
  },

  /**
   * Close a pane and remember it for REOPEN_WINDOW_MS, so Ctrl+Shift+T can
   * bring it back.
   *
   * Anything with something live behind it is *parked* rather than closed: it
   * comes out of its grid but stays in `panes`, so it stays mounted and hidden
   * and nothing is torn down until the window passes. That is what makes the
   * reopen the same thing and not a lookalike — a terminal keeps its shell and
   * its scrollback, and a browser pane keeps its page, its scroll position,
   * its network log and any comments written on it.
   *
   * A note is not parked: the note itself lives in the store, so there is
   * nothing to hold. Nor is a terminal whose shell has already exited.
   *
   * @param opts.remember pass false when the pane is being replaced rather
   *   than closed (restarting a dead shell, say) so it does not sit in the
   *   stack pretending to be recoverable.
   */
  closePane(paneId: string, opts: { remember?: boolean } = {}): void {
    const pane = paneById(state, paneId)
    const runtime = runtimeFor(state, paneId)
    const remember = pane !== null && opts.remember !== false
    const parked =
      remember &&
      (pane.kind === 'browser' ||
        (pane.kind === 'terminal' && runtime.pid !== null && !runtime.exited))

    // Addressed by grid rather than assumed to be the one on screen. Nothing
    // in the UI can close a hidden pane today, but the reopen has to know
    // which tab to put it back into either way.
    const owner = tabOfPane(state, paneId) ?? state.activeTabId
    const home =
      owner === state.activeTabId
        ? state.layout
        : (state.tabs.find((t) => t.id === owner)?.layout ?? null)

    const entry: ClosedEntry | null =
      remember && pane
        ? {
            kind: 'pane',
            pane,
            tabId: owner,
            layout: home,
            anchor: anchorFor(home, paneId),
            parked,
            expiresAt: Date.now() + REOPEN_WINDOW_MS,
            label: paneLabel(state, pane)
          }
        : null

    set((s) => {
      const tabs = tabsSnapshot(s).map((t) => (t.id === owner ? withoutPane(t, paneId) : t))
      const active = tabs.find((t) => t.id === s.activeTabId) as Tab
      const runtimeMap = { ...s.runtime }
      // A parked pane keeps its runtime: the pty behind it is still running,
      // and adopting it back has to find the same pid and shell.
      if (!parked) delete runtimeMap[paneId]
      return {
        tabs,
        layout: active.layout,
        // A parked pane stays in the list, and so stays mounted. Taking it out
        // is what would destroy it — React would unmount the component, and
        // with it the xterm host and the <webview>'s guest.
        panes: parked ? s.panes : s.panes.filter((p) => p.id !== paneId),
        runtime: runtimeMap,
        focusedPaneId: active.focusedPaneId,
        zoomedPaneId: active.zoomedPaneId,
        overlay: s.overlay.kind === 'confirm-close' ? { kind: 'none' } : s.overlay,
        recentlyClosed: entry ? [...s.recentlyClosed, entry] : s.recentlyClosed
      }
    })

    // Only worth saying when there is something to lose.
    if (entry?.parked) actions.toast(`Closed ${entry.label} — Ctrl+Shift+T brings it back`)
  },

  /**
   * Bring back the last thing you closed, whatever it was — a pane, or a whole
   * grid. Returns false when there is nothing left inside the window.
   */
  reopenLast(): boolean {
    const now = Date.now()
    const live = state.recentlyClosed.filter((e) => e.expiresAt > now)
    const entry = live[live.length - 1]
    if (!entry) return false

    if (entry.kind === 'tab') {
      set((s) => {
        const tabs = tabsSnapshot(s)
        // Back where it sat, unless the strip has since got shorter.
        tabs.splice(Math.min(entry.index, tabs.length), 0, entry.tab)
        return {
          tabs,
          activeTabId: entry.tab.id,
          // Its panes never left `panes`, so the tree it comes back with still
          // points at the same live components.
          layout: entry.tab.layout,
          focusedPaneId: entry.tab.focusedPaneId,
          zoomedPaneId: entry.tab.zoomedPaneId,
          recentlyClosed: s.recentlyClosed.filter((e) => e !== entry),
          ...dragCleared
        }
      })
      return true
    }

    const pane = entry.pane
    // A note deleted in the meantime has nothing left to come back to.
    if (pane.kind === 'note' && !noteById(state, pane.noteId)) {
      set((s) => ({ recentlyClosed: s.recentlyClosed.filter((e) => e !== entry) }))
      return actions.reopenLast()
    }

    // Back into the grid it was closed out of, which may not be the one on
    // screen. Going there first is also what puts the restore in front of the
    // user rather than behind a tab they are not looking at.
    if (state.tabs.some((t) => t.id === entry.tabId)) actions.switchTab(entry.tabId)

    set((s) => {
      const current = new Set(collectPaneIds(s.layout))
      const before = new Set(collectPaneIds(entry.layout))
      // If nothing else has moved since, the whole tree goes back exactly as
      // it was, including the space the neighbours grew into.
      const untouched =
        before.delete(pane.id) &&
        before.size === current.size &&
        [...current].every((id) => before.has(id))

      let layout: LayoutNode | null
      if (untouched) layout = entry.layout
      else if (entry.anchor && findLeaf(s.layout, entry.anchor.paneId)) {
        layout = splitPane(s.layout, entry.anchor.paneId, entry.anchor.side, pane.id)
      } else {
        layout = autoAppend(s.layout, pane.id, s.gridBox, s.settings.gutter)
      }

      return {
        // A parked pane never left the list — putting it back would render it
        // twice. Anything else is re-appended, which is a fresh component.
        panes: entry.parked ? s.panes : [...s.panes, pane],
        layout,
        focusedPaneId: pane.id,
        lastTerminalPaneId: pane.kind === 'terminal' ? pane.id : s.lastTerminalPaneId,
        // A parked pane still has its runtime; anything else starts clean.
        runtime: { ...s.runtime, [pane.id]: s.runtime[pane.id] ?? { ...emptyRuntime } },
        recentlyClosed: s.recentlyClosed.filter((e) => e !== entry),
        zoomedPaneId: null
      }
    })
    return true
  },

  /**
   * Let go of everything whose reopen window has passed.
   *
   * Dropping a parked pane out of `panes` is the whole of it: that unmounts
   * the component, and each kind's own cleanup does its own killing — the pty
   * and the xterm instance for a terminal, the debugger and the network log
   * for a browser pane. Same path as any other close, so there is one place
   * that ends a pane rather than two that have to agree.
   */
  dropExpired(now = Date.now()): void {
    const expired = state.recentlyClosed.filter((e) => e.expiresAt <= now)
    if (expired.length === 0) return

    const gone = new Set<string>()
    for (const e of expired) {
      if (e.kind === 'pane') gone.add(e.pane.id)
      else for (const id of e.paneIds) gone.add(id)
    }

    set((s) => {
      const runtime = { ...s.runtime }
      for (const id of gone) delete runtime[id]
      return {
        panes: s.panes.filter((p) => !gone.has(p.id)),
        runtime,
        recentlyClosed: s.recentlyClosed.filter((e) => !expired.includes(e))
      }
    })
  },

  toggleZoom(paneId: string): void {
    set((s) => ({
      zoomedPaneId: s.zoomedPaneId === paneId ? null : paneId,
      focusedPaneId: paneId
    }))
  },

  closeZoom(): void {
    if (state.zoomedPaneId) set({ zoomedPaneId: null })
  },

  // --- layout ------------------------------------------------------------

  resize(splitId: string, index: number, deltaFraction: number): void {
    set((s) => ({ layout: resizeSplit(s.layout, splitId, index, deltaFraction) }))
  },

  evenOut(): void {
    set((s) => ({ layout: evenOut(s.layout) }))
  },

  beginDrag(paneId: string): void {
    set({ dragging: paneId, zoomedPaneId: null, tabDropTarget: null })
  },

  setDropTarget(target: AppState['dropTarget']): void {
    const cur = state.dropTarget
    if (cur?.paneId === target?.paneId && cur?.side === target?.side) return
    set({ dropTarget: target })
  },

  endDrag(commit: boolean): void {
    const { dragging, dropTarget, tabDropTarget } = state
    if (commit && dragging && tabDropTarget) {
      // Dropped on the tab strip: the pane changes grid rather than moving
      // inside one. Nothing is unmounted by it — see `movePaneToTab`.
      actions.movePaneToTab(dragging, tabDropTarget)
    } else if (commit && dragging && dropTarget && dropTarget.paneId !== dragging) {
      if (dropTarget.side === 'center') {
        set((s) => ({ layout: swapPanes(s.layout, dragging, dropTarget.paneId) }))
      } else {
        set((s) => ({
          layout: movePane(s.layout, dragging, dropTarget.paneId, dropTarget.side as DockSide)
        }))
      }
      set({ focusedPaneId: dragging })
    }
    set({ dragging: null, dropTarget: null, tabDropTarget: null })
  },

  // --- repos -------------------------------------------------------------

  addRepo(repo: Omit<Repo, 'id'>): Repo | null {
    const key = normalisePath(repo.path)
    if (!key) return null
    const existing = state.repos.find((r) => normalisePath(r.path) === key)
    if (existing) return existing
    const next: Repo = { ...repo, id: newId('repo') }
    set((s) => ({ repos: [...s.repos, next] }))
    return next
  },

  updateRepo(id: string, patch: Partial<Repo>): void {
    set((s) => ({ repos: s.repos.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
  },

  removeRepo(id: string): void {
    set((s) => ({
      repos: s.repos.filter((r) => r.id !== id),
      // Panes stay open on their folder or page; they just stop being tied to
      // a repo. Browser panes carry a repoId too, and a dangling one would
      // send their network captures to a Claude session in the wrong project.
      panes: s.panes.map((p) =>
        p.kind !== 'note' && p.repoId === id ? { ...p, repoId: null } : p
      )
    }))
  },


  setGit(path: string, git: GitState): void {
    set((s) => ({ git: { ...s.git, [normalisePath(path)]: git } }))
  },

  setGitSnapshot(snapshot: Record<string, GitState>): void {
    const next: Record<string, GitState> = {}
    for (const [k, v] of Object.entries(snapshot)) next[normalisePath(k)] = v
    set({ git: next })
  },

  // --- notes -------------------------------------------------------------

  updateNote(noteId: string, patch: Partial<Omit<Note, 'id'>>): void {
    set((s) => ({
      notes: s.notes.map((n) =>
        n.id === noteId ? { ...n, ...patch, updatedAt: Date.now() } : n
      )
    }))
  },

  deleteNote(noteId: string): void {
    set((s) => ({ notes: s.notes.filter((n) => n.id !== noteId) }))
  },

  // --- runtime -----------------------------------------------------------

  patchRuntime(paneId: string, patch: Partial<PaneRuntime>): void {
    set((s) => {
      const cur = s.runtime[paneId] ?? emptyRuntime
      let same = true
      for (const key of Object.keys(patch) as Array<keyof PaneRuntime>) {
        if (cur[key] !== patch[key]) {
          same = false
          break
        }
      }
      if (same) return {}
      return { runtime: { ...s.runtime, [paneId]: { ...cur, ...patch } } }
    })
  },

  raiseAttention(paneId: string, kind: 'bell' | 'idle'): void {
    // A bell outranks an idle guess and should not be downgraded by one.
    const cur = runtimeFor(state, paneId)
    if (cur.attention === 'bell' && kind === 'idle') return
    if (state.focusedPaneId === paneId && state.zoomedPaneId !== null) return
    actions.patchRuntime(paneId, { attention: kind, attentionSince: Date.now() })
  },

  clearAttention(paneId: string): void {
    const cur = runtimeFor(state, paneId)
    if (cur.attention === 'none') return
    actions.patchRuntime(paneId, { attention: 'none', attentionSince: null })
  },

  // --- settings / chrome -------------------------------------------------

  patchSettings(patch: Partial<Settings>): void {
    set((s) => ({ settings: { ...s.settings, ...patch } }))
  },

  setShells(shells: ShellProfile[]): void {
    set({ shells })
  },

  showOverlay(overlay: Overlay): void {
    set({ overlay })
  },

  closeOverlay(): void {
    if (state.overlay.kind !== 'none') set({ overlay: { kind: 'none' } })
  },

  toast(text: string, tone: 'info' | 'error' = 'info'): void {
    set({ toast: { id: Date.now(), text, tone } })
  },

  clearToast(): void {
    if (state.toast) set({ toast: null })
  }
}

/** Take a pane out of one grid, keeping that grid's own focus and zoom honest. */
function withoutPane(tab: Tab, paneId: string): Tab {
  const layout = removePane(tab.layout, paneId)
  const left = collectPaneIds(layout)
  return {
    ...tab,
    layout,
    focusedPaneId:
      tab.focusedPaneId === paneId ? (left[left.length - 1] ?? null) : tab.focusedPaneId,
    zoomedPaneId: tab.zoomedPaneId === paneId ? null : tab.zoomedPaneId
  }
}

function nextNoteTitle(notes: Note[]): string {
  if (!notes.some((n) => n.title === 'scratch')) return 'scratch'
  let i = 2
  while (notes.some((n) => n.title === `scratch ${i}`)) i += 1
  return `scratch ${i}`
}

/** Rects for the current layout, recomputed whenever geometry inputs change. */
export function currentMeasure(s: AppState): ReturnType<typeof measure> {
  return measure(s.layout, s.gridBox, s.settings.gutter ?? 6)
}
