import { TabStrip } from 'dev-muxel'

/*
 * Reads the tabs out of the store, so like the titlebar it is a singleton with
 * one state. The seeded session has two grids — "build" (three panes, one busy)
 * and "api" — plus the new-grid affordance.
 */
export const Default = (): React.JSX.Element => (
  <div style={{ width: 900, background: 'var(--bg-chassis)' }}>
    <TabStrip />
  </div>
)
