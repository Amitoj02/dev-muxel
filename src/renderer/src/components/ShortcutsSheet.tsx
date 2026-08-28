import { Fragment } from 'react'
import { IconClose } from './Icons'
import { Overlay } from './Overlay'
import { SHORTCUTS } from '../lib/useShortcuts'
import { actions } from '../state/hooks'

export function ShortcutsSheet(): React.JSX.Element {
  return (
    <Overlay onClose={() => actions.closeOverlay()}>
      <div className="dialog dialog--narrow">
        <div className="dialog__head">
          <h2 className="dialog__title">KEYBOARD</h2>
          <span className="dialog__sub">Ctrl+Alt, Ctrl+Shift, and four keys no CLI binds</span>
          <button className="dialog__close" onClick={() => actions.closeOverlay()} aria-label="Close">
            <IconClose size={12} />
          </button>
        </div>

        <div className="dialog__body">
          <p
            style={{
              margin: 0,
              padding: '14px 16px 0',
              font: '400 11.5px/1.6 var(--font-mono)',
              color: 'var(--ink-faint)',
              maxWidth: '52ch'
            }}
          >
            Everything is Ctrl+Alt or Ctrl+Shift, so Claude and every other CLI keep the plain
            Ctrl range to themselves. The only exceptions are the zoom and page keys, which no
            CLI binds and every other application uses for exactly this.
          </p>

          <div className="keys">
            {SHORTCUTS.map((s) => (
              <Fragment key={s.keys}>
                <kbd className="kbd">{s.keys}</kbd>
                <span className="keys__what">{s.what}</span>
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </Overlay>
  )
}
