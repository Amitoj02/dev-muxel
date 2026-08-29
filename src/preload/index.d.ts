import type { DevLobbyApi } from './index'

declare global {
  interface Window {
    devlobby: DevLobbyApi
  }
}

export {}
