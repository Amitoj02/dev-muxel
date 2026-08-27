/**
 * One xterm instance per terminal pane, owned outside React.
 *
 * React re-renders the grid constantly (every splitter drag is a state
 * update). If the Terminal lived in component state it would be torn down and
 * rebuilt on every reshuffle and you would lose your scrollback. So sessions
 * live in a module-level registry, and the component only ever hands them a
 * host element to mount into.
 *
 * Written against xterm 6.0.0. Notable differences from v5, all of which bite
 * silently rather than loudly:
 *   - `windowsPty`, not `windowsMode`
 *   - `overviewRuler: { width }`, not `overviewRulerWidth`
 *   - the canvas renderer is gone; DOM and WebGL are the only two
 *   - unknown option keys are accepted and ignored, so typos never throw
 *   - the scrollbar is VS Code's, styled through theme keys not CSS
 */

import { Terminal, type IDisposable, type ITerminalOptions, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import {
  Base64,
  ClipboardAddon,
  type ClipboardSelectionType,
  type IClipboardProvider
} from '@xterm/addon-clipboard'
import { WebglAddon } from '@xterm/addon-webgl'
import type { Settings } from '../../../shared/types'
import { classifyChord } from '../lib/chords'

/**
 * Chrome loses the oldest WebGL context past 16 per renderer process. Panes
 * are cheap to open, so cap well under that and let the rest use the DOM
 * renderer rather than silently dropping a context out from under someone.
 */
const MAX_WEBGL_CONTEXTS = 8

export type AttentionSignal = 'busy' | 'idle' | 'bell' | 'waiting'

export type SessionCallbacks = {
  /** User keystrokes, to be forwarded to the pty. */
  onInput: (data: string) => void
  /** xterm resized itself after a fit; the pty must follow. */
  onResize: (cols: number, rows: number) => void
  /** Bytes written into xterm so far, for pty flow control. */
  onAck: (bytes: number) => void
  onAttention: (signal: AttentionSignal) => void
  onTitle: (title: string) => void
  /** A GRID shortcut was pressed inside the terminal; the app handles it. */
  onShortcut: (e: KeyboardEvent) => boolean
}

// ---------------------------------------------------------------------------

/** The chassis palette, mapped onto xterm's 28 theme keys. */
const theme: ITheme = {
  background: '#0d1117',
  foreground: '#b9c0cc',
  cursor: '#e5372a',
  cursorAccent: '#0d1117',
  selectionBackground: 'rgba(229,55,42,0.28)',
  selectionInactiveBackground: 'rgba(139,147,163,0.20)',
  selectionForeground: undefined,

  scrollbarSliderBackground: 'rgba(43,52,66,0.9)',
  scrollbarSliderHoverBackground: 'rgba(63,72,84,0.95)',
  scrollbarSliderActiveBackground: 'rgba(139,147,163,0.9)',
  overviewRulerBorder: '#0b0e13',

  black: '#0b0e13',
  red: '#e5372a',
  green: '#62c08a',
  yellow: '#c9a227',
  blue: '#5b8fd6',
  magenta: '#b071c9',
  cyan: '#4fb3bf',
  white: '#b9c0cc',

  brightBlack: '#5b6472',
  brightRed: '#ff6b52',
  brightGreen: '#7fd6a4',
  brightYellow: '#e3c14b',
  brightBlue: '#7fa9e8',
  brightMagenta: '#c98fdd',
  brightCyan: '#6ecdd8',
  brightWhite: '#e6e9ef'
}

const searchOptions: ISearchOptions = {
  regex: false,
  wholeWord: false,
  caseSensitive: false,
  incremental: true,
  decorations: {
    matchBackground: '#2b3442',
    matchBorder: '#3b4757',
    matchOverviewRuler: '#8a93a3',
    activeMatchBackground: '#e5372a',
    activeMatchBorder: '#ff6b52',
    activeMatchColorOverviewRuler: '#e5372a'
  }
}

function buildOptions(settings: Settings, buildNumber: number): ITerminalOptions {
  return {
    allowProposedApi: true, // required by unicode11 and registerDecoration
    allowTransparency: false,
    cursorBlink: settings.cursorBlink,
    cursorStyle: settings.cursorStyle,
    cursorInactiveStyle: 'outline',
    cursorWidth: 1,
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    // xterm throws outright if lineHeight drops below 1.
    lineHeight: Math.max(1, settings.lineHeight),
    fontWeight: 'normal',
    fontWeightBold: '600',
    letterSpacing: 0,
    scrollback: settings.scrollback,
    smoothScrollDuration: 0,
    drawBoldTextInBrightColors: true,
    minimumContrastRatio: 1,
    rightClickSelectsWord: false,
    macOptionIsMeta: false,
    logLevel: 'warn',
    // Telling xterm the real ConPTY build number is what enables reflow on
    // resize; without it every wrapped line is treated as hard-wrapped.
    windowsPty: { backend: 'conpty', buildNumber },
    overviewRuler: { width: 10, showTopBorder: false, showBottomBorder: false },
    // OSC 8 hyperlinks are handled by xterm itself, not by WebLinksAddon. Left
    // unset, clicking one pops xterm's own confirm() dialog and then fails to
    // open anything; `allowNonHttpProtocols` stays false so a repo cannot make
    // a `file:` link that would run something.
    linkHandler: {
      activate: (_event, text) => openLink(text),
      allowNonHttpProtocols: false
    },
    theme
  }
}

/**
 * OSC 52, write-only.
 *
 * The addon's default provider implements `readText`, which means any program
 * printing `ESC ] 52 ; c ; ? BEL` gets the user's clipboard piped straight back
 * into its stdin. For a tool whose whole job is running other people's
 * repositories, that is a credential-exfiltration primitive — developers keep
 * tokens on their clipboard. Writing is genuinely useful (a CLI can hand you a
 * URL to paste), so it stays; reading is refused.
 */
class WriteOnlyClipboard implements IClipboardProvider {
  readText(): string {
    return ''
  }

  async writeText(_selection: ClipboardSelectionType, text: string): Promise<void> {
    if (typeof text === 'string' && text.length > 0) await window.grid.clipboard.write(text)
  }
}

/** Only ever hand the OS a web URL; the terminal can print anything at all. */
function openLink(uri: string): void {
  if (/^https?:\/\//i.test(uri)) void window.grid.open.external(uri)
}

// ---------------------------------------------------------------------------

let webglCount = 0

export class TerminalSession {
  readonly term: Terminal
  readonly fit: FitAddon
  readonly search: SearchAddon

  private webgl: WebglAddon | null = null
  private disposables: IDisposable[] = []
  private host: HTMLElement | null = null
  private observer: ResizeObserver | null = null
  private resizeRaf = 0
  private written = 0
  /** Bytes written but not yet confirmed by xterm's write callback. */
  private inFlight = 0
  private lastOutputAt = 0
  private idleTimer: number | null = null
  private idleMs: number
  private bellIsAttention: boolean
  private disposed = false
  /** Set once OSC 133 shows up, so the idle heuristic can stand down. */
  private hasShellIntegration = false

  constructor(
    readonly paneId: string,
    settings: Settings,
    private cb: SessionCallbacks,
    buildNumber: number
  ) {
    this.idleMs = settings.idleAttentionMs
    this.bellIsAttention = settings.bellIsAttention

    this.term = new Terminal(buildOptions(settings, buildNumber))

    // unicode11 is two steps: load the addon, then select the version.
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'

    this.fit = new FitAddon()
    this.search = new SearchAddon({ highlightLimit: 2000 })
    this.term.loadAddon(this.fit)
    this.term.loadAddon(this.search)
    this.term.loadAddon(new ClipboardAddon(new Base64(), new WriteOnlyClipboard()))
    this.term.loadAddon(new WebLinksAddon((_event, uri) => openLink(uri)))

    this.disposables.push(
      this.term.onData((d) => this.cb.onInput(d)),
      this.term.onBinary((d) => this.cb.onInput(d)),
      this.term.onResize(({ cols, rows }) => this.cb.onResize(cols, rows)),
      this.term.onTitleChange((t) => this.cb.onTitle(t)),
      this.term.onBell(() => {
        if (this.bellIsAttention) this.cb.onAttention('bell')
      })
    )

    this.wireShellIntegration()

    // Keys GRID owns must be refused here, not merely ignored. Returning false
    // makes xterm bail out before its own cancel(), which would otherwise
    // stopPropagation() and stop the shortcut ever reaching the window.
    // Everything else belongs to whatever is running in the pane — including
    // Escape, which Claude and every TUI need.
    this.term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const chord = classifyChord(e)
      if (chord === null) return true
      // Ctrl+Shift acts on this specific terminal, so it is handled here where
      // the session is in scope; the rest bubbles to the app-level handler.
      if (chord === 'ctrl-shift') this.cb.onShortcut(e)
      return false
    })

    // Ctrl+wheel resizes the app font rather than scrolling the buffer.
    this.term.attachCustomWheelEventHandler((e) => !e.ctrlKey)
  }

  /** Mount into a host element. Safe to call again after the pane moves. */
  attach(host: HTMLElement, renderer: Settings['renderer']): void {
    if (this.disposed || this.host === host) return
    this.host = host

    if (!this.term.element) {
      this.term.open(host)
    } else if (this.term.element.parentElement !== host) {
      // Moving the existing DOM keeps the scrollback and the GL context.
      host.appendChild(this.term.element)
      // A parked session comes back through here after a spell outside the
      // document, where a WebGL canvas can be holding a stale frame and no
      // resize is coming to force a redraw. Repainting once is cheap.
      this.term.refresh(0, this.term.rows - 1)
    }

    if (renderer === 'webgl') this.enableWebgl()

    this.observer?.disconnect()
    this.observer = new ResizeObserver(() => this.scheduleFit())
    this.observer.observe(host)
    this.scheduleFit()
  }

  detach(): void {
    this.observer?.disconnect()
    this.observer = null
    this.host = null
  }

  /**
   * The pane was closed, but inside the reopen window — so nothing is torn
   * down. The shell keeps running and keeps writing into this buffer; the
   * element simply stops being on screen. Whoever adopts the session next
   * gets the scrollback, the process and the shell's own state back intact.
   */
  park(): void {
    this.detach()
  }

  /** Reopened, or remounted: a new pane component, the same terminal. */
  adopt(cb: SessionCallbacks): void {
    this.cb = cb
  }

  /** Coalesce fits into one per frame; a splitter drag fires dozens. */
  scheduleFit(): void {
    if (this.disposed || this.resizeRaf) return
    this.resizeRaf = window.requestAnimationFrame(() => {
      this.resizeRaf = 0
      this.doFit()
    })
  }

  private doFit(): void {
    if (this.disposed || !this.term.element) return
    const host = this.host
    // fit() reaches into the render service and throws if the element has no
    // box yet — during a zoom animation, for instance.
    if (!host || host.clientWidth < 8 || host.clientHeight < 8) return
    try {
      this.fit.fit()
    } catch {
      /* not measurable this frame; the next resize will catch it */
    }
  }

  write(data: string, seq: number): void {
    if (this.disposed) return
    this.lastOutputAt = Date.now()
    this.inFlight += data.length
    if (this.inFlight > 8192) this.cb.onAttention('busy')

    this.term.write(data, () => {
      this.inFlight = Math.max(0, this.inFlight - data.length)
      this.written = Math.max(this.written, seq)
      this.cb.onAck(this.written)
    })

    this.armIdleTimer()
  }

  /** Write GRID's own text into the pane (never echoed back to the pty). */
  writeLocal(text: string): void {
    if (!this.disposed) this.term.write(text)
  }

  focus(): void {
    if (!this.disposed) this.term.focus()
  }

  hasSelection(): boolean {
    return !this.disposed && this.term.hasSelection()
  }

  selection(): string {
    return this.disposed ? '' : this.term.getSelection()
  }

  paste(text: string): void {
    if (!this.disposed) this.term.paste(text)
  }

  clear(): void {
    if (!this.disposed) this.term.clear()
  }

  findNext(query: string): boolean {
    return !this.disposed && this.search.findNext(query, searchOptions)
  }

  findPrevious(query: string): boolean {
    return !this.disposed && this.search.findPrevious(query, searchOptions)
  }

  clearSearch(): void {
    if (this.disposed) return
    this.search.clearDecorations()
  }

  applySettings(settings: Settings, buildNumber: number): void {
    if (this.disposed) return
    this.idleMs = settings.idleAttentionMs
    this.bellIsAttention = settings.bellIsAttention

    const next = buildOptions(settings, buildNumber)
    // Assigning the whole options object is not supported; set the live keys.
    const o = this.term.options
    o.fontFamily = next.fontFamily
    o.fontSize = next.fontSize
    o.lineHeight = next.lineHeight
    o.cursorBlink = next.cursorBlink
    o.cursorStyle = next.cursorStyle
    o.scrollback = next.scrollback

    if (settings.renderer === 'webgl') this.enableWebgl()
    else this.disableWebgl()

    this.scheduleFit()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.idleTimer) window.clearTimeout(this.idleTimer)
    if (this.resizeRaf) window.cancelAnimationFrame(this.resizeRaf)
    this.observer?.disconnect()
    this.disableWebgl()
    for (const d of this.disposables) {
      try {
        d.dispose()
      } catch {
        /* ignore */
      }
    }
    this.disposables.length = 0
    try {
      this.term.dispose()
    } catch {
      /* ignore */
    }
  }

  // -------------------------------------------------------------------------

  private enableWebgl(): void {
    if (this.webgl || !this.term.element) return
    if (webglCount >= MAX_WEBGL_CONTEXTS) return
    try {
      const addon = new WebglAddon(false)
      // Context loss is reported ~3s late (xterm waits for a possible
      // restore); disposing puts the DOM renderer back automatically.
      addon.onContextLoss(() => this.disableWebgl())
      this.term.loadAddon(addon)
      this.webgl = addon
      webglCount += 1
    } catch {
      this.webgl = null
    }
  }

  private disableWebgl(): void {
    if (!this.webgl) return
    try {
      this.webgl.dispose()
    } catch {
      /* ignore */
    }
    this.webgl = null
    webglCount = Math.max(0, webglCount - 1)
  }

  /**
   * OSC 133 is the reliable answer to "is this thing waiting for me". When a
   * shell emits it we trust it completely; when it does not, the idle timer
   * below is the fallback.
   */
  private wireShellIntegration(): void {
    const handle = (payload: string): boolean => {
      const [kind, arg] = payload.split(';')
      this.hasShellIntegration = true
      if (kind === 'B') {
        // Prompt drawn, input accepted: the shell is waiting on a human.
        this.cb.onAttention('waiting')
      } else if (kind === 'C') {
        this.cb.onAttention('busy')
      } else if (kind === 'D') {
        // Command finished, with its exit code in `arg` if the shell sent one.
        void arg
        this.cb.onAttention('waiting')
      }
      // Returning false leaves the sequence unhandled so anything else
      // listening (or a future addon) still sees it.
      return false
    }

    this.disposables.push(
      this.term.parser.registerOscHandler(133, handle),
      this.term.parser.registerOscHandler(633, handle),
      // Windows Terminal's toast: ESC ] 9 ; <message> BEL. The 9;4 form is
      // ConEmu progress, which is a busy signal, not a notification.
      this.term.parser.registerOscHandler(9, (payload) => {
        if (/^4;/.test(payload)) {
          const state = Number(payload.split(';')[1])
          if (state === 3 || state === 1) this.cb.onAttention('busy')
          else if (state === 0) this.cb.onAttention('idle')
        } else if (payload.trim()) {
          this.cb.onAttention('bell')
        }
        return false
      })
    )
  }

  /**
   * The fallback for CLIs with no shell integration: after output stops for a
   * while, look at the last line and decide whether it reads like a question.
   */
  private armIdleTimer(): void {
    if (this.idleMs <= 0 || this.hasShellIntegration) return
    if (this.idleTimer) window.clearTimeout(this.idleTimer)
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null
      if (this.disposed) return
      if (Date.now() - this.lastOutputAt < this.idleMs - 50) return
      this.cb.onAttention(this.looksLikeAQuestion() ? 'waiting' : 'idle')
    }, this.idleMs)
  }

  private looksLikeAQuestion(): boolean {
    try {
      const buf = this.term.buffer.active
      // Scan back over trailing blanks; prompts often sit above a blank line.
      for (let i = 0; i < 4; i += 1) {
        const line = buf.getLine(buf.baseY + buf.cursorY - i)
        const text = line?.translateToString(true).trim()
        if (!text) continue
        return /(\(y\/n\)|\[y\/n\]|\(yes\/no\)|\?\s*$|❯\s*$|›\s*$|:\s*$|press\s+\w+\s+to)/i.test(text)
      }
    } catch {
      /* buffer not readable */
    }
    return false
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const sessions = new Map<string, TerminalSession>()

export function getSession(paneId: string): TerminalSession | undefined {
  return sessions.get(paneId)
}

export function createSession(
  paneId: string,
  settings: Settings,
  cb: SessionCallbacks,
  buildNumber: number
): TerminalSession {
  destroySession(paneId)
  const session = new TerminalSession(paneId, settings, cb, buildNumber)
  sessions.set(paneId, session)
  return session
}

export function destroySession(paneId: string): void {
  const existing = sessions.get(paneId)
  if (!existing) return
  sessions.delete(paneId)
  existing.dispose()
}

export function allSessions(): TerminalSession[] {
  return [...sessions.values()]
}
