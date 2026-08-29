/*
 * Shared preview data.
 *
 * Not a component preview — the converter only compiles `<ComponentName>.tsx`,
 * so this underscore-prefixed `.ts` is just a module the cells import. It holds
 * the browser-pane fixtures (network entries, picked elements, comments) that
 * several cards need to look like a real session rather than one request.
 */

type Headers = Record<string, string>

const REQ: Headers = {
  accept: 'application/json, text/plain, */*',
  'accept-encoding': 'gzip, deflate, br',
  referer: 'http://localhost:5173/'
}

const RES: Headers = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  server: 'nginx/1.27.2'
}

let n = 0

export function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  n += 1
  return {
    uid: `u${n}`,
    requestId: `r${n}`,
    method: 'GET',
    url: 'http://localhost:5173/api/projects',
    name: 'projects',
    kind: 'xhr',
    resourceType: 'XHR',
    status: 200,
    statusText: 'OK',
    mimeType: 'application/json',
    phase: 'done',
    fromCache: false,
    redirected: false,
    startedAt: Date.now() - 4200,
    startTs: 1042.5,
    durationMs: 84,
    bytes: 2417,
    requestHeaders: REQ,
    responseHeaders: RES,
    postData: null,
    postDataTruncated: false,
    initiator: 'fetch',
    remoteAddress: '127.0.0.1:5173',
    error: null,
    hasResponseBody: true,
    ...over
  }
}

/** A plausible page load: documents, assets, a few calls, one failure. */
export const ENTRIES = [
  entry({ url: 'http://localhost:5173/', name: '/', kind: 'document', resourceType: 'Document', mimeType: 'text/html', durationMs: 12, bytes: 1140, initiator: 'parser' }),
  entry({ url: 'http://localhost:5173/assets/index-4f1d2e.css', name: 'index-4f1d2e.css', kind: 'stylesheet', resourceType: 'Stylesheet', mimeType: 'text/css', durationMs: 7, bytes: 64_812, initiator: 'parser', hasResponseBody: false }),
  entry({ url: 'http://localhost:5173/assets/index-c365c6.js', name: 'index-c365c6.js', kind: 'script', resourceType: 'Script', mimeType: 'text/javascript', durationMs: 31, bytes: 412_004, initiator: 'parser', hasResponseBody: false }),
  entry({ name: 'projects', durationMs: 84, bytes: 2417 }),
  entry({ method: 'POST', url: 'http://localhost:5173/api/sessions', name: 'sessions', status: 201, statusText: 'Created', durationMs: 143, bytes: 318, postData: '{"repoId":"r1","shell":"powershell"}' }),
  entry({ url: 'http://localhost:5173/api/telemetry', name: 'telemetry', status: 500, statusText: 'Internal Server Error', durationMs: 1207, bytes: 94, initiator: 'script @ index-c365c6.js:1042' }),
  entry({ url: 'http://localhost:5173/api/me', name: 'me', status: null, statusText: '', phase: 'pending', durationMs: null, bytes: null, hasResponseBody: false })
]

export const PICKED = {
  selector: 'main > section.pricing > div.card:nth-child(2)',
  tag: 'div',
  id: '',
  classes: ['card', 'card--featured'],
  text: 'Team — $24 per seat, billed monthly',
  html: '<div class="card card--featured"><h3>Team</h3><p class="price">$24</p></div>',
  rect: { x: 412, y: 268, width: 320, height: 412 },
  styles: {
    display: 'flex',
    'flex-direction': 'column',
    gap: '16px',
    padding: '24px',
    'background-color': 'rgb(255, 255, 255)',
    'border-radius': '12px'
  },
  ancestors: ['main', 'section.pricing'],
  url: 'http://localhost:5173/pricing'
}

export const COMMENTS = [
  {
    id: 'c1',
    element: PICKED,
    text: 'This card is 12px wider than the other two — the featured modifier is adding padding rather than a border.',
    viewport: 'desktop' as const,
    viewportSize: { width: 1280, height: 800 },
    at: Date.now() - 9 * 60_000
  },
  {
    id: 'c2',
    element: {
      ...PICKED,
      selector: 'header > nav',
      tag: 'nav',
      classes: ['nav'],
      text: 'Product Pricing Docs',
      rect: { x: 0, y: 0, width: 1280, height: 64 }
    },
    text: 'Nav collapses a breakpoint too late; it is already cramped at 900.',
    viewport: 'tablet' as const,
    viewportSize: { width: 834, height: 1112 },
    at: Date.now() - 4 * 60_000
  },
  {
    id: 'c3',
    element: null,
    text: 'Vertical rhythm is off across the whole page — everything is on a 20px grid except the cards.',
    viewport: 'desktop' as const,
    viewportSize: { width: 1280, height: 800 },
    at: Date.now() - 90_000
  }
]

export const DESKTOP = {
  id: 'desktop' as const,
  label: 'Desktop',
  width: null,
  height: null,
  deviceScaleFactor: 0,
  mobile: false,
  touch: false
}
