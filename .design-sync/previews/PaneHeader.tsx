import { PaneHeader } from 'dev-muxel'

const noop = (): void => {}

const git = {
  path: 'C:\\Users\\dev\\projects\\dev-muxel',
  isRepo: true,
  branch: 'main',
  head: '4f1d2e1',
  detached: false,
  unborn: false,
  upstream: 'origin/main',
  ahead: 0,
  behind: 0,
  staged: 0,
  modified: 0,
  untracked: 0,
  conflicted: 0,
  dirty: 0,
  operation: null,
  error: null,
  at: Date.now()
}

const runtime = {
  pid: 24180,
  shellLabel: 'PowerShell',
  exited: false,
  exitCode: null,
  attention: 'none' as const,
  busy: false,
  attentionSince: null,
  title: null,
  ranStartup: null
}

const terminal = {
  id: 'p1',
  kind: 'terminal' as const,
  repoId: 'r1',
  cwd: 'C:\\Users\\dev\\projects\\dev-muxel',
  shellId: 'powershell',
  label: 'dev-muxel'
}

const handlers = {
  onFocus: noop,
  onZoom: noop,
  onClose: noop,
  onSplit: noop,
  onOpenEditor: noop,
  onDragStart: noop
}

const Row = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div style={{ background: 'var(--bg-pane)', border: '1px solid var(--line)', width: 460 }}>
    {children}
  </div>
)

/** A terminal on a clean tree — the branch chip is the quiet green. */
export const Clean = (): React.JSX.Element => (
  <Row>
    <PaneHeader pane={terminal} label="dev-muxel" git={git} runtime={runtime} zoomed={false} {...handlers} />
  </Row>
)

/** Work in progress: staged, modified and ahead all read off the same chip. */
export const Dirty = (): React.JSX.Element => (
  <Row>
    <PaneHeader
      pane={terminal}
      label="dev-muxel"
      git={{ ...git, staged: 1, modified: 3, untracked: 2, dirty: 4, ahead: 2 }}
      runtime={{ ...runtime, busy: true, title: 'npm run dev' }}
      zoomed={false}
      {...handlers}
    />
  </Row>
)

/** A pane asking for the user. This is the one state the chassis shouts about. */
export const Waiting = (): React.JSX.Element => (
  <Row>
    <PaneHeader
      pane={{ ...terminal, id: 'p2', label: 'orbit-api' }}
      label="orbit-api"
      git={{ ...git, branch: 'feat/pagination', conflicted: 2, dirty: 2, behind: 1 }}
      runtime={{ ...runtime, attention: 'idle', attentionSince: Date.now() - 40_000 }}
      zoomed={false}
      onAnswer={noop}
      {...handlers}
    />
  </Row>
)

/** Zoomed swaps the zoom affordance for its inverse. */
export const Zoomed = (): React.JSX.Element => (
  <Row>
    <PaneHeader pane={terminal} label="dev-muxel" git={git} runtime={runtime} zoomed {...handlers} />
  </Row>
)

/** A browser pane: same chrome, cool variant, host instead of a branch. */
export const Browser = (): React.JSX.Element => (
  <Row>
    <PaneHeader
      pane={{
        id: 'p3',
        kind: 'browser',
        repoId: 'r1',
        url: 'http://localhost:5173/settings',
        viewport: 'desktop',
        title: 'DevMuxel — Settings'
      }}
      label="localhost:5173"
      git={git}
      runtime={runtime}
      zoomed={false}
      {...handlers}
    />
  </Row>
)

/** A note pane, which carries a save status rather than a process. */
export const Note = (): React.JSX.Element => (
  <Row>
    <PaneHeader
      pane={{ id: 'p4', kind: 'note', noteId: 'n1' }}
      label="Release checklist"
      git={git}
      runtime={runtime}
      zoomed={false}
      noteStatus="saved"
      {...handlers}
    />
  </Row>
)
