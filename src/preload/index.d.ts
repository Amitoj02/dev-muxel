import type { GridApi } from './index'

declare global {
  interface Window {
    grid: GridApi
  }
}

export {}
