/*
 * Preview harness for the claude.ai/design sync.
 *
 * Not app code — nothing here ships in DevMuxel. It exists because the design
 * pane renders each component standalone in a plain browser tab, and DevMuxel's
 * components assume two things the app always provides and a bare tab never
 * does:
 *
 *   1. The chassis. This is a dark design system: `--ink` is near-white, so a
 *      component on a white card is invisible. `PreviewHarness` paints
 *      `--bg-chassis` and sets the ui font, which is what `.app` does in the
 *      real window.
 *   2. `window.devmuxel`. The preload bridge. Every call site is inside a
 *      handler or an effect (never module scope), so a stub installed before
 *      mount is enough to keep effects from throwing — TitleBar asks whether
 *      the window is maximised on mount, PageComments asks for skill status.
 *
 * The store is seeded here rather than in each preview so every card sees one
 * coherent session: the same three repos, the same git states, the same tabs.
 * Settings come from the app's own `defaultSettings` rather than a copy, so
 * they cannot drift from what DevMuxel actually ships.
 */
import type { JSX, ReactNode } from 'react'
import { defaultSettings, STATE_VERSION } from '../src/main/store/defaults'
import { addComment, replaceNet, setPicked } from '../src/renderer/src/browser/netlog'
import { actions, hydrate } from '../src/renderer/src/state/store'
import { getSession } from '../src/renderer/src/terminal/session'
import type { GitState, ShellProfile } from '../src/shared/types'
import { COMMENTS, ENTRIES, PICKED } from './previews/_fixtures'

// --- the bridge stub -------------------------------------------------------

const noop = (): void => {}
const off = (): (() => void) => noop

/** Faithful to src/preload/index.ts: same shapes, none of the effects. */
const bridge = {
  state: { load: async () => ({ state: null, shells: [], buildNumber: 0 }), save: noop },
  pty: { spawn: async () => ({ ok: true }), write: noop, resize: noop, ack: noop, kill: noop },
  git: { setRepos: async () => {}, snapshot: async () => ({}), refresh: async () => {} },
  dialog: { pickFolder: async () => null },
  repo: { probe: async () => null, scan: async () => [] },
  open: { editor: async () => ({ ok: true }), folder: async () => ({ ok: true }) },
  shells: { detect: async () => [] },
  browser: {
    attach: async () => ({ ok: false, error: 'preview' }),
    detach: async () => {},
    emulate: async () => ({ ok: true, missing: [] }),
    entries: async () => ({ entries: [], attached: false }),
    // A real payload rather than an error: SendToClaude renders what it is
    // about to hand over, and an empty body makes that card a shrug.
    body: async () => ({
      ok: true,
      text: JSON.stringify(
        {
          projects: [
            { id: 'r1', name: 'dev-muxel', branch: 'main', dirty: 4 },
            { id: 'r2', name: 'orbit-api', branch: 'feat/pagination', dirty: 2 }
          ],
          total: 2
        },
        null,
        2
      ),
      base64: false
    }),
    clear: async () => {},
    stash: async () => ({ ok: false as const, error: 'preview' }),
    bridgeSync: noop,
    sendComments: async () => ({ taken: false })
  },
  skill: {
    status: async () => ({
      installed: true,
      version: 1,
      current: true,
      dir: '~/.claude/skills/devmuxel-browser',
      legacyDir: null
    }),
    install: async () => ({ ok: true as const, dir: '~/.claude/skills/devmuxel-browser' })
  },
  window: {
    minimise: noop,
    toggleMaximise: noop,
    close: noop,
    isMaximised: async () => false,
    attention: noop
  },
  clipboard: { write: async () => {}, read: async () => '' },
  pathForFile: () => '',
  // Every channel in src/preload/index.ts. A missing one is not a silent
  // no-op: components call these in mount effects, so an absent key throws
  // "is not a function" and React unmounts the card.
  on: {
    ptyData: off,
    ptyExit: off,
    gitState: off,
    browserNet: off,
    browserCapture: off,
    browserFocus: off,
    browserArmPicker: off,
    browserCommentsTaken: off,
    browserWaiting: off,
    windowMaximised: off,
    windowFocus: off,
    beforeQuit: off,
    menuAction: off
  }
}

if (typeof window !== 'undefined' && !(window as unknown as Record<string, unknown>).devmuxel) {
  ;(window as unknown as Record<string, unknown>).devmuxel = bridge
}

// --- the seeded session ----------------------------------------------------

const REPOS = [
  {
    id: 'r1',
    name: 'dev-muxel',
    path: 'C:\\Users\\dev\\projects\\dev-muxel',
    color: '#e5372a',
    devUrl: 'http://localhost:5173'
  },
  { id: 'r2', name: 'orbit-api', path: 'C:\\Users\\dev\\projects\\orbit-api', color: '#5b8fd6' },
  { id: 'r3', name: 'ledger', path: 'C:\\Users\\dev\\projects\\ledger', color: '#62c08a' }
]

const git = (over: Partial<GitState>): GitState => ({
  path: '',
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
  at: Date.now(),
  ...over
})

const SHELLS: ShellProfile[] = [
  { id: 'powershell', label: 'PowerShell', path: 'powershell.exe', args: [], builtin: true },
  { id: 'bash', label: 'Git Bash', path: 'bash.exe', args: ['-l'], builtin: true }
]

let seeded = false

/**
 * Seed once, lazily. A module-scope call races the bundle's own init in some
 * card layouts; a call from the harness body is ordered after it.
 */
function seed(): void {
  if (seeded) return
  seeded = true

  hydrate(
    {
      version: STATE_VERSION,
      settings: defaultSettings,
      repos: REPOS,
      notes: [
        {
          id: 'n1',
          title: 'Release checklist',
          body: 'Bump the version, run the fixtures, tag it.\n\nThe installer signs on CI, not here.',
          updatedAt: Date.now() - 6 * 60_000
        },
        {
          id: 'n2',
          title: 'Grid bugs',
          body: 'Dragging a pane onto its own edge should be a no-op.',
          updatedAt: Date.now() - 3 * 3_600_000
        }
      ],
      session: {
        panes: [
          {
            id: 'p1',
            kind: 'terminal',
            repoId: 'r1',
            cwd: REPOS[0].path,
            shellId: 'powershell',
            label: 'dev-muxel'
          },
          {
            id: 'p2',
            kind: 'terminal',
            repoId: 'r2',
            cwd: REPOS[1].path,
            shellId: 'bash',
            label: 'orbit-api'
          },
          {
            id: 'p3',
            kind: 'browser',
            repoId: 'r1',
            url: 'http://localhost:5173',
            viewport: 'desktop',
            title: 'DevMuxel'
          },
          { id: 'p4', kind: 'note', noteId: 'n1' }
        ],
        tabs: [
          {
            id: 't1',
            name: 'build',
            focusedPaneId: 'p1',
            layout: {
              kind: 'split',
              id: 's1',
              dir: 'row',
              sizes: [0.55, 0.45],
              children: [
                { kind: 'leaf', id: 'l1', paneId: 'p1' },
                {
                  kind: 'split',
                  id: 's2',
                  dir: 'column',
                  sizes: [0.6, 0.4],
                  children: [
                    { kind: 'leaf', id: 'l2', paneId: 'p3' },
                    { kind: 'leaf', id: 'l3', paneId: 'p4' }
                  ]
                }
              ]
            }
          },
          {
            id: 't2',
            name: 'api',
            focusedPaneId: 'p2',
            layout: { kind: 'leaf', id: 'l4', paneId: 'p2' }
          }
        ],
        activeTabId: 't1'
      },
      shells: SHELLS
    },
    SHELLS,
    1042
  )

  actions.setGitSnapshot({
    [REPOS[0].path]: git({
      path: REPOS[0].path,
      branch: 'main',
      modified: 3,
      staged: 1,
      dirty: 4,
      ahead: 2
    }),
    [REPOS[1].path]: git({
      path: REPOS[1].path,
      branch: 'feat/pagination',
      untracked: 2,
      behind: 1
    }),
    [REPOS[2].path]: git({ path: REPOS[2].path, branch: 'main' })
  })

  actions.patchRuntime('p1', {
    pid: 24_180,
    shellLabel: 'PowerShell',
    busy: true,
    title: 'npm run dev'
  })
  actions.patchRuntime('p2', {
    pid: 24_902,
    shellLabel: 'Git Bash',
    attention: 'idle',
    attentionSince: Date.now() - 40_000
  })

  // The grid measures itself from the window in the app; cards have no such
  // box, so give it the card's own size or GridView lays out into nothing.
  actions.setGridBox({ x: 0, y: 0, width: 1200, height: 720 })

  // The browser pane's log lives outside the store, in its own module. Seed it
  // for p3 so the cards that read it rather than take it as a prop —
  // SendToClaude most of all — show a real session instead of an empty shell.
  replaceNet('p3', ENTRIES as never, true)
  setPicked('p3', PICKED as never)
  for (const c of COMMENTS) addComment('p3', c as never)

  // Paint the chassis on the page itself rather than on the wrapper below.
  // A wrapper stretched to fill the card leaves every short component — a 30px
  // pane header, a toast — sitting on a tall black slab; letting the ground be
  // the page means each cell hugs its content and still lands on the chassis.
  if (typeof document !== 'undefined') {
    document.documentElement.style.background = 'var(--bg-chassis)'
    document.body.style.background = 'var(--bg-chassis)'
    document.body.style.colorScheme = 'dark'
  }
}

// --- terminal scrollback ---------------------------------------------------

/**
 * Put text in a pane's terminal.
 *
 * `TerminalPane` mounts a real xterm; what it does not have in a preview is a
 * pty writing to it, so the card would otherwise be an empty rectangle.
 * `writeLocal` is the session's own path for text that did not come from the
 * shell, which is exactly what this is — the terminal, its font and its colours
 * are real, only the process behind them is missing.
 *
 * Retried on a frame because the session is created by the component's own
 * mount effect, which has not run when the preview's effect first fires.
 */
export function writeTerminal(paneId: string, text: string): void {
  let tries = 0
  const tick = (): void => {
    const session = getSession(paneId)
    if (session) {
      session.writeLocal(text)
      return
    }
    if (tries++ < 60) requestAnimationFrame(tick)
  }
  tick()
}

// --- the chassis -----------------------------------------------------------

/**
 * Wraps every preview card. `cfg.provider` points here, so this also wraps the
 * floor cards of components nobody has authored a preview for yet.
 */
export function PreviewHarness({ children }: { children?: ReactNode }): JSX.Element {
  seed()
  return (
    <div
      className="app"
      style={{
        background: 'var(--bg-chassis)',
        color: 'var(--ink)',
        fontFamily: 'var(--font-ui)',
        fontSize: 13,
        padding: 16
      }}
    >
      {children}
    </div>
  )
}
