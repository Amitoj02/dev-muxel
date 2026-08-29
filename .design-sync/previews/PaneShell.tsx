import { PaneShell } from 'devlobby'

const noop = (): void => {}

/*
 * The wrapper every pane in the grid sits in: header, body, focus ring and the
 * absolute placement the grid computes. `rect` is that placement — the shell is
 * positioned, so each cell gives it a relative box to sit in.
 */
const Stage = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div style={{ position: 'relative', width: 560, height: 300, background: 'var(--bg-chassis)' }}>
    {children}
  </div>
)

const rect = { x: 0, y: 0, width: 560, height: 300 }

const terminal = {
  id: 'p1',
  kind: 'terminal' as const,
  repoId: 'r1',
  cwd: 'C:\Users\dev\projects\devlobby',
  shellId: 'powershell',
  label: 'devlobby'
}

/** A terminal pane at rest. */
export const Terminal = (): React.JSX.Element => (
  <Stage>
    <PaneShell
      pane={terminal}
      rect={rect}
      zoomed={false}
      hidden={false}
      animating={false}
      onDragStart={noop}
    />
  </Stage>
)

/** A note pane — the warm variant of the chassis. */
export const Note = (): React.JSX.Element => (
  <Stage>
    <PaneShell
      pane={{ id: 'p4', kind: 'note', noteId: 'n1' }}
      rect={rect}
      zoomed={false}
      hidden={false}
      animating={false}
      onDragStart={noop}
    />
  </Stage>
)

/** Zoomed: inset from the window edge and lifted off the grid. */
export const Zoomed = (): React.JSX.Element => (
  <Stage>
    <PaneShell
      pane={terminal}
      rect={rect}
      zoomed
      hidden={false}
      animating={false}
      onDragStart={noop}
    />
  </Stage>
)
