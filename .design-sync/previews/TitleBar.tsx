import { TitleBar } from 'devlobby'

/*
 * An app singleton driven entirely by the store, so it has one state rather
 * than a variant axis: the harness seeds a session with two grids and a pane
 * waiting on the user, which is what the waiting counter reads.
 */
export const Default = (): React.JSX.Element => (
  <div style={{ width: 900, background: 'var(--bg-chassis)' }}>
    <TitleBar />
  </div>
)
