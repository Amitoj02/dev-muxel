import { CommentPopover } from 'devlobby'
import { DESKTOP, PICKED } from './_fixtures'

const noop = (): void => {}

const Stage = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div style={{ position: 'relative', width: 820, height: 520, background: 'var(--browser-bg)' }}>
    {children}
  </div>
)

/** Writing a note against a picked element, positioned over the stage. */
export const Writing = (): React.JSX.Element => (
  <Stage>
    <CommentPopover
      element={PICKED}
      preset={DESKTOP}
      scale={1}
      stage={{ width: 820, height: 520 }}
      onSave={noop}
      onCancel={noop}
    />
  </Stage>
)

/** A tall element near the bottom — the popover flips to stay on the stage. */
export const NearEdge = (): React.JSX.Element => (
  <Stage>
    <CommentPopover
      element={{ ...PICKED, rect: { x: 96, y: 392, width: 280, height: 110 } }}
      preset={DESKTOP}
      scale={1}
      stage={{ width: 820, height: 520 }}
      onSave={noop}
      onCancel={noop}
    />
  </Stage>
)
