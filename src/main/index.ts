/**
 * Main process entry.
 *
 * Owns everything the renderer is not allowed to touch: ptys, git, the
 * filesystem, the window. The renderer owns the layout and pushes it here to
 * be persisted. That split is the reason the renderer can stay sandboxed.
 */

import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell } from 'electron'
import path from 'node:path'
import os from 'node:os'
import { CH, EV } from '../shared/ipc'
import type {
  GitState,
  PersistedState,
  PtySpawnResult,
  Settings,
  ViewportId,
  WatchedRepo
} from '../shared/types'
import { BrowserBridge } from './browser/bridge'
import { BrowserCapture, type CaptureStatus } from './browser/network'
import { POPUP_SNOOZE_MS, type CommentBatch } from '../shared/browser'
import { formatComments } from '../shared/claude'
import { CaptureStash } from './browser/stash'
import { hardenGuest, prepareGuestSession } from './browser/guest'
import { PopupGate, type PopupDecision } from './browser/popups'
import { installSkill, skillStatus } from './browser/skill'
import { buildMenu } from './menu'
import { LEGACY_APP_NAMES, migrateProfile } from './migrate'
import { GitWatcher } from './git/watcher'
import { probeRepo, scanForRepos } from './git/status'
import { clampDepth } from '../shared/git'
import { editorAvailable, openInEditor, openInFileManager } from './integrations/editor'
import { PtyManager } from './pty/manager'
import { discoverShells, mergeShells, pickDefaultShell } from './pty/shells'
import { Store } from './store/store'
import { createWindow, resolvePreload } from './window'

// Must run before anything reads app.getPath('userData'), which cascades into
// sessionData and logs.
app.setName('DevLobby')

// And this before anything *opens* a file in there. An install that predates
// either rename still has its whole profile under an old name; see migrate.ts.
migrateProfile(
  LEGACY_APP_NAMES.map((name) => path.join(app.getPath('appData'), name)),
  app.getPath('userData')
)

// A second launch should raise the window you already have, not open a
// duplicate grid fighting over the same state file.
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
let store: Store
let stash: CaptureStash
let gitWatcher: GitWatcher | null = null
let quitting = false
/**
 * Whether the grid currently holds a browser pane. Pushed up by the renderer,
 * which owns the pane list — main needs it to tell a waiting script that there
 * is nothing to point at, before anybody starts waiting.
 */
let hasBrowserPane = false

let bridge: BrowserBridge

/**
 * New tabs the pages in browser panes have asked for.
 *
 * Up here rather than in the renderer because this is where the request
 * arrives and where it has to be refused; the renderer only gets the ones
 * worth disturbing somebody over. See browser/popups.ts.
 */
const popups = new PopupGate(POPUP_SNOOZE_MS)

/**
 * ConPTY's reflow behaviour depends on the Windows build, and xterm needs to
 * be told the same number or it treats every wrapped line as hard-wrapped.
 */
const windowsBuildNumber = (): number => {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(os.release())
  return m ? Number(m[3]) : 0
}

const pty = new PtyManager({
  onData: (paneId, data, seq) => {
    win?.webContents.send(EV.ptyData, paneId, data, seq)
  },
  onExit: (paneId, exitCode, solicited) => {
    win?.webContents.send(EV.ptyExit, paneId, exitCode, solicited)
  }
})

const capture = new BrowserCapture({
  onEntries: (paneId, entries) => {
    win?.webContents.send(EV.browserNet, paneId, entries)
  },
  onStatus: (paneId, status: CaptureStatus) => {
    win?.webContents.send(EV.browserCapture, paneId, status)
  },
  onFocus: (paneId) => {
    win?.webContents.send(EV.browserFocus, paneId)
  },
  limit: () => store.get().settings.browserNetLimit,
  captureBodies: () => store.get().settings.browserCaptureBodies
})

// ---------------------------------------------------------------------------

function registerIpc(): void {
  ipcMain.handle(CH.stateLoad, async () => {
    const state = store.get()
    const shells = mergeShells(discoverShells(), state.shells)
    // A default pointing at a shell this machine does not have would leave
    // every new terminal dead on arrival.
    if (!shells.some((s) => s.id === state.settings.defaultShellId)) {
      state.settings.defaultShellId = pickDefaultShell(shells)
    }
    return { state, shells, buildNumber: windowsBuildNumber() }
  })

  ipcMain.handle(CH.stateSave, (_e, next: PersistedState) => {
    store.set(next)
    applyGitSettings(next)
  })

  ipcMain.handle(CH.settingsPatch, (_e, patch: Partial<Settings>) => {
    const before = store.get().settings
    const settings = store.patchSettings(patch)
    // The renderer sends the whole settings object, so testing for the *presence*
    // of a poll key would rebuild the watcher on every unrelated preference
    // change — tearing down and re-creating an fs.watch per repo each time.
    if (
      gitWatcher &&
      (before.gitPollFocused !== settings.gitPollFocused ||
        before.gitPollBlurred !== settings.gitPollBlurred)
    ) {
      rebuildGitWatcher()
    }
    return settings
  })

  // --- pty ---------------------------------------------------------------

  ipcMain.handle(
    CH.ptySpawn,
    (
      _e,
      req: { paneId: string; cwd: string; shellId: string; cols: number; rows: number }
    ): PtySpawnResult => {
      const state = store.get()
      const shells = mergeShells(discoverShells(), state.shells)
      const shell_ =
        shells.find((s) => s.id === req.shellId) ??
        shells.find((s) => s.id === state.settings.defaultShellId) ??
        shells[0]

      if (!shell_) return { ok: false, error: 'no shell is available on this machine' }

      try {
        const { pid, shellLabel } = pty.spawn(req.paneId, shell_, req.cwd, req.cols, req.rows)
        return { ok: true, pid, shellLabel }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.on(CH.ptyWrite, (_e, paneId: string, data: string) => pty.write(paneId, data))
  ipcMain.on(CH.ptyResize, (_e, paneId: string, cols: number, rows: number) =>
    pty.resize(paneId, cols, rows)
  )
  ipcMain.on(CH.ptyAck, (_e, paneId: string, bytes: number) => pty.ack(paneId, bytes))
  ipcMain.on(CH.ptyKill, (_e, paneId: string) => pty.kill(paneId))

  // --- git ---------------------------------------------------------------

  // Asking by hand also walks every declared folder again. The timer leaves
  // that to a slow backstop, so Refresh is how you say "I just cloned one".
  ipcMain.handle(CH.gitRefresh, async (_e, target?: string) => {
    if (target) await gitWatcher?.refreshOne(target)
    else gitWatcher?.refreshAll(true)
  })

  ipcMain.handle(CH.gitSnapshot, (): Record<string, GitState> => gitWatcher?.snapshot() ?? {})

  ipcMain.handle(CH.gitSetRepos, (_e, repos: WatchedRepo[]) => {
    gitWatcher?.setRepos(repos)
  })

  // --- dialogs / fs ------------------------------------------------------

  ipcMain.handle(CH.dialogPickFolder, async (_e, title?: string) => {
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: title ?? 'Choose a folder',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Choose'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return path.normalize(result.filePaths[0])
  })

  ipcMain.handle(CH.repoScan, async (_e, root: string, depth?: number) => {
    const found = await scanForRepos(root, clampDepth(depth))
    return found.map((p) => ({
      path: p,
      name: path.basename(p),
      alreadyAdded: false
    }))
  })

  ipcMain.handle(CH.repoProbe, async (_e, target: string) => {
    const probe = await probeRepo(target)
    return {
      isRepo: probe.isRepo,
      isDirectory: probe.isDirectory,
      root: probe.root,
      name: probe.name,
      worktree: probe.worktree
    }
  })

  // --- integrations ------------------------------------------------------

  ipcMain.handle(CH.openEditor, (_e, target: string) => openInEditor(target))
  ipcMain.handle(CH.openFolder, (_e, target: string) => openInFileManager(target))
  ipcMain.handle(CH.editorAvailable, () => editorAvailable())
  ipcMain.handle(CH.openExternal, async (_e, url: string) => {
    // Only ever hand the OS a web URL; a terminal can print anything, and
    // shell.openExternal on a `file:` or custom scheme is an execution vector.
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'only http(s) links are opened' }
    await shell.openExternal(url)
    return { ok: true }
  })

  ipcMain.handle(CH.shellsList, () => mergeShells(discoverShells(), store.get().shells))

  // --- browser panes -----------------------------------------------------
  // The renderer owns the <webview> and drives it directly; only the network
  // debugger and device emulation need to be up here, because both are
  // privileged and neither is reachable from a sandboxed page.

  ipcMain.handle(CH.browserAttach, (_e, paneId: string, webContentsId: number) =>
    capture.attach(String(paneId), Number(webContentsId))
  )
  ipcMain.handle(CH.browserDetach, (_e, paneId: string) => capture.detach(String(paneId)))
  ipcMain.handle(
    CH.browserEmulate,
    (_e, paneId: string, viewport: ViewportId, userAgent: string) =>
      capture.emulate(String(paneId), viewport, String(userAgent))
  )
  ipcMain.handle(CH.browserEntries, (_e, paneId: string) => ({
    entries: capture.entries(String(paneId)),
    attached: capture.isAttached(String(paneId))
  }))
  ipcMain.handle(CH.browserBody, (_e, paneId: string, uid: string) =>
    capture.body(String(paneId), String(uid))
  )
  ipcMain.handle(CH.browserClear, (_e, paneId: string) => capture.clear(String(paneId)))
  ipcMain.handle(CH.browserStash, (_e, text: string, hint: string) =>
    stash.write(String(text ?? ''), String(hint ?? ''))
  )

  ipcMain.on(CH.browserBridgeSync, (_e, state: { hasBrowser?: boolean }) => {
    hasBrowserPane = Boolean(state?.hasBrowser)
  })

  /**
   * The answer to a new-tab question. Opening the page is the renderer's own
   * business — it is a pane, and panes are its — so all that comes back here
   * is whether this guest should be asked again.
   */
  ipcMain.on(CH.browserPopupDecide, (_e, guestId: number, decision: PopupDecision) => {
    const id = Number(guestId)
    if (!Number.isInteger(id)) return
    popups.decide(id, decision === 'snooze' ? 'snooze' : 'ignore')
  })

  ipcMain.handle(CH.browserSendComments, (_e, batch: CommentBatch) => ({
    // Formatted here rather than in the script: the text is built out of a web
    // page's own markup and styles, and `formatComments` is what strips the
    // control characters out of it before it reaches a session's context.
    taken: bridge.deliver({ ...batch, text: formatComments(batch) })
  }))

  // --- the /devlobby-browser skill -------------------------------------------
  // The other half of the bridge above, shipped with the app so the two cannot
  // drift apart. Installing it is always something the user pressed a button
  // for; nothing here writes to their home directory on its own.

  ipcMain.handle(CH.skillStatus, () => skillStatus())
  ipcMain.handle(CH.skillInstall, () => installSkill())

  // --- window ------------------------------------------------------------

  ipcMain.on(CH.winMinimise, () => win?.minimize())
  ipcMain.on(CH.winToggleMaximise, () => {
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on(CH.winClose, () => win?.close())
  ipcMain.handle(CH.winIsMaximised, () => win?.isMaximized() ?? false)

  /**
   * Panes shout at the taskbar, not just at the in-app titlebar. The whole
   * point of DevLobby is running agents while you do something else, so the
   * moment that matters is the one where the window is *not* on top.
   */
  ipcMain.on(CH.winAttention, (_e, count: number) => {
    if (!win || win.isDestroyed()) return
    const waiting = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
    win.setTitle(waiting > 0 ? `${waiting} waiting - DevLobby` : 'DevLobby')
    // Flashing a focused window is just noise; Windows ignores it anyway.
    win.flashFrame(waiting > 0 && !win.isFocused())
  })

  // --- clipboard ---------------------------------------------------------
  // Electron 44 removes the clipboard module from the renderer, so it is
  // bridged from here rather than used directly on the other side.

  ipcMain.handle(CH.clipboardWrite, (_e, text: string) => {
    clipboard.writeText(String(text ?? ''))
  })
  ipcMain.handle(CH.clipboardRead, () => clipboard.readText())
}

// ---------------------------------------------------------------------------

function applyGitSettings(state: PersistedState): void {
  gitWatcher?.setRepos(state.repos.map(watched))
}

/**
 * The slice of a repository the watcher needs. `scan` is what turns a declared
 * folder into the repositories inside it — see main/git/watcher.ts.
 */
function watched(r: PersistedState['repos'][number]): WatchedRepo {
  return { id: r.id, path: r.path, scan: r.scan, scanDepth: r.scanDepth }
}

function rebuildGitWatcher(): void {
  const settings = store.get().settings
  const repos = store.get().repos.map(watched)
  gitWatcher?.dispose()
  // Carry the focus state across: a fresh watcher defaulting to "focused"
  // would quietly put a background window back on the 5s poll.
  const focused = win?.isFocused() ?? true
  gitWatcher = new GitWatcher(
    {
      focusedIntervalMs: settings.gitPollFocused,
      blurredIntervalMs: settings.gitPollBlurred,
      onUpdate: (repoPath, gitState) => {
        win?.webContents.send(EV.gitState, repoPath, gitState)
      }
    },
    focused
  )
  gitWatcher.setRepos(repos)
}

// ---------------------------------------------------------------------------

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

// Never `await app.whenReady()` at module top level in ESM — the ready event
// cannot fire until the entry module finishes evaluating, so it deadlocks.
app.whenReady().then(async () => {
  store = new Store(app.getPath('userData'))
  stash = new CaptureStash(app.getPath('userData'))
  await store.load()

  bridge = new BrowserBridge(app.getPath('userData'), {
    hasBrowserPane: () => hasBrowserPane,
    armPicker: async () => {
      if (!hasBrowserPane || !win || win.isDestroyed()) return false
      win.webContents.send(EV.browserArmPicker)
      return true
    },
    acknowledge: (batch) => win?.webContents.send(EV.browserCommentsTaken, batch),
    onWaiting: (waiting) => win?.webContents.send(EV.browserWaiting, waiting)
  })
  // A failure here costs the /devlobby-browser skill and nothing else, so it is
  // reported rather than allowed to stop the app coming up.
  await bridge.start().catch((err) => {
    console.error('[main] the browser bridge could not start:', err)
  })

  // The renderer loads nothing remote and asks for nothing; deny outright
  // rather than relying on there being no code that would request it.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  )
  // Browser panes run in their own session, which needs the same answer — the
  // handler above is per-session and would not cover a guest.
  prepareGuestSession()

  // Every guest is locked down as it appears, wherever it came from.
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return
    hardenGuest(contents, {
      onPopup: (guestId, url) => {
        // A page that opens tabs on its own gets one question and then
        // silence, so the gate is consulted before the renderer hears
        // anything at all.
        if (popups.consider(guestId) !== 'ask') return
        if (!win || win.isDestroyed()) {
          popups.settle(guestId)
          return
        }
        win.webContents.send(EV.browserPopup, guestId, url)
      }
    })
    // Ids are reused once a guest is gone, and inheriting somebody else's
    // snooze is a link that mysteriously does nothing.
    contents.once('destroyed', () => popups.forget(contents.id))
  })

  registerIpc()
  rebuildGitWatcher()
  // The menu is never drawn (the window is frameless); it exists to own the
  // keyboard accelerators, which fire before the key reaches the renderer.
  buildMenu(() => win)

  win = createWindow({
    preload: resolvePreload(__dirname),
    devServerUrl: process.env.ELECTRON_RENDERER_URL ?? null,
    rendererHtml: path.join(__dirname, '../renderer/index.html'),
    // Packaged, the window and its taskbar button wear the executable's icon,
    // which electron-builder stamped from build/icon.ico. Unpackaged the
    // executable is electron.exe, so they wear Electron's — point them at the
    // same .ico instead. It is not in `files`, and so not inside the asar,
    // which is exactly why this is the unpackaged branch.
    icon: app.isPackaged ? null : path.join(__dirname, '../../build/icon.ico'),
    bounds: store.getBounds(),
    onBoundsChanged: (bounds) => store.setBounds(bounds)
  })

  win.on('focus', () => {
    gitWatcher?.setFocused(true)
    win?.flashFrame(false)
    win?.webContents.send(EV.winFocus, true)
  })
  win.on('blur', () => {
    gitWatcher?.setFocused(false)
    win?.webContents.send(EV.winFocus, false)
  })
  win.on('maximize', () => win?.webContents.send(EV.winMaximised, true))
  win.on('unmaximize', () => win?.webContents.send(EV.winMaximised, false))

  win.on('closed', () => {
    win = null
  })

  // Electron 43 changed this to a single details object; the old five-argument
  // handler silently logs nothing useful.
  win.webContents.on('console-message', ({ level, message, sourceId, lineNumber }) => {
    if (level === 'error' || level === 'warning') {
      console.log(`[renderer ${level}] ${message} (${sourceId}:${lineNumber})`)
    }
  })
})

/**
 * Quitting is deferred by one beat so the last layout change actually reaches
 * disk. The renderer saves continuously, but "start where it ended" is the
 * whole point of the session, and a fire-and-forget write on the way out races
 * process exit.
 */
app.on('before-quit', (event) => {
  if (quitting) return
  quitting = true
  event.preventDefault()

  win?.webContents.send(EV.appBeforeQuit)
  pty.killAll(true)
  capture.disposeAll()
  void bridge?.stop()
  gitWatcher?.dispose()
  gitWatcher = null

  // Long enough for the renderer's final save() to arrive over IPC.
  setTimeout(() => {
    void store
      ?.flush()
      .catch((err) => console.error('[main] final save failed:', err))
      .finally(() => app.exit(0))
  }, 150)
})

app.on('window-all-closed', () => {
  if (!quitting) app.quit()
})

process.on('uncaughtException', (err) => {
  console.error('[main] uncaught:', err)
})
