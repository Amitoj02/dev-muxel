/**
 * The reopen window.
 *
 * Closing a pane — or a whole grid — does not destroy it straight away. For
 * REOPEN_WINDOW_MS everything it held stays exactly where it was: the panes
 * stay in the store, and so stay mounted and hidden, which means shells keep
 * running, xterm keeps its scrollback, and a browser pane keeps its page, its
 * network log and any comments written on it. Ctrl+Shift+T is then a real undo
 * rather than a fresh pane that happens to look the same. The store side of
 * that is `actions.closePane` / `actions.closeTab` / `actions.reopenLast`.
 *
 * Something still has to call time. This hook is it: it watches the stack and,
 * when the oldest entry runs out, tells the store to let go. The killing
 * itself happens where it always does — in each pane component's own cleanup,
 * which runs the moment the store drops the pane out of the list.
 */

import { useEffect } from 'react'
import { actions, useSlice } from '../state/hooks'

export function useRecentlyClosed(): void {
  const closed = useSlice((s) => s.recentlyClosed)

  useEffect(() => {
    if (closed.length === 0) return
    const due = Math.min(...closed.map((e) => e.expiresAt))
    // A few ms of slack, so the timer can never land a hair early and find
    // nothing expired to reap.
    const id = window.setTimeout(
      () => actions.dropExpired(),
      Math.max(0, due - Date.now()) + 20
    )
    return () => window.clearTimeout(id)
  }, [closed])
}
