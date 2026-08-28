/**
 * One cell of the grid: the bordered box, its header, and whichever body the
 * pane kind calls for.
 *
 * The rect comes from the layout engine and is applied as absolute geometry.
 * `data-animating` is only set while a zoom is in play — a splitter drag must
 * track the pointer exactly, and a CSS transition on width would make it lag.
 */

import { memo, useCallback } from 'react'
import type { Pane } from '../../../shared/types'
import type { Rect } from '../../../shared/layout'
import { accentOf } from '../lib/colour'
import {
  actions,
  gitFor,
  noteById,
  paneLabel,
  repoById,
  runtimeFor,
  useApp
} from '../state/hooks'
import { PaneHeader } from './PaneHeader'
import { TerminalPane } from './TerminalPane'
import { BrowserPane } from './BrowserPane'
import { NotePane, ago } from './NotePane'
import { getSession } from '../terminal/session'
import { useTick } from '../lib/useTick'

export type PaneShellProps = {
  pane: Pane
  rect: Rect
  zoomed: boolean
  animating: boolean
  onDragStart: (paneId: string, e: React.PointerEvent) => void
}

export const PaneShell = memo(function PaneShell({
  pane,
  rect,
  zoomed,
  animating,
  onDragStart
}: PaneShellProps): React.JSX.Element {
  const app = useApp()
  const focused = app.focusedPaneId === pane.id
  const runtime = runtimeFor(app, pane.id)
  const git = gitFor(app, pane)
  // A browser pane wears its repository's colour too — it is the same project,
  // and picking it out of a wall of panes is the same problem.
  const repo = pane.kind === 'note' ? null : repoById(app, pane.repoId)
  const note = pane.kind === 'note' ? noteById(app, pane.noteId) : null
  const accent = accentOf(repo?.color)

  // Keep the note header's relative timestamp honest.
  useTick(10_000, pane.kind === 'note')

  const focus = useCallback(() => actions.focusPane(pane.id), [pane.id])

  const close = useCallback(() => {
    if (
      pane.kind === 'terminal' &&
      app.settings.confirmClose &&
      !runtime.exited &&
      runtime.pid !== null
    ) {
      actions.showOverlay({ kind: 'confirm-close', paneId: pane.id })
      return
    }
    actions.closePane(pane.id)
  }, [pane.id, pane.kind, app.settings.confirmClose, runtime.exited, runtime.pid])

  /**
   * Paste a note's text into whichever terminal was focused last. No newline
   * is appended on purpose — you read it back and press Enter yourself.
   */
  const sendToTerminal = useCallback(
    (text: string): boolean => {
      // The terminal you were last *in*, not the one most recently opened —
      // you click the note, type, and send it back where you came from.
      const preferred = app.lastTerminalPaneId
      const target =
        (preferred && getSession(preferred) ? app.panes.find((p) => p.id === preferred) : null) ??
        [...app.panes].reverse().find((p) => p.kind === 'terminal' && getSession(p.id))
      if (!target) return false
      window.grid.pty.write(target.id, text)
      actions.focusPane(target.id)
      getSession(target.id)?.focus()
      return true
    },
    [app.panes, app.lastTerminalPaneId]
  )

  return (
    <section
      className={paneClass(pane)}
      style={paneStyle(rect, accent)}
      data-focused={focused}
      data-accent={accent ? 'true' : undefined}
      data-zoomed={zoomed}
      data-animating={animating}
      data-attention={runtime.attention}
      data-dragging={app.dragging === pane.id}
      onPointerDownCapture={focus}
    >
      <PaneHeader
        pane={pane}
        label={paneLabel(app, pane)}
        git={git}
        runtime={runtime}
        zoomed={zoomed}
        noteStatus={note ? `saved ${ago(note.updatedAt)}` : undefined}
        onFocus={focus}
        onZoom={() => actions.toggleZoom(pane.id)}
        onClose={close}
        onAnswer={() => {
          actions.focusPane(pane.id)
          getSession(pane.id)?.focus()
        }}
        onSplit={pane.kind === 'note' ? undefined : () => actions.splitFrom(pane.id, 'right')}
        onOpenEditor={
          pane.kind === 'terminal'
            ? () => {
                void window.grid.open.editor(pane.cwd).then((r) => {
                  if (!r.ok) actions.toast(r.error ?? 'Could not open VS Code', 'error')
                })
              }
            : undefined
        }
        onDragStart={(e) => onDragStart(pane.id, e)}
      />

      {pane.kind === 'terminal' && <TerminalPane pane={pane} repo={repo} focused={focused} />}
      {pane.kind === 'note' && (
        <NotePane note={note} focused={focused} onSend={sendToTerminal} />
      )}
      {pane.kind === 'browser' && <BrowserPane pane={pane} />}
    </section>
  )
})

/** Notes are the warm variant of the chassis; the browser is the cool one. */
function paneClass(pane: Pane): string {
  if (pane.kind === 'note') return 'pane pane--note'
  if (pane.kind === 'browser') return 'pane pane--browser'
  return 'pane'
}

/**
 * Geometry, plus the repository's accent as a custom property for the header
 * to pick up. The colour is validated on the way in: it ends up in an inline
 * style, and the state file it comes from is editable by hand.
 */
function paneStyle(rect: Rect, accent: string | null): React.CSSProperties {
  const geometry = { left: rect.x, top: rect.y, width: rect.width, height: rect.height }
  return accent ? ({ ...geometry, '--repo-accent': accent } as React.CSSProperties) : geometry
}
