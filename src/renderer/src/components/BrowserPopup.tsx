/**
 * A page asked for a new tab.
 *
 * There are no tabs inside a browser pane, and its guest is not allowed to
 * open a window — so this is one of the few things DevLobby cannot decide on
 * the user's behalf. The three honest answers are all here: a browser pane of
 * its own, nothing, and nothing for five minutes, which is the one you want on
 * a site that opens a tab every time you touch it.
 *
 * Whatever happens, main is told. It holds the request open until it hears, so
 * every way out of this dialog answers it — including being taken off screen
 * by something else, which is what the unmount is for.
 */

import { useCallback, useEffect, useRef } from 'react'
import { POPUP_SNOOZE_MS } from '../../../shared/browser'
import { actions, getState, paneById, paneLabel, useApp } from '../state/hooks'
import { Overlay } from './Overlay'

export function BrowserPopup({
  paneId,
  guestId,
  url
}: {
  paneId: string
  guestId: number
  url: string
}): React.JSX.Element {
  const app = useApp()
  const pane = paneById(app, paneId)
  const label = pane ? paneLabel(app, pane) : 'a browser pane'
  const answered = useRef(false)

  const answer = useCallback(
    (decision: 'open' | 'ignore' | 'snooze') => {
      if (answered.current) return
      answered.current = true
      window.devlobby.browser.popupDecision(guestId, decision)
    },
    [guestId]
  )

  // Anything that takes the dialog away without an answer is an answer: main
  // will not ask about this guest again until it has one, and a page that
  // asked once will ask again the next time you click the link.
  //
  // The overlay is consulted rather than the unmount taken at face value,
  // because StrictMode rehearses one in development — and answering a question
  // that is still on screen would let the page behind it ask again while the
  // user is still reading the first.
  useEffect(() => {
    answered.current = false
    return () => {
      if (answered.current) return
      if (getState().overlay.kind === 'browser-popup') return
      answered.current = true
      window.devlobby.browser.popupDecision(guestId, 'ignore')
    }
  }, [guestId])

  const close = useCallback(
    (decision: 'open' | 'ignore' | 'snooze') => {
      answer(decision)
      actions.closeOverlay()
    },
    [answer]
  )

  const minutes = Math.round(POPUP_SNOOZE_MS / 60_000)

  return (
    <Overlay onClose={() => close('ignore')}>
      <div className="dialog dialog--narrow">
        <div className="dialog__head">
          <h2 className="dialog__title">NEW TAB</h2>
          <span className="dialog__sub">{label}</span>
        </div>

        <div className="dialog__body" style={{ padding: '20px 16px' }}>
          <p
            style={{
              margin: '0 0 12px',
              font: '400 13px/1.6 var(--font-ui)',
              color: 'var(--ink-2)'
            }}
          >
            The page in <strong>{label}</strong> wants to open this in a new tab. A pane has no
            tabs — it can have a browser pane of its own, next to the one you are on.
          </p>

          <p className="popup-url" title={url}>
            {url}
          </p>

          <p style={{ margin: 0, font: '400 11px/1.6 var(--font-mono)', color: 'var(--ink-faint)' }}>
            Nothing has been loaded. If the page keeps asking, the last button stops it asking for{' '}
            {minutes} minutes.
          </p>
        </div>

        <div className="dialog__foot">
          <button
            className="btn btn--primary"
            onClick={() => {
              // The repository comes with it, so the new pane wears the same
              // accent and its captures reach the same session.
              actions.addBrowser({
                url,
                repoId: pane && pane.kind !== 'note' ? pane.repoId : null
              })
              close('open')
            }}
          >
            Open in a new pane
          </button>
          <button className="btn btn--ghost" onClick={() => close('ignore')}>
            Ignore it
          </button>

          <span className="dialog__spacer" />

          <button
            className="btn btn--ghost"
            title={`Every new tab this pane asks for is ignored, without asking, for ${minutes} minutes`}
            onClick={() => {
              actions.toast(`New tabs from ${label} are ignored for ${minutes} minutes`)
              close('snooze')
            }}
          >
            Not for {minutes} minutes
          </button>
        </div>
      </div>
    </Overlay>
  )
}
