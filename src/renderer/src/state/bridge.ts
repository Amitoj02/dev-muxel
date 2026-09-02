/**
 * Everything that crosses the preload boundary, in one place.
 *
 * Two jobs:
 *   - pump events from main into the store (pty output, git state, focus)
 *   - push the persisted slice back out, debounced, whenever it changes
 *
 * Persistence is deliberately continuous rather than on-quit-only: a crash or
 * a forced restart should cost you nothing, and the write is a few kilobytes.
 */

import type { PersistedState, Repo, WatchedRepo } from '../../../shared/types'
import { actions, attentionCount, getState, isParked, subscribe, tabOfPane } from './store'
import { hydrate, toPersisted } from './store'
import { getSession } from '../terminal/session'
import {
  armPicker,
  hydrateComments,
  ingestNet,
  onCommentsChanged,
  paneOfWebContents,
  setBridgeWaiting,
  setNetStatus,
  settleBatch
} from '../browser/netlog'

const SAVE_DEBOUNCE_MS = 500

/** The slice of a repository the watcher follows. */
function watched(r: Repo): WatchedRepo {
  return { id: r.id, path: r.path, scan: r.scan, scanDepth: r.scanDepth }
}

export async function connect(): Promise<void> {
  const { state, shells, buildNumber } = await window.devlobby.state.load()
  hydrate(state, shells, buildNumber)

  // Before the first paint: a restored browser pane should come up already
  // wearing its badge, rather than appearing to have lost the comments and
  // then getting them back a frame later.
  hydrateComments(
    state.session.comments,
    getState().panes.map((p) => p.id)
  )

  // Tell the watcher which paths to follow before the first paint, so headers
  // are populated by the time the panes appear.
  await window.devlobby.git.setRepos(getState().repos.map(watched))
  const snapshot = await window.devlobby.git.snapshot()
  actions.setGitSnapshot(snapshot)

  wireEvents()
  wireAttention()
  wireBrowserBridge()
  wirePersistence()
}

// ---------------------------------------------------------------------------

function wireEvents(): void {
  window.devlobby.on.ptyData((paneId, data, seq) => {
    getSession(paneId)?.write(data, seq)
  })

  window.devlobby.on.ptyExit((paneId, exitCode, solicited) => {
    // A pane DevLobby killed is already on its way out of the UI, and on
    // Windows the exit code after an explicit kill is meaningless anyway
    // (ConPTY reports 0xC000013A, STATUS_CONTROL_C_EXIT). Never render it.
    if (solicited) return
    actions.patchRuntime(paneId, { exited: true, exitCode, busy: false })
    getSession(paneId)?.writeLocal(
      `\r\n\x1b[38;5;240m-- the shell exited${exitCode ? ` (${exitCode})` : ''} --\x1b[0m\r\n`
    )
  })

  window.devlobby.on.gitState((path, git) => {
    actions.setGit(path, git)
  })

  // Network entries land in a registry of their own rather than in the store:
  // a busy page is hundreds of updates a second, and the store notifies every
  // pane on every change.
  window.devlobby.on.browserNet((paneId, entries) => {
    ingestNet(paneId, entries, getState().settings.browserNetLimit ?? 400)
  })

  window.devlobby.on.browserCapture((paneId, status) => {
    setNetStatus(paneId, status.attached, status.reason)
  })

  // Clicking into a page focuses another WebContents entirely, so the click
  // never reaches this document. Main tells us instead, or the grid would go
  // on thinking whichever pane you came from is still the focused one — and
  // Ctrl+Alt+W would close that one.
  window.devlobby.on.browserFocus((paneId) => {
    // Only for a guest that is actually on screen. A pane in a tab you are not
    // looking at is hidden and cannot have been clicked, so anything claiming
    // focus from one is the page doing it to itself — and following that would
    // yank the user into another grid while they were typing.
    const s = getState()
    if (tabOfPane(s, paneId) !== s.activeTabId) return
    actions.focusPane(paneId)
  })

  // A session ran /devlobby-browser and wants the picker. It named no pane —
  // the one you were last looking at is what it meant.
  window.devlobby.on.browserArmPicker(() => {
    const state = getState()
    // Never one being held for a reopen: it is off the grid and about to be
    // gone, and arming a picker in a page nobody can see is a session waiting
    // on comments that can never arrive.
    const usable = (paneId: string): boolean => !isParked(state, paneId)
    const target =
      (state.lastBrowserPaneId &&
        state.panes.some((p) => p.id === state.lastBrowserPaneId) &&
        usable(state.lastBrowserPaneId) &&
        state.lastBrowserPaneId) ||
      state.panes.find((p) => p.kind === 'browser' && usable(p.id))?.id
    if (!target) return
    actions.focusPane(target)
    if (!armPicker(target)) actions.toast('That browser pane is not ready yet', 'error')
  })

  window.devlobby.on.browserCommentsTaken((batch) => {
    settleBatch(batch)
  })

  window.devlobby.on.browserWaiting((waiting) => {
    setBridgeWaiting(waiting)
  })

  /**
   * A page wants a new tab, and only the user can say what that means here.
   *
   * Three ways it is refused without anybody being asked, all of them cases
   * where a dialog would be the page interrupting rather than the user
   * following a link: no pane owns that guest any more, the pane is in a grid
   * that is not on screen — a page nobody can see did not just have a link
   * clicked in it — or there is already a dialog up, which a page does not get
   * to take away. Main is told either way; it is holding the request open.
   */
  window.devlobby.on.browserPopup((guestId, url) => {
    const s = getState()
    const paneId = paneOfWebContents(guestId)
    if (!paneId || tabOfPane(s, paneId) !== s.activeTabId || s.overlay.kind !== 'none') {
      window.devlobby.browser.popupDecision(guestId, 'ignore')
      return
    }
    actions.showOverlay({ kind: 'browser-popup', paneId, guestId, url })
  })

  // Nothing to do on focus: main already refreshes every repository when the
  // window comes forward, and asking again from here just doubles the work.

  window.devlobby.on.beforeQuit(() => {
    // Last chance to get the layout to disk before the process goes away.
    void window.devlobby.state.save(toPersisted(getState()))
  })
}

// ---------------------------------------------------------------------------

/**
 * Keep the taskbar in step with the grid. Only pushed on change, because
 * flashFrame is a system call and this fires on every store update.
 */
function wireAttention(): void {
  let last = -1
  subscribe(() => {
    const count = attentionCount(getState())
    if (count === last) return
    last = count
    window.devlobby.window.attention(count)
  })
}

/**
 * Keep main told whether there is a browser pane at all.
 *
 * The bridge has to refuse `/devlobby-browser` when there is nothing to point
 * at, and it has to do that before anybody starts waiting — but the pane list
 * lives here. Pushed on change only, like the taskbar count.
 */
function wireBrowserBridge(): void {
  let last = false
  subscribe(() => {
    const s = getState()
    // `isParked` returns straight away while nothing is closed, which is
    // almost always — this runs on every store update.
    const hasBrowser = s.panes.some((p) => p.kind === 'browser' && !isParked(s, p.id))
    if (hasBrowser === last) return
    last = hasBrowser
    window.devlobby.browser.bridgeSync({ hasBrowser })
  })
  window.devlobby.browser.bridgeSync({ hasBrowser: false })
}

function wirePersistence(): void {
  let timer: number | null = null
  let lastSerialised = ''
  let lastRepoKey = ''

  const flush = (): void => {
    timer = null
    const state = getState()
    if (!state.ready) return

    const payload: PersistedState = toPersisted(state)
    const serialised = JSON.stringify(payload)
    if (serialised === lastSerialised) return
    lastSerialised = serialised
    void window.devlobby.state.save(payload)

    // Repo list changes have to reach the git watcher too, but only when the
    // paths actually changed — not on every layout nudge.
    // Not just the paths: turning `scan` on, or looking one level deeper,
    // changes which repositories the watcher follows just as much as adding one.
    const repoKey = state.repos
      .map((r) => `${r.id}:${r.path}:${r.scan ? 1 : 0}:${r.scanDepth ?? ''}`)
      .join('|')
    if (repoKey !== lastRepoKey) {
      lastRepoKey = repoKey
      void window.devlobby.git.setRepos(state.repos.map(watched))
    }
  }

  const save = (): void => {
    if (timer !== null) return
    timer = window.setTimeout(flush, SAVE_DEBOUNCE_MS)
  }

  subscribe(save)
  // Comments do not live in the store — see browser/netlog.ts — so nothing
  // above would ever notice one being written. They are the one thing in a
  // browser pane worth keeping, so they get their own way of saying so.
  onCommentsChanged(save)

  // A settings change also has to reach the main process, which keeps its own
  // copy for the git poll intervals.
  let lastSettings = ''
  subscribe(() => {
    const s = getState().settings
    const key = JSON.stringify(s)
    if (key === lastSettings) return
    lastSettings = key
    void window.devlobby.state.patchSettings(s)
  })
}
