/**
 * Marking a page up.
 *
 * Point at something, say what is wrong with it, carry on. The comments pile
 * up in the pane behind a badge rather than going anywhere, because the
 * session that will act on them does not exist yet — you write them while you
 * are looking at the page, and a Claude session comes and collects the lot
 * when you run /grid-browser in one and press send.
 *
 * That is the whole reason this is not the send dialog the network log uses:
 * there is nothing to decide at the moment of writing, so there is nothing to
 * put in a dialog. A box over the page, and a list behind a number.
 */

import { useEffect, useRef, useState } from 'react'
import type { PageComment, PickedElement, ViewportPreset } from '../../../shared/browser'
import { rememberBatch, removeComment, updateComment } from '../browser/netlog'
import { actions } from '../state/hooks'
import { IconClose, IconPick, IconSend, IconTrash } from './Icons'

/** Where the comment box sits, given where the element is on screen. */
function anchorFor(
  element: PickedElement,
  preset: ViewportPreset,
  scale: number,
  stage: { width: number; height: number }
): { left: number; top: number } {
  // The device frame is centred in the stage; a desktop preset fills it.
  const frameLeft = preset.width ? Math.max(0, (stage.width - preset.width * scale) / 2) : 0
  const frameTop = preset.height ? Math.max(0, (stage.height - preset.height * scale) / 2) : 0

  const left = frameLeft + element.rect.x * scale
  const below = frameTop + (element.rect.y + element.rect.height) * scale + 8

  // Kept inside the pane whatever the page did: an element half off screen
  // must not take the box with it.
  const width = 320
  return {
    left: Math.max(8, Math.min(left, Math.max(8, stage.width - width - 8))),
    top: Math.max(8, Math.min(below, Math.max(8, stage.height - 140)))
  }
}

export function CommentPopover({
  element,
  preset,
  scale,
  stage,
  onSave,
  onCancel
}: {
  element: PickedElement
  preset: ViewportPreset
  scale: number
  stage: { width: number; height: number }
  onSave: (text: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState('')

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const save = (): void => {
    const said = text.trim()
    if (!said) return
    onSave(said)
  }

  return (
    <div className="comment-pop" style={anchorFor(element, preset, scale, stage)}>
      <div className="comment-pop__head">
        <IconPick size={10} />
        <span className="comment-pop__what" title={element.selector}>
          {element.selector || element.tag}
        </span>
        <button className="pane-btn" onClick={onCancel} title="Leave it — Esc">
          <IconClose size={10} />
        </button>
      </div>

      <textarea
        ref={ref}
        className="comment-pop__text"
        value={text}
        spellCheck={false}
        placeholder="What is wrong with this?"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter saves, because this is one line of thought and not a
          // document; Shift+Enter is there when it turns out not to be.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            save()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      />

      <div className="comment-pop__foot">
        <span className="field__hint">Enter adds it · Esc drops it</span>
        <span className="dialog__spacer" />
        <button className="btn btn--primary" onClick={save} disabled={!text.trim()}>
          Add
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

export function CommentsPanel({
  paneId,
  comments,
  waiting,
  picking,
  onTogglePicker,
  onNote,
  onSend,
  onClose
}: {
  paneId: string
  comments: PageComment[]
  /** A session is holding the line for these right now. */
  waiting: boolean
  /** The element selector is on and stays on until it is turned off. */
  picking: boolean
  onTogglePicker: () => void
  onNote: (text: string) => void
  onSend: () => void
  onClose: () => void
}): React.JSX.Element {
  const [note, setNote] = useState('')

  const addNote = (): void => {
    const said = note.trim()
    if (!said) return
    onNote(said)
    setNote('')
  }

  return (
    <div className="netlog">
      <div className="netlog__bar">
        <span className="netlog__count">
          {comments.length} comment{comments.length === 1 ? '' : 's'}
        </span>
        <button
          className="netlog__toggle"
          data-on={picking}
          onClick={onTogglePicker}
          title={
            picking
              ? 'Stop pointing — it stays on until you say otherwise'
              : 'Point at things in the page, one after another'
          }
        >
          <IconPick size={10} /> {picking ? 'pointing — click to stop' : 'point at something'}
        </button>

        <span className="pane-header__gap" />

        <button
          className="netlog__send"
          disabled={comments.length === 0}
          onClick={onSend}
          title={
            waiting
              ? 'A Claude session is waiting for these'
              : 'Run /grid-browser in a Claude session first'
          }
          data-armed={waiting}
        >
          <IconSend size={11} /> Send{waiting ? ' — a session is waiting' : ''}
        </button>
        <button className="pane-btn" onClick={onClose} title="Hide the comments">
          <IconClose size={10} />
        </button>
      </div>

      {/* Not everything worth saying is about one element. */}
      <div className="comment-note">
        <input
          className="comment-note__input"
          value={note}
          spellCheck={false}
          placeholder="A note about the page as a whole…"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            addNote()
          }}
        />
        <button className="btn" onClick={addNote} disabled={!note.trim()}>
          Add
        </button>
      </div>

      <div className="netlog__list">
        {comments.length === 0 && (
          <p className="netlog__empty">
            Nothing yet. Point at something in the page and say what is wrong with it, or write a
            note about the page as a whole. They gather here until a Claude session asks for them.
          </p>
        )}

        {comments.map((comment, i) => (
          <div key={comment.id} className="comment-row">
            <span className="comment-row__n">{i + 1}</span>
            <div className="comment-row__body">
              <span className="comment-row__where">
                <span
                  className="comment-row__what"
                  data-note={comment.element === null}
                  title={comment.element?.selector ?? 'about the page as a whole'}
                >
                  {comment.element
                    ? comment.element.selector || comment.element.tag
                    : 'the page as a whole'}
                </span>
                <span className="comment-row__viewport">
                  {comment.viewport}
                  {comment.viewportSize
                    ? ` ${comment.viewportSize.width}×${comment.viewportSize.height}`
                    : ''}
                </span>
              </span>
              <textarea
                className="comment-row__text"
                value={comment.text}
                spellCheck={false}
                rows={2}
                onChange={(e) => updateComment(paneId, comment.id, e.target.value)}
              />
            </div>
            <button
              className="icon-btn icon-btn--danger"
              onClick={() => removeComment(paneId, comment.id)}
              title="Drop this comment"
            >
              <IconTrash size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Hand a pane's comments over.
 *
 * The batch is remembered before it goes, because the acknowledgement names
 * only the batch — and anything written while the session was reading has to
 * survive the clear that follows.
 */
export function sendComments(
  paneId: string,
  label: string,
  url: string,
  comments: PageComment[]
): void {
  if (comments.length === 0) return

  const batch = `batch_${Date.now().toString(36)}`
  rememberBatch(
    batch,
    paneId,
    comments.map((c) => c.id)
  )

  void window.grid.browser.sendComments({ batch, pane: label, url, comments }).then(({ taken }) => {
    if (taken) {
      actions.toast(`Sent ${comments.length} comment${comments.length === 1 ? '' : 's'}`)
      return
    }
    actions.toast(
      'No Claude session is waiting — run /grid-browser in one, then send again',
      'error'
    )
  })
}
