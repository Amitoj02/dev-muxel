/**
 * Closing a pane kills whatever is running in it. When that is a long agent
 * session or a dev server, silently dropping it is expensive, so ask — once,
 * and with an option to stop asking.
 */

import { Overlay } from './Overlay'
import { actions, paneById, runtimeFor, useApp } from '../state/hooks'

export function ConfirmClose({ paneId }: { paneId: string }): React.JSX.Element | null {
  const app = useApp()
  const pane = paneById(app, paneId)
  const runtime = runtimeFor(app, paneId)

  if (!pane) return null

  const label =
    pane.kind === 'terminal'
      ? (pane.label ?? app.repos.find((r) => r.id === pane.repoId)?.name ?? pane.cwd)
      : 'this note'

  return (
    <Overlay onClose={() => actions.closeOverlay()}>
      <div className="dialog dialog--narrow">
        <div className="dialog__head">
          <h2 className="dialog__title">CLOSE PANE</h2>
        </div>

        <div className="dialog__body" style={{ padding: '20px 16px' }}>
          <p style={{ margin: '0 0 10px', font: '400 13px/1.6 var(--font-ui)', color: 'var(--ink-2)' }}>
            <strong>{label}</strong> is still running
            {runtime.pid ? ` (pid ${runtime.pid})` : ''}. Closing the pane ends it.
          </p>
          {pane.kind === 'terminal' && (
            <p style={{ margin: 0, font: '400 11px/1.6 var(--font-mono)', color: 'var(--ink-faint)' }}>
              {pane.cwd}
            </p>
          )}
        </div>

        <div className="dialog__foot">
          <button className="btn btn--danger" onClick={() => actions.closePane(paneId)}>
            Close it
          </button>
          <button className="btn btn--ghost" onClick={() => actions.closeOverlay()}>
            Keep it open
          </button>
          <span className="dialog__spacer" />
          <button
            className="btn btn--ghost"
            onClick={() => {
              actions.patchSettings({ confirmClose: false })
              actions.closePane(paneId)
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
