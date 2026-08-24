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
import { actions, attentionCount, getState, subscribe } from './store'
import { hydrate, toPersisted } from './store'
import { getSession } from '../terminal/session'

const SAVE_DEBOUNCE_MS = 500

export async function connect(): Promise<void> {
  const { state, shells, buildNumber } = await window.grid.state.load()
  hydrate(state, shells, buildNumber)

  // Tell the watcher which paths to follow before the first paint, so headers
  // are populated by the time the panes appear.
  await window.grid.git.setRepos(getState().repos.map((r) => ({ id: r.id, path: r.path })))
  const snapshot = await window.grid.git.snapshot()
  actions.setGitSnapshot(snapshot)

  wireEvents()
  wireAttention()
  wirePersistence()
}

// ---------------------------------------------------------------------------

function wireEvents(): void {
  window.grid.on.ptyData((paneId, data, seq) => {
    getSession(paneId)?.write(data, seq)
  })

  window.grid.on.ptyExit((paneId, exitCode, solicited) => {
    // A pane GRID killed is already on its way out of the UI, and on Windows
    // the exit code after an explicit kill is meaningless anyway (ConPTY
    // reports 0xC000013A, STATUS_CONTROL_C_EXIT). Never render it.
    if (solicited) return
    actions.patchRuntime(paneId, { exited: true, exitCode, busy: false })
    getSession(paneId)?.writeLocal(
      `\r\n\x1b[38;5;240m-- the shell exited${exitCode ? ` (${exitCode})` : ''} --\x1b[0m\r\n`
    )
  })

  window.grid.on.gitState((path, git) => {
    actions.setGit(path, git)
  })

  // Nothing to do on focus: main already refreshes every repository when the
  // window comes forward, and asking again from here just doubles the work.

  window.grid.on.beforeQuit(() => {
    // Last chance to get the layout to disk before the process goes away.
    void window.grid.state.save(toPersisted(getState()))
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
    window.grid.window.attention(count)
  })
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
    void window.grid.state.save(payload)

    // Repo list changes have to reach the git watcher too, but only when the
    // paths actually changed — not on every layout nudge.
    const repoKey = state.repos.map((r) => `${r.id}:${r.path}`).join('|')
    if (repoKey !== lastRepoKey) {
      lastRepoKey = repoKey
      void window.grid.git.setRepos(state.repos.map((r) => ({ id: r.id, path: r.path })))
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
    void window.grid.state.patchSettings(s)
  })
}
