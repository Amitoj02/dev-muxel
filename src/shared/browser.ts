/**
 * The pure half of the browser pane.
 *
 * Everything in here is a plain function over plain data — no DOM, no
 * Electron, no network — which is what lets `npm run check:browser` drive the
 * URL bar, the device presets, the network-log reducer and the exact text that
 * lands in Claude without launching the app. The impure halves are
 * `src/main/browser/network.ts` (the debugger) and the renderer's
 * `components/BrowserPane.tsx` (the <webview>).
 */

import type { ViewportId } from './types'

// ---------------------------------------------------------------------------
// URL bar
// ---------------------------------------------------------------------------

export type UrlResult = { ok: true; url: string } | { ok: false; reason: string }

/**
 * Schemes the URL bar refuses outright.
 *
 * `javascript:` is the one that matters — typed into the bar it would run in
 * the guest with the page's own origin, which is precisely the injection this
 * app otherwise has no surface for. The rest are refused because a pane that
 * can open `file:` is a file browser nobody asked for.
 */
const REFUSED_SCHEME = /^([a-z][a-z0-9+.-]*):/i
const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

/** localhost in every spelling a dev server hands you. */
const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(:\d{1,5})?([/?#].*)?$/i

/**
 * Something.something — enough dots to be a host rather than a search.
 * Unicode-aware, because `bücher.de` is a host and refusing it as "not a URL"
 * would be a strange thing for a browser to do.
 */
const LOOKS_LIKE_HOST = /^[\p{L}\p{M}\p{N}-]+(\.[\p{L}\p{M}\p{N}-]+)+(:\d{1,5})?([/?#].*)?$/u

/** RFC1918 and friends: a machine on your desk is not running TLS. */
const PRIVATE_IP = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/

/**
 * Turn whatever was typed into a URL the guest can load.
 *
 * Deliberately not a search box. DevLobby never touches the network on its own,
 * and quietly posting half-typed thoughts to a search engine would be the one
 * place it did — so anything that is not a URL comes back as an error the bar
 * can show, rather than as a query.
 *
 * @param base the page currently open, so `/orders` resolves against it.
 */
export function normaliseUrl(input: string, base?: string | null): UrlResult {
  const raw = input.trim()
  if (!raw) return { ok: false, reason: 'type a URL' }
  if (/^about:blank$/i.test(raw)) return { ok: true, url: 'about:blank' }

  // ":5173" and ":5173/health" — how you actually think about a dev server.
  const bare = /^:(\d{2,5})([/?#].*)?$/.exec(raw)
  if (bare) return parseUrl(`http://localhost:${bare[1]}${bare[2] ?? ''}`)

  // "/orders" against the page you are already on.
  if (raw.startsWith('/') && base && base !== 'about:blank') {
    try {
      return parseUrl(new URL(raw, base).href)
    } catch {
      /* fall through to everything else */
    }
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return parseUrl(raw)

  // A scheme with no `//` after it — `javascript:alert(1)`, `data:`, `mailto:`.
  // `localhost:5173` looks like one too, so it is checked for first.
  if (!LOCAL_HOST.test(raw) && !LOOKS_LIKE_HOST.test(raw)) {
    const scheme = REFUSED_SCHEME.exec(raw)
    if (scheme) {
      return { ok: false, reason: `${scheme[1]}: links do not open here — http and https only` }
    }
  }

  if (LOCAL_HOST.test(raw)) return parseUrl(`http://${raw}`)
  if (LOOKS_LIKE_HOST.test(raw)) {
    return parseUrl(`${PRIVATE_IP.test(raw) ? 'http' : 'https'}://${raw}`)
  }

  return { ok: false, reason: 'not a URL — this bar does not search the web' }
}

function parseUrl(candidate: string): UrlResult {
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return { ok: false, reason: 'not a URL' }
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return { ok: false, reason: `${url.protocol} links do not open here — http and https only` }
  }
  return { ok: true, url: url.href }
}

/**
 * Guests share one persistent partition, so a dev server's cookies and local
 * storage survive a reload — you log into your own app once, not once per
 * pane. It is a different session from the app's own, which is what keeps page
 * storage out of DevLobby's.
 *
 * Shared because both sides need the exact same string: the renderer puts it
 * on the tag, and main looks the session up by it.
 */
export const BROWSER_PARTITION = 'persist:devlobby-browser'

/** True for a scheme a pane is allowed to be pointed at. */
export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || url === 'about:blank'
}

/**
 * How long "not now" lasts when a page will not stop asking for new tabs.
 *
 * Shared because both sides say it out loud: main counts the five minutes, and
 * the dialog is what promises them.
 */
export const POPUP_SNOOZE_MS = 5 * 60 * 1000

/** The longest address worth carrying across a process boundary to render. */
export const MAX_POPUP_URL = 4096

/**
 * Whether a page's request for a new tab is one there is anything to ask
 * about.
 *
 * `about:blank` is the shape `window.open()` takes when the page means to
 * write the document itself. There is no page to put in a pane of its own, so
 * there is nothing to put to anybody — and the same goes for every scheme a
 * pane may not load in the first place.
 */
export function askablePopup(url: string): boolean {
  return /^https?:\/\//i.test(url) && url.length <= MAX_POPUP_URL
}

/** `localhost:5173` / `example.com` — what the pane header shows. */
export function hostLabel(url: string | null | undefined): string {
  if (!url) return ''
  if (url === 'about:blank') return 'blank'
  try {
    const u = new URL(url)
    return u.port ? `${u.hostname}:${u.port}` : u.hostname
  } catch {
    return url
  }
}

/** The last meaningful path segment, for a log row. */
export function requestName(url: string): string {
  try {
    const u = new URL(url)
    const seg = u.pathname.split('/').filter(Boolean).pop()
    const name = seg ?? u.hostname
    return u.search ? `${name}${u.search}` : name
  } catch {
    return url.slice(0, 80)
  }
}

// ---------------------------------------------------------------------------
// Device presets
// ---------------------------------------------------------------------------

export type ViewportPreset = {
  id: ViewportId
  label: string
  /** CSS pixels the guest is laid out at; null means "however wide the pane is". */
  width: number | null
  height: number | null
  /** 0 means "leave the guest's own scale factor alone". */
  deviceScaleFactor: number
  mobile: boolean
  touch: boolean
}

/**
 * Three sizes rather than a device menu. The point is catching a layout that
 * breaks below a breakpoint, not reproducing one specific handset — 390 and
 * 834 sit either side of the two breakpoints every CSS framework ships with.
 */
export const VIEWPORTS: Record<ViewportId, ViewportPreset> = {
  mobile: {
    id: 'mobile',
    label: 'Mobile',
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
    touch: true
  },
  tablet: {
    id: 'tablet',
    label: 'Tablet',
    width: 834,
    height: 1112,
    deviceScaleFactor: 2,
    mobile: true,
    touch: true
  },
  desktop: {
    id: 'desktop',
    label: 'Desktop',
    width: null,
    height: null,
    deviceScaleFactor: 0,
    mobile: false,
    touch: false
  }
}

export const VIEWPORT_ORDER: ViewportId[] = ['mobile', 'tablet', 'desktop']

export function viewportOf(id: string | null | undefined): ViewportPreset {
  return VIEWPORTS[(id ?? 'desktop') as ViewportId] ?? VIEWPORTS.desktop
}

/**
 * How far a device-sized guest has to shrink to fit the pane it is in.
 *
 * Never scaled above 1: a phone viewport blown up to fill a wide pane would
 * show a layout at a size no phone has, which is the opposite of the point.
 * Never below 0.2, because past that it is unreadable and you would rather
 * scroll.
 */
export function fitScale(
  available: { width: number; height: number },
  device: { width: number | null; height: number | null }
): number {
  if (!device.width || !device.height) return 1
  if (available.width <= 0 || available.height <= 0) return 1
  const scale = Math.min(1, available.width / device.width, available.height / device.height)
  return Math.max(0.2, Math.round(scale * 1000) / 1000)
}

/**
 * A clean Chrome user agent for the guest.
 *
 * The default one carries `DevLobby/1.0.0 Electron/43.4.1`, which some sites
 * refuse outright and every site can fingerprint, so the desktop preset
 * overrides it too rather than only the handheld ones. The Chrome version is
 * passed in from `process.versions.chrome`, so this never goes stale.
 */
export function userAgentFor(id: ViewportId, chromeVersion: string): string {
  const major = /^\d+/.exec(chromeVersion)?.[0] ?? '140'
  const engine = `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0`
  if (id === 'mobile') {
    return `Mozilla/5.0 (Linux; Android 14; Pixel 8) ${engine} Mobile Safari/537.36`
  }
  if (id === 'tablet') {
    return `Mozilla/5.0 (Linux; Android 14; Pixel Tablet) ${engine} Safari/537.36`
  }
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${engine} Safari/537.36`
}

// ---------------------------------------------------------------------------
// The element picker
// ---------------------------------------------------------------------------

/**
 * One element pointed at in a browser pane.
 *
 * Everything here is read out of the live page by the picker script and comes
 * back across the guest boundary as plain data — so it is page-controlled, and
 * every field of it is sanitised before it goes anywhere near a terminal.
 */
export type PickedElement = {
  /** A CSS path back to it, good enough to paste into a query selector. */
  selector: string
  tag: string
  id: string
  classes: string[]
  /** Trimmed and capped by the picker. */
  text: string
  /** outerHTML, capped by the picker. */
  html: string
  rect: { x: number; y: number; width: number; height: number }
  /** The computed properties worth arguing about, in source order. */
  styles: Record<string, string>
  /** A few levels of parent, outermost first, as short labels. */
  ancestors: string[]
  /** The page it was picked on. */
  url: string
}

/**
 * Something pointed at, with something said about it.
 *
 * Comments pile up in the pane rather than going anywhere on their own: you
 * mark up a page at your own pace, and a Claude session collects the lot when
 * one asks. That is why they carry their own id — the session that takes them
 * has to be able to say which batch it took, so the pane knows what to clear.
 */
export type PageComment = {
  id: string
  /**
   * What it is about, when it is about something in particular. Null for a
   * note about the page as a whole — "the spacing is off everywhere" is a
   * thing worth saying, and pointing at one element to say it would be a lie.
   */
  element: PickedElement | null
  /** What the user typed. */
  text: string
  /**
   * Which device the page was laid out as when this was written.
   *
   * Not decoration: every measurement on the element beside it is in that
   * viewport's pixels, so "48px tall" means something different depending on
   * this, and a comment about a layout is nearly always a comment about a
   * layout *at a width*.
   */
  viewport: ViewportId
  /** The pixels it was laid out at, when the viewport fixes them. */
  viewportSize: { width: number; height: number } | null
  /** Wall-clock ms, for ordering and for the list. */
  at: number
}

/** One handover: everything a pane had, and a name for it. */
export type CommentBatch = {
  batch: string
  /** The pane it came from, by label. */
  pane: string
  url: string
  comments: PageComment[]
}

// ---------------------------------------------------------------------------
// Network log
// ---------------------------------------------------------------------------

export type ResourceKind =
  | 'document'
  | 'xhr'
  | 'script'
  | 'stylesheet'
  | 'image'
  | 'font'
  | 'media'
  | 'websocket'
  | 'other'

export type NetPhase = 'pending' | 'done' | 'failed'

export type NetEntry = {
  /** Stable key within one pane's log. A redirect chain produces several. */
  uid: string
  /** CDP request id — what `Network.getResponseBody` is keyed on. */
  requestId: string
  method: string
  url: string
  /** Short label for the row. */
  name: string
  kind: ResourceKind
  /** CDP's own resource type, for the detail view. */
  resourceType: string
  status: number | null
  statusText: string
  mimeType: string
  phase: NetPhase
  fromCache: boolean
  /** Set when this entry is one hop of a redirect chain. */
  redirected: boolean
  /** Wall-clock ms when the request went out. */
  startedAt: number
  /** CDP monotonic seconds; only ever used to compute the duration. */
  startTs: number
  durationMs: number | null
  /** Transfer size in bytes; null while it is still arriving. */
  bytes: number | null
  requestHeaders: Record<string, string>
  responseHeaders: Record<string, string>
  /** Inline request body, when CDP handed us one. */
  postData: string | null
  /** True when a body exists but CDP truncated or withheld it. */
  postDataTruncated: boolean
  /** "fetch", "parser", "script @ app.js:42". */
  initiator: string | null
  remoteAddress: string | null
  error: string | null
  /** A response body was captured and can be asked for by request id. */
  hasResponseBody: boolean
}

export type NetLogState = {
  entries: NetEntry[]
  /** requestId -> index into `entries`, for the hop still in flight. */
  index: Record<string, number>
  limit: number
  seq: number
  /** Entries dropped by the cap, so the UI can say so rather than lie. */
  dropped: number
}

export function createNetLog(limit = 400): NetLogState {
  return { entries: [], index: {}, limit, seq: 0, dropped: 0 }
}

/**
 * CDP payloads, narrowed to the fields this app reads.
 *
 * Hand-rolled rather than pulled from `devtools-protocol`: that is one more
 * dependency for twenty field names, and every one of them is optional to us
 * anyway — a missing field must degrade to a duller row, never to a throw.
 */
type CdpRequest = {
  url?: string
  method?: string
  headers?: Record<string, string>
  postData?: string
  hasPostData?: boolean
}

type CdpResponse = {
  status?: number
  statusText?: string
  headers?: Record<string, string>
  mimeType?: string
  remoteIPAddress?: string
  fromDiskCache?: boolean
  encodedDataLength?: number
}

type CdpParams = {
  requestId?: string
  timestamp?: number
  wallTime?: number
  type?: string
  request?: CdpRequest
  response?: CdpResponse
  redirectResponse?: CdpResponse
  initiator?: { type?: string; url?: string; lineNumber?: number }
  encodedDataLength?: number
  dataLength?: number
  errorText?: string
  canceled?: boolean
  blockedReason?: string
  url?: string
}

const KIND_BY_TYPE: Record<string, ResourceKind> = {
  document: 'document',
  xhr: 'xhr',
  fetch: 'xhr',
  eventsource: 'xhr',
  script: 'script',
  stylesheet: 'stylesheet',
  image: 'image',
  font: 'font',
  media: 'media',
  websocket: 'websocket',
  texttrack: 'media'
}

function kindOf(type: string | undefined): ResourceKind {
  return KIND_BY_TYPE[(type ?? '').toLowerCase()] ?? 'other'
}

/** Header names are case-insensitive; lowercase once so redaction is total. */
function lowerHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = String(v)
  return out
}

function describeInitiator(initiator: CdpParams['initiator']): string | null {
  if (!initiator?.type) return null
  if (initiator.url) {
    const where = typeof initiator.lineNumber === 'number' ? `:${initiator.lineNumber + 1}` : ''
    return `${initiator.type} @ ${requestName(initiator.url)}${where}`
  }
  return initiator.type
}

function current(log: NetLogState, requestId: string | undefined): NetEntry | null {
  if (!requestId) return null
  const at = log.index[requestId]
  return at === undefined ? null : (log.entries[at] ?? null)
}

/**
 * Fold one CDP Network event into the log, returning the entry it touched so
 * the caller can push just that one across to the renderer.
 *
 * The log is mutated in place on purpose: it is a bounded ring buffer owned by
 * the main process, not React state, and copying 400 entries per request would
 * be the most expensive thing in the pane.
 */
export function applyNetEvent(log: NetLogState, method: string, raw: unknown): NetEntry | null {
  const params = (raw ?? {}) as CdpParams
  const id = params.requestId

  switch (method) {
    case 'Network.requestWillBeSent': {
      if (!id) return null

      // A redirect reuses the request id. Close the hop that just ended and
      // let the new one take the id, so the chain reads as several rows —
      // which is the only way to see a 302 that lands somewhere unexpected.
      const previous = current(log, id)
      if (previous && params.redirectResponse) {
        applyResponse(previous, params.redirectResponse)
        previous.phase = 'done'
        previous.redirected = true
        if (params.timestamp) previous.durationMs = msBetween(previous.startTs, params.timestamp)
        delete log.index[id]
      }

      const entry: NetEntry = {
        uid: `r${(log.seq += 1)}`,
        requestId: id,
        method: params.request?.method ?? 'GET',
        url: params.request?.url ?? params.url ?? '',
        name: requestName(params.request?.url ?? params.url ?? ''),
        kind: kindOf(params.type),
        resourceType: params.type ?? 'Other',
        status: null,
        statusText: '',
        mimeType: '',
        phase: 'pending',
        fromCache: false,
        redirected: false,
        startedAt: params.wallTime ? Math.round(params.wallTime * 1000) : 0,
        startTs: params.timestamp ?? 0,
        durationMs: null,
        bytes: null,
        requestHeaders: lowerHeaders(params.request?.headers),
        responseHeaders: {},
        postData: params.request?.postData ?? null,
        postDataTruncated: Boolean(params.request?.hasPostData) && !params.request?.postData,
        initiator: describeInitiator(params.initiator),
        remoteAddress: null,
        error: null,
        hasResponseBody: false
      }
      push(log, entry)
      return entry
    }

    case 'Network.responseReceived': {
      const entry = current(log, id)
      if (!entry) return null
      applyResponse(entry, params.response)
      if (params.type) {
        entry.resourceType = params.type
        entry.kind = kindOf(params.type)
      }
      return entry
    }

    case 'Network.dataReceived': {
      const entry = current(log, id)
      if (!entry) return null
      entry.bytes = (entry.bytes ?? 0) + (params.encodedDataLength || params.dataLength || 0)
      return entry
    }

    case 'Network.requestServedFromCache': {
      const entry = current(log, id)
      if (!entry) return null
      entry.fromCache = true
      return entry
    }

    case 'Network.loadingFinished': {
      const entry = current(log, id)
      if (!entry) return null
      entry.phase = 'done'
      if (typeof params.encodedDataLength === 'number' && params.encodedDataLength > 0) {
        entry.bytes = params.encodedDataLength
      }
      if (params.timestamp) entry.durationMs = msBetween(entry.startTs, params.timestamp)
      return entry
    }

    case 'Network.loadingFailed': {
      const entry = current(log, id)
      if (!entry) return null
      entry.phase = 'failed'
      // A cancelled request is not a failure worth shouting about, but it is
      // worth being able to tell apart from one the server refused.
      entry.error = params.canceled
        ? (params.errorText ?? 'cancelled')
        : (params.blockedReason ?? params.errorText ?? 'failed')
      if (params.timestamp) entry.durationMs = msBetween(entry.startTs, params.timestamp)
      return entry
    }

    case 'Network.webSocketCreated': {
      const entry: NetEntry = {
        uid: `r${(log.seq += 1)}`,
        requestId: id ?? `ws${log.seq}`,
        method: 'WS',
        url: params.url ?? '',
        name: requestName(params.url ?? ''),
        kind: 'websocket',
        resourceType: 'WebSocket',
        status: null,
        statusText: 'open',
        mimeType: '',
        phase: 'pending',
        fromCache: false,
        redirected: false,
        startedAt: 0,
        startTs: params.timestamp ?? 0,
        durationMs: null,
        bytes: null,
        requestHeaders: {},
        responseHeaders: {},
        postData: null,
        postDataTruncated: false,
        initiator: describeInitiator(params.initiator),
        remoteAddress: null,
        error: null,
        hasResponseBody: false
      }
      push(log, entry)
      return entry
    }

    case 'Network.webSocketClosed': {
      const entry = current(log, id)
      if (!entry) return null
      entry.phase = 'done'
      entry.statusText = 'closed'
      return entry
    }

    default:
      return null
  }
}

function applyResponse(entry: NetEntry, response: CdpResponse | undefined): void {
  if (!response) return
  if (typeof response.status === 'number') entry.status = response.status
  entry.statusText = response.statusText ?? entry.statusText
  entry.mimeType = response.mimeType ?? entry.mimeType
  entry.responseHeaders = { ...entry.responseHeaders, ...lowerHeaders(response.headers) }
  entry.remoteAddress = response.remoteIPAddress ?? entry.remoteAddress
  if (response.fromDiskCache) entry.fromCache = true
}

function msBetween(startTs: number, endTs: number): number | null {
  if (!startTs || !endTs || endTs < startTs) return null
  return Math.round((endTs - startTs) * 1000)
}

/** Append, dropping the oldest once the cap is reached. */
function push(log: NetLogState, entry: NetEntry): void {
  log.entries.push(entry)

  if (log.entries.length > log.limit) {
    const overflow = log.entries.length - log.limit
    log.entries.splice(0, overflow)
    log.dropped += overflow
    // Every position moved, so the map is rebuilt rather than patched. Later
    // entries win: a request id is only reused by a redirect, and the newest
    // hop is the one still in flight.
    log.index = {}
    for (let i = 0; i < log.entries.length; i += 1) {
      log.index[log.entries[i].requestId] = i
    }
    return
  }

  log.index[entry.requestId] = log.entries.length - 1
}

export function clearNetLog(log: NetLogState): void {
  log.entries = []
  log.index = {}
  log.dropped = 0
}

/**
 * The renderer's mirror of the log: replace the entry with this uid, or append
 * it. Pure, because this copy does live in React state.
 */
export function upsertEntry(list: NetEntry[], entry: NetEntry, limit: number): NetEntry[] {
  const at = list.findIndex((e) => e.uid === entry.uid)
  let next: NetEntry[]
  if (at === -1) next = [...list, entry]
  else {
    next = list.slice()
    next[at] = entry
  }
  return next.length > limit ? next.slice(next.length - limit) : next
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export type NetFilter = {
  text: string
  /** null means every kind. */
  kinds: ResourceKind[] | null
  failedOnly: boolean
}

export const EMPTY_FILTER: NetFilter = { text: '', kinds: null, failedOnly: false }

export function matchesFilter(entry: NetEntry, filter: NetFilter): boolean {
  if (filter.failedOnly && !isFailure(entry)) return false
  if (filter.kinds && !filter.kinds.includes(entry.kind)) return false
  const text = filter.text.trim().toLowerCase()
  if (!text) return true
  return (
    entry.url.toLowerCase().includes(text) ||
    entry.method.toLowerCase().includes(text) ||
    String(entry.status ?? '').includes(text) ||
    entry.resourceType.toLowerCase().includes(text)
  )
}

/** 4xx, 5xx, or the request never arrived at all. */
export function isFailure(entry: NetEntry): boolean {
  if (entry.phase === 'failed') return true
  return entry.status !== null && entry.status >= 400
}

/**
 * Worth spending a protocol round trip and some memory on the body for.
 *
 * The bodies you want are the ones a person would read: an API call, the page
 * itself, and anything that went wrong. Fetching every image and font as well
 * would drain the very buffer that keeps the interesting ones alive.
 */
export function wantsBody(entry: NetEntry): boolean {
  if (entry.kind === 'xhr' || entry.kind === 'document') return true
  return isFailure(entry)
}
