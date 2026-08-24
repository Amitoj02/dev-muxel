/**
 * The contextBridge surface. This is the only door between the renderer and
 * the machine, so it is a fixed, typed list of verbs rather than a generic
 * "invoke anything" passthrough.
 *
 * Constraint worth knowing before editing: this runs in a **sandboxed**
 * preload, which can only require `electron`, `events`, `timers` and `url`.
 * `path`, `fs` and `os` all throw "module not found" here — so no
 * `path.join(__dirname, …)` in this file, ever.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { CH, EV } from '../shared/ipc'
import type {
  GitState,
  PersistedState,
  PtySpawnResult,
  RepoScanResult,
  Settings,
  ShellProfile
} from '../shared/types'

type Off = () => void

/** Never hand the renderer the raw IpcRendererEvent — it carries a sender. */
function listen<T extends unknown[]>(channel: string, cb: (...args: T) => void): Off {
  const handler = (_e: unknown, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.off(channel, handler)
  }
}

const api = {
  state: {
    load: (): Promise<{ state: PersistedState; shells: ShellProfile[]; buildNumber: number }> =>
      ipcRenderer.invoke(CH.stateLoad),
    save: (state: PersistedState): Promise<void> => ipcRenderer.invoke(CH.stateSave, state),
    patchSettings: (patch: Partial<Settings>): Promise<Settings> =>
      ipcRenderer.invoke(CH.settingsPatch, patch)
  },

  pty: {
    spawn: (req: {
      paneId: string
      cwd: string
      shellId: string
      cols: number
      rows: number
    }): Promise<PtySpawnResult> => ipcRenderer.invoke(CH.ptySpawn, req),
    write: (paneId: string, data: string): void => {
      ipcRenderer.send(CH.ptyWrite, paneId, data)
    },
    resize: (paneId: string, cols: number, rows: number): void => {
      ipcRenderer.send(CH.ptyResize, paneId, cols, rows)
    },
    ack: (paneId: string, bytes: number): void => {
      ipcRenderer.send(CH.ptyAck, paneId, bytes)
    },
    kill: (paneId: string): void => {
      ipcRenderer.send(CH.ptyKill, paneId)
    }
  },

  git: {
    refresh: (path?: string): Promise<void> => ipcRenderer.invoke(CH.gitRefresh, path),
    snapshot: (): Promise<Record<string, GitState>> => ipcRenderer.invoke(CH.gitSnapshot),
    setRepos: (repos: Array<{ id: string; path: string }>): Promise<void> =>
      ipcRenderer.invoke(CH.gitSetRepos, repos)
  },

  dialog: {
    pickFolder: (title?: string): Promise<string | null> =>
      ipcRenderer.invoke(CH.dialogPickFolder, title)
  },

  repo: {
    scan: (root: string): Promise<RepoScanResult[]> => ipcRenderer.invoke(CH.repoScan, root),
    probe: (
      target: string
    ): Promise<{
      isRepo: boolean
      isDirectory: boolean
      root: string | null
      name: string
      worktree: boolean
    }> =>
      ipcRenderer.invoke(CH.repoProbe, target)
  },

  open: {
    editor: (path: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(CH.openEditor, path),
    folder: (path: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(CH.openFolder, path),
    external: (url: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(CH.openExternal, url),
    editorAvailable: (): Promise<boolean> => ipcRenderer.invoke(CH.editorAvailable)
  },

  shells: {
    list: (): Promise<ShellProfile[]> => ipcRenderer.invoke(CH.shellsList)
  },

  window: {
    minimise: (): void => {
      ipcRenderer.send(CH.winMinimise)
    },
    toggleMaximise: (): void => {
      ipcRenderer.send(CH.winToggleMaximise)
    },
    close: (): void => {
      ipcRenderer.send(CH.winClose)
    },
    isMaximised: (): Promise<boolean> => ipcRenderer.invoke(CH.winIsMaximised),
    /** How many panes are waiting on the user, for the taskbar. */
    attention: (count: number): void => {
      ipcRenderer.send(CH.winAttention, count)
    }
  },

  clipboard: {
    write: (text: string): Promise<void> => ipcRenderer.invoke(CH.clipboardWrite, text),
    read: (): Promise<string> => ipcRenderer.invoke(CH.clipboardRead)
  },

  /**
   * `File.path` was removed in Electron 32, so a dropped folder's path can only
   * be recovered through webUtils — and only from a preload.
   */
  pathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },

  on: {
    ptyData: (cb: (paneId: string, data: string, seq: number) => void): Off =>
      listen(EV.ptyData, cb),
    ptyExit: (cb: (paneId: string, exitCode: number, solicited: boolean) => void): Off =>
      listen(EV.ptyExit, cb),
    gitState: (cb: (path: string, state: GitState) => void): Off => listen(EV.gitState, cb),
    windowMaximised: (cb: (maximised: boolean) => void): Off => listen(EV.winMaximised, cb),
    windowFocus: (cb: (focused: boolean) => void): Off => listen(EV.winFocus, cb),
    beforeQuit: (cb: () => void): Off => listen(EV.appBeforeQuit, cb),
    menuAction: (cb: (action: string) => void): Off => listen(EV.menuAction, cb)
  }
}

export type GridApi = typeof api

contextBridge.exposeInMainWorld('grid', api)
