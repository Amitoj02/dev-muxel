/**
 * First run, and any moment the grid is empty.
 *
 * Two different situations with two different right answers: with no
 * repositories declared the only useful action is declaring one; with
 * repositories but no panes, the useful action is opening one of them.
 */

import { IconPlus, IconScan } from './Icons'
import { actions, useApp } from '../state/hooks'

export function EmptyState(): React.JSX.Element {
  const app = useApp()
  const hasRepos = app.repos.length > 0

  const addFirst = async (): Promise<void> => {
    const picked = await window.grid.dialog.pickFolder('Add a repository')
    if (!picked) return
    const probe = await window.grid.repo.probe(picked)
    const repo = actions.addRepo({ name: probe.name, path: probe.root ?? picked })
    if (repo) actions.addTerminal({ repoId: repo.id })
  }

  return (
    <div className="empty">
      <span className="empty__kicker">GRID</span>

      {hasRepos ? (
        <>
          <h1 className="empty__title">Nothing open.</h1>
          <p className="empty__hint">
            {app.repos.length} {app.repos.length === 1 ? 'repository' : 'repositories'} declared.
            Open one, and split it as many ways as you need.
          </p>
          <div className="empty__actions">
            {app.repos.slice(0, 6).map((r) => (
              <button
                key={r.id}
                className="btn"
                onClick={() => actions.addTerminal({ repoId: r.id })}
              >
                <IconPlus size={10} /> {r.name}
              </button>
            ))}
            <button
              className="btn btn--ghost"
              onClick={() => actions.showOverlay({ kind: 'repositories' })}
            >
              All repositories
            </button>
          </div>
        </>
      ) : (
        <>
          <h1 className="empty__title">Point GRID at the repositories you work in.</h1>
          <p className="empty__hint">
            Each one gets a terminal that knows its branch and how dirty its tree is. Drag panes
            around to build the grid you want, and drop a folder anywhere on this window to add it.
          </p>
          <div className="empty__actions">
            <button className="btn btn--primary" onClick={addFirst}>
              <IconPlus size={10} /> Add a repository
            </button>
            <button
              className="btn"
              onClick={() => actions.showOverlay({ kind: 'repositories' })}
            >
              <IconScan size={11} /> Scan a folder
            </button>
            <button className="btn btn--ghost" onClick={() => actions.addNote()}>
              Start with a note
            </button>
          </div>
        </>
      )}
    </div>
  )
}
