/**
 * From a network request to a prompt.
 *
 * This is the other half of the browser pane's reason to exist: you watch a
 * request fail, and the fix is the CLI that is already open two panes away. So
 * the transform from "a row in the log" to "text a Claude session can act on"
 * is a pure function, and `npm run check:browser` asserts the exact bytes it
 * produces — including what it refuses to send.
 */

// Types only, deliberately: `scripts/check-browser.mts` runs under Node's type
// stripping, where a type import is erased but a value import would have to
// resolve a bare specifier with no extension.
import type { CommentBatch, NetEntry, PickedElement } from './browser'

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Headers that carry credentials rather than information.
 *
 * Redacted by default and opt-in to include, because sending a request to a
 * CLI means sending it to a model, and a session cookie pasted into a prompt
 * is a session cookie in someone's transcript. The toggle exists because
 * sometimes the bug *is* the auth header.
 */
export const SENSITIVE_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'x-xsrf-token'
]

/** Query parameters with the same problem. */
const SENSITIVE_QUERY = /^(access_token|token|api_?key|key|secret|password|sig|signature)$/i

export const REDACTED = '<redacted by GRID>'

/**
 * The same thing for a query parameter. Kept to bare letters because a URL
 * percent-encodes whatever it is given, and `%3Credacted+by+GRID%3E` in the
 * middle of a URL is harder to read than the token it replaced.
 */
export const REDACTED_PARAM = 'REDACTED'

export type Redacted<T> = { value: T; redacted: number }

export function redactHeaders(
  headers: Record<string, string>,
  include: boolean
): Redacted<Array<[string, string]>> {
  let redacted = 0
  const rows = Object.entries(headers)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, value]): [string, string] => {
      if (include || !SENSITIVE_HEADERS.includes(name)) return [name, value]
      redacted += 1
      return [name, REDACTED]
    })
  return { value: rows, redacted }
}

/**
 * Strip credentials out of a URL's query string.
 *
 * The URL is the one field that is always shown, always copied and most often
 * carries a token, so it gets the same treatment as the headers.
 */
export function redactUrl(url: string, include: boolean): Redacted<string> {
  if (include) return { value: url, redacted: 0 }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { value: url, redacted: 0 }
  }
  let redacted = 0
  for (const key of [...parsed.searchParams.keys()]) {
    if (!SENSITIVE_QUERY.test(key)) continue
    parsed.searchParams.set(key, REDACTED_PARAM)
    redacted += 1
  }
  if (parsed.username || parsed.password) {
    parsed.username = ''
    parsed.password = ''
    redacted += 1
  }
  return { value: redacted ? parsed.href : url, redacted }
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

export type SendableBody = { text: string; base64: boolean } | null

export type SendableEntry = {
  entry: NetEntry
  requestBody?: SendableBody
  responseBody?: SendableBody
}

export type SendOptions = {
  /** What the user typed. Goes first: it is the actual question. */
  comment: string
  /** Pane the capture came from, so a Claude session knows which app this is. */
  paneLabel: string
  pageUrl: string | null
  includeSensitive: boolean
  /** Bodies longer than this are cut, with the cut declared in the text. */
  maxBodyChars: number
  /** An element pointed at in the page, if one was. */
  element?: PickedElement | null
}

export const DEFAULT_MAX_BODY_CHARS = 4000

/**
 * Build the block that gets pasted into a Claude session.
 *
 * Plain text with markdown structure, no leading blank line, and no trailing
 * newline — a trailing newline in a terminal paste is a submit, and deciding
 * to send is the user's job, not this function's.
 */
export function formatForClaude(items: SendableEntry[], opts: SendOptions): string {
  const out: string[] = []
  const comment = clean(opts.comment.trim())
  if (comment) out.push(comment, '')

  let redactions = 0

  // The address bar is page-controlled too, and a token in it would otherwise
  // travel in the very first line while the footer said nothing was redacted.
  const page =
    opts.pageUrl && opts.pageUrl !== 'about:blank'
      ? redactUrl(opts.pageUrl, opts.includeSensitive)
      : null
  if (page) redactions += page.redacted

  const where = page ? ` on ${clean(page.value)}` : ''
  const counted: string[] = []
  if (opts.element) counted.push('1 element')
  if (items.length) {
    counted.push(items.length === 1 ? '1 network request' : `${items.length} network requests`)
  }
  const what = counted.length ? counted.join(' and ') : 'nothing'
  // The label can be the page's own <title>, so it is page-controlled as well.
  out.push(`Captured in the GRID browser pane "${clean(opts.paneLabel)}"${where} — ${what}:`, '')

  if (opts.element) {
    out.push(...describeElement(opts.element, opts.maxBodyChars))
    out.push('')
  }

  items.forEach((item, i) => {
    const e = item.entry
    const url = redactUrl(e.url, opts.includeSensitive)
    redactions += url.redacted
    const safeUrl = clean(url.value)

    const heading = items.length > 1 ? `## ${i + 1}. ` : '## '
    // Taken from the *redacted* url. The entry's own short name is built out
    // of the path and the query string, so using it here would put a token
    // straight back into the heading.
    out.push(`${heading}${clean(e.method)} ${pathOf(safeUrl)} — ${clean(statusLine(e))}`)
    out.push(safeUrl)
    out.push(clean(facts(e)))
    out.push('')

    const reqHeaders = redactHeaders(e.requestHeaders, opts.includeSensitive)
    redactions += reqHeaders.redacted
    if (reqHeaders.value.length) {
      out.push('request headers')
      for (const [k, v] of reqHeaders.value) out.push(`  ${clean(k)}: ${clean(v)}`)
      out.push('')
    }

    const requestBody = renderBody(item.requestBody ?? inlineRequestBody(e), e, opts.maxBodyChars)
    if (requestBody) {
      out.push('request body', requestBody, '')
    } else if (e.postDataTruncated) {
      out.push('request body: not captured (too large for the debugger buffer)', '')
    }

    const resHeaders = redactHeaders(e.responseHeaders, opts.includeSensitive)
    redactions += resHeaders.redacted
    if (resHeaders.value.length) {
      out.push('response headers')
      for (const [k, v] of resHeaders.value) out.push(`  ${clean(k)}: ${clean(v)}`)
      out.push('')
    }

    const responseBody = renderBody(item.responseBody ?? null, e, opts.maxBodyChars)
    if (responseBody) {
      out.push('response body', responseBody, '')
    } else if (e.phase === 'failed') {
      out.push(`no response — ${clean(e.error ?? 'the request failed')}`, '')
    }
  })

  if (redactions > 0 && !opts.includeSensitive) {
    out.push(
      `(${redactions} credential ${redactions === 1 ? 'value was' : 'values were'} redacted by GRID before this was sent. Bodies are included in full, with control characters removed so this is safe to paste into a terminal.)`
    )
  }

  // Blank separators are collapsed as the document is assembled rather than
  // with a pass over the finished string: a regex over the whole thing would
  // reach inside the fenced bodies and change the bytes the server actually
  // sent, which is the one part that has to arrive verbatim.
  const lines: string[] = []
  for (const part of out) {
    if (part === '' && lines[lines.length - 1] === '') continue
    lines.push(part)
  }
  return lines.join('\n').trimEnd()
}

/**
 * The one-line stand-in for a capture that is not being pasted whole.
 *
 * Guaranteed to be a single line, because it is typed at a prompt where a
 * newline is an Enter — and two of the three strings in it are not the user's:
 * the pane label can be the page's own `<title>`, and the comment is whatever
 * was in the box. Both are flattened rather than trusted.
 */
export function captureReference(opts: {
  comment: string
  path: string
  count: number
  paneLabel: string
}): string {
  const head = flatten(opts.comment)
  const label = flatten(opts.paneLabel)
  const what = `${opts.count} request${opts.count === 1 ? '' : 's'}`
  const body = `the network capture is in ${flatten(opts.path)}: ${what} from the GRID browser pane "${label}".`
  return head ? `${head} — ${body}` : body
}

/** One line, whatever went in: control characters out, runs of space folded. */
function flatten(text: string): string {
  return clean(text).replace(/\s+/g, ' ').trim()
}

/**
 * Everything page-controlled goes through here.
 *
 * A response body is bytes a website chose, and this text is pasted into a
 * terminal. `ESC[201~` in the middle of it would close the bracketed paste and
 * every byte after it would arrive as live keystrokes in whatever is running
 * in that pane — so the escape character, and every other control code, never
 * leaves this function. Tabs and newlines survive; carriage returns are folded
 * into newlines, because a lone CR in a terminal paste is an Enter.
 */
function clean(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // Naming control characters inside a regex is the whole job of this one,
    // so the rule that normally forbids it does not apply here.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
}

/**
 * A batch of comments, as the text a waiting session reads on its standard
 * output.
 *
 * The same sanitising as everything else here, and for a stronger reason: this
 * one is not pasted into a terminal by a person who can see it first, it is
 * printed straight into a session's context by a script. Every field of it was
 * read out of somebody's web page.
 */
export function formatComments(batch: CommentBatch, maxChars = DEFAULT_MAX_BODY_CHARS): string {
  const out: string[] = []
  const count = batch.comments.length

  out.push(
    `${count} comment${count === 1 ? '' : 's'} from the GRID browser pane "${clean(batch.pane)}" on ${clean(batch.url)}:`,
    ''
  )

  batch.comments.forEach((comment, i) => {
    const said = clean(comment.text).trim()
    out.push(`### ${i + 1}. ${said || '(no comment given)'}`)
    const size = comment.viewportSize
    out.push(
      `seen in the ${clean(comment.viewport)} viewport${size ? ` (${size.width}×${size.height})` : ''}`
    )
    out.push('')
    // A note about the page as a whole has nothing to describe under it.
    if (comment.element) {
      out.push(...describeElement(comment.element, maxChars))
      out.push('')
    }
  })

  const lines: string[] = []
  for (const part of out) {
    if (part === '' && lines[lines.length - 1] === '') continue
    lines.push(part)
  }
  return lines.join('\n').trimEnd()
}

/**
 * The block describing an element somebody pointed at.
 *
 * Ordered the way the question is usually asked: what it is, where it is, what
 * it says, what it computes to, and only then the markup — because the
 * computed styles are what an argument about layout actually turns on, and
 * burying them under a screenful of HTML makes them useless.
 */
function describeElement(el: PickedElement, maxChars: number): string[] {
  const out: string[] = []
  const name = clean(el.selector) || clean(el.tag) || 'element'

  out.push(`## The element — ${name}`)
  if (el.ancestors.length) out.push(`inside ${el.ancestors.map(clean).join(' > ')}`)
  out.push(
    `${Math.round(el.rect.width)}×${Math.round(el.rect.height)} at ${Math.round(el.rect.x)},${Math.round(el.rect.y)} in the viewport`
  )

  const text = clean(el.text).trim()
  if (text) {
    out.push('', 'its text', ...text.split('\n').map((line) => `  ${line}`))
  }

  const styles = Object.entries(el.styles)
  if (styles.length) {
    out.push('', 'computed styles')
    for (const [prop, value] of styles) out.push(`  ${clean(prop)}: ${clean(value)}`)
  }

  const html = clean(el.html)
  if (html.trim()) {
    const cut = html.length > maxChars
    const shown = cut ? html.slice(0, maxChars) : html
    const runs = shown.match(/`+/g) ?? []
    const fence = '`'.repeat(Math.max(3, ...runs.map((run) => run.length + 1)))
    const note = cut ? `\n... truncated by GRID at ${maxChars} of ${html.length} characters` : ''
    out.push('', 'its markup', `${fence}html\n${shown}${note}\n${fence}`)
  }

  return out
}

/**
 * `/api/orders?page=2` — the whole path, not the log row's abbreviated name.
 * A prompt has room for it, and which endpoint this was is the first thing
 * anybody reading it needs.
 */
function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

function statusLine(e: NetEntry): string {
  if (e.phase === 'failed') return e.error ?? 'failed'
  if (e.status === null) return e.phase === 'pending' ? 'still in flight' : 'no status'
  return `${e.status}${e.statusText ? ` ${e.statusText}` : ''}`
}

function facts(e: NetEntry): string {
  const bits = [e.resourceType.toLowerCase()]
  if (e.durationMs !== null) bits.push(prettyMs(e.durationMs))
  if (e.bytes !== null) bits.push(prettyBytes(e.bytes))
  if (e.fromCache) bits.push('from cache')
  if (e.redirected) bits.push('redirect hop')
  if (e.remoteAddress) bits.push(e.remoteAddress)
  if (e.initiator) bits.push(`initiated by ${e.initiator}`)
  return bits.join(' · ')
}

function inlineRequestBody(e: NetEntry): SendableBody {
  return e.postData ? { text: e.postData, base64: false } : null
}

/** A fenced block, or a one-line note when the body is not text. */
function renderBody(body: SendableBody, e: NetEntry, max: number): string | null {
  if (!body) return null
  if (body.base64) {
    return `(binary ${clean(e.mimeType) || 'body'}, ${prettyBytes(e.bytes ?? 0)} — not included)`
  }

  const text = clean(body.text)
  if (!text.trim()) return null

  const cut = text.length > max
  let shown = cut ? text.slice(0, max) : text
  // Slicing counts UTF-16 units, so a cut can land between the halves of a
  // surrogate pair and leave a character that is not one.
  if (cut && /[\uD800-\uDBFF]$/.test(shown)) shown = shown.slice(0, -1)

  // A body with a line of backticks in it would close the block early and turn
  // the rest of the capture into prose. Size the fence past the longest run —
  // which is what markdown's own fence rule is for.
  const runs = shown.match(/`+/g) ?? []
  const fence = '`'.repeat(Math.max(3, ...runs.map((run) => run.length + 1)))

  const note = cut ? `\n... truncated by GRID at ${max} of ${text.length} characters` : ''
  return `${fence}${bodyLanguage(e.mimeType)}\n${shown}${note}\n${fence}`
}

export function bodyLanguage(mimeType: string): string {
  const mime = mimeType.toLowerCase()
  if (mime.includes('json')) return 'json'
  if (mime.includes('html')) return 'html'
  if (mime.includes('xml')) return 'xml'
  if (mime.includes('javascript')) return 'js'
  if (mime.includes('css')) return 'css'
  return ''
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function prettyBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function prettyMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}

// ---------------------------------------------------------------------------
// The CLI invocation
// ---------------------------------------------------------------------------

/** Aliases `claude --model` documents. A full model id is accepted too. */
export const CLAUDE_MODELS = ['opus', 'sonnet', 'haiku', 'fable']

/** `claude --effort <level>`. */
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

export type ClaudeInvocation = {
  /** True when this command actually launches the Claude CLI. */
  isClaude: boolean
  /** Everything up to the first flag — `claude`, `npx claude`, a full path. */
  base: string
  model: string | null
  effort: string | null
  /** Every other argument, kept verbatim so rebuilding never loses one. */
  rest: string[]
}

/**
 * Read the model and effort back out of the command a terminal was opened
 * with.
 *
 * This is what "the model and effort I started this with" means in practice:
 * a repository's `Command on open` is `claude --model opus --effort high`, and
 * anything GRID sends onwards has to agree with the session already running,
 * or the answer comes back from a different model than the one you chose.
 */
export function parseClaudeInvocation(command: string | null | undefined): ClaudeInvocation {
  const empty: ClaudeInvocation = { isClaude: false, base: '', model: null, effort: null, rest: [] }
  if (!command || !command.trim()) return empty

  const tokens = tokenise(command)
  const at = tokens.findIndex((t) => isClaudeBinary(t.text))
  if (at === -1) return { ...empty, base: '', rest: tokens.map((t) => t.raw) }

  // Spelled exactly as it was written. Rebuilding it from the unquoted text
  // would lose the quotes around a path with a space, and — worse — turn a
  // chained command like `cd frontend && claude` into one where `&&` is an
  // argument rather than the operator that makes it work.
  const base = tokens
    .slice(0, at + 1)
    .map((t) => t.raw)
    .join(' ')

  const args = tokens.slice(at + 1)
  const rest: string[] = []
  let model: string | null = null
  let effort: string | null = null

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i].text
    const eq = /^--(model|effort)=(.*)$/.exec(arg)
    if (eq) {
      if (eq[1] === 'model') model = eq[2]
      else effort = eq[2]
      continue
    }
    if (arg === '--model' || arg === '--effort') {
      const value = args[i + 1]?.text
      // A trailing `--model` with nothing after it is the user mid-edit, not a
      // model called undefined.
      if (value !== undefined && !value.startsWith('-')) {
        if (arg === '--model') model = value
        else effort = value
        i += 1
        continue
      }
      continue
    }
    rest.push(args[i].raw)
  }

  return { isClaude: true, base, model, effort, rest }
}

/** `claude` however it was spelled: a bare name, a .cmd shim, a full path. */
function isClaudeBinary(token: string): boolean {
  const name = token.replace(/^["']|["']$/g, '').split(/[\\/]/).pop() ?? ''
  return /^claude(\.(cmd|exe|bat|ps1))?$/i.test(name)
}

/**
 * A model or effort value safe to put on a command line.
 *
 * These end up in a string GRID types into a live shell, and they come from a
 * settings file the user can edit by hand — so `opus; rm -rf /` has to be
 * refused here rather than only in the UI that usually produces them.
 */
export function isSafeFlagValue(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)
}

/**
 * A path GRID can put inside double quotes on a command line.
 *
 * The captures directory is derived from the user's own profile path, and the
 * shell it will be typed into might be PowerShell, cmd or bash — two of which
 * expand `$` and a backtick inside double quotes. A profile path containing
 * one is rare and a refusal is cheap, so this is checked rather than escaped
 * three different ways.
 */
export function isSafeQuotedPath(path: string): boolean {
  return path.length > 0 && !/["`$%\r\n]/.test(path)
}

/**
 * A token that needs no quoting in any of the five shells GRID can open —
 * PowerShell, Windows PowerShell, cmd, Git Bash and WSL.
 *
 * Deliberately a whitelist, and deliberately without the backslash. A Windows
 * folder may contain `&`, which cmd.exe reads as a command separator when it
 * is not quoted, so quoting only tokens with a space would let that through.
 * And a bare `C:\Users\me\captures` reaches bash with every backslash eaten as
 * an escape — which is how `--add-dir` ends up naming a folder that does not
 * exist. Anything with a backslash in it gets quoted.
 */
const BARE_TOKEN = /^[A-Za-z0-9._:/@=+-]+$/

export function buildClaudeInvocation(inv: {
  base?: string
  model?: string | null
  effort?: string | null
  rest?: string[]
}): string {
  // The base is used verbatim: `parseClaudeInvocation` already quoted it token
  // by token, and re-quoting it as a unit would turn `npx claude` into
  // `"npx claude"` — a single command name no shell has.
  const parts = [inv.base?.trim() || 'claude']
  if (inv.model && isSafeFlagValue(inv.model)) parts.push('--model', inv.model)
  if (inv.effort && isSafeFlagValue(inv.effort)) parts.push('--effort', inv.effort)
  // Verbatim: these came out of a parse with their quoting intact, or from a
  // caller that has already put them through `quoteArg`.
  for (const arg of inv.rest ?? []) parts.push(arg)
  return parts.join(' ')
}

/**
 * Quote a value GRID is putting on a command line itself — a path it chose, a
 * directory it just created.
 *
 * Returns null when the value cannot be made safe in all three of the shells a
 * pane might be running, which is a refusal for the caller to surface rather
 * than something to paper over: a half-escaped path on a command line is how a
 * capture folder becomes a command.
 */
export function quoteArg(value: string): string | null {
  if (!isSafeQuotedPath(value)) return null
  return BARE_TOKEN.test(value) ? value : `"${value}"`
}

/**
 * Split a command line, keeping quoted runs together.
 *
 * Each token is kept twice: `text` is what the shell would pass to the
 * program, and `raw` is how it was written. Both are needed — the flags are
 * read off `text`, and anything put back on a command line has to go back as
 * `raw` or its quoting and its shell operators are lost.
 */
type Token = { text: string; raw: string }

function tokenise(command: string): Token[] {
  const out: Token[] = []
  let text = ''
  let raw = ''
  let quote: string | null = null

  for (const ch of command.trim()) {
    if (quote) {
      raw += ch
      if (ch === quote) quote = null
      else text += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      raw += ch
      continue
    }
    if (/\s/.test(ch)) {
      if (raw) out.push({ text, raw })
      text = ''
      raw = ''
      continue
    }
    text += ch
    raw += ch
  }
  if (raw) out.push({ text, raw })
  return out
}
