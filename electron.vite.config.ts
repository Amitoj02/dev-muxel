import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // electron-vite 5 externalizes every package.json "dependencies" entry on
    // its own (build.externalizeDeps defaults to true), which is what keeps
    // node-pty a bare require() and its .node files out of the bundle.
    //
    // Do NOT add build.rollupOptions.external here: that REPLACES the preset's
    // own externals (electron + node builtins) rather than merging with them,
    // which bundles the electron npm shim into main and makes the packaged app
    // die at startup with "Electron failed to install correctly".
    build: {
      externalizeDeps: true,
      minify: true
    }
  },
  preload: {
    build: {
      externalizeDeps: true,
      minify: true
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    build: {
      // electron-vite defaults minify to false on all three targets.
      minify: true,
      chunkSizeWarningLimit: 1500
    }
  }
})
