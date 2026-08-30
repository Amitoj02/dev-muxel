/**
 * Closing a tab ends everything in it at once. Ctrl+Shift+T brings the whole
 * grid back for five seconds afterwards, shells and pages intact, but five
 * seconds is not long to notice a mistake in — so when something in it is
 * still running, ask first as well.
 */

import { Overlay } from './Overlay'
import { actions, tabPaneIds, tabRunning, tabTitle, tabUnsent, useApp } from '../state/hooks'

export function ConfirmCloseTab({ tabId }: { tabId: string }): React.JSX.Element | null {
  const app = useApp()
  if (!app.tabs.some((t) => t.id === tabId)) return null

  const title = tabTitle(app, tabId)
  const panes = tabPaneIds(app, tabId).length
  const running = tabRunning(app, tabId)
  const unsent = tabUnsent(app, tabId)

  return (
    <Overlay onClose={() => actions.closeOverlay()}>
      <div className="dialog dialog--narrow">
        <div className="dialog__head">
          <h2 className="dialog__title">CLOSE GRID</h2>
        </div>

        <div className="dialog__body" style={{ padding: '20px 16px' }}>
          <p
            style={{ margin: '0 0 10px', font: '400 13px/1.6 var(--font-ui)', color: 'var(--ink-2)' }}
          >
            <strong>{title}</strong> holds {panes} pane{panes === 1 ? '' : 's'}
            {running > 0 && (
              <>
                , {running} of which {running === 1 ? 'is' : 'are'} still running. Closing the grid
                ends {running === 1 ? 'it' : 'them'}
              </>
            )}
            .
            {unsent > 0 && (
              <>
                {' '}
                {running > 0 ? 'It is also holding ' : 'It is holding '}
                {unsent} comment{unsent === 1 ? '' : 's'} no session has taken yet, and closing
                throws {unsent === 1 ? 'it' : 'them'} away.
              </>
            )}
          </p>
          <p style={{ margin: 0, font: '400 11px/1.6 var(--font-mono)', color: 'var(--ink-faint)' }}>
            Ctrl+Shift+T brings the whole grid back for five seconds afterwards, still running and
            still holding {unsent > 0 ? 'its comments' : 'everything'}. After that it is gone.
          </p>
        </div>

        <div className="dialog__foot">
          <button className="btn btn--danger" onClick={() => actions.closeTab(tabId)}>
            Close it
          </button>
          <button className="btn btn--ghost" onClick={() => actions.closeOverlay()}>
            Keep it
          </button>
          <span className="dialog__spacer" />
          <button
            className="btn btn--ghost"
            onClick={() => {
              actions.patchSettings({ confirmClose: false })
              actions.closeTab(tabId)
            }}
            title="Turn this confirmation off in settings"
          >
            Close and stop asking
          </button>
        </div>
      </div>
    </Overlay>
  )
}
