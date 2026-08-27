/**
 * Every note, including the ones whose pane you closed.
 *
 * Notes persist by design — the point of the feature is drafting something and
 * not losing it. But a note whose pane is gone has nowhere to be reached from,
 * so without this list "persisted" and "lost" look identical from the outside.
 */

import { useState } from 'react'
import { IconClose, IconPlus, IconTrash } from './Icons'
import { Overlay } from './Overlay'
import { ago } from './NotePane'
import { actions, useApp } from '../state/hooks'

export function NotesPanel(): React.JSX.Element {
  const app = useApp()
  const [confirming, setConfirming] = useState<string | null>(null)

  const onScreen = new Set(
    app.panes.filter((p) => p.kind === 'note').map((p) => (p.kind === 'note' ? p.noteId : ''))
  )

  // Most recently touched first — a scratchpad is a stack, not a filing cabinet.
  const notes = [...app.notes].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <Overlay onClose={() => actions.closeOverlay()}>
      <div className="dialog">
        <div className="dialog__head">
          <h2 className="dialog__title">NOTES</h2>
          <span className="dialog__sub">
            {app.notes.length} kept · {onScreen.size} on screen
          </span>
          <button className="dialog__close" onClick={() => actions.closeOverlay()} aria-label="Close">
            <IconClose size={12} />
          </button>
        </div>

        <div className="dialog__body">
          {notes.length === 0 && (
            <p
              style={{
                padding: '34px 16px',
                margin: 0,
                font: '400 11.5px/1.75 var(--font-mono)',
                color: 'var(--ink-faint)',
                maxWidth: '56ch'
              }}
            >
              No notes yet. A note tiles and resizes like a terminal, and pastes itself into the
              focused one when you are ready.
            </p>
          )}

          {notes.map((note) => {
            const open = onScreen.has(note.id)
            const preview = note.body.trim().split('\n')[0].slice(0, 90)
            return (
              <div
                key={note.id}
                className="repo-row"
                data-state={open ? 'clean' : 'missing'}
                style={{ borderLeftColor: open ? 'var(--amber)' : 'var(--line-strong)', opacity: 1 }}
              >
                <div className="repo-row__main">
                  <input
                    className="repo-row__name"
                    value={note.title}
                    aria-label="Note title"
                    onChange={(e) => actions.updateNote(note.id, { title: e.target.value })}
                    style={{
                      background: 'none',
                      border: 0,
                      outline: 'none',
                      padding: 0,
                      width: '100%',
                      fontFamily: 'var(--font-ui)'
                    }}
                  />
                  <span
                    style={{
                      font: '400 10.5px/1.4 var(--font-mono)',
                      color: 'var(--ink-faint)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {preview || 'empty'}
                  </span>
                </div>

                <div className="repo-row__git">
                  <span>{ago(note.updatedAt)}</span>
                  {open && <span style={{ color: 'var(--amber)' }}>on screen</span>}
                </div>

                <div className="repo-row__actions">
                  <button
                    className="icon-btn"
                    title={open ? 'Focus this note' : 'Open this note in a pane'}
                    onClick={() => {
                      actions.openNote(note.id)
                      actions.closeOverlay()
                    }}
                  >
                    <IconPlus size={12} />
                  </button>
                  {/* Keyed, so arming the delete mounts a second button rather
                      than relabelling the bin in place. It can then take focus
                      as it appears, which is what makes Enter confirm it and a
                      click anywhere else cancel it. */}
                  {confirming === note.id ? (
                    <button
                      key="confirm"
                      autoFocus
                      className="btn btn--danger"
                      style={{ padding: '5px 8px' }}
                      onClick={() => {
                        // Close its pane first, or the pane renders "deleted".
                        const pane = app.panes.find(
                          (p) => p.kind === 'note' && p.noteId === note.id
                        )
                        if (pane) actions.closePane(pane.id)
                        actions.deleteNote(note.id)
                        setConfirming(null)
                      }}
                      onBlur={() => setConfirming(null)}
                    >
                      Really delete
                    </button>
                  ) : (
                    <button
                      key="arm"
                      className="icon-btn icon-btn--danger"
                      title="Delete this note"
                      onClick={() => setConfirming(note.id)}
                    >
                      <IconTrash size={12} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="dialog__foot">
          <button
            className="btn btn--primary"
            onClick={() => {
              actions.addNote()
              actions.closeOverlay()
            }}
          >
            <IconPlus size={10} /> New note
          </button>
          <span className="dialog__spacer" />
          <button className="btn btn--ghost" onClick={() => actions.closeOverlay()}>
            Done
          </button>
        </div>
      </div>
    </Overlay>
  )
}
