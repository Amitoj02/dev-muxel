/**
 * Keeping a browser pane's guest page where it belongs.
 *
 * A browser pane runs somebody else's code inside DevLobby's window, which is
 * the one thing the rest of this app never does. Three defences, all of them
 * here so there is a single place to read them:
 *
 *   1. The guest's own preferences are overwritten as it attaches, rather than
 *      trusted from the renderer — a `<webview>` carries its `webpreferences`
 *      as an HTML attribute, and an attribute is not a security boundary.
 *   2. The guest cannot navigate anywhere but http and https, and cannot open
 *      a window at all.
 *   3. It lives in its own session, which grants no permissions to anyone.
 *
 * What it deliberately does *not* do is stop the page reaching the network.
 * The whole point of the pane is watching a page that does.
 */

import { session, shell, type WebContents, type WebPreferences } from 'electron'
import { askablePopup, BROWSER_PARTITION, isWebUrl } from '../../shared/browser'

/**
 * Applied from the host's `will-attach-webview`. Everything here overrides
 * whatever the tag asked for.
 */
export function sanitiseGuestPreferences(prefs: WebPreferences & { preload?: string }): void {
  // A preload would run with the guest's page but DevLobby's module resolution;
  // nothing in this app needs one, so nothing may have one.
  delete prefs.preload
  prefs.nodeIntegration = false
  prefs.nodeIntegrationInWorker = false
  prefs.nodeIntegrationInSubFrames = false
  prefs.contextIsolation = true
  prefs.sandbox = true
  prefs.webviewTag = false
  prefs.allowRunningInsecureContent = false
  prefs.experimentalFeatures = false
  // `alert()` in a guest opens a *native* modal parented to the DevLobby
  // window, which would block every other pane — including the agents running
  // in them — until somebody clicks OK. A page in a pane does not get to do
  // that.
  prefs.disableDialogs = true
  // Not inherited from the host, and the first focused text field would
  // otherwise have Chromium download a hunspell dictionary — in an app whose
  // whole renderer is built never to touch the network.
  prefs.spellcheck = false
  // A page in a pane nobody is looking at is usually a dev server mid-rebuild;
  // there is no reason for it to keep a core busy. Not inherited either: the
  // host sets this to false so a build never stalls, which is not a promise
  // DevLobby needs to make to somebody else's website.
  prefs.backgroundThrottling = true
}

export type GuestDeps = {
  /**
   * The page wants a new tab. A pane has none, so the answer is the user's —
   * see `popups.ts`. Called with the guest's own web contents id, which is how
   * the renderer finds its way back to the pane the page is sitting in.
   */
  onPopup: (guestId: number, url: string) => void
}

/**
 * Applied to the guest's own web contents once it exists.
 *
 * `will-navigate` covers the page navigating itself; the window-open handler
 * covers `target="_blank"` and `window.open`. Neither is ever allowed to open
 * a window — a guest that could would be a browser window outside the grid,
 * with none of the grid's rules on it. What a new tab gets instead is a
 * question, asked once and answered by the user.
 */
export function hardenGuest(contents: WebContents, deps: GuestDeps): void {
  contents.setWindowOpenHandler(({ url }) => {
    // The decision has to be returned before anything else happens, so the
    // asking is a side effect of denying rather than a condition of it.
    if (askablePopup(url)) deps.onPopup(contents.id, url)
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (!isWebUrl(url)) event.preventDefault()
  })

  contents.on('will-redirect', (event, url) => {
    if (!isWebUrl(url)) event.preventDefault()
  })

  // `requestFullscreen()` in a guest takes the whole DevLobby window
  // fullscreen, hiding every other pane behind one page. The permission is
  // refused in the guests' session as well; this is the second lock on the same
  // door, because a tiling grid losing its tiles to an embedded video is not a
  // small bug.
  contents.on('enter-html-full-screen', () => {
    void contents.executeJavaScript('document.exitFullscreen && document.exitFullscreen()')
  })

  // Sub-frames are deliberately left alone. `about:srcdoc`, `blob:` and `data:`
  // iframes are ordinary web content, and refusing them here would break real
  // pages to defend against something Chromium already refuses on its own.
}

/**
 * The guests' session. Called once, after `app.whenReady`.
 *
 * Nothing is granted: a page previewed in a pane has no business with the
 * camera, the microphone, notifications or the user's location, and the answer
 * being a silent no is better than a dialog on top of a tiling grid.
 */
export function prepareGuestSession(): void {
  const guests = session.fromPartition(BROWSER_PARTITION)
  guests.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  guests.setPermissionCheckHandler(() => false)
  // Downloads would land silently in a folder nobody chose. Hand them to the
  // real browser, which has a UI for it.
  guests.on('will-download', (event, item) => {
    event.preventDefault()
    const url = item.getURL()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
}
