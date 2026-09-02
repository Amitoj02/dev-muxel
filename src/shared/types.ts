/**
 * Types shared verbatim between the main process, the preload bridge and the
 * renderer. Nothing in here may import from `electron` or from the DOM.
 */

// Type-only, and deliberately: `browser.ts` reads `ViewportId` back out of
// this file, so anything but an erased import would be a cycle at runtime.
import type { PageComment } from './browser'

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
  /**
   * Press Enter on this pane's own `startupCommand`, overriding the repo's
   * `runOnOpen`. Set when DevLobby opened the terminal to run something
   * specific — a Claude session started from a browser pane's network log, say.
   */
  runStartup?: boolean
  /** User-set label; falls back to the repo name or the folder name. */
  label?: string
}

export type NotePane = {
  id: string
  kind: 'note'
  noteId: string
}

/** Which device the browser pane lays its page out as. */
export type ViewportId = 'mobile' | 'tablet' | 'desktop'

export type BrowserPane = {
  id: string
  kind: 'browser'
  /**
   * Repository this page belongs to. Not used for git — a page has no working
   * tree — but it is how "send this request to Claude" finds the session
   * running on the project that served the request.
   */
  repoId: string | null
  /** The page open right now; restored on launch. */
  url: string
  viewport: ViewportId
  /** User-set label; falls back to the page title, then the host. */
  label?: string
  /** Last title the page reported, so a restored pane has a name before it loads. */
  title?: string
}

export type Pane = TerminalPane | NotePane | BrowserPane

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
  /** Where this project runs. A browser pane opened here starts on it. */
  devUrl?: string
  /**
   * Watch the repositories *inside* this folder rather than the folder itself.
   *
   * Set when the folder you declared turns out not to be a work tree but to
   * have work trees in it, which is what a projects directory is. The state
   * published for it is then the sum of theirs — see `shared/git.ts`.
   */
  scan?: boolean
  /** Levels below the folder to look in. 1 is the folders directly inside it. */
  scanDepth?: number
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
  /**
   * The repositories found inside this folder, when `scan` is set on the repo
   * that declared it. Present only for a folder, and when it is, **every count
   * above is their sum** — which is what lets a header, a spine and a
   * repository row go on reading one flat state.
   */
  members?: GitState[]
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
  /** True when DevLobby discovered it rather than the user adding it. */
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
  /** Requests kept per browser pane before the oldest are dropped. */
  browserNetLimit: number
  /**
   * Keep response bodies for the requests worth reading (XHR, documents, and
   * anything that failed). Off means the log still lists every request, it
   * just has nothing to hand Claude but the headers.
   */
  browserCaptureBodies: boolean
  /**
   * Model and effort DevLobby opens a Claude session with when it starts one
   * for you. Empty means "whatever the CLI defaults to". A session that is
   * already running always wins over these: it was started with its own flags,
   * and pasting into it cannot change them.
   */
  claudeModel: string
  claudeEffort: string
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

/**
 * One whole grid.
 *
 * Panes live in a single flat list on the session, not inside the tab: a tab
 * is only the tree saying which of them it shows and how they are arranged.
 * That is what makes moving a pane between tabs a change of address rather
 * than a rebuild — the component is never unmounted, so the shell behind a
 * terminal and the page behind a browser pane both survive the move, for the
 * same reason they survive being dragged across the grid.
 *
 * A pane id must appear in exactly one tab's layout. Nothing enforces that in
 * the file, so `hydrate` does it on the way in.
 */
export type TabState = {
  id: string
  /** Empty means "unnamed"; the UI numbers those. */
  name: string
  layout: LayoutNode | null
  focusedPaneId: string | null
}

// ---------------------------------------------------------------------------
// Persisted session
// ---------------------------------------------------------------------------

export type SessionState = {
  /** Every pane in the app, across every tab. */
  panes: Pane[]
  tabs: TabState[]
  activeTabId: string | null
  /**
   * Comments written on the pages in browser panes, by pane id.
   *
   * They are on disk for the same reason the layout is: they are work, and
   * work should survive the app being closed. Nothing else about a browser
   * pane is expensive to recreate — a page reloads — but a page somebody has
   * marked up cannot be got back by reloading it.
   *
   * Held here rather than on the pane itself so the shape a pane is restored
   * from stays small and readable; they are reunited by id on the way in.
   */
  comments?: Record<string, PageComment[]>
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

/**
 * Whether the `/devlobby-browser` skill is installed for the user, and whether
 * it is the one this build of DevLobby ships. A copy with no version stamp was
 * written by hand and counts as out of date — see `main/browser/skill.ts`.
 *
 * Asked and answered per Claude profile: a machine can carry several — the
 * default `.claude` and a second account's `.claude-work` beside it — and a
 * skill installed in one is not there for a session running out of the other.
 */
export type SkillProfile = {
  /** The configuration directory itself, so the UI can tell two apart. */
  configDir: string
  /** Where the skill is, or would go, so the UI can name it. */
  dir: string
  installed: boolean
  version: number | null
  current: boolean
  /**
   * The pre-rename `/devmuxel-browser` and `/grid-browser` skills, whichever
   * are still in this profile. Named so the user can delete them; installing
   * the new one does not touch them.
   */
  legacyDirs: string[]
}

export type SkillStatus = {
  /** Every profile found, the default `.claude` first. Never empty. */
  profiles: SkillProfile[]
  /** Installed in every profile — though a copy may still be out of date. */
  installed: boolean
  /** Current in every profile: the install button has nothing left to do. */
  current: boolean
  /** Every pre-rename skill still on disk, across all of them. */
  legacyDirs: string[]
}

/** What installing did, named by profile so the toast can say how many. */
export type SkillInstallResult =
  | { ok: true; dirs: string[] }
  | { ok: false; error: string; dirs: string[] }

export type RepoScanResult = {
  path: string
  name: string
  alreadyAdded: boolean
}

/**
 * What the git watcher is told to follow.
 *
 * A subset of `Repo` rather than the whole thing: the watcher has no business
 * with a repository's colour or its startup command, and the renderer pushes
 * this list every time the paths change.
 */
export type WatchedRepo = {
  id: string
  path: string
  /** Follow the repositories inside this folder instead of the folder itself. */
  scan?: boolean
  scanDepth?: number
}
