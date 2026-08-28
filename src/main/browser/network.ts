/**
 * The network log behind a browser pane.
 *
 * Chrome's own DevTools protocol is the only source that has all of it —
 * status, timing, headers *and* bodies. `session.webRequest` can see requests
 * go past but never what came back in them, which is exactly the half you want
 * to hand to Claude. So main attaches a debugger to the guest and folds the
 * events into a bounded log per pane.
 *
 * Two consequences worth knowing:
 *
 *   - Only one debugger client can be attached at a time, so opening DevTools
 *     on a guest detaches this one. That is reported to the pane rather than
 *     swallowed, and reattaching is a button.
 *   - Bodies are pulled eagerly for the requests a person would actually read
 *     (XHR, documents, anything that failed) because the protocol evicts them
 *     from its buffer as the page keeps loading. Everything else is listed but
 *     not stored.
 */

import { webContents, type WebContents } from 'electron'
import {
  applyNetEvent,
  clearNetLog,
  createNetLog,
  viewportOf,
  wantsBody,
  type NetEntry,
  type NetLogState
} from '../../shared/browser'
import type { ViewportId } from '../../shared/types'

/** Entry updates are batched, exactly like pty output, for the same reason. */
const FLUSH_MS = 16

/** A single body worth keeping. Past this it is a download, not a payload. */
const MAX_BODY_BYTES = 512 * 1024

/** Everything a pane may hold in bodies before the oldest are dropped. */
const MAX_TOTAL_BODY_BYTES = 6 * 1024 * 1024

export type CaptureStatus = { attached: boolean; reason: string | null }

export type StoredBody = { text: string; base64: boolean; bytes: number }

export type CaptureDeps = {
  /** A batch of entries that changed, newest state, oldest first. */
  onEntries: (paneId: string, entries: NetEntry[]) => void
  onStatus: (paneId: string, status: CaptureStatus) => void
  /**
   * The user clicked into the page. A guest is a separate WebContents, so the
   * click never reaches the renderer's document and the grid would otherwise
   * go on believing some other pane was focused.
   */
  onFocus: (paneId: string) => void
  /** Read live, so changing the setting takes effect without a reattach. */
  limit: () => number
  captureBodies: () => boolean
}

type PaneCapture = {
  paneId: string
  wc: WebContents
  log: NetLogState
  bodies: Map<string, StoredBody>
  bodyBytes: number
  /** uid -> latest entry, drained on the flush timer. */
  dirty: Map<string, NetEntry>
  timer: NodeJS.Timeout | null
  onMessage: (event: unknown, method: string, params: unknown) => void
  onDetach: (event: unknown, reason: string) => void
  onFocus: () => void
  onGone: () => void
}

export class BrowserCapture {
  private panes = new Map<string, PaneCapture>()

  constructor(private deps: CaptureDeps) {}

  /**
   * Start capturing for a pane, given the web contents id its <webview>
   * reported. The id comes from the renderer, so it is checked rather than
   * trusted: it has to name a live guest, not the window itself.
   */
  attach(paneId: string, webContentsId: number): { ok: boolean; error?: string } {
    const existing = this.panes.get(paneId)
    // Already capturing this exact target: nothing to do. The id matching is
    // not enough on its own — DevTools takes the debugger away without the
    // page changing at all, and that is precisely when the pane asks to
    // reattach.
    if (
      existing &&
      !existing.wc.isDestroyed() &&
      existing.wc.id === webContentsId &&
      existing.wc.debugger.isAttached()
    ) {
      return { ok: true }
    }

    // Everything below has to succeed before the old capture is touched: a
    // reattach that fails — DevTools is still open, the page has gone — must
    // leave the pane exactly as it was, log and bodies included, rather than
    // trading a working log for a failed attach.
    const wc = webContents.fromId(webContentsId)
    if (!wc || wc.isDestroyed()) return { ok: false, error: 'that page is already gone' }
    if (wc.getType() !== 'webview') return { ok: false, error: 'not a browser pane' }

    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      this.deps.onStatus(paneId, { attached: false, reason: error })
      return { ok: false, error }
    }

    // Whatever was captured before belongs to the pane, not to the debugger
    // session, so a reattach — or a page that crashed and came back — keeps
    // its history instead of starting from an empty log.
    const carried = existing
      ? { log: existing.log, bodies: existing.bodies, bodyBytes: existing.bodyBytes }
      : null

    // Reattaching to the *same* page is the whole point of the reattach
    // button, and releasing the debugger on the way past would undo the attach
    // that just succeeded two lines up. Only a genuinely different target gets
    // the full release.
    if (existing) this.retire(paneId, existing.wc !== wc)

    const capture: PaneCapture = {
      paneId,
      wc,
      log: carried?.log ?? createNetLog(this.deps.limit()),
      bodies: carried?.bodies ?? new Map(),
      bodyBytes: carried?.bodyBytes ?? 0,
      dirty: new Map(),
      timer: null,
      onMessage: () => {},
      onDetach: () => {},
      onFocus: () => {},
      onGone: () => {}
    }

    capture.onMessage = (_event, method, params): void => {
      this.handle(capture, method, params)
    }
    capture.onDetach = (_event, reason): void => {
      // "Another debugger is already attached" and "target closed" both land
      // here. Say which, because the fix differs: close DevTools, or reload.
      this.deps.onStatus(paneId, { attached: false, reason })
    }
    capture.onFocus = (): void => this.deps.onFocus(paneId)
    capture.onGone = (): void => {
      this.detach(paneId)
    }

    wc.debugger.on('message', capture.onMessage)
    wc.debugger.on('detach', capture.onDetach)
    wc.on('focus', capture.onFocus)
    wc.once('destroyed', capture.onGone)

    this.panes.set(paneId, capture)

    void wc.debugger
      .sendCommand('Network.enable', {
        maxTotalBufferSize: 10_000_000,
        maxResourceBufferSize: 5_000_000,
        maxPostDataSize: 64 * 1024
      })
      .then(() => this.deps.onStatus(paneId, { attached: true, reason: null }))
      .catch((err: unknown) => {
        this.deps.onStatus(paneId, { attached: false, reason: messageOf(err) })
      })

    return { ok: true }
  }

  detach(paneId: string): void {
    this.retire(paneId, true)
  }

  /**
   * Drop a pane's capture.
   *
   * @param releaseDebugger false when the caller has just attached to the same
   *   page and is about to take the session over — detaching there would hand
   *   the debugger back seconds after asking for it.
   */
  private retire(paneId: string, releaseDebugger: boolean): void {
    const capture = this.panes.get(paneId)
    if (!capture) return
    this.panes.delete(paneId)
    if (capture.timer) clearTimeout(capture.timer)

    const { wc } = capture
    if (!wc.isDestroyed()) {
      wc.debugger.off('message', capture.onMessage)
      wc.debugger.off('detach', capture.onDetach)
      wc.off('focus', capture.onFocus)
      wc.off('destroyed', capture.onGone)
      if (releaseDebugger) {
        try {
          if (wc.debugger.isAttached()) wc.debugger.detach()
        } catch {
          /* already gone; nothing to release */
        }
      }
    }
  }

  /**
   * Device emulation, for the mobile and tablet presets.
   *
   * The guest element is genuinely sized to 390 CSS pixels by the renderer, so
   * the width is deliberately *not* overridden here — width 0 means "leave
   * that dimension alone" in the protocol. What is left is the part CSS cannot
   * fake: the user agent, touch events, and the device pixel ratio a
   * responsive image picks its source from.
   */
  async emulate(
    paneId: string,
    viewport: ViewportId,
    userAgent: string
  ): Promise<{ ok: boolean; missing: string[] }> {
    const capture = this.panes.get(paneId)
    if (!capture) return { ok: false, missing: ['debugger'] }

    const preset = viewportOf(viewport)
    const missing: string[] = []
    const send = async (method: string, params: unknown, label: string): Promise<void> => {
      try {
        await capture.wc.debugger.sendCommand(method, params)
      } catch {
        missing.push(label)
      }
    }

    // Each command stands alone. `setDeviceMetricsOverride` in particular is
    // documented as top-level-target only, and a guest is an inner one — so a
    // build that refuses it must still get the user agent and the touch
    // events, which are most of what a responsive layout keys off.
    try {
      // Client hints travel separately from the UA string; a site reading
      // `Sec-CH-UA-Mobile` would otherwise still be told it is on a desktop.
      await capture.wc.debugger.sendCommand('Emulation.setUserAgentOverride', {
        userAgent,
        userAgentMetadata: {
          platform: preset.mobile ? 'Android' : 'Windows',
          platformVersion: preset.mobile ? '14' : '10',
          architecture: preset.mobile ? '' : 'x86',
          model: preset.mobile ? 'Pixel 8' : '',
          mobile: preset.mobile
        }
      })
    } catch {
      // The metadata is validated field by field; if this build rejects the
      // shape, the plain string is still worth having.
      await send('Emulation.setUserAgentOverride', { userAgent }, 'user agent')
    }

    await send(
      'Emulation.setTouchEmulationEnabled',
      { enabled: preset.touch, maxTouchPoints: preset.touch ? 5 : 1 },
      'touch events'
    )

    if (preset.deviceScaleFactor > 0) {
      // Width and height are deliberately zero: the element is genuinely that
      // many CSS pixels wide, and zero means "do not override this dimension".
      await send(
        'Emulation.setDeviceMetricsOverride',
        {
          width: 0,
          height: 0,
          deviceScaleFactor: preset.deviceScaleFactor,
          mobile: preset.mobile
        },
        'device pixel ratio'
      )
    } else {
      await send('Emulation.clearDeviceMetricsOverride', {}, 'device pixel ratio')
    }

    return { ok: missing.length === 0, missing }
  }

  /** The whole log, for a pane whose component just remounted. */
  entries(paneId: string): NetEntry[] {
    return this.panes.get(paneId)?.log.entries ?? []
  }

  isAttached(paneId: string): boolean {
    const capture = this.panes.get(paneId)
    return Boolean(capture && !capture.wc.isDestroyed() && capture.wc.debugger.isAttached())
  }

  /**
   * A response body, addressed by the log entry's own uid rather than by the
   * CDP request id.
   *
   * That distinction is the whole point: a redirect chain reuses one request id
   * across every hop, so a cache keyed on it would hand the final page's body
   * back for the 302 that led to it — in the detail view and in the text sent
   * to Claude. The uid is unique per hop.
   *
   * Already captured bodies come straight back; anything else is asked for now,
   * which works only while the protocol still has it, and only for the hop that
   * is still live under that request id.
   */
  async body(
    paneId: string,
    uid: string
  ): Promise<{ ok: boolean; text?: string; base64?: boolean; error?: string }> {
    const capture = this.panes.get(paneId)
    if (!capture) return { ok: false, error: 'not capturing on this pane' }

    const held = capture.bodies.get(uid)
    if (held) return { ok: true, text: held.text, base64: held.base64 }

    const entry = capture.log.entries.find((e) => e.uid === uid)
    if (!entry) return { ok: false, error: 'that request has dropped out of the log' }

    const live = capture.log.index[entry.requestId]
    if (live === undefined || capture.log.entries[live]?.uid !== uid) {
      return { ok: false, error: 'the body for that redirect hop was not kept' }
    }

    try {
      const result = (await capture.wc.debugger.sendCommand('Network.getResponseBody', {
        requestId: entry.requestId
      })) as { body?: string; base64Encoded?: boolean }
      return { ok: true, text: result.body ?? '', base64: Boolean(result.base64Encoded) }
    } catch (err) {
      // The usual cause is the protocol having evicted it as the page carried
      // on loading. Nothing to do about it but say so.
      return { ok: false, error: messageOf(err) }
    }
  }

  clear(paneId: string): void {
    const capture = this.panes.get(paneId)
    if (!capture) return
    clearNetLog(capture.log)
    capture.bodies.clear()
    capture.bodyBytes = 0
    capture.dirty.clear()
  }

  disposeAll(): void {
    for (const paneId of [...this.panes.keys()]) this.detach(paneId)
  }

  // -------------------------------------------------------------------------

  private handle(capture: PaneCapture, method: string, params: unknown): void {
    if (!method.startsWith('Network.')) return

    capture.log.limit = this.deps.limit()
    const entry = applyNetEvent(capture.log, method, params)
    if (!entry) return

    if (method === 'Network.loadingFinished' && this.deps.captureBodies() && wantsBody(entry)) {
      void this.pullBody(capture, entry)
    }

    this.mark(capture, entry)
  }

  /** Queue an entry for the next flush; the newest state of it wins. */
  private mark(capture: PaneCapture, entry: NetEntry): void {
    capture.dirty.set(entry.uid, entry)
    if (capture.timer) return
    capture.timer = setTimeout(() => {
      capture.timer = null
      const batch = [...capture.dirty.values()]
      capture.dirty.clear()
      if (batch.length) this.deps.onEntries(capture.paneId, batch)
    }, FLUSH_MS)
    capture.timer.unref?.()
  }

  private async pullBody(capture: PaneCapture, entry: NetEntry): Promise<void> {
    if ((entry.bytes ?? 0) > MAX_BODY_BYTES) return
    if (capture.bodies.has(entry.uid)) return

    try {
      const result = (await capture.wc.debugger.sendCommand('Network.getResponseBody', {
        requestId: entry.requestId
      })) as { body?: string; base64Encoded?: boolean }

      const text = result.body ?? ''
      if (!text) return
      const bytes = text.length
      if (bytes > MAX_BODY_BYTES) return

      // Oldest out first, so a long-running page cannot grow without bound.
      while (capture.bodyBytes + bytes > MAX_TOTAL_BODY_BYTES && capture.bodies.size > 0) {
        const oldest = capture.bodies.keys().next().value as string | undefined
        if (oldest === undefined) break
        capture.bodyBytes -= capture.bodies.get(oldest)?.bytes ?? 0
        capture.bodies.delete(oldest)
      }

      capture.bodies.set(entry.uid, {
        text,
        base64: Boolean(result.base64Encoded),
        bytes
      })
      capture.bodyBytes += bytes
      entry.hasResponseBody = true
      this.mark(capture, entry)
    } catch {
      /* evicted, or the debugger went away mid-flight; the row stands as it is */
    }
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
