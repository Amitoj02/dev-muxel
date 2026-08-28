/**
 * The `<webview>` element, typed down to what a browser pane actually uses.
 *
 * Electron ships a full `WebviewTag` interface, but importing it would pull
 * the whole main-process API surface into the renderer's type program — the
 * one place in GRID that has deliberately never seen `electron`. So this is
 * the handful of methods the pane calls and nothing else: a method missing
 * from here is a method the pane is not allowed to reach for.
 *
 * React does not know `<webview>` is an element either, hence the module
 * augmentation at the bottom. React 19 keeps its JSX namespace inside the
 * `react` module rather than in the global scope, so that is where it goes —
 * and it lives in a `.d.ts` because `@typescript-eslint/no-namespace` allows
 * a namespace in a declaration file and nowhere else.
 */

import type { DetailedHTMLProps, WebViewHTMLAttributes } from 'react'

export type WebviewElement = HTMLElement & {
  loadURL(url: string): Promise<void>
  getURL(): string
  getTitle(): string
  isLoading(): boolean
  reload(): void
  reloadIgnoringCache(): void
  stop(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  /**
   * The guest's web contents id — how main finds it to attach a debugger.
   * Throws until the guest is attached and `dom-ready` has fired.
   */
  getWebContentsId(): number
  /**
   * Runs in the page's own world and resolves whatever the last statement
   * evaluates to — including a promise, which is how the element picker waits
   * for a click without any channel of its own.
   */
  executeJavaScript(code: string): Promise<unknown>
  setUserAgent(userAgent: string): void
  setZoomFactor(factor: number): void
  openDevTools(): void
  closeDevTools(): void
  isDevToolsOpened(): boolean
}

/**
 * Webview events are plain DOM events with extra own-properties hung off them,
 * so each one is the `Event` type plus the fields this app reads.
 */
export type WebviewNavigateEvent = Event & { url?: string }
export type WebviewTitleEvent = Event & { title?: string }
export type WebviewFailEvent = Event & {
  errorCode?: number
  errorDescription?: string
  validatedURL?: string
  isMainFrame?: boolean
}

/**
 * React still ships `WebViewHTMLAttributes` — src, partition, allowpopups,
 * webpreferences and the rest — but React 19 dropped `webview` from the
 * intrinsic element list, so the attributes exist with nothing to attach them
 * to. This puts the element back.
 */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<WebViewHTMLAttributes<HTMLElement>, HTMLElement>
    }
  }
}
