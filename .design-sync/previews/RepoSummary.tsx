import { useEffect, useRef, useState } from 'react'
import { IconFolder, RepoSummary } from 'devlobby'

const noop = (): void => {}

type Member = {
  name: string
  branch?: string
  detached?: string
  staged?: number
  modified?: number
  untracked?: number
  conflicted?: number
  ahead?: number
  behind?: number
  operation?: 'rebase' | 'merge' | 'cherry-pick' | 'revert' | 'am' | 'bisect'
  error?: string
}

/** A member's git state, spelled out the way the watcher publishes it. */
function member(root: string, m: Member): Record<string, unknown> {
  const staged = m.staged ?? 0
  const modified = m.modified ?? 0
  const conflicted = m.conflicted ?? 0
  return {
    path: `${root}\\${m.name}`,
    isRepo: !m.error,
    branch: m.detached ? null : (m.branch ?? 'main'),
    head: m.detached ?? '4f1d2e1',
    detached: Boolean(m.detached),
    unborn: false,
    upstream: m.branch ? `origin/${m.branch}` : null,
    ahead: m.ahead ?? 0,
    behind: m.behind ?? 0,
    staged,
    modified,
    untracked: m.untracked ?? 0,
    conflicted,
    dirty: staged + modified + conflicted,
    operation: m.operation ?? null,
    error: m.error ?? null,
    at: Date.now()
  }
}

/**
 * A folder's state: the sum of its members, with the members riding along.
 *
 * Built the way `aggregate` builds it rather than by hand, so a card cannot
 * show a total that no set of repositories could actually produce.
 */
function folder(root: string, members: Member[]): Record<string, unknown> {
  const states = members.map((m) => member(root, m))
  const live = states.filter((s) => s.isRepo && !s.error)
  const total = (key: string): number =>
    live.reduce((n, s) => n + (s[key] as number), 0)
  return {
    path: root,
    isRepo: live.length > 0,
    branch: null,
    head: null,
    detached: false,
    unborn: false,
    upstream: null,
    ahead: total('ahead'),
    behind: total('behind'),
    staged: total('staged'),
    modified: total('modified'),
    untracked: total('untracked'),
    conflicted: total('conflicted'),
    dirty: total('dirty'),
    operation: live.map((s) => s.operation).find(Boolean) ?? null,
    error: null,
    at: Date.now(),
    members: states
  }
}

const ROOT = 'C:\\Users\\dev\\projects'

/**
 * The card measures its anchor as it opens and hangs under it, so a preview has
 * to give it a real mounted element — here the readout in a pane header, which
 * is the thing you actually hover in the app.
 */
function Hovered({ git, name }: { git: unknown; name: string }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  useEffect(() => setAnchor(ref.current), [])

  const g = git as {
    dirty: number
    untracked: number
    conflicted: number
    ahead: number
    behind: number
    members: unknown[]
  }

  return (
    <div style={{ minHeight: 320 }}>
      <div className="pane-header">
        <span className="pane-header__spine" data-state="idle" />
        <span className="pane-header__name">{name}</span>
        <span className="git-group" ref={ref}>
          <span className="pane-header__branch">
            <IconFolder size={11} />
            {g.members.length} repos
          </span>
          {g.conflicted > 0 && <span className="chip chip--conflict">!{g.conflicted}</span>}
          {g.dirty > 0 ? (
            <span className="chip chip--dirty">●{g.dirty}</span>
          ) : g.untracked === 0 ? (
            <span className="chip chip--clean">clean</span>
          ) : null}
          {g.untracked > 0 && <span className="chip chip--new">+{g.untracked}</span>}
          {(g.ahead > 0 || g.behind > 0) && (
            <span className="chip chip--sync">
              ↑{g.ahead} ↓{g.behind}
            </span>
          )}
        </span>
        <span className="pane-header__gap" />
      </div>
      {anchor ? (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <RepoSummary git={git as any} name={name} anchorEl={anchor} onClose={noop} />
      ) : null}
    </div>
  )
}

/** A projects directory in the state you usually find one: mostly behind. */
export const Default = (): React.JSX.Element => (
  <Hovered
    name="projects"
    git={folder(ROOT, [
      { name: 'atlas-api', branch: 'feat/webhook-retry', staged: 1, modified: 1, untracked: 3, ahead: 2 },
      { name: 'mercury-web', modified: 1, behind: 1 },
      { name: 'docs-site', detached: '8ac21f3', modified: 5 },
      { name: 'infra', ahead: 1, behind: 3 },
      { name: 'ledger-cli', branch: 'fix/tz-parse' },
      { name: 'design-tokens' }
    ])}
  />
)

/** A half-finished merge outranks everything else in the folder. */
export const Blocked = (): React.JSX.Element => (
  <Hovered
    name="platform"
    git={folder(ROOT, [
      { name: 'gateway', branch: 'release/4.2', conflicted: 2, operation: 'merge' },
      { name: 'billing', branch: 'release/4.2', modified: 4, untracked: 1 },
      { name: 'workers', branch: 'release/4.2' }
    ])}
  />
)

/** One repository that could not be read is not a folder that is clean. */
export const Unreadable = (): React.JSX.Element => (
  <Hovered
    name="clients"
    git={folder(ROOT, [
      { name: 'acme\\web', error: 'folder is missing' },
      { name: 'acme\\api', branch: 'main', modified: 2 },
      { name: 'globex', branch: 'main' }
    ])}
  />
)

/** Long enough that the tail is counted rather than listed. */
export const Many = (): React.JSX.Element => (
  <Hovered
    name="monorepos"
    git={folder(
      ROOT,
      Array.from({ length: 18 }, (_, i) => ({
        name: `service-${String(i + 1).padStart(2, '0')}`,
        branch: i === 0 ? 'spike/cache' : 'main',
        modified: i < 3 ? 3 - i : 0,
        ahead: i === 1 ? 2 : 0
      }))
    )}
  />
)
