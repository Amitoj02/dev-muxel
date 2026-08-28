/**
 * App-level shortcuts.
 *
 * The bindings themselves live in the main process as menu accelerators (see
 * src/main/menu.ts), because a `keydown` listener cannot be trusted in a window
 * full of terminals: xterm.js consumes most chords and calls
 * `stopPropagation()` on the ones it handles, so the renderer only ever sees an
 * arbitrary subset. Accelerators are evaluated before the key reaches the page.
 *
 * This module is the other half: it turns an action name into a change in the
 * grid. A DOM listener is kept as a second path for the same actions, so the
 * app still behaves if focus is somewhere the accelerator does not reach.
 */

import { useEffect } from 'react'
import { measure, neighbour } from '../../../shared/layout'
import { classifyChord } from './chords'
import { focusPaneHard } from './focus'
import { actions, getState, tabRunning } from '../state/hooks'

export type Shortcut = { keys: string; what: string }

export const SHORTCUTS: Shortcut[] = [
  { keys: 'Ctrl+Alt+T', what: 'New terminal' },
  { keys: 'Ctrl+Alt+Shift+T', what: 'New grid, in its own tab' },
  { keys: 'Ctrl+Alt+Shift+W', what: 'Close this grid and everything in it' },
  { keys: 'Ctrl+PageUp / PageDown', what: 'Previous / next grid' },
  { keys: 'Ctrl+Alt+G', what: 'New browser pane' },
  { keys: 'Ctrl+Alt+N', what: 'New note' },
  { keys: 'Ctrl+Alt+D', what: 'Split the focused pane to the right' },
  { keys: 'Ctrl+Alt+S', what: 'Split the focused pane downwards' },
  { keys: 'Ctrl+Alt+W', what: 'Close the focused pane' },
  { keys: 'Ctrl+Shift+T', what: 'Bring back the pane or grid you just closed, for 5 seconds' },
  { keys: 'Ctrl+Alt+Z', what: 'Fill the window, and back again' },
  { keys: 'Ctrl+Alt+←↑→↓', what: 'Move focus to the next pane that way' },
  { keys: 'Ctrl+Alt+1…9', what: 'Focus pane 1 to 9' },
  { keys: 'Ctrl+Alt+E', what: 'Even out every split' },
  { keys: 'Ctrl+Alt+O', what: 'Open the focused pane in VS Code' },
  { keys: 'Ctrl+Alt+R or P', what: 'Repositories' },
  { keys: 'Ctrl+Alt+B', what: 'Every note you have kept' },
  { keys: 'Ctrl+Alt+,', what: 'Settings' },
  { keys: 'Ctrl+Alt+/', what: 'This list' },
  { keys: 'Ctrl+Shift+C', what: 'Copy the terminal selection' },
  { keys: 'Ctrl+Shift+V', what: 'Paste into the terminal' },
  { keys: 'Ctrl+Shift+F', what: 'Find in the terminal' },
  { keys: 'Ctrl+Shift+K', what: 'Clear the terminal' },
  { keys: 'Ctrl+= / Ctrl+- / Ctrl+0', what: 'Terminal font size' },
  { keys: 'Esc', what: 'Closes dialogs — terminals keep Esc for themselves' }
]

/** Maps a menu action name onto the grid. */
export function runAction(action: string): void {
  const state = getState()
  const focused = state.focusedPaneId

  switch (action) {
    case 'new-terminal':
      return actions.addTerminalSmart()
    case 'new-note':
      actions.addNote()
      return
    case 'new-browser':
      return actions.addBrowserSmart()
    case 'new-tab':
      actions.addTab()
      return
    case 'close-tab': {
      const tabId = state.activeTabId
      // Checked before the dialog, not after it: there is no app without a
      // grid, and asking "really close it?" only to refuse is worse than
      // saying so up front.
      if (state.tabs.length < 2) {
        actions.toast('That is the only grid open')
        return
      }
      if (state.settings.confirmClose && tabRunning(state, tabId) > 0) {
        actions.showOverlay({ kind: 'confirm-close-tab', tabId })
        return
      }
      actions.closeTab(tabId)
      return
    }
    case 'next-tab':
      return actions.cycleTab(1)
    case 'prev-tab':
      return actions.cycleTab(-1)
    case 'split-right':
      if (focused) actions.splitFrom(focused, 'right')
      return
    case 'split-down':
      if (focused) actions.splitFrom(focused, 'bottom')
      return
    case 'close-pane':
      if (focused) actions.closePane(focused)
      return
    case 'reopen-pane':
      // Say so when there is nothing left to bring back: the window is short,
      // and silence reads as a broken shortcut.
      if (!actions.reopenLast()) {
        actions.toast('Nothing to bring back — that offer only stands for 5 seconds')
      }
      return
    case 'zoom-pane':
      if (focused) actions.toggleZoom(focused)
      return
    case 'even-out':
      return actions.evenOut()
    case 'repositories':
      return actions.showOverlay({ kind: 'repositories' })
    case 'notes':
      return actions.showOverlay({ kind: 'notes' })
    case 'settings':
      return actions.showOverlay({ kind: 'settings' })
    case 'shortcuts':
      return actions.showOverlay({ kind: 'shortcuts' })
    case 'open-editor': {
      const pane = state.panes.find((p) => p.id === focused)
      if (pane?.kind === 'terminal') {
        void window.devmuxel.open.editor(pane.cwd).then((r) => {
          if (!r.ok) actions.toast(r.error ?? 'Could not open VS Code', 'error')
        })
      }
      return
    }
    case 'font-bigger':
      return actions.patchSettings({ fontSize: clampFont(state.settings.fontSize + 0.5) })
    case 'font-smaller':
      return actions.patchSettings({ fontSize: clampFont(state.settings.fontSize - 0.5) })
    case 'font-reset':
      return actions.patchSettings({ fontSize: 12.5 })
    default:
      break
  }

  if (action.startsWith('focus-')) {
    const what = action.slice('focus-'.length)
    const { panes } = measure(state.layout, state.gridBox, state.settings.gutter ?? 6)

    if (/^\d+$/.test(what)) {
      // Numbering follows the visual order — left to right, top to bottom —
      // not the order the panes happened to be created in.
      const ordered = [...panes.entries()].sort((a, b) => {
        const dy = a[1].y - b[1].y
        return Math.abs(dy) > 8 ? dy : a[1].x - b[1].x
      })
      const target = ordered[Number(what) - 1]
      if (target) focusPaneHard(target[0])
      return
    }

    if (!focused) return
    const dir = what as 'left' | 'right' | 'up' | 'down'
    const next = neighbour(panes, focused, dir)
    if (next) focusPaneHard(next)
  }
}

function clampFont(size: number): number {
  return Math.min(28, Math.max(8, Math.round(size * 2) / 2))
}

/** DOM chord -> action name, for the fallback listener. */
function actionForChord(e: KeyboardEvent): string | null {
  const key = e.key.toLowerCase()

  if (e.ctrlKey && e.altKey && e.shiftKey) {
    if (key === 't') return 'new-tab'
    if (key === 'w') return 'close-tab'
    return null
  }

  if (e.ctrlKey && e.altKey) {
    switch (key) {
      case 't':
        return 'new-terminal'
      case 'n':
        return 'new-note'
      case 'g':
        return 'new-browser'
      case 'd':
        return 'split-right'
      case 's':
        return 'split-down'
      case 'w':
        return 'close-pane'
      case 'z':
        return 'zoom-pane'
      case 'e':
        return 'even-out'
      case 'r':
      case 'p':
        return 'repositories'
      case 'b':
        return 'notes'
      case 'o':
        return 'open-editor'
      case ',':
        return 'settings'
      case '/':
        return 'shortcuts'
      case 'arrowleft':
        return 'focus-left'
      case 'arrowright':
        return 'focus-right'
      case 'arrowup':
        return 'focus-up'
      case 'arrowdown':
        return 'focus-down'
      default:
        return /^[1-9]$/.test(key) ? `focus-${key}` : null
    }
  }

  // Ctrl+Shift belongs to the focused terminal (copy, paste, find, clear),
  // which handles its own; reopen is the one the app takes.
  if (e.ctrlKey && e.shiftKey && !e.altKey) {
    return key === 't' ? 'reopen-pane' : null
  }

  if (e.ctrlKey && !e.altKey && !e.shiftKey) {
    if (key === '=' || key === '+') return 'font-bigger'
    if (key === '-' || key === '_') return 'font-smaller'
    if (key === '0') return 'font-reset'
    if (key === 'pagedown') return 'next-tab'
    if (key === 'pageup') return 'prev-tab'
  }

  return null
}

export function useShortcuts(): void {
  useEffect(() => {
    const off = window.devmuxel.on.menuAction((action) => runAction(action))

    // Fallback for anything the accelerator misses. Escape is deliberately not
    // bound anywhere: Claude, vim and fzf all need it, and dialogs close on it
    // through their own capture-phase listener where nothing competes.
    const onKey = (e: KeyboardEvent): void => {
      if (classifyChord(e) === null) return
      const action = actionForChord(e)
      if (!action) return
      e.preventDefault()
      e.stopPropagation()
      runAction(action)
    }

    window.addEventListener('keydown', onKey, true)
    return () => {
      off()
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])
}
