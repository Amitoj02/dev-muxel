/**
 * A page in the grid.
 *
 * The guest is an Electron `<webview>` rather than a main-process
 * `WebContentsView`, which matters more than it sounds: a WebContentsView is
 * composited *above* the page, so it would sit on top of the zoom scrim, the
 * drop indicator and every dialog, and its rectangle would have to be mirrored
 * out of the layout engine on every splitter drag. A `<webview>` is an
 * element. It obeys the same absolute rect, the same stacking order and the
 * same CSS transition as every other pane, and — like the xterm instances —
 * it survives being dragged across the grid because the pane list never
 * reorders and so React never moves the node.
 *
 * Everything privileged (the network debugger, device emulation) is in the
 * main process; everything else is driven straight off the element.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BrowserPane as BrowserPaneModel, ViewportId } from '../../../shared/types'
import type { PickedElement } from '../../../shared/browser'
import {
  BROWSER_PARTITION,
  VIEWPORTS,
  VIEWPORT_ORDER,
  fitScale,
  isFailure,
  isWebUrl,
  normaliseUrl,
  userAgentFor,
  viewportOf
} from '../../../shared/browser'
import {
  addComment,
  chromeVersion,
  dropNet,
  registerArm,
  registerView,
  replaceNet,
  setPicked,
  useBridgeWaiting,
  useNetLog
} from '../browser/netlog'
import { cancelPick, pickElement } from '../browser/picker'
import { CommentPopover, CommentsPanel, sendComments } from './PageComments'
import type {
  WebviewElement,
  WebviewFailEvent,
  WebviewNavigateEvent,
  WebviewTitleEvent
} from '../browser/webview'
import { actions, getState, paneById, paneLabel, useApp } from '../state/hooks'
import {
  IconArrowLeft,
  IconArrowRight,
  IconClose,
  IconGlobe,
  IconPick,
  IconRefresh
} from './Icons'
import { NetworkLog } from './NetworkLog'

export type BrowserPaneProps = {
  pane: BrowserPaneModel
}

/** Ports a dev server is most likely to be on, for the empty state. */
const COMMON_PORTS = [3000, 5173, 8080]

/**
 * The CSS pixels the page was actually laid out at when a comment was written.
 *
 * A device preset fixes it. Desktop does not — it is whatever the pane happens
 * to be — so the measured stage stands in, which is the same number the page
 * itself saw, because at desktop the guest fills the stage unscaled.
 */
function measuredViewport(
  preset: { width: number | null; height: number | null },
  stage: { width: number; height: number }
): { width: number; height: number } | null {
  if (preset.width && preset.height) return { width: preset.width, height: preset.height }
  if (stage.width > 0 && stage.height > 0) {
    return { width: Math.round(stage.width), height: Math.round(stage.height) }
  }
  return null
}

export function BrowserPane({ pane }: BrowserPaneProps): React.JSX.Element {
  const ref = useRef<WebviewElement | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const attached = useRef(false)
  /** The preset the guest is currently emulating, as opposed to asked to. */
  const appliedViewport = useRef<ViewportId | null>(null)

  const log = useNetLog(pane.id)
  const [stage, setStage] = useState({ width: 0, height: 0 })
  const [loading, setLoading] = useState(false)
  const [nav, setNav] = useState({ back: false, forward: false })
  const [failure, setFailure] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [showComments, setShowComments] = useState(false)
  /** The selector is on: pointing at one thing leads straight to the next. */
  const [selecting, setSelecting] = useState(false)
  const selectorOn = useRef(false)
  const waiting = useBridgeWaiting()
  const label = paneLabel(useApp(), pane)
  /**
   * The picker, reachable from the mount effect — which is keyed on the pane
   * id and so cannot close over a callback that changes every render.
   */
  const pickRef = useRef<(() => void) | null>(null)

  const preset = viewportOf(pane.viewport)
  const scale = fitScale(stage, preset)

  // --- the guest ----------------------------------------------------------
  // Keyed on the pane id alone. Everything else about the pane is pushed into
  // the existing element rather than rebuilding it, because rebuilding means a
  // new guest process and a page reload.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    registerView(pane.id, el)
    // How /devmuxel-browser reaches this pane's picker from a session
    // elsewhere.
    registerArm(pane.id, () => void pickRef.current?.())

    const syncNav = (): void => {
      setNav({ back: el.canGoBack(), forward: el.canGoForward() })
    }

    /**
     * `getWebContentsId()` throws until the guest has attached *and* reported
     * dom-ready, so this is the earliest honest moment to hand main an id.
     * It fires again on every navigation; the attach itself is idempotent.
     */
    const onReady = (): void => {
      if (attached.current) return
      attached.current = true

      // Read live rather than from this effect's closure: the effect is keyed
      // on the pane id alone, so a preset chosen between mount and dom-ready
      // would otherwise be applied and then immediately undone.
      const live = getState().panes.find((p) => p.id === pane.id)
      const wanted = live?.kind === 'browser' ? live : null
      const viewport = wanted?.viewport ?? pane.viewport
      appliedViewport.current = viewport

      const ua = userAgentFor(viewport, chromeVersion())
      el.setUserAgent(ua)

      void window.devmuxel.browser.attach(pane.id, el.getWebContentsId()).then((result) => {
        if (!result.ok) return
        void window.devmuxel.browser.emulate(pane.id, viewport, ua)
        // A remounted pane (reopened with Ctrl+Shift+T) has a log in main
        // that this side knows nothing about yet.
        void window.devmuxel.browser.entries(pane.id).then(({ entries, attached: live }) => {
          replaceNet(pane.id, entries, live)
        })
      })

      // `loadURL` is the one navigation the guest's own will-navigate guard
      // never sees, so the scheme is checked here as well as on the way into
      // the state file.
      if (wanted && isWebUrl(wanted.url) && wanted.url !== 'about:blank') {
        void el.loadURL(wanted.url).catch(() => {
          /* did-fail-load reports it; a rejected promise here is the same news */
        })
      }
    }

    const onNavigate = (event: Event): void => {
      const url = (event as WebviewNavigateEvent).url
      if (url) actions.patchBrowser(pane.id, { url })
      setFailure(null)
      syncNav()
    }

    const onTitle = (event: Event): void => {
      const title = (event as WebviewTitleEvent).title
      if (title) actions.patchBrowser(pane.id, { title })
    }

    const onStart = (): void => setLoading(true)
    const onStop = (): void => {
      setLoading(false)
      syncNav()
    }

    const onFail = (event: Event): void => {
      const detail = event as WebviewFailEvent
      // Sub-resources fail all the time and are the network log's business,
      // not the pane's. Only a main frame that never arrived is a dead page.
      if (detail.isMainFrame === false) return
      // -3 is ERR_ABORTED, which is what a navigation you replaced looks like.
      if (detail.errorCode === -3) return
      setFailure(detail.errorDescription ?? 'the page did not load')
      setLoading(false)
    }

    /**
     * Clicking inside a guest never reaches this document — the events belong
     * to another WebContents entirely. Main reports the guest's own focus over
     * IPC for that reason; this is the same signal from the element, for the
     * moments before the debugger has attached.
     */
    const onFocus = (): void => actions.focusPane(pane.id)

    const onGone = (): void => {
      attached.current = false
    }

    el.addEventListener('dom-ready', onReady)
    el.addEventListener('did-navigate', onNavigate)
    el.addEventListener('did-navigate-in-page', onNavigate)
    el.addEventListener('page-title-updated', onTitle)
    el.addEventListener('did-start-loading', onStart)
    el.addEventListener('did-stop-loading', onStop)
    el.addEventListener('did-fail-load', onFail)
    el.addEventListener('focus', onFocus)
    el.addEventListener('destroyed', onGone)
    el.addEventListener('render-process-gone', onGone)

    return () => {
      el.removeEventListener('dom-ready', onReady)
      el.removeEventListener('did-navigate', onNavigate)
      el.removeEventListener('did-navigate-in-page', onNavigate)
      el.removeEventListener('page-title-updated', onTitle)
      el.removeEventListener('did-start-loading', onStart)
      el.removeEventListener('did-stop-loading', onStop)
      el.removeEventListener('did-fail-load', onFail)
      el.removeEventListener('focus', onFocus)
      el.removeEventListener('destroyed', onGone)
      el.removeEventListener('render-process-gone', onGone)
      registerView(pane.id, null)
      registerArm(pane.id, null)
      attached.current = false

      // Still on the grid means this is a remount, not a close: main's log has
      // to survive it, because the element it belongs to is coming straight
      // back. Gone from the grid means gone for good.
      if (paneById(getState(), pane.id)) return
      void window.devmuxel.browser.detach(pane.id)
      dropNet(pane.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id])

  // --- device preset ------------------------------------------------------
  // The preset a pane opens with is applied by `dom-ready`, which also records
  // it here; this only ever runs for a *change*, because applying it twice
  // would reload the page out from under the user.
  useEffect(() => {
    const el = ref.current
    if (!el || !attached.current) return
    if (appliedViewport.current === pane.viewport) return
    appliedViewport.current = pane.viewport

    const ua = userAgentFor(pane.viewport, chromeVersion())
    el.setUserAgent(ua)
    void window.devmuxel.browser.emulate(pane.id, pane.viewport, ua).then((result) => {
      if (result.missing.length > 0 && result.missing[0] !== 'debugger') {
        actions.toast(`Emulating ${result.missing.join(' and ')} is not supported here`, 'error')
      }
      // The server only sees the new user agent on the next request, so a
      // switch that does not reload is a switch that half happened.
      if (el.getURL() && el.getURL() !== 'about:blank') el.reload()
    })
  }, [pane.id, pane.viewport])

  // --- fitting the device frame into the pane -----------------------------
  useLayoutEffect(() => {
    const host = stageRef.current
    if (!host) return
    const update = (): void => setStage({ width: host.clientWidth, height: host.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(host)
    return () => ro.disconnect()
  }, [])

  // --- actions ------------------------------------------------------------

  const go = useCallback(
    (raw: string): boolean => {
      const el = ref.current
      if (!el) return false
      const result = normaliseUrl(raw, pane.url)
      if (!result.ok) {
        actions.toast(result.reason, 'error')
        return false
      }
      setFailure(null)
      // Remembered before the load rather than after it: a URL that fails to
      // resolve is still the one you asked for, and the bar should say so.
      actions.patchBrowser(pane.id, { url: result.url })
      void el.loadURL(result.url).catch(() => {})
      return true
    },
    [pane.id, pane.url]
  )

  /**
   * Arm the picker once and hand back whatever was pointed at.
   *
   * The wait is the user's: `pickElement` resolves when they click, press
   * Escape, or the page navigates away — so this promise can be outstanding
   * for as long as they are looking around.
   */
  const armOnce = useCallback(async () => {
    const el = ref.current
    if (!el) return
    const result = await pickElement(el)
    if (result) {
      // The comment box opens over it; picking resumes when that box closes.
      setPicked(pane.id, result)
      return
    }
    // Escape, or a navigation: that is the selector being turned off.
    selectorOn.current = false
    setSelecting(false)
  }, [pane.id])

  /**
   * The selector as a mode rather than a single shot.
   *
   * Marking a page up is a run of comments, not one — so pointing at something
   * and saying what is wrong with it puts you straight back into pointing, and
   * it stays that way until you turn it off or press Escape.
   */
  const toggleSelector = useCallback(() => {
    const el = ref.current
    if (!el) return
    if (selectorOn.current) {
      selectorOn.current = false
      setSelecting(false)
      cancelPick(el)
      return
    }
    selectorOn.current = true
    setSelecting(true)
    void armOnce()
  }, [armOnce])

  /** Called when the comment box closes, whether it was saved or dropped. */
  const resumeSelector = useCallback(() => {
    if (!selectorOn.current) return
    void armOnce()
  }, [armOnce])

  /**
   * What /devmuxel-browser reaches. It asks for the selector, so it turns it on
   * rather than toggling — and opens the comments, because the session that
   * asked is now waiting on the send button in there.
   */
  const armFromSession = useCallback(() => {
    setShowComments(true)
    if (!selectorOn.current) toggleSelector()
  }, [toggleSelector])

  useEffect(() => {
    pickRef.current = armFromSession
  }, [armFromSession])

  const reload = useCallback((hard: boolean) => {
    const el = ref.current
    if (!el) return
    if (el.isLoading()) el.stop()
    else if (hard) el.reloadIgnoringCache()
    else el.reload()
  }, [])

  const blank = !pane.url || pane.url === 'about:blank'
  const failures = log.entries.filter(isFailure).length

  return (
    <div className="pane-body pane-body--browser">
      <BrowserToolbar
        pane={pane}
        loading={loading}
        nav={nav}
        scale={scale}
        logOpen={showLog}
        logFailures={failures}
        selecting={selecting}
        commentsOpen={showComments}
        commentCount={log.comments.length}
        onToggleComments={() => setShowComments((open) => !open)}
        onGo={go}
        onBack={() => ref.current?.goBack()}
        onForward={() => ref.current?.goForward()}
        onReload={reload}
        onViewport={(viewport) => actions.patchBrowser(pane.id, { viewport })}
        onToggleLog={() => setShowLog((open) => !open)}
      />

      <div className="browser-stage" ref={stageRef} data-device={preset.id}>
        <div
          className="browser-frame"
          style={
            preset.width && preset.height
              ? { width: preset.width * scale, height: preset.height * scale }
              : { width: '100%', height: '100%' }
          }
        >
          <webview
            ref={ref as React.Ref<HTMLElement>}
            className="browser-view"
            src="about:blank"
            partition={BROWSER_PARTITION}
            allowpopups={true}
            /* Belt and braces only: main overwrites every one of these as the
               guest attaches, because an HTML attribute is not a boundary. */
            webpreferences="contextIsolation=yes,sandbox=yes,nodeIntegration=no"
            style={
              preset.width && preset.height
                ? {
                    width: preset.width,
                    height: preset.height,
                    transform: `scale(${scale})`,
                    transformOrigin: '0 0'
                  }
                : { width: '100%', height: '100%' }
            }
          />
        </div>

        {log.picked && (
          <CommentPopover
            element={log.picked}
            preset={preset}
            scale={scale}
            stage={stage}
            onSave={(text) => {
              addComment(pane.id, {
                id: `cmt_${Date.now().toString(36)}`,
                element: log.picked as PickedElement,
                text,
                viewport: preset.id,
                viewportSize: measuredViewport(preset, stage),
                at: Date.now()
              })
              resumeSelector()
            }}
            onCancel={() => {
              setPicked(pane.id, null)
              resumeSelector()
            }}
          />
        )}

        {blank && <BrowserStart pane={pane} onGo={go} />}
        {failure && !blank && (
          <div className="browser-failure">
            <span>{failure}</span>
            <button className="btn" onClick={() => reload(false)}>
              Try again
            </button>
          </div>
        )}
      </div>

      {showComments && (
        <CommentsPanel
          paneId={pane.id}
          comments={log.comments}
          waiting={waiting}
          picking={selecting}
          onTogglePicker={toggleSelector}
          onNote={(text) =>
            addComment(pane.id, {
              id: `cmt_${Date.now().toString(36)}`,
              element: null,
              text,
              viewport: preset.id,
                viewportSize: measuredViewport(preset, stage),
              at: Date.now()
            })
          }
          onSend={() => {
            // Handing them over ends the run: the selector stays on between
            // comments, but not past the moment they leave.
            if (selectorOn.current) toggleSelector()
            sendComments(pane.id, label, pane.url, log.comments)
          }}
          onClose={() => setShowComments(false)}
        />
      )}

      {showLog && <NetworkLog paneId={pane.id} log={log} onClose={() => setShowLog(false)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------

type ToolbarProps = {
  pane: BrowserPaneModel
  loading: boolean
  nav: { back: boolean; forward: boolean }
  scale: number
  logOpen: boolean
  logFailures: number
  selecting: boolean
  commentsOpen: boolean
  commentCount: number
  onToggleComments: () => void
  onGo: (raw: string) => boolean
  onBack: () => void
  onForward: () => void
  onReload: (hard: boolean) => void
  onViewport: (viewport: ViewportId) => void
  onToggleLog: () => void
}

function BrowserToolbar(props: ToolbarProps): React.JSX.Element {
  const { pane } = props
  const shown = pane.url === 'about:blank' ? '' : pane.url
  const [draft, setDraft] = useState(shown)
  const [editing, setEditing] = useState(false)
  const [seen, setSeen] = useState(shown)
  const inputRef = useRef<HTMLInputElement>(null)

  // The bar follows the page, except while you are typing into it — otherwise
  // a redirect landing mid-keystroke would rewrite what you were typing. It
  // catches up on the render after the field is left, because `seen` is only
  // moved on when the bar is not being edited.
  //
  // Adjusted during render rather than in an effect, like the zoom flag in
  // GridView: an effect would paint one frame with the previous URL in the bar.
  if (!editing && seen !== shown) {
    setSeen(shown)
    setDraft(shown)
  }

  const preset = viewportOf(pane.viewport)

  return (
    <div className="browser-bar">
      <button
        className="pane-btn"
        onClick={props.onBack}
        disabled={!props.nav.back}
        title="Back"
      >
        <IconArrowLeft />
      </button>
      <button
        className="pane-btn"
        onClick={props.onForward}
        disabled={!props.nav.forward}
        title="Forward"
      >
        <IconArrowRight />
      </button>
      <button
        className="pane-btn"
        onClick={(e) => props.onReload(e.shiftKey)}
        title={props.loading ? 'Stop loading' : 'Reload — Shift-click to ignore the cache'}
      >
        {props.loading ? <IconClose size={10} /> : <IconRefresh size={11} />}
      </button>

      <input
        ref={inputRef}
        className="browser-url"
        value={draft}
        spellCheck={false}
        placeholder="localhost:3000"
        data-loading={props.loading}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          setEditing(true)
          e.currentTarget.select()
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (props.onGo(draft)) inputRef.current?.blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setDraft(pane.url === 'about:blank' ? '' : pane.url)
            inputRef.current?.blur()
          }
        }}
      />

      <div className="browser-devices" role="group" aria-label="Viewport">
        {VIEWPORT_ORDER.map((id) => (
          <button
            key={id}
            className="browser-device"
            data-picked={pane.viewport === id}
            onClick={() => props.onViewport(id)}
            title={
              VIEWPORTS[id].width
                ? `${VIEWPORTS[id].label} — ${VIEWPORTS[id].width}×${VIEWPORTS[id].height}`
                : 'Desktop — whatever the pane is'
            }
          >
            {VIEWPORTS[id].label}
          </button>
        ))}
      </div>

      {preset.width !== null && (
        <span className="browser-size" title="The page is laid out at this size, then scaled to fit">
          {preset.width}×{preset.height}
          {props.scale < 1 ? ` · ${Math.round(props.scale * 100)}%` : ''}
        </span>
      )}

      <button
        className="browser-net"
        data-open={props.commentsOpen || props.selecting}
        data-armed={props.commentCount > 0}
        onClick={props.onToggleComments}
        title="Comments on this page"
      >
        <IconPick size={11} />
        {props.commentCount > 0 && (
          <span className="browser-net__badge">{props.commentCount}</span>
        )}
      </button>

      {/* No count on it: the pane header already carries every other number,
          and a running total of requests is not one you act on. */}
      <button
        className="browser-net"
        data-open={props.logOpen}
        data-failed={props.logFailures > 0}
        onClick={props.onToggleLog}
        title="The network log for this page"
      >
        <IconGlobe size={12} />
      </button>
    </div>
  )
}

/** What a browser pane shows before it has been pointed anywhere. */
function BrowserStart({
  pane,
  onGo
}: {
  pane: BrowserPaneModel
  onGo: (raw: string) => boolean
}): React.JSX.Element {
  const app = useApp()
  const repo = pane.repoId ? app.repos.find((r) => r.id === pane.repoId) : null

  return (
    <div className="browser-start">
      <span className="empty__kicker">BROWSER</span>
      <p className="empty__hint">
        Point this pane at what you are building. Requests it makes show up in the network log,
        and any one of them can go straight to a Claude session with a note attached.
      </p>
      <div className="empty__actions">
        {repo?.devUrl && (
          <button className="btn btn--primary" onClick={() => onGo(repo.devUrl as string)}>
            {repo.name} — {repo.devUrl}
          </button>
        )}
        {COMMON_PORTS.map((port) => (
          <button key={port} className="btn" onClick={() => onGo(`:${port}`)}>
            localhost:{port}
          </button>
        ))}
      </div>
    </div>
  )
}
