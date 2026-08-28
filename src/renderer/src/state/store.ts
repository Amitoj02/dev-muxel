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
  TerminalPane
} from '../../../shared/types'
import { hostLabel, normaliseUrl } from '../../../shared/browser'
import {
  anchorFor,
  autoAppend,
  collectPaneIds,
  evenOut,
  findLeaf,
  measure,
  movePane,
  normalise,
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
   * The command GRID typed into this shell *and pressed Enter on*, if any.
   *
   * The distinction matters: a repository's "command on open" is typed into
   * every terminal whether or not "press Enter for me" is set, so the pane's
   * configuration says nothing about what is actually running. This does — and
   * it is what decides whether a captured request may be pasted into the pane
   * as one message, or has to go to a file because the pane is a bare shell.
   */
  ranStartup: string | null
}

/** A pane closed recently enough to be worth keeping around. */
export type ClosedPane = {
  pane: Pane
  /** The tree as it stood before the close, for an exact restore. */
  layout: LayoutNode | null
  /** Fallback address, for when the grid has been reshaped since. */
  anchor: { paneId: string; side: DockSide } | null
  /** True while the pty and the xterm buffer behind it are still alive. */
  parked: boolean
  expiresAt: number
  /** Pane label at the time of closing, for the toast. */
  label: string
}

export type Overlay =
  | { kind: 'none' }
  | { kind: 'repositories' }
  | { kind: 'notes' }
  | { kind: 'settings' }
  | { kind: 'shortcuts' }
  | { kind: 'confirm-close'; paneId: string }
  /** Requests picked out of a browser pane's log, on their way to a CLI. */
  | { kind: 'send-to-claude'; paneId: string; uids: string[] }

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
  layout: LayoutNode | null
  panes: Pane[]
  focusedPaneId: string | null
  /** Last terminal pane to hold focus — where a note's "send" lands. */
  lastTerminalPaneId: string | null
  /**
   * Last browser pane to hold focus. A session running /grid-browser asks for
   * "the element picker" without knowing which pane it means; this is what it
   * means.
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
  /** Closed panes still inside the reopen window, oldest first. */
  recentlyClosed: ClosedPane[]
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

export function attentionCount(s: AppState): number {
  // Over the panes, not over the runtime map: a parked pane still has a
  // runtime entry, and a pane you have closed must not shout at the taskbar.
  return s.panes.filter(
    (p) => p.id !== s.focusedPaneId && runtimeFor(s, p.id).attention !== 'none'
  ).length
}

/** True while a closed pane's shell and scrollback are held for a reopen. */
export function isParked(s: AppState, paneId: string): boolean {
  return s.recentlyClosed.some((e) => e.parked && e.pane.id === paneId)
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
  const layout = restore ? normalise(persisted.session.layout) : null

  // Drop anything the layout references but the pane list lost, and vice
  // versa: a half-written state file should still open into a usable grid.
  const inLayout = new Set(collectPaneIds(layout))
  const keptPanes = panes.filter((p) => inLayout.has(p.id))
  const known = new Set(keptPanes.map((p) => p.id))
  let repaired: LayoutNode | null = layout
  for (const paneId of inLayout) {
    if (!known.has(paneId)) repaired = removePane(repaired, paneId)
  }

  const runtime: Record<string, PaneRuntime> = {}
  for (const p of keptPanes) runtime[p.id] = { ...emptyRuntime }

  set({
    ready: true,
    buildNumber,
    restoredPaneIds: new Set(keptPanes.map((p) => p.id)),
    settings: persisted.settings,
    repos: persisted.repos,
    notes: persisted.notes,
    shells,
    layout: repaired,
    panes: keptPanes,
    focusedPaneId:
      persisted.session.focusedPaneId && known.has(persisted.session.focusedPaneId)
        ? persisted.session.focusedPaneId
        : (keptPanes[0]?.id ?? null),
    zoomedPaneId: null,
    runtime
  })
}

/** The slice that gets written to disk. */
export function toPersisted(s: AppState): PersistedState {
  return {
    version: 1,
    settings: s.settings,
    repos: s.repos,
    notes: s.notes,
    shells: s.shells.filter((sh) => !sh.builtin),
    session: {
      layout: s.layout,
      panes: s.panes,
      focusedPaneId: s.focusedPaneId,
      zoomedPaneId: null
    }
  }
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
    if (state.focusedPaneId === paneId) return
    const pane = paneById(state, paneId)
    set({
      focusedPaneId: paneId,
      lastTerminalPaneId: pane?.kind === 'terminal' ? pane.id : state.lastTerminalPaneId,
      lastBrowserPaneId: pane?.kind === 'browser' ? pane.id : state.lastBrowserPaneId
    })
    if (paneId) actions.clearAttention(paneId)
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
   * bring it back. A terminal whose shell is still alive is *parked* rather
   * than killed: nothing is torn down until the window passes, which is what
   * makes the reopen the same session and not a lookalike.
   *
   * @param opts.remember pass false when the pane is being replaced rather
   *   than closed (restarting a dead shell, say) so it does not sit in the
   *   stack pretending to be recoverable.
   */
  closePane(paneId: string, opts: { remember?: boolean } = {}): void {
    const pane = paneById(state, paneId)
    const runtime = runtimeFor(state, paneId)
    const remember = pane !== null && opts.remember !== false
    // Nothing to hold on to for a note, or for a shell that has already gone.
    const parked = remember && pane.kind === 'terminal' && runtime.pid !== null && !runtime.exited

    const entry: ClosedPane | null =
      remember && pane
        ? {
            pane,
            layout: state.layout,
            anchor: anchorFor(state.layout, paneId),
            parked,
            expiresAt: Date.now() + REOPEN_WINDOW_MS,
            label: paneLabel(state, pane)
          }
        : null

    set((s) => {
      const layout = removePane(s.layout, paneId)
      const panes = s.panes.filter((p) => p.id !== paneId)
      const runtimeMap = { ...s.runtime }
      // A parked pane keeps its runtime: the pty behind it is still running,
      // and adopting it back has to find the same pid and shell.
      if (!parked) delete runtimeMap[paneId]
      const remaining = collectPaneIds(layout)
      return {
        layout,
        panes,
        runtime: runtimeMap,
        focusedPaneId:
          s.focusedPaneId === paneId ? (remaining[remaining.length - 1] ?? null) : s.focusedPaneId,
        zoomedPaneId: s.zoomedPaneId === paneId ? null : s.zoomedPaneId,
        overlay: s.overlay.kind === 'confirm-close' ? { kind: 'none' } : s.overlay,
        recentlyClosed: entry ? [...s.recentlyClosed, entry] : s.recentlyClosed
      }
    })

    // Only worth saying when there is something running to lose.
    if (entry?.parked) actions.toast(`Closed ${entry.label} — Ctrl+Shift+T brings it back`)
  },

  /**
   * Bring back the pane closed most recently, if its window has not passed.
   * Returns false when there is nothing left to bring back.
   */
  reopenLast(): boolean {
    const now = Date.now()
    const live = state.recentlyClosed.filter((e) => e.expiresAt > now)
    const entry = live[live.length - 1]
    if (!entry) return false

    const pane = entry.pane
    // A note deleted in the meantime has nothing left to come back to.
    if (pane.kind === 'note' && !noteById(state, pane.noteId)) {
      set((s) => ({ recentlyClosed: s.recentlyClosed.filter((e) => e !== entry) }))
      return actions.reopenLast()
    }

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
        panes: [...s.panes, pane],
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

  /** Forget closed panes whose window has passed and whose resources are gone. */
  dropClosed(paneIds: string[]): void {
    if (paneIds.length === 0) return
    const drop = new Set(paneIds)
    set((s) => {
      const runtime = { ...s.runtime }
      for (const id of drop) delete runtime[id]
      return {
        runtime,
        recentlyClosed: s.recentlyClosed.filter((e) => !drop.has(e.pane.id))
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
    set({ dragging: paneId, zoomedPaneId: null })
  },

  setDropTarget(target: AppState['dropTarget']): void {
    const cur = state.dropTarget
    if (cur?.paneId === target?.paneId && cur?.side === target?.side) return
    set({ dropTarget: target })
  },

  endDrag(commit: boolean): void {
    const { dragging, dropTarget } = state
    if (commit && dragging && dropTarget && dropTarget.paneId !== dragging) {
      if (dropTarget.side === 'center') {
        set((s) => ({ layout: swapPanes(s.layout, dragging, dropTarget.paneId) }))
      } else {
        set((s) => ({
          layout: movePane(s.layout, dragging, dropTarget.paneId, dropTarget.side as DockSide)
        }))
      }
      set({ focusedPaneId: dragging })
    }
    set({ dragging: null, dropTarget: null })
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
