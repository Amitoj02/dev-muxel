import { CommentsPanel } from 'devlobby'
import { COMMENTS } from './_fixtures'

const noop = (): void => {}

const Frame = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div style={{ width: 420, height: 460, display: 'flex', background: 'var(--browser-bg)' }}>
    {children}
  </div>
)

const handlers = { onTogglePicker: noop, onNote: noop, onSend: noop, onClose: noop }

/** Three comments waiting to be collected, two of them pointing at elements. */
export const Marked = (): React.JSX.Element => (
  <Frame>
    <CommentsPanel paneId="p3" comments={COMMENTS} waiting={false} picking={false} {...handlers} />
  </Frame>
)

/** A session is holding the line for this batch. */
export const Waiting = (): React.JSX.Element => (
  <Frame>
    <CommentsPanel paneId="p3" comments={COMMENTS} waiting picking={false} {...handlers} />
  </Frame>
)

/** The picker is armed — click anything in the page to attach a note to it. */
export const Picking = (): React.JSX.Element => (
  <Frame>
    <CommentsPanel paneId="p3" comments={COMMENTS.slice(0, 1)} waiting={false} picking {...handlers} />
  </Frame>
)

/** Nothing said yet. */
export const Empty = (): React.JSX.Element => (
  <Frame>
    <CommentsPanel paneId="p3" comments={[]} waiting={false} picking={false} {...handlers} />
  </Frame>
)
