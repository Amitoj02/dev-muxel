/**
 * The frameless window's own titlebar.
 *
 * It is both the app menu and the OS drag region, so the flexible spacer in
 * the middle carries `-webkit-app-region: drag` while every button inside it
 * has to opt back out — otherwise the click is swallowed by the window move.
 */

import { useEffect, useState } from 'react'
import { IconClose, IconMaximise, IconMinimise, IconPlus, IconRestore } from './Icons'
import { actions, attentionCount, useApp } from '../state/hooks'

const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export function TitleBar(): React.JSX.Element {
  const app = useApp()
  const [maximised, setMaximised] = useState(false)
  const waiting = attentionCount(app)

  useEffect(() => {
    let alive = true
    void window.grid.window.isMaximised().then((v) => {
      if (alive) setMaximised(v)
    })
    const off = window.grid.on.windowMaximised((v) => setMaximised(v))
    return () => {
      alive = false
      off()
    }
  }, [])

  const jumpToWaiting = (): void => {
    const target = Object.entries(app.runtime).find(
      ([paneId, r]) => r.attention !== 'none' && paneId !== app.focusedPaneId
    )
    if (target) {
      actions.focusPane(target[0])
      actions.clearAttention(target[0])
    }
  }

  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <span className="titlebar__mark" />
        <span className="titlebar__word">GRID</span>
      </div>
      <div className="titlebar__rule" />

      <nav className="titlebar__menu" style={NO_DRAG}>
        <button
          className="menu-item"
          onClick={() => actions.addTerminalSmart()}
          title="New terminal — Ctrl+Alt+T"
        >
          <IconPlus size={10} /> Terminal
        </button>
        <button className="menu-item" onClick={() => actions.addNote()} title="New note — Ctrl+Alt+N">
          <IconPlus size={10} /> Note
        </button>
        <button
          className="menu-item"
          data-active={app.overlay.kind === 'repositories'}
          onClick={() => actions.showOverlay({ kind: 'repositories' })}
          title="Repositories — Ctrl+Alt+R"
        >
          Repositories
        </button>
        <button
          className="menu-item"
          data-active={app.overlay.kind === 'notes'}
          onClick={() => actions.showOverlay({ kind: 'notes' })}
          title="Every note you have kept — Ctrl+Alt+B"
        >
          Notes
        </button>
        <button
          className="menu-item"
          data-active={app.overlay.kind === 'settings'}
          onClick={() => actions.showOverlay({ kind: 'settings' })}
          title="Settings — Ctrl+Alt+,"
        >
          Settings
        </button>
      </nav>

      <div className="titlebar__drag" />

      {waiting > 0 && (
        <button
          className="titlebar__waiting"
          style={NO_DRAG}
          onClick={jumpToWaiting}
          title="Jump to the pane that wants you"
        >
          <span className="titlebar__waiting-dot" />
          <span className="titlebar__waiting-text">
            {waiting} waiting
          </span>
        </button>
      )}

      <div className="wincontrols" style={NO_DRAG}>
        <button
          className="wincontrol"
          onClick={() => window.grid.window.minimise()}
          aria-label="Minimise"
        >
          <IconMinimise />
        </button>
        <button
          className="wincontrol"
          onClick={() => window.grid.window.toggleMaximise()}
          aria-label={maximised ? 'Restore' : 'Maximise'}
        >
          {maximised ? <IconRestore /> : <IconMaximise />}
        </button>
        <button
          className="wincontrol wincontrol--close"
          onClick={() => window.grid.window.close()}
          aria-label="Close"
        >
          <IconClose size={12} />
        </button>
      </div>
    </header>
  )
}
