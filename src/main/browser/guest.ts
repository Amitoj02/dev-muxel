/**
 * Keeping a browser pane's guest page where it belongs.
 *
 * A browser pane runs somebody else's code inside DevMuxel's window, which is
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
import { BROWSER_PARTITION, isWebUrl } from '../../shared/browser'

/**
 * Applied from the host's `will-attach-webview`. Everything here overrides
 * whatever the tag asked for.
 */
export function sanitiseGuestPreferences(prefs: WebPreferences & { preload?: string }): void {
  // A preload would run with the guest's page but DevMuxel's module resolution;
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
  // `alert()` in a guest opens a *native* modal parented to the DevMuxel
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
  // DevMuxel needs to make to somebody else's website.
  prefs.backgroundThrottling = true
}

/**
 * Applied to the guest's own web contents once it exists.
 *
 * `will-navigate` covers the page navigating itself; the window-open handler
 * covers `target="_blank"` and `window.open`. A pane has no tabs, so a link
 * meant for a new window is loaded in place — losing the page you were on is
 * still better than a link that silently does nothing, and anything that is
 * not http goes to the real browser instead.
 */
export function hardenGuest(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      // Not inside the handler itself: it has to return a decision first.
      setImmediate(() => {
        if (!contents.isDestroyed()) void contents.loadURL(url)
      })
    }
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (!isWebUrl(url)) event.preventDefault()
  })

  contents.on('will-redirect', (event, url) => {
    if (!isWebUrl(url)) event.preventDefault()
  })

  // `requestFullscreen()` in a guest takes the whole DevMuxel window
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
