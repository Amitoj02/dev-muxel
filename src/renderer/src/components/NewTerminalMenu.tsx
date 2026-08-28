/**
 * Which repository the new terminal opens on.
 *
 * `＋ Terminal` used to guess — the focused pane's repository, else the first
 * one ever declared. That is right often enough to be annoying when it is
 * wrong, because by the time you find out a shell has already started
 * somewhere else. The guess still lives on Ctrl+Alt+T, where there is nowhere
 * to put a menu and the point is speed; the button asks.
 */

import { accentOf } from '../lib/colour'
import { actions, normalisePath, paneById, paneLabel, useApp } from '../state/hooks'
import { IconFolder, IconPlus } from './Icons'

export function NewTerminalMenu({ onClose }: { onClose: () => void }): React.JSX.Element {
  const app = useApp()
  const focused = paneById(app, app.focusedPaneId)

  // "Where I already am" is only worth offering when it is somewhere the list
  // below cannot get you: a terminal opened on a loose folder rather than on
  // one of the declared repositories.
  const declared = new Set(app.repos.map((r) => normalisePath(r.path)))
  const here =
    focused?.kind === 'terminal' && !declared.has(normalisePath(focused.cwd)) ? focused : null

  const pick = async (): Promise<void> => {
    onClose()
    const folder = await window.devmuxel.dialog.pickFolder('Open a terminal in')
    if (folder) actions.addTerminal({ cwd: folder })
  }

  return (
    <>
      <span className="pmenu__label">OPEN A TERMINAL ON</span>

      {app.repos.length === 0 && (
        <p className="pmenu__empty">
          No repositories declared yet. Open one anywhere, or go and declare some.
        </p>
      )}

      {app.repos.map((repo) => {
        const accent = accentOf(repo.color)
        return (
          <button
            key={repo.id}
            className="pmenu__item"
            role="menuitem"
            onClick={() => {
              onClose()
              actions.addTerminal({ repoId: repo.id })
            }}
            title={repo.path}
          >
            <span
              className="pmenu__dot"
              style={accent ? { background: accent } : undefined}
            />
            <span className="pmenu__name">{repo.name}</span>
            <span className="pmenu__path">{repo.path}</span>
          </button>
        )
      })}

      {here && (
        <>
          <div className="pmenu__sep" />
          <button
            className="pmenu__item"
            role="menuitem"
            onClick={() => {
              onClose()
              actions.addTerminal({ repoId: here.repoId, cwd: here.cwd, shellId: here.shellId })
            }}
            title={here.cwd}
          >
            <span className="pmenu__dot" />
            <span className="pmenu__name">Alongside {paneLabel(app, here)}</span>
            <span className="pmenu__path">{here.cwd}</span>
          </button>
        </>
      )}

      <div className="pmenu__sep" />

      <button className="pmenu__item" role="menuitem" onClick={() => void pick()}>
        <IconFolder size={11} />
        <span className="pmenu__name">Choose a folder…</span>
      </button>
      <button
        className="pmenu__item"
        role="menuitem"
        onClick={() => {
          onClose()
          actions.showOverlay({ kind: 'repositories' })
        }}
      >
        <IconPlus size={10} />
        <span className="pmenu__name">Repositories…</span>
      </button>
    </>
  )
}
