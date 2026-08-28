import type { PersistedState, Settings } from '../../shared/types'

export const STATE_VERSION = 1

export const defaultSettings: Settings = {
  defaultShellId: 'powershell',
  fontFamily: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace",
  fontSize: 12.5,
  lineHeight: 1.4,
  gutter: 6,
  zoomInset: 26,
  glowStrength: 26,
  scrollback: 10_000,
  gitPollFocused: 5_000,
  gitPollBlurred: 45_000,
  bellIsAttention: true,
  // Claude CLI goes quiet when it wants an answer; four seconds of silence
  // after it was clearly working is a good proxy for "it is waiting on you".
  idleAttentionMs: 4_000,
  confirmClose: true,
  restoreSession: true,
  restoreRunsStartup: false,
  cursorBlink: true,
  cursorStyle: 'bar',
  copyOnSelect: true,
  rightClickPastes: true,
  showGridLines: true,
  renderer: 'dom',
  // 400 rows is about two minutes of a chatty dev server, and the log is only
  // ever read backwards from "the one that just failed".
  browserNetLimit: 400,
  browserCaptureBodies: true,
  claudeModel: '',
  claudeEffort: ''
}

export function defaultState(): PersistedState {
  return {
    version: STATE_VERSION,
    settings: { ...defaultSettings },
    repos: [],
    notes: [],
    session: {
      layout: null,
      panes: [],
      focusedPaneId: null,
      zoomedPaneId: null
    },
    shells: []
  }
}
