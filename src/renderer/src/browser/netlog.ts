/**
 * The renderer's copy of each browser pane's network log.
 *
 * Kept in a module-level registry rather than in the app store, for the same
 * reason the xterm instances are: a busy page is a hundred store updates a
 * second, and the store notifies every subscriber on every change — so putting
 * the log there would re-render the whole grid each time a font finished
 * loading. A pane subscribes to its own log and nothing else does.
 *
 * Main owns the authoritative log and the response bodies; this is a mirror
 * fed by batched events, kept so the list can render without a round trip.
 */

import { useCallback, useSyncExternalStore } from 'react'
import {
  upsertEntry,
  type NetEntry,
  type PageComment,
  type PickedElement
} from '../../../shared/browser'
import type { WebviewElement } from './webview'

export type PaneNetLog = {
  entries: NetEntry[]
  /** The debugger is attached, so the log is live. */
  attached: boolean
  /** Why it is not, when it is not. */
  reason: string | null
  /** The element last pointed at in this pane, until it is sent or dropped. */
  picked: PickedElement | null
  /** Comments made on this page, waiting for a session to come and get them. */
  comments: PageComment[]
}

const EMPTY: PaneNetLog = {
  entries: [],
  attached: false,
  reason: null,
  picked: null,
  comments: []
}

const logs = new Map<string, PaneNetLog>()
const listeners = new Map<string, Set<() => void>>()

/** The <webview> element behind each browser pane, for focus and navigation. */
const views = new Map<string, WebviewElement>()

function notify(paneId: string): void {
  const set = listeners.get(paneId)
  if (!set) return
  for (const fn of set) fn()
}

/** Snapshot for `useSyncExternalStore` — a stable reference until it changes. */
export function netLogFor(paneId: string): PaneNetLog {
  return logs.get(paneId) ?? EMPTY
}

export function subscribeNet(paneId: string, fn: () => void): () => void {
  let set = listeners.get(paneId)
  if (!set) {
    set = new Set()
    listeners.set(paneId, set)
  }
  set.add(fn)
  return () => {
    set.delete(fn)
    // Identity-checked, not just emptiness-checked. A pane closed and brought
    // back with Ctrl+Shift+T keeps its id, so a stale unsubscribe — the send
    // dialog's, held open across the close — would otherwise delete the *new*
    // pane's listener set and leave its log updating with nothing listening.
    if (set.size === 0 && listeners.get(paneId) === set) listeners.delete(paneId)
  }
}

export function ingestNet(paneId: string, entries: NetEntry[], limit: number): void {
  if (entries.length === 0) return
  const current = logs.get(paneId) ?? EMPTY
  let next = current.entries
  for (const entry of entries) next = upsertEntry(next, entry, limit)
  logs.set(paneId, { ...current, entries: next })
  notify(paneId)
}

/** Wholesale replacement, for a pane whose component just remounted. */
export function replaceNet(paneId: string, entries: NetEntry[], attached: boolean): void {
  const current = logs.get(paneId) ?? EMPTY
  logs.set(paneId, {
    ...current,
    entries,
    attached,
    reason: attached ? null : current.reason
  })
  notify(paneId)
}

export function setNetStatus(paneId: string, attached: boolean, reason: string | null): void {
  const current = logs.get(paneId) ?? EMPTY
  if (current.attached === attached && current.reason === reason) return
  logs.set(paneId, { ...current, attached, reason })
  notify(paneId)
}

/** What the picker came back with, or null to drop it. */
export function setPicked(paneId: string, picked: PickedElement | null): void {
  const current = logs.get(paneId) ?? EMPTY
  if (current.picked === picked) return
  logs.set(paneId, { ...current, picked })
  notify(paneId)
}

/**
 * Comments are held here rather than in the app store for the same reason the
 * log is: they belong to one pane, nothing else in the grid reads them, and
 * they change while somebody is typing.
 *
 * Unlike the log, they go to disk — see `allComments` — so every change also
 * wakes whoever is doing the writing.
 */
export function addComment(paneId: string, comment: PageComment): void {
  const current = logs.get(paneId) ?? EMPTY
  logs.set(paneId, { ...current, comments: [...current.comments, comment], picked: null })
  notify(paneId)
  commentsChanged()
}

export function updateComment(paneId: string, id: string, text: string): void {
  const current = logs.get(paneId) ?? EMPTY
  logs.set(paneId, {
    ...current,
    comments: current.comments.map((c) => (c.id === id ? { ...c, text } : c))
  })
  notify(paneId)
  commentsChanged()
}

export function removeComment(paneId: string, id: string): void {
  const current = logs.get(paneId) ?? EMPTY
  logs.set(paneId, { ...current, comments: current.comments.filter((c) => c.id !== id) })
  notify(paneId)
  commentsChanged()
}

/** Drop the ones a session has taken, by id, leaving anything added since. */
export function forgetComments(paneId: string, ids: string[]): void {
  const gone = new Set(ids)
  const current = logs.get(paneId) ?? EMPTY
  logs.set(paneId, { ...current, comments: current.comments.filter((c) => !gone.has(c.id)) })
  notify(paneId)
  commentsChanged()
}

/** Every pane holding comments, so a send can find them wherever they are. */
export function panesWithComments(): string[] {
  return [...logs.entries()].filter(([, log]) => log.comments.length > 0).map(([id]) => id)
}

/** How many a pane is holding, for a header that must not re-render on traffic. */
export function commentCount(paneId: string): number {
  return logs.get(paneId)?.comments.length ?? 0
}

/**
 * One pane's comment count, as React state.
 *
 * Subscribed to the same per-pane channel the log is, so it is *read* on every
 * batch of network entries — but it returns a number, and React does not
 * re-render a component whose snapshot has not changed. That is what lets a
 * pane header ask this question without paying for the log.
 */
export function useCommentCount(paneId: string): number {
  const subscribe = useCallback((fn: () => void) => subscribeNet(paneId, fn), [paneId])
  const read = useCallback(() => commentCount(paneId), [paneId])
  return useSyncExternalStore(subscribe, read, read)
}

// --- keeping them ----------------------------------------------------------

/**
 * Comments are the one thing in a browser pane that cannot be got back by
 * reloading, so they are the one thing here that goes to disk. This is what
 * the persistence layer reads; `onCommentsChanged` is what tells it to.
 */
export function allComments(): Record<string, PageComment[]> {
  const out: Record<string, PageComment[]> = {}
  for (const [paneId, log] of logs) {
    if (log.comments.length > 0) out[paneId] = log.comments
  }
  return out
}

/** Put a previous session's comments back, for the panes that came back with them. */
export function hydrateComments(
  saved: Record<string, PageComment[]> | undefined,
  livePaneIds: Iterable<string>
): void {
  if (!saved) return
  const live = new Set(livePaneIds)
  for (const [paneId, comments] of Object.entries(saved)) {
    if (!live.has(paneId) || !Array.isArray(comments) || comments.length === 0) continue
    const current = logs.get(paneId) ?? EMPTY
    logs.set(paneId, { ...current, comments })
    notify(paneId)
  }
}

const commentWatchers = new Set<() => void>()

/** Told whenever any pane's comments change, so they can be written out. */
export function onCommentsChanged(fn: () => void): () => void {
  commentWatchers.add(fn)
  return () => {
    commentWatchers.delete(fn)
  }
}

function commentsChanged(): void {
  for (const fn of commentWatchers) fn()
}

export function clearNet(paneId: string): void {
  const current = logs.get(paneId) ?? EMPTY
  logs.set(paneId, { ...current, entries: [] })
  notify(paneId)
}

/**
 * The pane is gone for good; nothing should keep its log alive.
 *
 * Its comments go with it, which is why closing a browser pane that is still
 * holding some asks first — see `ConfirmClose`. By the time this runs the
 * answer was yes, and the write that follows takes them off disk too.
 */
export function dropNet(paneId: string): void {
  const had = commentCount(paneId) > 0
  logs.delete(paneId)
  listeners.delete(paneId)
  views.delete(paneId)
  if (had) commentsChanged()
}

/**
 * Whether a Claude session is holding the line for comments.
 *
 * App-wide rather than per-pane: there is one bridge and one waiter, and every
 * pane's send button wants to say the same thing about it.
 */
let bridgeWaiting = false
const waitingListeners = new Set<() => void>()

const subscribeWaiting = (fn: () => void): (() => void) => {
  waitingListeners.add(fn)
  return () => {
    waitingListeners.delete(fn)
  }
}
const readWaiting = (): boolean => bridgeWaiting

export function setBridgeWaiting(waiting: boolean): void {
  if (bridgeWaiting === waiting) return
  bridgeWaiting = waiting
  for (const fn of waitingListeners) fn()
}

export function useBridgeWaiting(): boolean {
  return useSyncExternalStore(subscribeWaiting, readWaiting, readWaiting)
}

/** One pane's log, as React state. */
export function useNetLog(paneId: string): PaneNetLog {
  const subscribe = useCallback((fn: () => void) => subscribeNet(paneId, fn), [paneId])
  const read = useCallback(() => netLogFor(paneId), [paneId])
  return useSyncExternalStore(subscribe, read, read)
}

/**
 * How a pane offers its element picker to the rest of the app.
 *
 * A session running /devlobby-browser asks main for "the picker", main forwards
 * it to the renderer, and the renderer has to reach into one particular pane's
 * component to start it. The pane leaves a handle here for exactly that.
 */
const armers = new Map<string, () => void>()

export function registerArm(paneId: string, arm: (() => void) | null): void {
  if (arm) armers.set(paneId, arm)
  else armers.delete(paneId)
}

export function armPicker(paneId: string): boolean {
  const arm = armers.get(paneId)
  if (!arm) return false
  arm()
  return true
}

/**
 * Comments handed to a session and not yet acknowledged.
 *
 * The acknowledgement names a batch, not the comments in it, so the mapping
 * has to be remembered here — and anything added while the session was reading
 * survives, because only the ids that went are dropped.
 */
const pending = new Map<string, { paneId: string; ids: string[] }>()

export function rememberBatch(batch: string, paneId: string, ids: string[]): void {
  pending.set(batch, { paneId, ids })
}

export function settleBatch(batch: string): void {
  const sent = pending.get(batch)
  if (!sent) return
  pending.delete(batch)
  forgetComments(sent.paneId, sent.ids)
}

export function registerView(paneId: string, el: WebviewElement | null): void {
  if (el) views.set(paneId, el)
  else views.delete(paneId)
}

export function getView(paneId: string): WebviewElement | undefined {
  return views.get(paneId)
}

/**
 * Which pane a guest belongs to, by the id the main process knows it as.
 *
 * Main sees a page asking for a new tab as a WebContents and nothing more —
 * pane ids are this side's idea — so the way back is here, where the elements
 * are. `getWebContentsId` throws until a guest has attached, which is an
 * honest answer to "is it this one": a pane with no live guest did not ask.
 */
export function paneOfWebContents(webContentsId: number): string | null {
  for (const [paneId, el] of views) {
    try {
      if (el.getWebContentsId() === webContentsId) return paneId
    } catch {
      /* not attached yet, so not the one that asked */
    }
  }
  return null
}

/**
 * The Chrome major version this window is running, for building a user agent
 * that does not announce Electron. Read off the host's own UA rather than
 * bridged from main: it is the same Chromium, and this keeps the guest's
 * identity decided in one place.
 */
export function chromeVersion(): string {
  return /Chrome\/(\d+[\d.]*)/.exec(navigator.userAgent)?.[1] ?? ''
}
