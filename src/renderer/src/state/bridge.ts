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

import type { PersistedState } from '../../../shared/types'
import { actions, attentionCount, getState, isParked, subscribe, tabOfPane } from './store'
import { hydrate, toPersisted } from './store'
import { getSession } from '../terminal/session'
import {
  armPicker,
  ingestNet,
  setBridgeWaiting,
  setNetStatus,
  settleBatch
} from '../browser/netlog'

const SAVE_DEBOUNCE_MS = 500

export async function connect(): Promise<void> {
  const { state, shells, buildNumber } = await window.devmuxel.state.load()
  hydrate(state, shells, buildNumber)

  // Tell the watcher which paths to follow before the first paint, so headers
  // are populated by the time the panes appear.
  await window.devmuxel.git.setRepos(getState().repos.map((r) => ({ id: r.id, path: r.path })))
  const snapshot = await window.devmuxel.git.snapshot()
  actions.setGitSnapshot(snapshot)

  wireEvents()
  wireAttention()
  wireBrowserBridge()
  wirePersistence()
}

// ---------------------------------------------------------------------------

function wireEvents(): void {
  window.devmuxel.on.ptyData((paneId, data, seq) => {
    getSession(paneId)?.write(data, seq)
  })

  window.devmuxel.on.ptyExit((paneId, exitCode, solicited) => {
    // A pane DevMuxel killed is already on its way out of the UI, and on
    // Windows the exit code after an explicit kill is meaningless anyway
    // (ConPTY reports 0xC000013A, STATUS_CONTROL_C_EXIT). Never render it.
    if (solicited) return
    actions.patchRuntime(paneId, { exited: true, exitCode, busy: false })
    getSession(paneId)?.writeLocal(
      `\r\n\x1b[38;5;240m-- the shell exited${exitCode ? ` (${exitCode})` : ''} --\x1b[0m\r\n`
    )
  })

  window.devmuxel.on.gitState((path, git) => {
    actions.setGit(path, git)
  })

  // Network entries land in a registry of their own rather than in the store:
  // a busy page is hundreds of updates a second, and the store notifies every
  // pane on every change.
  window.devmuxel.on.browserNet((paneId, entries) => {
    ingestNet(paneId, entries, getState().settings.browserNetLimit ?? 400)
  })

  window.devmuxel.on.browserCapture((paneId, status) => {
    setNetStatus(paneId, status.attached, status.reason)
  })

  // Clicking into a page focuses another WebContents entirely, so the click
  // never reaches this document. Main tells us instead, or the grid would go
  // on thinking whichever pane you came from is still the focused one — and
  // Ctrl+Alt+W would close that one.
  window.devmuxel.on.browserFocus((paneId) => {
    // Only for a guest that is actually on screen. A pane in a tab you are not
    // looking at is hidden and cannot have been clicked, so anything claiming
    // focus from one is the page doing it to itself — and following that would
    // yank the user into another grid while they were typing.
    const s = getState()
    if (tabOfPane(s, paneId) !== s.activeTabId) return
    actions.focusPane(paneId)
  })

  // A session ran /devmuxel-browser and wants the picker. It named no pane —
  // the one you were last looking at is what it meant.
  window.devmuxel.on.browserArmPicker(() => {
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

  window.devmuxel.on.browserCommentsTaken((batch) => {
    settleBatch(batch)
  })

  window.devmuxel.on.browserWaiting((waiting) => {
    setBridgeWaiting(waiting)
  })

  // Nothing to do on focus: main already refreshes every repository when the
  // window comes forward, and asking again from here just doubles the work.

  window.devmuxel.on.beforeQuit(() => {
    // Last chance to get the layout to disk before the process goes away.
    void window.devmuxel.state.save(toPersisted(getState()))
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
    window.devmuxel.window.attention(count)
  })
}

/**
 * Keep main told whether there is a browser pane at all.
 *
 * The bridge has to refuse `/devmuxel-browser` when there is nothing to point
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
    window.devmuxel.browser.bridgeSync({ hasBrowser })
  })
  window.devmuxel.browser.bridgeSync({ hasBrowser: false })
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
    void window.devmuxel.state.save(payload)

    // Repo list changes have to reach the git watcher too, but only when the
    // paths actually changed — not on every layout nudge.
    const repoKey = state.repos.map((r) => `${r.id}:${r.path}`).join('|')
    if (repoKey !== lastRepoKey) {
      lastRepoKey = repoKey
      void window.devmuxel.git.setRepos(state.repos.map((r) => ({ id: r.id, path: r.path })))
    }
  }

  subscribe(() => {
    if (timer !== null) return
    timer = window.setTimeout(flush, SAVE_DEBOUNCE_MS)
  })

  // A settings change also has to reach the main process, which keeps its own
  // copy for the git poll intervals.
  let lastSettings = ''
  subscribe(() => {
    const s = getState().settings
    const key = JSON.stringify(s)
    if (key === lastSettings) return
    lastSettings = key
    void window.devmuxel.state.patchSettings(s)
  })
}
