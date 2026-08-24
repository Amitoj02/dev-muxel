/**
 * A sticky note that tiles, resizes and persists exactly like a terminal.
 *
 * The point of it is drafting a prompt before pasting it into a CLI, so the
 * pane carries a "send" action that types the note into the last focused
 * terminal *without* a trailing newline — you get to read it back and press
 * Enter yourself rather than having the app run something on your behalf.
 */

import { useEffect, useRef, useState } from 'react'
import type { Note } from '../../../shared/types'
import { IconSend } from './Icons'
import { actions } from '../state/hooks'

export type NotePaneProps = {
  note: Note | null
  focused: boolean
  onSend: (text: string) => boolean
}

const SAVE_DEBOUNCE_MS = 350

export function NotePane({ note, focused, onSend }: NotePaneProps): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  const timer = useRef<number | null>(null)
  const [dirty, setDirty] = useState(false)

  /** Write whatever is in the box right now, cancelling any pending save. */
  const save = (): void => {
    if (timer.current) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    const el = ref.current
    if (!el || !note) return
    actions.updateNote(note.id, { body: el.value })
    setDirty(false)
  }

  // Focusing the pane focuses the caret; the whole point of a note pane is to
  // click it and start typing.
  useEffect(() => {
    if (focused) ref.current?.focus()
  }, [focused])

  // On unmount, flush rather than cancel. Closing a pane 200ms after the last
  // keystroke would otherwise silently drop it — the one thing a note must
  // never do. The element is captured on mount: it is the same node for the
  // life of the component, and its `value` is still readable once detached.
  const noteId = note?.id
  useEffect(() => {
    const el = ref.current
    const pending = timer
    return () => {
      if (pending.current) {
        window.clearTimeout(pending.current)
        pending.current = null
      }
      if (el && noteId) actions.updateNote(noteId, { body: el.value })
    }
  }, [noteId])

  if (!note) {
    return <div className="pane-dead">this note was deleted</div>
  }

  const onChange = (): void => {
    setDirty(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(save, SAVE_DEBOUNCE_MS)
  }

  // Tab indents instead of leaving the field: this is a scratchpad for code
  // and prompts, not a form.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      const el = e.currentTarget
      const { selectionStart: start, selectionEnd: end, value } = el
      el.value = `${value.slice(0, start)}  ${value.slice(end)}`
      el.selectionStart = el.selectionEnd = start + 2
      // Assigning `.value` directly bypasses React's value tracker, so its
      // onChange never fires and the indent would never be persisted.
      onChange()
      return
    }
    // Ctrl+Enter sends without leaving the keyboard.
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      handleSend(e.currentTarget.value)
    }
  }

  const handleSend = (text: string): void => {
    if (!text.trim()) return
    const ok = onSend(text)
    actions.toast(
      ok ? 'Pasted into the focused terminal — press Enter to run it' : 'No terminal to paste into',
      ok ? 'info' : 'error'
    )
  }

  return (
    <>
      <textarea
        ref={ref}
        className="note-body"
        defaultValue={note.body}
        spellCheck={false}
        placeholder={'Draft here, then send it into a terminal.\nCtrl+Enter sends without a newline.'}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={save}
      />
      <NoteFooter onSend={() => handleSend(ref.current?.value ?? '')} dirty={dirty} />
    </>
  )
}

function NoteFooter({ dirty, onSend }: { dirty: boolean; onSend: () => void }): React.JSX.Element {
  return (
    <div
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 8px 0 14px',
        height: 26,
        borderTop: '1px solid var(--note-line)',
        background: 'var(--note-header)'
      }}
    >
      <span className="note-status">
        {dirty ? 'unsaved' : 'Ctrl+Enter pastes this into the focused terminal'}
      </span>
      <span style={{ flex: 1 }} />
      <button className="pane-btn" onClick={onSend} title="Paste into the focused terminal — Ctrl+Enter">
        <IconSend />
      </button>
    </div>
  )
}

export function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
