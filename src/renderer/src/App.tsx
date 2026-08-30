/**
 * The app shell: titlebar, grid, overlays, toast.
 *
 * Everything below this is either the grid itself or a modal; there is no
 * router and no nested layout, which is the point — DevLobby is one screen.
 */

import { useEffect } from 'react'
import { GridView } from './components/GridView'
import { TabStrip } from './components/TabStrip'
import { TitleBar } from './components/TitleBar'
import { RepositoriesPanel } from './components/RepositoriesPanel'
import { NotesPanel } from './components/NotesPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { ShortcutsSheet } from './components/ShortcutsSheet'
import { ConfirmClose } from './components/ConfirmClose'
import { ConfirmCloseTab } from './components/ConfirmCloseTab'
import { SendToClaude } from './components/SendToClaude'
import { BrowserPopup } from './components/BrowserPopup'
import { Toast } from './components/Toast'
import { useShortcuts } from './lib/useShortcuts'
import { useFolderDrop } from './lib/useFolderDrop'
import { useRecentlyClosed } from './lib/useRecentlyClosed'
import { actions, useApp } from './state/hooks'

export function App(): React.JSX.Element {
  const app = useApp()
  useShortcuts()
  useFolderDrop()
  useRecentlyClosed()

  // The design exposes gutter / zoom inset / glow as live knobs; feed them
  // straight into the custom properties so CSS stays the single source of size.
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--gutter', `${app.settings.gutter ?? 6}px`)
    root.setProperty('--zoom-inset', `${app.settings.zoomInset ?? 26}px`)
    root.setProperty('--glow', `${app.settings.glowStrength ?? 26}px`)
  }, [app.settings.gutter, app.settings.zoomInset, app.settings.glowStrength])

  if (!app.ready) {
    return (
      <div className="app">
        <TitleBar />
        <div className="grid" />
      </div>
    )
  }

  return (
    <div className="app" data-glow={String(app.settings.glowStrength ?? 26)}>
      <TitleBar />
      <TabStrip />
      <GridView />

      {app.overlay.kind === 'repositories' && <RepositoriesPanel />}
      {app.overlay.kind === 'notes' && <NotesPanel />}
      {app.overlay.kind === 'settings' && <SettingsPanel />}
      {app.overlay.kind === 'shortcuts' && <ShortcutsSheet />}
      {app.overlay.kind === 'confirm-close' && <ConfirmClose paneId={app.overlay.paneId} />}
      {app.overlay.kind === 'confirm-close-tab' && <ConfirmCloseTab tabId={app.overlay.tabId} />}
      {app.overlay.kind === 'send-to-claude' && (
        <SendToClaude paneId={app.overlay.paneId} uids={app.overlay.uids} />
      )}
      {app.overlay.kind === 'browser-popup' && (
        <BrowserPopup
          paneId={app.overlay.paneId}
          guestId={app.overlay.guestId}
          url={app.overlay.url}
        />
      )}

      {app.toast && (
        <Toast key={app.toast.id} text={app.toast.text} tone={app.toast.tone} onDone={actions.clearToast} />
      )}
    </div>
  )
}
