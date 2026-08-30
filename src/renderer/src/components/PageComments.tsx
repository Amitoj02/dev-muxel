/**
 * Marking a page up.
 *
 * Point at something, say what is wrong with it, carry on. The comments pile
 * up in the pane behind a badge rather than going anywhere, because the
 * session that will act on them does not exist yet — you write them while you
 * are looking at the page, and a Claude session comes and collects the lot
 * when you run /devlobby-browser in one and press send.
 *
 * That is the whole reason this is not the send dialog the network log uses:
 * there is nothing to decide at the moment of writing, so there is nothing to
 * put in a dialog. A box over the page, and a list behind a number.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PageComment, PickedElement, ViewportPreset } from '../../../shared/browser'
import type { SkillStatus } from '../../../shared/types'
import { rememberBatch, removeComment, updateComment } from '../browser/netlog'
import { actions } from '../state/hooks'
import { IconClose, IconPick, IconPlus, IconSend, IconTrash } from './Icons'

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
  const skill = useSkill()

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
        {/* The one filled button in a bar of hairlines: it is what the panel is
            for, and it was being missed as another dim outline among several.
            The label is its own element rather than a bare text child, so the
            icon and the words are two flex items that cannot come apart. */}
        <button
          className="netlog__select"
          data-on={picking}
          onClick={onTogglePicker}
          title={
            picking
              ? 'Stop selecting — it stays on until you say otherwise'
              : 'Select an element in the page, then say what is wrong with it'
          }
        >
          <IconPick size={12} />
          <span>{picking ? 'Stop Selecting' : 'Select Element'}</span>
        </button>

        {/*
          Only on screen when there is something to do about it. Sending is
          half a handshake — the other half is a skill in the user's home
          directory, and until this build wrote it there is no way to tell
          whether the copy they have still matches this DevLobby.
        */}
        {skill.status && !skill.status.current && (
          <button
            className="netlog__skill"
            disabled={skill.busy}
            onClick={skill.install}
            title={skillTitle(skill.status)}
          >
            <IconPlus size={10} />{' '}
            {skill.busy
              ? 'writing…'
              : skill.status.installed
                ? 'update the skill'
                : 'add the skill'}
          </button>
        )}

        <span className="pane-header__gap" />

        <button
          className="netlog__send"
          disabled={comments.length === 0}
          onClick={onSend}
          title={
            waiting
              ? 'A Claude session is waiting for these'
              : 'Run /devlobby-browser in a Claude session first'
          }
          data-armed={waiting}
        >
          <IconSend size={11} /> Send{waiting ? ' — a session is waiting' : ''}
        </button>
        <button
          className="pane-btn"
          onClick={onClose}
          title={picking ? 'Stop selecting and hide the comments' : 'Hide the comments'}
        >
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
            Nothing yet. Press <strong>Select Element</strong>, click something in the page and say
            what is wrong with it — or hold <strong>Ctrl</strong> over the page and click, which is
            the same thing for one comment rather than a run of them. A note about the page as a
            whole works too. They gather here until a Claude session asks for them.
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
 * Names any pre-rename skill still on disk.
 *
 * There can be two — `/devmuxel-browser` and `/grid-browser`, from someone who
 * ran both and installed the skill from each — so this agrees with however many
 * there are rather than assuming one.
 */
function staleSkills(dirs: string[]): string {
  if (dirs.length === 0) return ''
  return dirs.length > 1
    ? ` The pre-rename skills at ${dirs.join(' and ')} are not removed — delete them yourself.`
    : ` The pre-rename skill at ${dirs[0]} is not removed — delete it yourself.`
}

/**
 * What the install button says it will do, which depends on what is already
 * there — including a skill left behind by a rename, since that is the one case
 * where installing leaves the user with more slash commands than work.
 */
function skillTitle(status: SkillStatus): string {
  const stale = staleSkills(status.legacyDirs)
  return status.installed
    ? `Your /devlobby-browser skill was not written by this DevLobby. Replaces ${status.dir}.${stale}`
    : `Write /devlobby-browser to ${status.dir}, so a Claude session can come and collect these.${stale}`
}

/**
 * The `/devlobby-browser` skill, and the one button that installs it.
 *
 * Asked for when the comments open rather than at startup, because this is the
 * only place the answer is worth anything — and because "is there a file in
 * your home directory" is not a question to ask on every launch.
 */
function useSkill(): { status: SkillStatus | null; busy: boolean; install: () => void } {
  const [status, setStatus] = useState<SkillStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    void window.devlobby.skill.status().then((s) => {
      if (alive.current) setStatus(s)
    })
    return () => {
      alive.current = false
    }
  }, [])

  const install = useCallback(() => {
    setBusy(true)
    void window.devlobby.skill
      .install()
      .then(async (result) => {
        if (!result.ok) {
          actions.toast(`Could not write the skill — ${result.error}`, 'error')
          return
        }
        const next = await window.devlobby.skill.status()
        if (alive.current) setStatus(next)
        actions.toast(
          next.legacyDirs.length > 0
            ? `Skill installed — run /devlobby-browser.${staleSkills(next.legacyDirs)}`
            : 'Skill installed — run /devlobby-browser in a Claude session'
        )
      })
      .finally(() => {
        if (alive.current) setBusy(false)
      })
  }, [])

  return { status, busy, install }
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

  void window.devlobby.browser.sendComments({ batch, pane: label, url, comments }).then(({ taken }) => {
    if (taken) {
      actions.toast(`Sent ${comments.length} comment${comments.length === 1 ? '' : 's'}`)
      return
    }
    actions.toast(
      'No Claude session is waiting — run /devlobby-browser in one, then send again',
      'error'
    )
  })
}
