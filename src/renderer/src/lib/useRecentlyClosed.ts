/**
 * The reopen window.
 *
 * Closing a pane does not destroy it straight away: for REOPEN_WINDOW_MS the
 * shell keeps running and the scrollback stays in memory, so Ctrl+Shift+T can
 * bring the whole thing back as it was rather than open a lookalike. The store
 * side of that lives in `actions.closePane` / `actions.reopenLast`.
 *
 * Something still has to hold the axe. This hook is it: it watches the stack of
 * recently closed panes and, when the oldest runs out of time, kills the pty,
 * disposes the terminal and drops the entry. Keeping it here rather than in the
 * store is what lets the store stay clear of pty and xterm plumbing.
 */

import { useEffect } from 'react'
import { actions, getState, useSlice } from '../state/hooks'
import { destroySession } from '../terminal/session'

export function useRecentlyClosed(): void {
  const closed = useSlice((s) => s.recentlyClosed)

  useEffect(() => {
    if (closed.length === 0) return
    const due = Math.min(...closed.map((e) => e.expiresAt))
    // A few ms of slack, so the timer can never land a hair early and find
    // nothing expired to reap.
    const id = window.setTimeout(reap, Math.max(0, due - Date.now()) + 20)
    return () => window.clearTimeout(id)
  }, [closed])
}

function reap(): void {
  const now = Date.now()
  const expired = getState().recentlyClosed.filter((e) => e.expiresAt <= now)
  if (expired.length === 0) return

  for (const entry of expired) {
    // Parked panes are the only ones still holding on to anything; everything
    // else was torn down when its component unmounted.
    if (entry.parked) window.grid.pty.kill(entry.pane.id)
    destroySession(entry.pane.id)
  }
  actions.dropClosed(expired.map((e) => e.pane.id))
}
