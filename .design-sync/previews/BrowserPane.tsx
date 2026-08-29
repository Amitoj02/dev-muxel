import { BrowserPane } from 'dev-muxel'

/*
 * Built on Electron's <webview>, which does not exist in an ordinary browser
 * tag namespace — so the page itself cannot load here. What the card shows is
 * the pane's own chrome, which is the part that belongs to the design system:
 * the URL bar, the device switcher, and the network/comments affordances.
 */

const Stage = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div
    style={{
      position: 'relative',
      width: 760,
      height: 420,
      display: 'flex',
      background: 'var(--browser-bg)',
      border: '1px solid var(--browser-line)'
    }}
  >
    {children}
  </div>
)

/** A dev server open at desktop width. */
export const Desktop = (): React.JSX.Element => (
  <Stage>
    <BrowserPane
      pane={{
        id: 'p3',
        kind: 'browser',
        repoId: 'r1',
        url: 'http://localhost:5173/pricing',
        viewport: 'desktop',
        title: 'Pricing — DevMuxel'
      }}
    />
  </Stage>
)

/** The same page laid out as a phone: the stage narrows to 390. */
export const Mobile = (): React.JSX.Element => (
  <Stage>
    <BrowserPane
      pane={{
        id: 'p3',
        kind: 'browser',
        repoId: 'r1',
        url: 'http://localhost:5173/pricing',
        viewport: 'mobile',
        title: 'Pricing — DevMuxel'
      }}
    />
  </Stage>
)
