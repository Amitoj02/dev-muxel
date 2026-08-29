import { NotePane } from 'devlobby'

const noop = (): void => {}

const note = {
  id: 'n1',
  title: 'Release checklist',
  body: 'Bump the version, run the fixtures, tag it.\n\nThe installer signs on CI, not here.',
  updatedAt: Date.now() - 6 * 60_000
}

const Frame = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div
    style={{
      position: 'relative',
      width: 460,
      height: 240,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--note-bg)',
      border: '1px solid var(--note-line)'
    }}
  >
    {children}
  </div>
)

/** Focused: the caret is in the body and Ctrl+Enter will send it. */
export const Focused = (): React.JSX.Element => (
  <Frame>
    <NotePane note={note} focused onSend={noop} />
  </Frame>
)

/** Unfocused — same surface, no focus treatment. */
export const Blurred = (): React.JSX.Element => (
  <Frame>
    <NotePane note={note} focused={false} onSend={noop} />
  </Frame>
)

/** An empty note says what it is for rather than sitting blank. */
export const Empty = (): React.JSX.Element => (
  <Frame>
    <NotePane note={{ ...note, id: 'n3', title: '', body: '' }} focused={false} onSend={noop} />
  </Frame>
)
