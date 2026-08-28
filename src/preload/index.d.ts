import type { DevMuxelApi } from './index'

declare global {
  interface Window {
    devmuxel: DevMuxelApi
  }
}

export {}
