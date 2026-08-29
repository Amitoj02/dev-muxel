import { EmptyState } from 'devlobby'

/*
 * What the grid shows before anything is open. Reads nothing but the shell
 * list, so it is the same whatever the session holds.
 */
export const Default = (): React.JSX.Element => (
  <div style={{ position: 'relative', width: 820, height: 420, display: 'flex' }}>
    <EmptyState />
  </div>
)
