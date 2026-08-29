import { NetworkLog } from 'devlobby'
import { ENTRIES } from './_fixtures'

const noop = (): void => {}

const log = (over: Record<string, unknown> = {}): never =>
  ({ entries: ENTRIES, attached: true, reason: null, picked: null, comments: [], ...over }) as never

const Frame = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div style={{ width: 720, height: 420, display: 'flex', background: 'var(--browser-bg)' }}>
    {children}
  </div>
)

/** A live log after a page load — documents, assets, calls, one 500. */
export const Live = (): React.JSX.Element => (
  <Frame>
    <NetworkLog paneId="p3" log={log()} onClose={noop} />
  </Frame>
)

/** Nothing captured yet: the debugger is attached but the page is idle. */
export const Empty = (): React.JSX.Element => (
  <Frame>
    <NetworkLog paneId="p3" log={log({ entries: [] })} onClose={noop} />
  </Frame>
)

/** Detached — the log says why rather than looking broken. */
export const Detached = (): React.JSX.Element => (
  <Frame>
    <NetworkLog
      paneId="p3"
      log={log({ entries: [], attached: false, reason: 'The debugger could not attach to this page.' })}
      onClose={noop}
    />
  </Frame>
)
