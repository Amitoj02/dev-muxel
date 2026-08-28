/**
 * A captured request, on its way to a Claude session.
 *
 * The awkward part is not the text — that is a pure function — it is *which*
 * Claude. A session already running was started with a model and an effort
 * level, and nothing pasted into it can change those; a session GRID starts
 * for you has to be given them. So the dialog shows you which of the two you
 * are doing, and reads the flags back out of the command the terminal was
 * opened with rather than guessing.
 *
 * Paste size is the other trap. The CLI folds any paste over ten thousand
 * characters into a placeholder held outside the prompt, which can age out
 * before the model reads it — so a big capture goes to a file and the paste
 * becomes one line naming it.
 */

import { useEffect, useMemo, useState } from 'react'
import type { Pane, TerminalPane } from '../../../shared/types'
import { hostLabel, type NetEntry } from '../../../shared/browser'
import {
  CLAUDE_EFFORTS,
  CLAUDE_MODELS,
  DEFAULT_MAX_BODY_CHARS,
  buildClaudeInvocation,
  captureReference,
  formatForClaude,
  isSafeQuotedPath,
  parseClaudeInvocation,
  quoteArg,
  redactHeaders,
  redactUrl,
  type SendableBody,
  type SendableEntry
} from '../../../shared/claude'
import { netLogFor, useNetLog } from '../browser/netlog'
import { getSession } from '../terminal/session'
import { actions, paneById, paneLabel, repoById, runtimeFor, useApp } from '../state/hooks'
import { Overlay } from './Overlay'

/**
 * Below this a capture is pasted whole. The CLI's own threshold is 10,000
 * characters, past which it stores the paste out of band as a placeholder;
 * staying under it is what keeps a send readable in the transcript.
 */
const PASTE_INLINE_LIMIT = 9_000

export function SendToClaude({
  paneId,
  uids
}: {
  paneId: string
  uids: string[]
}): React.JSX.Element | null {
  const app = useApp()
  const log = useNetLog(paneId)
  const pane = paneById(app, paneId)

  const entries = useMemo(
    () => uids.map((uid) => log.entries.find((e) => e.uid === uid)).filter(Boolean) as NetEntry[],
    [uids, log.entries]
  )

  // Bodies live in main; pull the ones being sent, once.
  const [bodies, setBodies] = useState<Record<string, SendableBody>>({})
  useEffect(() => {
    let alive = true
    void Promise.all(
      uids.map(async (uid) => {
        const entry = netLogFor(paneId).entries.find((e) => e.uid === uid)
        if (!entry) return [uid, null] as const
        const result = await window.grid.browser.body(paneId, entry.uid)
        const body: SendableBody =
          result.ok && result.text ? { text: result.text, base64: Boolean(result.base64) } : null
        return [uid, body] as const
      })
    ).then((pairs) => {
      if (!alive) return
      setBodies(Object.fromEntries(pairs))
    })
    return () => {
      alive = false
    }
  }, [paneId, uids])

  const targets = useTargets(app, pane)
  const [targetId, setTargetId] = useState<string>(() => targets.preferred)
  const [comment, setComment] = useState('')
  const [includeSensitive, setIncludeSensitive] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [busy, setBusy] = useState(false)

  const targetPane = targetId === 'new' ? null : paneById(app, targetId)
  const targetClaude = useMemo(() => claudeIn(app, targetPane), [app, targetPane])
  const targetInvocation = targetClaude.invocation

  // The repository's own pinned flags win over the global default: a project
  // whose command on open says `--model opus` means it.
  const [model, setModel] = useState(
    () => targets.newSession.model ?? app.settings.claudeModel ?? ''
  )
  const [effort, setEffort] = useState(
    () => targets.newSession.effort ?? app.settings.claudeEffort ?? ''
  )

  const label = pane ? paneLabel(app, pane) : 'browser'
  const pageUrl = pane?.kind === 'browser' ? pane.url : null

  const items: SendableEntry[] = useMemo(
    () => entries.map((entry) => ({ entry, responseBody: bodies[entry.uid] ?? null })),
    [entries, bodies]
  )

  const text = useMemo(
    () =>
      formatForClaude(items, {
        comment,
        paneLabel: label,
        pageUrl,
        includeSensitive,
        maxBodyChars: DEFAULT_MAX_BODY_CHARS
      }),
    [items, comment, label, pageUrl, includeSensitive]
  )

  /**
   * Whether the capture goes into the pane whole.
   *
   * Decided here rather than inside the send so the dialog can describe the
   * same routing it is going to take — a preview that shows one thing while
   * something else is pasted is worse than no preview. It is checked again at
   * the moment of sending, because the mode it depends on is live.
   */
  const willInline =
    targetId !== 'new' &&
    targetClaude.running &&
    acceptsBracketedPaste(targetId) &&
    text.length <= PASTE_INLINE_LIMIT

  const redactions = useMemo(
    () =>
      entries.reduce(
        (total, e) =>
          total +
          redactUrl(e.url, false).redacted +
          redactHeaders(e.requestHeaders, false).redacted +
          redactHeaders(e.responseHeaders, false).redacted,
        // The address bar is in the capture's first line and is as likely as
        // any request to be carrying a token.
        pageUrl ? redactUrl(pageUrl, false).redacted : 0
      ),
    [entries, pageUrl]
  )

  if (!pane || pane.kind !== 'browser') return null

  /** Says, in one line, exactly what pressing Send will do. */
  const describeRouting = (): string => {
    if (targetId === 'new') {
      return targets.newSessionCwd
        ? `Opens a terminal in ${targets.newSessionCwd.cwd} on a file holding this capture`
        : 'No folder to open a terminal in yet'
    }
    if (willInline) {
      return `Running ${describeInvocation(targetInvocation)} — pasted in whole; that model and effort cannot be changed from here`
    }
    if (targetClaude.running && text.length > PASTE_INLINE_LIMIT) {
      return `Running ${describeInvocation(targetInvocation)} — too long to paste, so it goes to a file and one line names it`
    }
    if (targetClaude.running) {
      return `Running ${describeInvocation(targetInvocation)}, but it is not accepting a paste right now — the capture goes to a file and one line names it`
    }
    if (targetInvocation.isClaude) {
      return 'Set up for claude, but GRID never pressed Enter on it — the capture goes to a file and one line names it'
    }
    return 'Not a Claude session — the capture goes to a file and one line naming it is pasted'
  }

  const send = async (): Promise<void> => {
    setBusy(true)
    try {
      const hint = entries[0] ? `${entries[0].method}-${entries[0].name}` : hostLabel(pageUrl)

      if (targetId === 'new') {
        const where = targets.newSessionCwd
        if (!where) {
          actions.toast('Nowhere to open a terminal — declare a repository first', 'error')
          return
        }
        const stashed = await window.grid.browser.stash(text, hint)
        if (!stashed.ok) {
          actions.toast(`Could not write the capture — ${stashed.error}`, 'error')
          return
        }
        // Both end up on a command line, and two of the three shells GRID can
        // open expand things inside double quotes. A refusal is better than a
        // half-escaped path.
        const quotedDir = quoteArg(stashed.dir)
        if (!quotedDir || !isSafeQuotedPath(stashed.path)) {
          actions.toast(
            'That folder cannot be put on a command line safely — send this to a session that is already running',
            'error'
          )
          return
        }
        // The prompt is an argument rather than a paste: a session that has not
        // started yet has nothing to paste into, and there is no moment we
        // could reliably wait for.
        const command = buildClaudeInvocation({
          base: targets.newSession.base,
          model,
          effort,
          // The repository's own flags first, then one capture folder — so the
          // session is granted the file it was opened for rather than every
          // capture ever taken.
          rest: [...targets.newSession.rest, '--add-dir', quotedDir]
        })
        actions.addTerminal({
          repoId: where.repoId,
          cwd: where.cwd,
          startupCommand: `${command} "Read ${stashed.path} — it is a network capture from the GRID browser pane, and my question is at the top of it."`,
          runStartup: true,
          label: 'claude · capture'
        })
        actions.closeOverlay()
        actions.toast('Opened a Claude session on that capture')
        return
      }

      const session = getSession(targetId)
      if (!session || runtimeFor(app, targetId).exited) {
        actions.toast('That terminal is no longer running', 'error')
        return
      }

      /**
       * A capture is bytes a web page chose. Pasted into a Claude session it
       * is one message; pasted into a bare shell, every line of it is a command
       * sitting on the prompt. So a pane where GRID cannot confirm Claude is
       * running gets one line naming a file instead — as does any capture too
       * big to paste, which the CLI would fold into a placeholder that expires.
       */
      // Re-checked rather than trusted from render: bracketed paste is a mode
      // the program in the pane turns on and off, and nothing re-renders this
      // dialog when it does.
      let payload = text
      if (!willInline || !acceptsBracketedPaste(targetId)) {
        const stashed = await window.grid.browser.stash(text, hint)
        if (!stashed.ok) {
          actions.toast(`Could not write the capture — ${stashed.error}`, 'error')
          return
        }
        payload = captureReference({
          comment,
          path: stashed.path,
          count: entries.length,
          paneLabel: label
        })
      }

      // Through xterm rather than straight at the pty: xterm wraps this in the
      // bracketed-paste sequence when the program has asked for one, which is
      // what stops every newline in the capture being read as Enter.
      session.paste(payload)
      actions.focusPane(targetId)
      session.focus()
      actions.closeOverlay()
      actions.toast('Pasted into the session — press Enter to send it')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Overlay onClose={() => actions.closeOverlay()}>
      <div className="dialog">
        <div className="dialog__head">
          <h2 className="dialog__title">SEND TO CLAUDE</h2>
          <span className="dialog__sub">
            {entries.length} request{entries.length === 1 ? '' : 's'} from {label}
          </span>
          <button className="dialog__close" onClick={() => actions.closeOverlay()} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="dialog__body">
          <div className="send-summary">
            {entries.map((e) => (
              <span key={e.uid} className="send-summary__row" data-failed={e.status !== null && e.status >= 400}>
                <span className="send-summary__method">{e.method}</span>
                <span className="send-summary__name">{e.name || e.url}</span>
                <span className="send-summary__status">
                  {e.phase === 'failed' ? (e.error ?? 'failed') : (e.status ?? '···')}
                </span>
              </span>
            ))}
          </div>

          <div style={{ padding: '0 16px 4px' }}>
            <div className="field">
              <label className="field__label" htmlFor="send-comment">
                Your question
              </label>
              <textarea
                id="send-comment"
                className="input send-comment"
                value={comment}
                spellCheck={false}
                placeholder="Why is this 500ing? The payload looks right to me."
                onChange={(e) => setComment(e.target.value)}
              />
            </div>
          </div>

          <div className="settings-grid" style={{ paddingTop: 12 }}>
            <div className="field">
              <label className="field__label" htmlFor="send-target">
                Send it to
              </label>
              <select
                id="send-target"
                className="select"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                {targets.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
                <option value="new">A new Claude session</option>
              </select>
              <span className="field__hint">{describeRouting()}</span>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="send-model">
                Model
              </label>
              <select
                id="send-model"
                className="select"
                value={targetId === 'new' ? model : (targetInvocation.model ?? '')}
                disabled={targetId !== 'new'}
                onChange={(e) => {
                  setModel(e.target.value)
                  actions.patchSettings({ claudeModel: e.target.value })
                }}
              >
                <option value="">CLI default</option>
                {CLAUDE_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                {targetInvocation.model && !CLAUDE_MODELS.includes(targetInvocation.model) && (
                  <option value={targetInvocation.model}>{targetInvocation.model}</option>
                )}
              </select>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="send-effort">
                Effort
              </label>
              <select
                id="send-effort"
                className="select"
                value={targetId === 'new' ? effort : (targetInvocation.effort ?? '')}
                disabled={targetId !== 'new'}
                onChange={(e) => {
                  setEffort(e.target.value)
                  actions.patchSettings({ claudeEffort: e.target.value })
                }}
              >
                <option value="">CLI default</option>
                {CLAUDE_EFFORTS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ padding: '4px 16px 16px' }}>
            <label className="check">
              <input
                type="checkbox"
                checked={includeSensitive}
                onChange={(e) => setIncludeSensitive(e.target.checked)}
              />
              Include credentials
              {redactions > 0
                ? ` — ${redactions} value${redactions === 1 ? '' : 's'} would otherwise be redacted`
                : ''}
            </label>
            <span className="field__hint" style={{ paddingLeft: 23 }}>
              Headers and URLs are scanned. Bodies are not: they go in full, minus control
              characters and anything past {DEFAULT_MAX_BODY_CHARS} characters — read the capture
              below if you are not sure what is in them.
            </span>

            <button
              className="btn btn--ghost"
              style={{ marginTop: 10 }}
              onClick={() => setShowPreview((open) => !open)}
            >
              {showPreview ? 'Hide' : 'Show'} the capture ({text.length} characters)
            </button>

            {showPreview && (
              <>
                {!willInline && (
                  <p className="field__hint" style={{ margin: '10px 0 0' }}>
                    This is what Claude reads. It is written to a file under
                    {' %APPDATA%\\GRID\\captures'}; the pane itself gets one line naming that file.
                  </p>
                )}
                <pre className="send-preview">{text}</pre>
              </>
            )}
          </div>
        </div>

        <div className="dialog__foot">
          <button
            className="btn btn--primary"
            disabled={busy || entries.length === 0}
            onClick={() => void send()}
          >
            Send it
          </button>
          <button
            className="btn"
            onClick={() => {
              void window.grid.clipboard.write(text)
              actions.toast('Copied')
            }}
          >
            Copy instead
          </button>
          <span className="dialog__spacer" />
          <button className="btn btn--ghost" onClick={() => actions.closeOverlay()}>
            Cancel
          </button>
        </div>
      </div>
    </Overlay>
  )
}

// ---------------------------------------------------------------------------

type Targets = {
  options: Array<{ id: string; label: string }>
  preferred: string
  newSessionCwd: { cwd: string; repoId: string | null } | null
  /**
   * The repository's own claude command, parsed. A project that pins a model,
   * an effort or a flag keeps all three when GRID opens a session on a
   * capture — otherwise "a new Claude session" would quietly be a different
   * Claude from the one that repository always uses.
   */
  newSession: ReturnType<typeof parseClaudeInvocation>
}

/**
 * Which sessions this capture could go to, best first.
 *
 * "Best" means a Claude running on the repository the page belongs to: the
 * request came from that project's dev server, so that is the session with the
 * code in its context.
 */
function useTargets(app: ReturnType<typeof useApp>, pane: Pane | null): Targets {
  return useMemo(() => {
    const repoId = pane && pane.kind === 'browser' ? pane.repoId : null
    // A pane whose shell has exited still has an xterm session holding its
    // scrollback, and pasting into it would go nowhere while the dialog said
    // it had worked.
    const live = app.panes.filter(
      (p): p is TerminalPane =>
        p.kind === 'terminal' && Boolean(getSession(p.id)) && !runtimeFor(app, p.id).exited
    )

    const score = (p: TerminalPane): number => {
      const claude = claudeIn(app, p)
      let value = 0
      // A confirmed session outranks one that is merely configured for it.
      if (claude.running) value += 8
      else if (claude.invocation.isClaude) value += 2
      if (repoId && p.repoId === repoId) value += 4
      if (p.id === app.lastTerminalPaneId) value += 1
      return value
    }

    const ranked = [...live].sort((a, b) => score(b) - score(a))
    const options = ranked.map((p) => {
      const claude = claudeIn(app, p)
      const suffix = claude.running
        ? ` — ${describeInvocation(claude.invocation)}`
        : claude.invocation.isClaude
          ? ' — claude, not started'
          : ''
      return { id: p.id, label: `${paneLabel(app, p)}${suffix}` }
    })

    const repo = repoById(app, repoId)
    const fallback = ranked[0]
    const cwd = repo?.path ?? fallback?.cwd ?? app.repos[0]?.path ?? null

    // The command to start a new one with: the repository's own, when that is
    // already a claude command, so a project that pins a model keeps it.
    const repoInvocation = parseClaudeInvocation(repo?.startupCommand)

    return {
      options,
      preferred: ranked[0]?.id ?? 'new',
      newSessionCwd: cwd ? { cwd, repoId: repo?.id ?? fallback?.repoId ?? null } : null,
      newSession: repoInvocation.isClaude ? repoInvocation : parseClaudeInvocation('claude')
    }
  }, [app, pane])
}

/**
 * Whether the program in this pane has told the terminal it will read a paste
 * as one thing.
 *
 * This is the decisive test, and it is better than anything GRID can infer
 * about what was launched: bracketed paste is a mode the *running program*
 * turns on, so it is the CLI itself saying a multi-line paste will arrive as a
 * message rather than as a stack of commands on a prompt. A shell that has
 * come back after the CLI exited turns it off again, and cmd.exe never turns
 * it on at all — both of which are exactly when a capture must go to a file
 * instead.
 */
function acceptsBracketedPaste(paneId: string): boolean {
  return getSession(paneId)?.term.modes.bracketedPasteMode ?? false
}

type SessionClaude = {
  /** GRID pressed Enter on a claude command here, and the shell is still up. */
  running: boolean
  invocation: ReturnType<typeof parseClaudeInvocation>
}

/**
 * Whether a terminal pane is actually running Claude — not whether it was
 * configured to.
 *
 * The difference is the whole safety argument for pasting a capture in whole.
 * A repository's command on open is typed into every terminal it opens, but
 * Enter is only pressed when "press Enter for me" is set, and a restored pane
 * does not replay it at all unless the user asked for that. In both of those
 * states the pane is a bare shell whose configuration says `claude`, and a
 * multi-line paste into a shell is a stack of commands on the prompt.
 *
 * So the flag GRID records when it actually pressed Enter is the one that
 * counts, and anything short of it falls through to the file path.
 */
function claudeIn(app: ReturnType<typeof useApp>, pane: Pane | null): SessionClaude {
  if (!pane || pane.kind !== 'terminal') {
    return { running: false, invocation: parseClaudeInvocation(null) }
  }

  const runtime = runtimeFor(app, pane.id)
  const ran = parseClaudeInvocation(runtime.ranStartup)
  if (ran.isClaude && !runtime.exited) return { running: true, invocation: ran }

  // Worth showing so the dialog can say what the pane is set up for; never
  // worth trusting with a paste.
  const repo = repoById(app, pane.repoId)
  return {
    running: false,
    invocation: parseClaudeInvocation(pane.startupCommand ?? repo?.startupCommand)
  }
}

function describeInvocation(invocation: ReturnType<typeof parseClaudeInvocation>): string {
  const bits = [invocation.model ?? 'default model', invocation.effort ?? 'default effort']
  return bits.join(' · ')
}
