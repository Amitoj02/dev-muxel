/**
 * Binds a pane to a live shell.
 *
 * The xterm instance itself lives in the session registry outside React, so
 * this component is only responsible for: mounting it into a host div, wiring
 * it to the pty in the main process, and tearing both down when the pane goes
 * away. Everything React re-renders here is chrome.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Repo, TerminalPane as TerminalPaneModel } from '../../../shared/types'
import { actions, getState, isParked, paneById, useApp } from '../state/hooks'
import {
  createSession,
  destroySession,
  getSession,
  type SessionCallbacks
} from '../terminal/session'
import { IconClose, IconSearch } from './Icons'

export type TerminalPaneProps = {
  pane: TerminalPaneModel
  repo: Repo | null
  focused: boolean
}

export function TerminalPane({ pane, repo, focused }: TerminalPaneProps): React.JSX.Element {
  const app = useApp()
  const hostRef = useRef<HTMLDivElement>(null)
  const [searching, setSearching] = useState(false)
  const runtime = app.runtime[pane.id]

  // --- session lifetime ---------------------------------------------------
  // Deliberately keyed on the pane id alone. Settings changes are pushed into
  // the existing session rather than rebuilding it, because rebuilding would
  // throw away the scrollback and kill the shell.
  useEffect(() => {
    const settings = getState().settings
    const buildNumber = getState().buildNumber

    const callbacks: SessionCallbacks = {
      onInput: (data) => window.grid.pty.write(pane.id, data),
      onResize: (cols, rows) => window.grid.pty.resize(pane.id, cols, rows),
      onAck: (bytes) => window.grid.pty.ack(pane.id, bytes),
      onTitle: (title) => actions.patchRuntime(pane.id, { title }),
      onAttention: (signal) => {
        if (signal === 'busy') {
          // Output resuming does NOT mean the pane stopped wanting you. A
          // CLI that rings the bell and then prints one more line would
          // otherwise clear its own alert a millisecond later, and nothing
          // re-raises it. Only focusing the pane clears attention.
          actions.patchRuntime(pane.id, { busy: true })
          return
        }
        actions.patchRuntime(pane.id, { busy: false })
        if (signal === 'idle') return
        // Never shout about the pane the user is already looking at.
        if (getState().focusedPaneId === pane.id) return
        actions.raiseAttention(pane.id, signal === 'bell' ? 'bell' : 'idle')
      },
      onShellBack: () => {
        // Whatever GRID started in here has exited and the shell has the
        // terminal back. Forgetting the command is what stops a captured
        // request being pasted into a bare prompt on the strength of a CLI
        // that is no longer running.
        actions.patchRuntime(pane.id, { ranStartup: null })
      },
      onShortcut: (e) => handleTerminalShortcut(pane.id, e, () => setSearching(true))
    }

    // A session already here means the pane is coming back rather than opening
    // for the first time: reopened inside the window with its shell still
    // running, or simply remounted (React does one of those in development).
    // Either way it is adopted, because building a second session would kill a
    // live shell and throw its scrollback away.
    const existing = getSession(pane.id)
    const session = existing ?? createSession(pane.id, settings, callbacks, buildNumber)
    existing?.adopt(callbacks)

    const host = hostRef.current
    if (host) session.attach(host, settings.renderer)

    let cancelled = false
    if (!existing) {
      void window.grid.pty
        .spawn({
          paneId: pane.id,
          cwd: pane.cwd,
          shellId: pane.shellId,
          cols: session.term.cols,
          rows: session.term.rows
        })
        .then((result) => {
          if (cancelled) return
          if (!result.ok) {
            actions.patchRuntime(pane.id, { exited: true, exitCode: -1 })
            session.writeLocal(`\r\n\x1b[31m  could not start a shell: ${result.error}\x1b[0m\r\n`)
            return
          }
          actions.patchRuntime(pane.id, {
            pid: result.pid,
            shellLabel: result.shellLabel,
            exited: false,
            exitCode: null
          })

          // A pane restored from the last session only re-runs its command if
          // the user opted in; a pane just opened always does. A command GRID
          // chose for one specific terminal — a Claude session opened on a
          // captured request, say — is never replayed: it points at a capture
          // file that may be long gone, and "restored terminals re-run their
          // repository command" promises the repository's command, not that.
          const restored = getState().restoredPaneIds.has(pane.id)
          const oneShot = pane.runStartup !== undefined
          const allowed = !restored || (getState().settings.restoreRunsStartup && !oneShot)
          const command = allowed ? (pane.startupCommand ?? repo?.startupCommand) : null
          if (command) {
            // `runStartup` is set only when GRID picked the command itself, so
            // it is the flag that distinguishes the two cases; a repository's
            // own command still answers to the repository's "press Enter for
            // me".
            const run = pane.runStartup ?? repo?.runOnOpen ?? false
            // Give the shell a moment to print its own prompt first, otherwise
            // the command lands in the middle of the banner.
            window.setTimeout(() => {
              if (cancelled) return
              window.grid.pty.write(pane.id, run ? `${command}\r` : command)
              // Recorded only when Enter was actually pressed. Anything that
              // asks "is a CLI running in this pane" has to key off what ran,
              // not off what the repository is configured with — the command
              // is typed either way.
              if (run) {
                actions.patchRuntime(pane.id, { ranStartup: command })
                // From here the session watches for that command taking the
                // terminal and later letting go of it.
                session.armShellWatch()
              }
            }, 400)
          }
        })
    }

    return () => {
      const s = getState()
      // Closed, but inside the reopen window: leave the shell running and the
      // buffer intact. useRecentlyClosed reaps it once the window passes.
      if (isParked(s, pane.id)) {
        session.park()
        return
      }
      // Still on the grid, so this is a remount rather than a close, and the
      // spawn above may still be in flight: cancelling it here would leave the
      // pane with a live pty whose pid it never learned.
      if (paneById(s, pane.id)) return

      cancelled = true
      window.grid.pty.kill(pane.id)
      destroySession(pane.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id])

  // --- keep the mount point attached across layout changes ---------------
  useEffect(() => {
    const host = hostRef.current
    const session = getSession(pane.id)
    if (host && session) session.attach(host, app.settings.renderer)
  })

  // --- settings -----------------------------------------------------------
  // The store replaces the settings object wholesale on change, so this fires
  // exactly when something was actually edited.
  useEffect(() => {
    getSession(pane.id)?.applySettings(app.settings, app.buildNumber)
  }, [pane.id, app.settings, app.buildNumber])

  // --- focus --------------------------------------------------------------
  useEffect(() => {
    if (focused) getSession(pane.id)?.focus()
  }, [focused, pane.id])

  // A zoom animates the pane's box over ~220ms; refit once it settles.
  useEffect(() => {
    const session = getSession(pane.id)
    if (!session) return
    const id = window.setTimeout(() => session.scheduleFit(), 260)
    return () => window.clearTimeout(id)
  }, [app.zoomedPaneId, pane.id])

  // --- selection / paste --------------------------------------------------
  const onMouseUp = useCallback(() => {
    if (!app.settings.copyOnSelect) return
    const session = getSession(pane.id)
    if (session?.hasSelection()) void window.grid.clipboard.write(session.selection())
  }, [app.settings.copyOnSelect, pane.id])

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!app.settings.rightClickPastes) return
      e.preventDefault()
      const session = getSession(pane.id)
      if (!session) return
      // Right click copies a selection if there is one, otherwise pastes —
      // the PuTTY convention, and the one most terminal users expect.
      if (session.hasSelection()) {
        void window.grid.clipboard.write(session.selection())
        session.term.clearSelection()
      } else {
        void window.grid.clipboard.read().then((text) => {
          if (text) session.paste(text)
        })
      }
    },
    [app.settings.rightClickPastes, pane.id]
  )

  return (
    <div className="pane-body" onMouseUp={onMouseUp} onContextMenu={onContextMenu}>
      <div className="term-host" ref={hostRef} />

      {searching && (
        <SearchBar
          paneId={pane.id}
          onClose={() => {
            setSearching(false)
            getSession(pane.id)?.clearSearch()
            getSession(pane.id)?.focus()
          }}
        />
      )}

      {runtime?.exited && (
        <div className="pane-dead">
          <span>
            the shell exited{' '}
            {runtime.exitCode !== null && runtime.exitCode !== 0 && (
              <span className="pane-dead__code">with code {runtime.exitCode}</span>
            )}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn"
              onClick={() => {
                // Simplest honest restart: drop the pane and open a fresh one
                // in the same folder, which also resets the terminal state.
                // Not worth remembering: the replacement is right there.
                const { cwd, repoId, shellId } = pane
                actions.closePane(pane.id, { remember: false })
                actions.addTerminal({ cwd, repoId, shellId })
              }}
            >
              Start it again
            </button>
            <button className="btn btn--ghost" onClick={() => actions.closePane(pane.id)}>
              Close pane
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function SearchBar({
  paneId,
  onClose
}: {
  paneId: string
  onClose: () => void
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{ index: number; count: number } | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const session = getSession(paneId)
    if (!session) return
    const sub = session.search.onDidChangeResults(({ resultIndex, resultCount }) =>
      setResult({ index: resultIndex, count: resultCount })
    )
    return () => sub.dispose()
  }, [paneId])

  const find = (backwards: boolean): void => {
    const session = getSession(paneId)
    if (!session || !query) return
    if (backwards) session.findPrevious(query)
    else session.findNext(query)
  }

  return (
    <div className="term-search">
      <IconSearch size={11} />
      <input
        ref={inputRef}
        value={query}
        placeholder="find"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value)
          const session = getSession(paneId)
          if (session && e.target.value) session.findNext(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            find(e.shiftKey)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <span className="term-search__count">
        {result && result.count > 0
          ? `${result.index + 1}/${result.count}`
          : query
            ? 'none'
            : ''}
      </span>
      <button className="pane-btn" onClick={onClose} title="Close find — Esc">
        <IconClose size={10} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * Shortcuts that must work while a terminal has focus. Everything here is
 * Ctrl+Shift or Ctrl+Alt so it can never collide with what the CLI wants —
 * Claude and friends own the plain Ctrl range.
 */
function handleTerminalShortcut(
  paneId: string,
  e: KeyboardEvent,
  openSearch: () => void
): boolean {
  const session = getSession(paneId)
  if (!session) return false

  if (e.ctrlKey && e.shiftKey) {
    switch (e.key.toLowerCase()) {
      case 'c':
        if (session.hasSelection()) {
          void window.grid.clipboard.write(session.selection())
          return true
        }
        return false
      case 'v':
        void window.grid.clipboard.read().then((text) => {
          if (text) session.paste(text)
        })
        return true
      case 'f':
        openSearch()
        return true
      case 'k':
        session.clear()
        return true
      default:
        return false
    }
  }

  // Ctrl+Alt combinations belong to the app-level shortcut handler.
  return false
}
