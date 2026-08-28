/**
 * React bindings for the store. Components import from here, never from
 * store.ts directly, so the subscription plumbing lives in one place.
 */

import { useSyncExternalStore } from 'react'
import type { AppState } from './store'
import { getState, subscribe } from './store'

export function useApp(): AppState {
  return useSyncExternalStore(subscribe, getState, getState)
}

/**
 * Subscribe to a slice. The selector must return a stable reference for
 * unchanged data (the store never mutates in place, so object identity works).
 */
export function useSlice<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(getState()),
    () => selector(getState())
  )
}

export {
  actions,
  attentionCount,
  currentMeasure,
  getState,
  gitFor,
  isParked,
  newId,
  noteById,
  normalisePath,
  paneById,
  paneLabel,
  repoById,
  REOPEN_WINDOW_MS,
  runtimeFor,
  shellById,
  subscribe,
  tabAttention,
  tabOfPane,
  tabPaneIds,
  tabRunning,
  tabsSnapshot,
  tabTitle
} from './store'

export type { AppState, ClosedEntry, Overlay, PaneRuntime, Tab } from './store'
