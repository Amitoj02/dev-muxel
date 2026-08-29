import { Overlay } from 'devlobby'

const noop = (): void => {}

/*
 * The shell every dialog sits in: a scrim, a focus trap, and whatever it is
 * given. On its own it renders nothing visible, so each cell composes it the
 * way the app does — with a `.dialog` inside.
 */

/** The narrow dialog, which is what confirmations use. */
export const Confirm = (): React.JSX.Element => (
  <Overlay onClose={noop}>
    <div className="dialog dialog--narrow">
      <div className="dialog__head">
        <h2 className="dialog__title">CLOSE PANE</h2>
      </div>
      <div className="dialog__body" style={{ padding: '20px 16px' }}>
        <p style={{ margin: 0, font: '400 13px/1.6 var(--font-ui)', color: 'var(--ink-2)' }}>
          <strong>devlobby</strong> is still running (pid 24180). Closing the pane ends it.
        </p>
      </div>
      <div className="dialog__foot">
        <button className="btn btn--danger" type="button">
          Close it
        </button>
        <button className="btn btn--ghost" type="button">
          Keep it open
        </button>
      </div>
    </div>
  </Overlay>
)

/** The full-width dialog the panels use. */
export const Panel = (): React.JSX.Element => (
  <Overlay onClose={noop}>
    <div className="dialog">
      <div className="dialog__head">
        <h2 className="dialog__title">KEYBOARD</h2>
      </div>
      <div className="dialog__body" style={{ padding: '20px 16px' }}>
        <p style={{ margin: 0, font: '400 13px/1.6 var(--font-ui)', color: 'var(--ink-2)' }}>
          Everything in the grid is one chord away. The dialog shell traps Tab and takes focus off
          the terminal behind it, so keystrokes land here rather than in a shell.
        </p>
      </div>
      <div className="dialog__foot">
        <button className="btn btn--primary" type="button">
          Done
        </button>
      </div>
    </div>
  </Overlay>
)
