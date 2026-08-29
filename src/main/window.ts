/**
 * The application window.
 *
 * Frameless, because the titlebar is part of the design and doubles as the
 * drag region. The trade-off, verified on Electron 43: a frameless window with
 * HTML window buttons does not get the Windows 11 Snap Layouts flyout when you
 * hover maximise — Electron cannot return HTMAXBUTTON for an HTML element.
 * Edge resizing and double-click-to-maximise still work through the default
 * `thickFrame`. Getting Snap Layouts back would mean OS-drawn buttons
 * (`titleBarStyle: 'hidden'` + `titleBarOverlay`), which would break the
 * design's own window controls.
 */

import { BrowserWindow, screen, shell, type Rectangle } from 'electron'
import path from 'node:path'
import type { WindowBounds } from '../shared/types'
import { sanitiseGuestPreferences } from './browser/guest'

const MIN_WIDTH = 760
const MIN_HEIGHT = 480

export type WindowDeps = {
  preload: string
  /** Dev server URL, or null to load the built renderer from disk. */
  devServerUrl: string | null
  rendererHtml: string
  /** Window icon, or null to let the executable's own stand. */
  icon: string | null
  bounds: WindowBounds
  onBoundsChanged: (bounds: WindowBounds) => void
}

/**
 * Put a remembered rectangle somewhere it can actually be seen. Monitors get
 * unplugged, and a window restored onto a display that no longer exists is a
 * window the user cannot find.
 *
 * Must run after `app.whenReady()`: the `screen` module throws before that.
 */
export function sanitiseBounds(saved: WindowBounds): Rectangle | { width: number; height: number } {
  const width = Math.max(MIN_WIDTH, Math.round(saved.width || 1440))
  const height = Math.max(MIN_HEIGHT, Math.round(saved.height || 900))

  if (typeof saved.x !== 'number' || typeof saved.y !== 'number') {
    return { width, height }
  }

  const rect = { x: saved.x, y: saved.y, width, height }
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return (
      rect.x < a.x + a.width &&
      rect.x + rect.width > a.x &&
      rect.y < a.y + a.height &&
      rect.y + rect.height > a.y
    )
  })

  if (!onScreen) {
    const wa = screen.getPrimaryDisplay().workArea
    return { width: Math.min(width, wa.width), height: Math.min(height, wa.height) }
  }

  const wa = screen.getDisplayMatching(rect).workArea
  const w = Math.min(width, wa.width)
  const h = Math.min(height, wa.height)
  return {
    width: w,
    height: h,
    x: Math.max(wa.x, Math.min(rect.x, wa.x + wa.width - w)),
    y: Math.max(wa.y, Math.min(rect.y, wa.y + wa.height - h))
  }
}

export function createWindow(deps: WindowDeps): BrowserWindow {
  const restored = sanitiseBounds(deps.bounds)

  const win = new BrowserWindow({
    ...restored,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    frame: false,
    backgroundColor: '#0b0e13',
    // Mica would be composited behind an opaque chassis and do nothing; it
    // also silently no-ops with no way to query whether it took effect.
    backgroundMaterial: 'none',
    autoHideMenuBar: true,
    thickFrame: true,
    roundedCorners: true,
    title: 'DevLobby',
    icon: deps.icon ?? undefined,
    webPreferences: {
      preload: deps.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A pane in the background is still a running build; do not throttle it.
      backgroundThrottling: false,
      // A terminal has nothing to spell-check, and the dictionary is not free.
      spellcheck: false,
      webgl: true,
      // Browser panes. WebContentsView was the alternative and was rejected:
      // it is composited above the page, so it would sit on top of the zoom
      // scrim, the drop indicator and every dialog, and its bounds would have
      // to be mirrored from the layout engine on every splitter drag. A
      // <webview> is an element, so it obeys the same absolute rect, the same
      // stacking order and the same CSS transition as every other pane.
      webviewTag: true
    }
  })

  // A guest's preferences arrive as an HTML attribute, which is not a security
  // boundary — so they are overwritten here, where the renderer cannot reach.
  win.webContents.on('will-attach-webview', (_event, webPreferences) => {
    sanitiseGuestPreferences(webPreferences)
  })

  // Nothing in DevLobby should ever open a second window or navigate away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  let saveTimer: NodeJS.Timeout | null = null
  let lastGood: WindowBounds | null = null

  const persist = (): void => {
    if (win.isDestroyed()) return

    // Windows parks a minimised window at -32000,-32000 and fires `resize` on
    // the way there, so reading bounds now would persist a position the window
    // can never be restored to. Keep the last sane one instead.
    if (win.isMinimized() || win.isFullScreen()) {
      if (lastGood) deps.onBoundsChanged(lastGood)
      return
    }

    // On Windows a maximised window's getBounds() includes 8px of invisible
    // resize border on every side, so persisting it makes the window creep
    // larger and up-left on every launch. getNormalBounds() is the honest one.
    const b = win.getNormalBounds()
    // A zero-size or off-screen rect means we caught the window mid-transition;
    // there is nothing worth saving in that.
    if (b.width < MIN_WIDTH || b.height < MIN_HEIGHT || b.x < -10_000 || b.y < -10_000) {
      if (lastGood) deps.onBoundsChanged(lastGood)
      return
    }

    lastGood = {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      maximized: win.isMaximized()
    }
    deps.onBoundsChanged(lastGood)
  }
  const persistSoon = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(persist, 300)
    saveTimer.unref?.()
  }

  win.on('resize', persistSoon)
  win.on('move', persistSoon)
  win.on('maximize', persistSoon)
  win.on('unmaximize', persistSoon)
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    persist()
  })

  win.once('ready-to-show', () => {
    if (deps.bounds.maximized) win.maximize()
    win.show()
  })

  if (deps.devServerUrl) {
    void win.loadURL(deps.devServerUrl)
  } else {
    void win.loadFile(deps.rendererHtml)
  }

  return win
}

export function resolvePreload(dirname: string): string {
  return path.join(dirname, '../preload/index.js')
}
