/**
 * The repository manager.
 *
 * Declaring paths is the first thing you do in DevLobby and the thing you do
 * least often afterwards, so it lives in an overlay rather than eating grid
 * space permanently. Everything a repo needs is here: where it is, which shell
 * it opens with, and the command to run when a terminal lands in it — that last
 * one is what turns "open a terminal" into "start Claude in this repo".
 */

import { useMemo, useState } from 'react'
import type { GitState, Repo } from '../../../shared/types'
import {
  clampDepth,
  groupLabel,
  isGroup,
  MAX_SCAN_DEPTH,
  MIN_SCAN_DEPTH
} from '../../../shared/git'
import {
  IconClose,
  IconFolder,
  IconGlobe,
  IconPlus,
  IconRefresh,
  IconScan,
  IconTrash
} from './Icons'
import { Overlay } from './Overlay'
import { RepoSummary } from './RepoSummary'
import { accentOf, REPO_COLOURS } from '../lib/colour'
import { useHoverCard } from '../lib/useHoverCard'
import { actions, normalisePath, useApp } from '../state/hooks'

export function RepositoriesPanel(): React.JSX.Element {
  const app = useApp()
  const [editing, setEditing] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [found, setFound] = useState<Array<{ path: string; name: string; alreadyAdded: boolean }> | null>(
    null
  )

  /**
   * Add one folder.
   *
   * A folder that is not a work tree is very often the folder your work trees
   * live in, so that case is looked into rather than shrugged at: if there are
   * repositories inside, the row is declared as a folder and starts adding
   * them up. The toggle in its settings is there to say otherwise.
   */
  const addFolder = async (): Promise<void> => {
    const picked = await window.devlobby.dialog.pickFolder('Add a repository')
    if (!picked) return
    const probe = await window.devlobby.repo.probe(picked)

    const inside =
      !probe.isRepo && probe.isDirectory ? await window.devlobby.repo.scan(picked) : []

    const repo = actions.addRepo({
      name: probe.name,
      path: probe.root ?? picked,
      scan: inside.length > 0 || undefined
    })
    if (repo) setEditing(repo.id)

    if (inside.length > 0) {
      actions.toast(
        `Not a repository itself — watching the ${inside.length} inside it`
      )
    } else if (!probe.isRepo) {
      actions.toast('That folder is not a git repository — added anyway', 'info')
    }
  }

  const scanFolder = async (): Promise<void> => {
    const picked = await window.devlobby.dialog.pickFolder('Scan a folder for repositories')
    if (!picked) return
    setScanning(true)
    try {
      const results = await window.devlobby.repo.scan(picked)
      const known = new Set(app.repos.map((r) => normalisePath(r.path)))
      setFound(
        results.map((r) => ({ ...r, alreadyAdded: known.has(normalisePath(r.path)) }))
      )
    } finally {
      setScanning(false)
    }
  }

  return (
    <Overlay onClose={() => actions.closeOverlay()}>
      <div className="dialog">
        <div className="dialog__head">
          <h2 className="dialog__title">REPOSITORIES</h2>
          <span className="dialog__sub">
            {app.repos.length} declared
          </span>
          <button className="dialog__close" onClick={() => actions.closeOverlay()} aria-label="Close">
            <IconClose size={12} />
          </button>
        </div>

        <div className="dialog__body">
          {app.repos.length === 0 && !found && (
            <div style={{ padding: '34px 16px', maxWidth: '58ch' }}>
              <p
                style={{
                  margin: '0 0 8px',
                  font: '400 14px/1.6 var(--font-ui)',
                  color: 'var(--ink-2)'
                }}
              >
                Nothing declared yet.
              </p>
              <p style={{ margin: 0, font: '400 11.5px/1.75 var(--font-mono)', color: 'var(--ink-faint)' }}>
                Add one folder at a time, or point <em>Scan folder</em> at the directory your
                projects live in and take them all at once.
              </p>
            </div>
          )}

          {app.repos.map((repo) => (
            <RepoRow
              key={repo.id}
              repo={repo}
              git={app.git[normalisePath(repo.path)] ?? null}
              expanded={editing === repo.id}
              shells={app.shells}
              onToggle={() => setEditing(editing === repo.id ? null : repo.id)}
            />
          ))}

          {found && (
            <ScanResults
              // Keyed by the result set: a second scan gets a fresh component,
              // so its checkbox selection cannot carry over from the first.
              key={found.map((f) => f.path).join('|')}
              found={found}
              onDismiss={() => setFound(null)}
              onAdd={(paths) => {
                for (const p of paths) {
                  const name = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
                  actions.addRepo({ name, path: p })
                }
                setFound(null)
                actions.toast(`Added ${paths.length} ${paths.length === 1 ? 'repository' : 'repositories'}`)
              }}
            />
          )}
        </div>

        <div className="dialog__foot">
          <button className="btn btn--primary" onClick={addFolder}>
            <IconPlus size={10} /> Add repository
          </button>
          <button className="btn" onClick={scanFolder} disabled={scanning}>
            <IconScan size={11} /> {scanning ? 'Scanning…' : 'Scan folder'}
          </button>
          <button
            className="btn btn--ghost"
            onClick={() => void window.devlobby.git.refresh()}
            title="Re-read every repository now"
          >
            <IconRefresh size={11} /> Refresh
          </button>
          <span className="dialog__spacer" />
          <button className="btn btn--ghost" onClick={() => actions.closeOverlay()}>
            Done
          </button>
        </div>
      </div>
    </Overlay>
  )
}

// ---------------------------------------------------------------------------

function RepoRow({
  repo,
  git,
  expanded,
  shells,
  onToggle
}: {
  repo: Repo
  git: GitState | null
  expanded: boolean
  shells: Array<{ id: string; label: string }>
  onToggle: () => void
}): React.JSX.Element {
  const state =
    !git || git.error || !git.isRepo ? 'missing' : git.dirty > 0 ? 'dirty' : 'clean'
  const accent = accentOf(repo.color)

  return (
    <div>
      <div className="repo-row" data-state={state} onDoubleClick={onToggle}>
        {accent && (
          <span
            className="repo-row__dot"
            style={{ '--repo-accent': accent } as React.CSSProperties}
            title="This repository's colour"
          />
        )}
        <div className="repo-row__main">
          <span className="repo-row__name">{repo.name}</span>
          <span className="repo-row__path" title={repo.path}>
            {repo.path}
          </span>
        </div>

        <RepoRowGit git={git} name={repo.name} />

        <div className="repo-row__actions">
          <button
            className="icon-btn"
            title="Open a terminal here"
            onClick={() => {
              actions.addTerminal({ repoId: repo.id })
              actions.closeOverlay()
            }}
          >
            <IconPlus size={12} />
          </button>
          <button
            className="icon-btn"
            title={repo.devUrl ? `Open a browser on ${repo.devUrl}` : 'Open a browser pane here'}
            onClick={() => {
              actions.addBrowser({ repoId: repo.id })
              actions.closeOverlay()
            }}
          >
            <IconGlobe size={12} />
          </button>
          <button
            className="icon-btn"
            title="Open in VS Code"
            onClick={() => void window.devlobby.open.editor(repo.path)}
          >
            <span style={{ font: '600 9.5px/1 var(--font-ui)' }}>VS</span>
          </button>
          <button
            className="icon-btn"
            title="Show in Explorer"
            onClick={() => void window.devlobby.open.folder(repo.path)}
          >
            <IconFolder size={12} />
          </button>
          <button className="icon-btn" title="Settings for this repository" onClick={onToggle}>
            <span style={{ font: '600 12px/1 var(--font-ui)' }}>{expanded ? '−' : '⋯'}</span>
          </button>
          <button
            className="icon-btn icon-btn--danger"
            title="Remove from DevLobby (the folder is untouched)"
            onClick={() => actions.removeRepo(repo.id)}
          >
            <IconTrash size={12} />
          </button>
        </div>
      </div>

      {expanded && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 16,
            padding: '16px',
            background: 'var(--bg-sunken)',
            borderBottom: '1px solid var(--line)'
          }}
        >
          <label className="field">
            <span className="field__label">Name</span>
            <input
              className="input"
              value={repo.name}
              onChange={(e) => actions.updateRepo(repo.id, { name: e.target.value })}
            />
          </label>

          <label className="field">
            <span className="field__label">Shell</span>
            <select
              className="select"
              value={repo.shellId ?? ''}
              onChange={(e) =>
                actions.updateRepo(repo.id, { shellId: e.target.value || undefined })
              }
            >
              <option value="">Default</option>
              {shells.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <div className="field">
            <span className="field__label">Colour</span>
            <div className="swatches">
              <button
                type="button"
                className="swatch swatch--none"
                data-picked={!accent}
                title="No colour"
                onClick={() => actions.updateRepo(repo.id, { color: undefined })}
              />
              {REPO_COLOURS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  className="swatch"
                  style={{ '--swatch': c.hex } as React.CSSProperties}
                  data-picked={accent === c.hex}
                  title={c.name}
                  onClick={() => actions.updateRepo(repo.id, { color: c.hex })}
                />
              ))}
              <input
                type="color"
                className="swatch swatch--custom"
                value={accent ?? '#5b8fd6'}
                data-picked={Boolean(accent) && !REPO_COLOURS.some((c) => c.hex === accent)}
                title="Any other colour"
                onChange={(e) =>
                  actions.updateRepo(repo.id, { color: accentOf(e.target.value) ?? undefined })
                }
              />
            </div>
            <span className="field__hint">
              Tints the header of every terminal opened on this repository.
            </span>
          </div>

          <ScanField repo={repo} git={git} />

          <label className="field" style={{ gridColumn: '1 / -1' }}>
            <span className="field__label">Command on open</span>
            <input
              className="input"
              placeholder="claude"
              value={repo.startupCommand ?? ''}
              onChange={(e) =>
                actions.updateRepo(repo.id, { startupCommand: e.target.value || undefined })
              }
            />
            <span className="field__hint">
              Typed into every new terminal on this repository.
            </span>
          </label>

          <label className="check" style={{ gridColumn: '1 / -1' }}>
            <input
              type="checkbox"
              checked={Boolean(repo.runOnOpen)}
              onChange={(e) => actions.updateRepo(repo.id, { runOnOpen: e.target.checked })}
            />
            Press Enter for me — run it rather than just typing it
          </label>

          <label className="field" style={{ gridColumn: '1 / -1' }}>
            <span className="field__label">Where it runs</span>
            <input
              className="input"
              placeholder="localhost:3000"
              value={repo.devUrl ?? ''}
              onChange={(e) => actions.updateRepo(repo.id, { devUrl: e.target.value || undefined })}
            />
            <span className="field__hint">
              A browser pane opened on this repository starts here.
            </span>
          </label>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * A row's git readout.
 *
 * A declared folder reads exactly like a repository does, because the state
 * published for it is already the sum of the ones inside — the branch is the
 * one place there is nothing to put, so it says how many were counted instead
 * and the card names them.
 */
function RepoRowGit({ git, name }: { git: GitState | null; name: string }): React.JSX.Element {
  const card = useHoverCard()

  if (git?.error) {
    return (
      <div className="repo-row__git">
        <span style={{ color: 'var(--ink-dim)' }}>{git.error}</span>
      </div>
    )
  }

  if (isGroup(git)) {
    return (
      <div className="repo-row__git" {...card.bind}>
        <span style={{ color: 'var(--ink-muted)' }}>{groupLabel(git)}</span>
        {git.dirty > 0 ? (
          <span style={{ color: 'var(--red-light)' }}>●{git.dirty}</span>
        ) : (
          <span style={{ color: 'var(--green)' }}>clean</span>
        )}
        {git.untracked > 0 && <span>+{git.untracked}</span>}
        <span>
          ↑{git.ahead} ↓{git.behind}
        </span>
        {card.anchor && (
          <RepoSummary git={git} name={name} anchorEl={card.anchor} onClose={card.close} />
        )}
      </div>
    )
  }

  if (!git?.isRepo) {
    return (
      <div className="repo-row__git">
        <span style={{ color: 'var(--ink-dim)' }}>no git</span>
      </div>
    )
  }

  return (
    <div className="repo-row__git">
      <span style={{ color: 'var(--ink-muted)' }}>
        {git.detached ? `detached ${git.head}` : (git.branch ?? '—')}
      </span>
      {git.dirty > 0 ? (
        <span style={{ color: 'var(--red-light)' }}>●{git.dirty}</span>
      ) : (
        <span style={{ color: 'var(--green)' }}>clean</span>
      )}
      {git.untracked > 0 && <span>+{git.untracked}</span>}
      <span>
        ↑{git.ahead} ↓{git.behind}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------

const DEPTH_LABELS = ['', 'One level down', 'Two levels down', 'Three levels down']

/**
 * Whether this row is a repository or the folder your repositories live in.
 *
 * The one setting here that changes what the row *is* rather than how it
 * behaves, which is why it says what it found: a folder watching six things is
 * obvious from the count, and a folder watching none is a depth that wants
 * turning up — or a path that was never the right one.
 */
function ScanField({ repo, git }: { repo: Repo; git: GitState | null }): React.JSX.Element {
  const depth = clampDepth(repo.scanDepth)
  const found = isGroup(git) ? git.members.length : null

  return (
    <div className="field" style={{ gridColumn: '1 / -1' }}>
      <span className="field__label">Repositories inside</span>

      <label className="check">
        <input
          type="checkbox"
          checked={Boolean(repo.scan)}
          onChange={(e) =>
            actions.updateRepo(repo.id, { scan: e.target.checked || undefined })
          }
        />
        Add up the repositories inside this folder, rather than reading it as one
      </label>

      {repo.scan && (
        <select
          className="select"
          value={depth}
          onChange={(e) => actions.updateRepo(repo.id, { scanDepth: Number(e.target.value) })}
          aria-label="How deep to look"
        >
          {DEPTH_LABELS.map((label, level) =>
            level < MIN_SCAN_DEPTH || level > MAX_SCAN_DEPTH ? null : (
              <option key={level} value={level}>
                {label}
              </option>
            )
          )}
        </select>
      )}

      <span className="field__hint">
        {!repo.scan
          ? 'For a folder your projects live in rather than a project of its own.'
          : found === null
            ? 'Looking…'
            : found === 0
              ? 'Nothing found. Try looking a level deeper.'
              : `${found} found. The header of a terminal opened here shows their total; hover it for the breakdown.`}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------

function ScanResults({
  found,
  onAdd,
  onDismiss
}: {
  found: Array<{ path: string; name: string; alreadyAdded: boolean }>
  onAdd: (paths: string[]) => void
  onDismiss: () => void
}): React.JSX.Element {
  const fresh = useMemo(() => found.filter((f) => !f.alreadyAdded), [found])
  const [picked, setPicked] = useState<Set<string>>(() => new Set(fresh.map((f) => f.path)))

  return (
    <div style={{ borderTop: '2px solid var(--line-strong)' }}>
      <div className="settings-section" style={{ borderTop: 0 }}>
        Found {found.length} · {fresh.length} new
      </div>

      {fresh.length === 0 ? (
        <p style={{ padding: '0 16px 16px', font: '400 11.5px/1.6 var(--font-mono)', color: 'var(--ink-faint)' }}>
          Everything under that folder is already declared.
        </p>
      ) : (
        <div style={{ maxHeight: 260, overflow: 'auto' }}>
          {fresh.map((f) => (
            <label
              key={f.path}
              className="check"
              style={{ padding: '8px 16px', borderBottom: '1px solid var(--line)' }}
            >
              <input
                type="checkbox"
                checked={picked.has(f.path)}
                onChange={(e) => {
                  const next = new Set(picked)
                  if (e.target.checked) next.add(f.path)
                  else next.delete(f.path)
                  setPicked(next)
                }}
              />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <span style={{ font: '600 12px/1 var(--font-ui)', color: 'var(--ink)' }}>{f.name}</span>
                <span className="repo-row__path" title={f.path}>
                  {f.path}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, padding: '12px 16px' }}>
        <button
          className="btn btn--primary"
          disabled={picked.size === 0}
          onClick={() => onAdd([...picked])}
        >
          Add {picked.size} selected
        </button>
        <button className="btn btn--ghost" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  )
}

