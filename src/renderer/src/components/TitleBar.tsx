/**
 * The frameless window's own titlebar.
 *
 * It is both the app menu and the OS drag region, so the flexible spacer in
 * the middle carries `-webkit-app-region: drag` while every button inside it
 * has to opt back out — otherwise the click is swallowed by the window move.
 */

import { useCallback, useEffect, useState } from 'react'
import { IconClose, IconMaximise, IconMinimise, IconPlus, IconRestore } from './Icons'
import { MenuPopover } from './MenuPopover'
import { NewTerminalMenu } from './NewTerminalMenu'
import { focusPaneHard } from '../lib/focus'
import { actions, attentionCount, isParked, runtimeFor, useApp } from '../state/hooks'

const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export function TitleBar(): React.JSX.Element {
  const app = useApp()
  const [maximised, setMaximised] = useState(false)
  /**
   * The open menu, carrying the button it hangs off.
   *
   * The element rather than a ref: the popover needs it both to place itself
   * and to know which pointerdown is its own opener rather than a click
   * outside, and reading a ref during render is neither allowed nor honest —
   * the first render after opening would find it null.
   */
  const [menu, setMenu] = useState<{ kind: 'terminal'; anchor: HTMLElement } | null>(null)
  const waiting = attentionCount(app)

  // Stable, because `MenuPopover` binds window listeners keyed on it and this
  // component re-renders on every store change.
  const closeMenu = useCallback(() => setMenu(null), [])

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
    // Across every tab: focusPane brings the right grid forward, which is the
    // whole point of the count being an app-wide one. Never a pane being held
    // for a reopen — it is in no grid, so there would be nothing to jump to,
    // and `attentionCount` does not count it either.
    const target = app.panes.find(
      (p) =>
        p.id !== app.focusedPaneId &&
        !isParked(app, p.id) &&
        runtimeFor(app, p.id).attention !== 'none'
    )
    if (target) {
      focusPaneHard(target.id)
      actions.clearAttention(target.id)
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
        {/* Asks which repository rather than guessing. Ctrl+Alt+T still
            guesses — there is nowhere to hang a menu off a keystroke, and
            speed is the point of it. */}
        <button
          className="menu-item"
          data-active={menu?.kind === 'terminal'}
          onClick={(e) => {
            const anchor = e.currentTarget
            setMenu((open) => (open?.kind === 'terminal' ? null : { kind: 'terminal', anchor }))
          }}
          title="New terminal — Ctrl+Alt+T opens one without asking"
        >
          <IconPlus size={10} /> Terminal
        </button>
        <button
          className="menu-item"
          onClick={() => actions.addBrowserSmart()}
          title="New browser pane — Ctrl+Alt+G"
        >
          <IconPlus size={10} /> Browser
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

      {menu?.kind === 'terminal' && (
        <MenuPopover anchorEl={menu.anchor} onClose={closeMenu}>
          <NewTerminalMenu onClose={closeMenu} />
        </MenuPopover>
      )}

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
