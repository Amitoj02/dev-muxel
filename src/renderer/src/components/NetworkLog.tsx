/**
 * The network log drawer inside a browser pane.
 *
 * Deliberately not a second DevTools. It answers one question — "what did this
 * page ask for, and what came back" — and then gets the answer out of the app
 * and into a Claude session, which is the whole reason the pane exists. So the
 * row is terse, the detail is complete, and the only verb is send.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  EMPTY_FILTER,
  isFailure,
  matchesFilter,
  type NetEntry,
  type NetFilter
} from '../../../shared/browser'
import { prettyBytes, prettyMs, redactUrl } from '../../../shared/claude'
import { clearNet, getView, type PaneNetLog } from '../browser/netlog'
import { actions } from '../state/hooks'
import { IconClose, IconSearch, IconSend, IconTrash } from './Icons'

export type NetworkLogProps = {
  paneId: string
  log: PaneNetLog
  onClose: () => void
}

type BodyState = { loading: boolean; text: string | null; base64: boolean; error: string | null }

export function NetworkLog({ paneId, log, onClose }: NetworkLogProps): React.JSX.Element {
  const [filter, setFilter] = useState<NetFilter>(EMPTY_FILTER)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [bodies, setBodies] = useState<Record<string, BodyState>>({})
  const asked = useRef<Set<string>>(new Set())

  // Newest first: the request you are looking for is nearly always the one
  // that just happened, and scrolling to find it is the wrong default.
  const rows = useMemo(
    () => log.entries.filter((e) => matchesFilter(e, filter)).reverse(),
    [log.entries, filter]
  )

  const toggle = useCallback((uid: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }, [])

  const loadBody = useCallback(
    (entry: NetEntry) => {
      if (asked.current.has(entry.uid)) return
      asked.current.add(entry.uid)
      setBodies((b) => ({
        ...b,
        [entry.uid]: { loading: true, text: null, base64: false, error: null }
      }))
      void window.devlobby.browser.body(paneId, entry.uid).then((result) => {
        setBodies((b) => ({
          ...b,
          [entry.uid]: {
            loading: false,
            text: result.ok ? (result.text ?? '') : null,
            base64: Boolean(result.base64),
            error: result.ok ? null : (result.error ?? 'no body')
          }
        }))
      })
    },
    [paneId]
  )

  useEffect(() => {
    const entry = rows.find((e) => e.uid === expanded)
    if (entry) loadBody(entry)
  }, [expanded, rows, loadBody])

  const send = (uids: string[]): void => {
    if (uids.length === 0) return
    actions.showOverlay({ kind: 'send-to-claude', paneId, uids })
  }

  const clear = (): void => {
    void window.devlobby.browser.clear(paneId)
    clearNet(paneId)
    setSelected(new Set())
    setExpanded(null)
    asked.current.clear()
    setBodies({})
  }

  const failures = log.entries.filter(isFailure).length

  return (
    <div className="netlog">
      <div className="netlog__bar">
        <IconSearch size={11} />
        <input
          className="netlog__filter"
          value={filter.text}
          spellCheck={false}
          placeholder="filter by url, method or status"
          onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))}
        />
        <button
          className="netlog__toggle"
          data-on={filter.failedOnly}
          onClick={() => setFilter((f) => ({ ...f, failedOnly: !f.failedOnly }))}
          title="Only what failed, or came back 4xx or 5xx"
        >
          failed{failures > 0 ? ` ${failures}` : ''}
        </button>

        <span className="netlog__count">
          {rows.length}
          {rows.length !== log.entries.length ? ` of ${log.entries.length}` : ''}
        </span>

        <span className="pane-header__gap" />

        <button
          className="netlog__send"
          disabled={selected.size === 0}
          onClick={() => send([...selected])}
          title="Send the ticked requests to a Claude session"
        >
          <IconSend size={11} /> Claude {selected.size > 0 ? `(${selected.size})` : ''}
        </button>
        <button className="pane-btn" onClick={clear} title="Clear the log">
          <IconTrash size={11} />
        </button>
        <button className="pane-btn" onClick={onClose} title="Hide the network log">
          <IconClose size={10} />
        </button>
      </div>

      {!log.attached && (
        <div className="netlog__notice">
          <span>
            {log.reason
              ? `Not capturing — ${log.reason}`
              : 'Not capturing. Opening DevTools on this page takes the debugger.'}
          </span>
          <button
            className="btn btn--ghost"
            onClick={() => {
              const el = getView(paneId)
              if (!el) return
              void window.devlobby.browser.attach(paneId, el.getWebContentsId()).then((r) => {
                if (!r.ok) actions.toast(r.error ?? 'Could not reattach', 'error')
              })
            }}
          >
            Reattach
          </button>
        </div>
      )}

      <div className="netlog__list">
        {rows.length === 0 && (
          <p className="netlog__empty">
            {log.entries.length === 0
              ? 'Nothing yet. Reload the page and every request it makes lands here.'
              : 'Nothing matches that filter.'}
          </p>
        )}

        {rows.map((entry) => (
          <div key={entry.uid} className="netlog__item">
            <div
              className="netlog__row"
              data-failed={isFailure(entry)}
              data-open={expanded === entry.uid}
            >
              <input
                type="checkbox"
                className="netlog__pick"
                checked={selected.has(entry.uid)}
                onChange={() => toggle(entry.uid)}
                onClick={(e) => e.stopPropagation()}
                title="Include this one when sending to Claude"
              />
              <button
                className="netlog__open"
                onClick={() => setExpanded((uid) => (uid === entry.uid ? null : entry.uid))}
              >
                <span className="netlog__status" data-phase={entry.phase}>
                  {entry.phase === 'failed'
                    ? 'ERR'
                    : entry.status !== null
                      ? entry.status
                      : '···'}
                </span>
                <span className="netlog__method">{entry.method}</span>
                <span className="netlog__name" title={entry.url}>
                  {entry.name || entry.url}
                </span>
                <span className="netlog__kind">{entry.kind}</span>
                <span className="netlog__size">
                  {entry.fromCache ? 'cache' : entry.bytes !== null ? prettyBytes(entry.bytes) : ''}
                </span>
                <span className="netlog__time">
                  {entry.durationMs !== null ? prettyMs(entry.durationMs) : ''}
                </span>
              </button>
            </div>

            {expanded === entry.uid && (
              <NetDetail
                entry={entry}
                body={bodies[entry.uid]}
                onSend={() => send([entry.uid])}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function NetDetail({
  entry,
  body,
  onSend
}: {
  entry: NetEntry
  body: BodyState | undefined
  onSend: () => void
}): React.JSX.Element {
  // Credentials are hidden here for the same reason they are hidden on the way
  // to Claude: this pane is the thing people screen-share.
  const url = redactUrl(entry.url, false)

  return (
    <div className="netdetail">
      <div className="netdetail__head">
        <span className="netdetail__url" title={entry.url}>
          {url.value}
        </span>
        <button className="btn btn--ghost" onClick={onSend}>
          <IconSend size={11} /> Send to Claude
        </button>
      </div>

      <p className="netdetail__facts">
        {[
          entry.resourceType.toLowerCase(),
          entry.mimeType,
          entry.durationMs !== null ? prettyMs(entry.durationMs) : null,
          entry.bytes !== null ? prettyBytes(entry.bytes) : null,
          entry.remoteAddress,
          entry.initiator ? `initiated by ${entry.initiator}` : null,
          entry.error
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      <Headers title="request headers" headers={entry.requestHeaders} />
      {entry.postData && <Block title="request body" text={entry.postData} />}
      {!entry.postData && entry.postDataTruncated && (
        <p className="netdetail__note">request body: too large for the debugger buffer</p>
      )}
      <Headers title="response headers" headers={entry.responseHeaders} />

      {body?.loading && <p className="netdetail__note">reading the response body…</p>}
      {body?.error && <p className="netdetail__note">no response body — {body.error}</p>}
      {body?.base64 && <p className="netdetail__note">binary response, not shown</p>}
      {body?.text && !body.base64 && <Block title="response body" text={body.text} />}
    </div>
  )
}

function Headers({
  title,
  headers
}: {
  title: string
  headers: Record<string, string>
}): React.JSX.Element | null {
  const rows = Object.entries(headers)
  if (rows.length === 0) return null
  return (
    <div className="netdetail__section">
      <span className="netdetail__title">{title}</span>
      <dl className="netdetail__headers">
        {rows.sort((a, b) => a[0].localeCompare(b[0])).map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** Bodies are shown whole here; the truncation happens on the way to Claude. */
function Block({ title, text }: { title: string; text: string }): React.JSX.Element {
  return (
    <div className="netdetail__section">
      <span className="netdetail__title">{title}</span>
      <pre className="netdetail__body">{pretty(text)}</pre>
    </div>
  )
}

/** JSON is unreadable on one line, and a dev server sends nothing else. */
function pretty(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return text
  }
}
