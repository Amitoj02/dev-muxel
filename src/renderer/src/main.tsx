import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@xterm/xterm/css/xterm.css'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/app.css'

import { App } from './App'
import { connect } from './state/bridge'

const el = document.getElementById('root')
if (!el) throw new Error('#root is missing from index.html')

// Load state before the first paint so the grid never flashes empty on a
// restore. Failing to connect is fatal — without the bridge there is no app.
connect()
  .catch((err) => {
    console.error('[grid] failed to load state', err)
  })
  .finally(() => {
    createRoot(el).render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  })
