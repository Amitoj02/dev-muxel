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
import { upsertEntry, type NetEntry, type PickedElement } from '../../../shared/browser'
import type { WebviewElement } from './webview'

export type PaneNetLog = {
  entries: NetEntry[]
  /** The debugger is attached, so the log is live. */
  attached: boolean
  /** Why it is not, when it is not. */
  reason: string | null
  /** The element last pointed at in this pane, until it is sent or dropped. */
  picked: PickedElement | null
}

const EMPTY: PaneNetLog = { entries: [], attached: false, reason: null, picked: null }

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

export function clearNet(paneId: string): void {
  const current = logs.get(paneId) ?? EMPTY
  logs.set(paneId, { ...current, entries: [] })
  notify(paneId)
}

/** The pane is gone for good; nothing should keep its log alive. */
export function dropNet(paneId: string): void {
  logs.delete(paneId)
  listeners.delete(paneId)
  views.delete(paneId)
}

/** One pane's log, as React state. */
export function useNetLog(paneId: string): PaneNetLog {
  const subscribe = useCallback((fn: () => void) => subscribeNet(paneId, fn), [paneId])
  const read = useCallback(() => netLogFor(paneId), [paneId])
  return useSyncExternalStore(subscribe, read, read)
}

export function registerView(paneId: string, el: WebviewElement | null): void {
  if (el) views.set(paneId, el)
  else views.delete(paneId)
}

export function getView(paneId: string): WebviewElement | undefined {
  return views.get(paneId)
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
