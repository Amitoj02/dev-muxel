/**
 * App-level shortcuts, as menu accelerators.
 *
 * The obvious approach — a `keydown` listener in the renderer — does not
 * survive contact with a terminal. xterm.js consumes most chords and calls
 * `stopPropagation()` on the ones it handles, so a window-level listener sees
 * an arbitrary subset of what the user actually pressed.
 *
 * Electron accelerators are evaluated before the key reaches the web contents,
 * so they always win, and the terminal never sees them at all. The menu itself
 * is never drawn (the window is frameless), it exists purely to own the
 * bindings — which is also how VS Code and Hyper do this.
 *
 * Everything here is Ctrl+Alt, or Ctrl plus a zoom key. Nothing shadows a
 * plain Ctrl chord, because Claude and every other CLI need those.
 */

import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { EV } from '../shared/ipc'

export type MenuAction =
  | 'new-terminal'
  | 'new-note'
  | 'split-right'
  | 'split-down'
  | 'close-pane'
  | 'reopen-pane'
  | 'zoom-pane'
  | 'even-out'
  | 'repositories'
  | 'notes'
  | 'settings'
  | 'shortcuts'
  | 'open-editor'
  | 'font-bigger'
  | 'font-smaller'
  | 'font-reset'
  | 'focus-left'
  | 'focus-right'
  | 'focus-up'
  | 'focus-down'
  | `focus-${number}`

export function buildMenu(getWindow: () => BrowserWindow | null): void {
  const send = (action: MenuAction) => (): void => {
    getWindow()?.webContents.send(EV.menuAction, action)
  }

  const item = (
    label: string,
    accelerator: string,
    action: MenuAction
  ): MenuItemConstructorOptions => ({ label, accelerator, click: send(action) })

  const focusNumbers: MenuItemConstructorOptions[] = Array.from({ length: 9 }, (_, i) => ({
    label: `Pane ${i + 1}`,
    accelerator: `Ctrl+Alt+${i + 1}`,
    click: send(`focus-${i + 1}` as MenuAction)
  }))

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&Grid',
      submenu: [
        item('New terminal', 'Ctrl+Alt+T', 'new-terminal'),
        item('New note', 'Ctrl+Alt+N', 'new-note'),
        { type: 'separator' },
        item('Repositories', 'Ctrl+Alt+R', 'repositories'),
        // Ctrl+Alt+R is a popular global hotkey (screen recorders claim it
        // most often). A second binding means the shortcut still works on a
        // machine where something else got there first.
        item('Repositories', 'Ctrl+Alt+P', 'repositories'),
        item('Notes', 'Ctrl+Alt+B', 'notes'),
        item('Settings', 'Ctrl+Alt+,', 'settings'),
        item('Keyboard shortcuts', 'Ctrl+Alt+/', 'shortcuts'),
        { type: 'separator' },
        { role: 'quit', accelerator: 'Ctrl+Q' }
      ]
    },
    {
      label: '&Pane',
      submenu: [
        item('Split right', 'Ctrl+Alt+D', 'split-right'),
        item('Split down', 'Ctrl+Alt+S', 'split-down'),
        item('Fill the window', 'Ctrl+Alt+Z', 'zoom-pane'),
        item('Even out splits', 'Ctrl+Alt+E', 'even-out'),
        { type: 'separator' },
        item('Open in VS Code', 'Ctrl+Alt+O', 'open-editor'),
        { type: 'separator' },
        item('Close pane', 'Ctrl+Alt+W', 'close-pane'),
        // The browser gesture, and the same promise: for five seconds after a
        // close, the shell is still running and this puts it back.
        item('Reopen closed pane', 'Ctrl+Shift+T', 'reopen-pane')
      ]
    },
    {
      label: '&Focus',
      submenu: [
        item('Left', 'Ctrl+Alt+Left', 'focus-left'),
        item('Right', 'Ctrl+Alt+Right', 'focus-right'),
        item('Up', 'Ctrl+Alt+Up', 'focus-up'),
        item('Down', 'Ctrl+Alt+Down', 'focus-down'),
        { type: 'separator' },
        ...focusNumbers
      ]
    },
    {
      label: '&View',
      submenu: [
        item('Bigger text', 'Ctrl+=', 'font-bigger'),
        // Ctrl+Plus is what a numpad or a shifted `=` actually reports.
        item('Bigger text', 'Ctrl+Plus', 'font-bigger'),
        item('Smaller text', 'Ctrl+-', 'font-smaller'),
        item('Reset text size', 'Ctrl+0', 'font-reset'),
        { type: 'separator' },
        { role: 'reload', accelerator: 'Ctrl+Alt+Shift+R' },
        { role: 'toggleDevTools', accelerator: 'Ctrl+Alt+Shift+I' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
