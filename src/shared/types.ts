/**
 * Types shared verbatim between the main process, the preload bridge and the
 * renderer. Nothing in here may import from `electron` or from the DOM.
 */

// ---------------------------------------------------------------------------
// Layout tree
// ---------------------------------------------------------------------------

/** Direction children of a split are laid out along. Matches flexbox naming. */
export type SplitDir = 'row' | 'column'

/** Which edge of a target pane a dropped pane docks against. */
export type DockSide = 'left' | 'right' | 'top' | 'bottom'

export type LayoutLeaf = {
  kind: 'leaf'
  id: string
  paneId: string
}

export type LayoutSplit = {
  kind: 'split'
  id: string
  dir: SplitDir
  /** Always length >= 2 in a normalised tree. */
  children: LayoutNode[]
  /** Fractions, same length as `children`, summing to 1. */
  sizes: number[]
}

export type LayoutNode = LayoutLeaf | LayoutSplit

// ---------------------------------------------------------------------------
// Panes
// ---------------------------------------------------------------------------

export type TerminalPane = {
  id: string
  kind: 'terminal'
  /** Repository this terminal belongs to, or null for an ad-hoc directory. */
  repoId: string | null
  /** Absolute working directory the shell was started in. */
  cwd: string
  /** Id of the shell profile from settings.shells. */
  shellId: string
  /** Command typed into the shell right after it starts (no trailing newline added unless runOnOpen). */
  startupCommand?: string
  /** User-set label; falls back to the repo name or the folder name. */
  label?: string
}

export type NotePane = {
  id: string
  kind: 'note'
  noteId: string
}

export type Pane = TerminalPane | NotePane

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export type Repo = {
  id: string
  name: string
  path: string
  /** Overrides settings.defaultShellId when opening a terminal here. */
  shellId?: string
  /** Command run automatically when a terminal opens on this repo. */
  startupCommand?: string
  /** Send the startup command with a newline (i.e. actually run it). */
  runOnOpen?: boolean
  /** Accent used for this repo's spine when the tree is clean. */
  color?: string
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export type Note = {
  id: string
  title: string
  body: string
  updatedAt: number
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

export type GitState = {
  /** Absolute repo path the state was computed for. */
  path: string
  /** True when `path` is inside a git work tree. */
  isRepo: boolean
  /** Branch name, or null when detached / unborn. */
  branch: string | null
  /** Short oid, shown when detached. */
  head: string | null
  detached: boolean
  /** Repo has no commits yet. */
  unborn: boolean
  upstream: string | null
  ahead: number
  behind: number
  /** Tracked files with staged changes. */
  staged: number
  /** Tracked files with unstaged changes. */
  modified: number
  /** Untracked files (counted with -uall, capped). */
  untracked: number
  /** Unmerged / conflicted paths. */
  conflicted: number
  /** Convenience: staged + modified + conflicted. */
  dirty: number
  /** Half-finished git operation, which porcelain=v2 cannot report on its own. */
  operation: 'rebase' | 'merge' | 'cherry-pick' | 'revert' | 'am' | 'bisect' | null
  /** Populated when the git call failed. */
  error: string | null
  /** Wall-clock ms when this snapshot was produced. */
  at: number
}

// ---------------------------------------------------------------------------
// Shells
// ---------------------------------------------------------------------------

export type ShellProfile = {
  id: string
  label: string
  /** Absolute path to the executable. */
  path: string
  args: string[]
  /** Extra env layered on top of process.env. */
  env?: Record<string, string>
  /** True when GRID discovered it rather than the user adding it. */
  builtin?: boolean
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type Settings = {
  defaultShellId: string
  fontFamily: string
  fontSize: number
  lineHeight: number
  /** Gutter between panes, px. Design default 6. */
  gutter: number
  /** Inset of a zoomed pane from the window edge, px. Design default 26. */
  zoomInset: number
  /** Attention glow radius, px. Design default 26. */
  glowStrength: number
  scrollback: number
  /** Git poll interval while the window is focused, ms. */
  gitPollFocused: number
  /** Git poll interval while the window is in the background, ms. */
  gitPollBlurred: number
  /** Treat a terminal bell as "this pane needs you". */
  bellIsAttention: boolean
  /** Mark a pane as idle-waiting after this many ms of silence following output. 0 disables. */
  idleAttentionMs: number
  /** Ask before closing a pane whose child process is still running. */
  confirmClose: boolean
  /** Restore the previous layout on launch. */
  restoreSession: boolean
  /** Run each repo's startup command when a restored terminal reopens. */
  restoreRunsStartup: boolean
  cursorBlink: boolean
  cursorStyle: 'block' | 'underline' | 'bar'
  copyOnSelect: boolean
  rightClickPastes: boolean
  showGridLines: boolean
  /**
   * xterm renderer. DOM is the safe default: measured on par with WebGL on a
   * real GPU and ~2.5x faster when the GPU is blocklisted (RDP, VMs), and it
   * does not spend one of the renderer process's 16 WebGL contexts per pane.
   */
  renderer: 'dom' | 'webgl'
}

// ---------------------------------------------------------------------------
// Persisted session
// ---------------------------------------------------------------------------

export type SessionState = {
  layout: LayoutNode | null
  panes: Pane[]
  focusedPaneId: string | null
  zoomedPaneId: string | null
}

export type PersistedState = {
  version: number
  settings: Settings
  repos: Repo[]
  notes: Note[]
  session: SessionState
  shells: ShellProfile[]
}

export type WindowBounds = {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

// ---------------------------------------------------------------------------
// IPC payloads
// ---------------------------------------------------------------------------

export type PtySpawnRequest = {
  paneId: string
  cwd: string
  shellId: string
  cols: number
  rows: number
}

export type PtySpawnResult =
  | { ok: true; pid: number; shellLabel: string }
  | { ok: false; error: string }

export type PtyExitEvent = {
  paneId: string
  exitCode: number
  signal?: number
}

export type PtyDataEvent = {
  paneId: string
  data: string
  /** Running total of bytes main has sent for this pane; echoed back on ack. */
  seq: number
}

export type RepoScanResult = {
  path: string
  name: string
  alreadyAdded: boolean
}
