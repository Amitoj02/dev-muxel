/**
 * Focusing a pane for real.
 *
 * Marking a pane focused in the store is not the same as the keyboard going
 * there: a terminal's keys live in xterm's own hidden textarea, and a browser
 * pane's live in another process entirely. So whichever kind it is, it has to
 * be told directly — which is what this does, and why it lives outside the
 * store: the store holds the data and knows nothing about xterm or guests.
 */

import { actions } from '../state/hooks'
import { getSession } from '../terminal/session'
import { getView } from '../browser/netlog'

export function focusPaneHard(paneId: string | null): void {
  if (!paneId) return
  actions.focusPane(paneId)
  getSession(paneId)?.focus()
  getView(paneId)?.focus()
}
