/**
 * Closing a pane throws something away. When that is a long agent session, a
 * dev server, or a page somebody has spent ten minutes marking up, silently
 * dropping it is expensive — so ask, once, with an option to stop asking.
 *
 * The two reasons read differently on purpose. A shell can be started again;
 * comments cannot be written again, so that copy says where they go and how to
 * get them back.
 */

import { Overlay } from './Overlay'
import { useCommentCount } from '../browser/netlog'
import { actions, paneById, runtimeFor, useApp } from '../state/hooks'

export function ConfirmClose({ paneId }: { paneId: string }): React.JSX.Element | null {
  const app = useApp()
  const pane = paneById(app, paneId)
  const runtime = runtimeFor(app, paneId)
  const comments = useCommentCount(paneId)

  if (!pane) return null

  const label =
    pane.kind === 'terminal'
      ? (pane.label ?? app.repos.find((r) => r.id === pane.repoId)?.name ?? pane.cwd)
      : pane.kind === 'browser'
        ? (pane.label ?? pane.title ?? 'this page')
        : 'this note'

  return (
    <Overlay onClose={() => actions.closeOverlay()}>
      <div className="dialog dialog--narrow">
        <div className="dialog__head">
          <h2 className="dialog__title">CLOSE PANE</h2>
        </div>

        <div className="dialog__body" style={{ padding: '20px 16px' }}>
          {pane.kind === 'browser' ? (
            <>
              <p
                style={{
                  margin: '0 0 10px',
                  font: '400 13px/1.6 var(--font-ui)',
                  color: 'var(--ink-2)'
                }}
              >
                <strong>{label}</strong> is holding {comments} comment
                {comments === 1 ? '' : 's'} no session has taken yet. Closing the pane is what
                throws {comments === 1 ? 'it' : 'them'} away.
              </p>
              <p
                style={{
                  margin: 0,
                  font: '400 11px/1.6 var(--font-mono)',
                  color: 'var(--ink-faint)'
                }}
              >
                Ctrl+Shift+T brings the pane back for five seconds afterwards, comments and all.
                Until then they are kept across a restart.
              </p>
            </>
          ) : (
            <>
              <p
                style={{
                  margin: '0 0 10px',
                  font: '400 13px/1.6 var(--font-ui)',
                  color: 'var(--ink-2)'
                }}
              >
                <strong>{label}</strong> is still running
                {runtime.pid ? ` (pid ${runtime.pid})` : ''}. Closing the pane ends it.
              </p>
              {pane.kind === 'terminal' && (
                <p
                  style={{
                    margin: 0,
                    font: '400 11px/1.6 var(--font-mono)',
                    color: 'var(--ink-faint)'
                  }}
                >
                  {pane.cwd}
                </p>
              )}
            </>
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
