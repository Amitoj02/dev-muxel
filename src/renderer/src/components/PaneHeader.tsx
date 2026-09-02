/**
 * Pane header — layout 1d from the handoff: one dense 30px line carrying the
 * repo name, the branch, the working-tree counts and the pane's actions.
 *
 * It is also the drag handle. Pointer capture is used rather than HTML5 drag
 * and drop so the drop zones can be drawn in the same coordinate space as the
 * grid and so a drag never leaves a ghost image behind.
 */

import { useRef } from 'react'
import type { BrowserPane as BrowserPaneModel, GitState, Pane } from '../../../shared/types'
import { hostLabel, viewportOf } from '../../../shared/browser'
import { groupLabel, groupLabelIsBranch, isGroup } from '../../../shared/git'
import type { PaneRuntime } from '../state/hooks'
import { useHoverCard } from '../lib/useHoverCard'
import {
  IconBranch,
  IconClose,
  IconFolder,
  IconGlobe,
  IconPlus,
  IconUnzoom,
  IconZoom
} from './Icons'
import { RepoSummary } from './RepoSummary'

export type PaneHeaderProps = {
  pane: Pane
  label: string
  git: GitState | null
  runtime: PaneRuntime
  zoomed: boolean
  noteStatus?: string
  onFocus: () => void
  onZoom: () => void
  onClose: () => void
  onSplit?: () => void
  onOpenEditor?: () => void
  onDragStart: (e: React.PointerEvent) => void
  onAnswer?: () => void
}

/** Spine colour: red when the pane wants you, green when the tree is clean. */
function spineState(pane: Pane, git: GitState | null, runtime: PaneRuntime): string {
  if (pane.kind === 'note') return 'note'
  if (pane.kind === 'browser') return 'browser'
  if (runtime.attention !== 'none') return 'alert'
  if (git?.isRepo && git.dirty === 0 && git.conflicted === 0) return 'clean'
  return 'idle'
}

export function PaneHeader(props: PaneHeaderProps): React.JSX.Element {
  const { pane, git, runtime, zoomed } = props
  const downAt = useRef<{ x: number; y: number } | null>(null)

  // Only start a drag once the pointer has actually travelled; otherwise every
  // click on the header would begin a drag and eat the focus click.
  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('button')) return
    downAt.current = { x: e.clientX, y: e.clientY }
    props.onFocus()
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const start = downAt.current
    if (!start) return
    if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) < 5) return
    downAt.current = null
    props.onDragStart(e)
  }

  const onPointerUp = (): void => {
    downAt.current = null
  }

  return (
    <div
      className="pane-header"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={props.onZoom}
    >
      <span className="pane-header__spine" data-state={spineState(pane, git, runtime)} />
      <span className="pane-header__name" title={paneTitleAttr(pane)}>
        {props.label}
      </span>

      {pane.kind === 'terminal' && <GitChips git={git} label={props.label} />}
      {pane.kind === 'note' && <span className="note-status">{props.noteStatus}</span>}
      {pane.kind === 'browser' && <BrowserChips pane={pane} />}

      <span className="pane-header__gap" />

      {runtime.attention !== 'none' && (
        <button className="badge-needs" onClick={props.onAnswer} title="Focus this pane">
          NEEDS YOU
        </button>
      )}

      {props.onOpenEditor && (
        <button
          className="pane-btn pane-btn--vs"
          onClick={props.onOpenEditor}
          title="Open this folder in VS Code"
        >
          VS
        </button>
      )}

      {props.onSplit && (
        <button
          className="pane-btn pane-btn--split"
          onClick={props.onSplit}
          title={
            pane.kind === 'browser'
              ? 'The same page again, beside itself'
              : 'Another terminal on this folder'
          }
        >
          <IconPlus />
        </button>
      )}

      <button
        className="pane-btn"
        onClick={props.onZoom}
        title={zoomed ? 'Back to the grid — Esc' : 'Fill the window — Ctrl+Alt+Z'}
      >
        {zoomed ? <IconUnzoom /> : <IconZoom />}
      </button>

      <button className="pane-btn pane-btn--close" onClick={props.onClose} title="Close this pane">
        <IconClose />
      </button>
    </div>
  )
}

/**
 * A browser pane's readout: where it is, and which device it is pretending to
 * be when that is not the obvious one.
 *
 * The preset goes through `viewportOf` rather than indexing the table. The
 * state file is plain JSON a user can edit, and an unrecognised viewport in it
 * would otherwise throw inside render — which, with no error boundary above
 * this, is a blank window on every launch.
 */
function BrowserChips({ pane }: { pane: BrowserPaneModel }): React.JSX.Element {
  const preset = viewportOf(pane.viewport)
  return (
    <>
      <span className="chip chip--host" title={pane.url}>
        <IconGlobe size={10} />
        {hostLabel(pane.url) || 'nothing open'}
      </span>
      {preset.id !== 'desktop' && <span className="chip chip--device">{preset.label}</span>}
    </>
  )
}

/** What hovering the pane's name tells you: where it is, in its own terms. */
function paneTitleAttr(pane: Pane): string | undefined {
  if (pane.kind === 'terminal') return pane.cwd
  if (pane.kind === 'browser') return pane.url
  return undefined
}

/**
 * The git readout. Order and wording are from the design: a dirty count as a
 * tinted chip, untracked as a neutral chip, then the ahead/behind pair.
 *
 * A folder of repositories draws the same chips off the same fields, because
 * the state published for it is already the sum of the ones inside — see
 * `shared/git.ts`. All that differs is the branch slot, which has a count to
 * put there instead of a name, and where the detail lives: a work tree explains
 * itself in a `title`, a folder needs a card to name what owes what.
 */
function GitChips({ git, label }: { git: GitState | null; label: string }): React.JSX.Element | null {
  if (!git) return null

  if (isGroup(git)) return <FolderChips git={git} label={label} />

  if (git.error) {
    return <span className="chip chip--error">{git.error}</span>
  }

  if (!git.isRepo) {
    return <span className="chip chip--error">not a repo</span>
  }

  const branch = git.detached
    ? `detached ${git.head ?? ''}`.trim()
    : (git.branch ?? git.head ?? '—')

  return (
    <>
      <span className="pane-header__branch" title={git.upstream ? `tracking ${git.upstream}` : 'no upstream'}>
        <IconBranch />
        {branch}
      </span>
      <CountChips git={git} titles />
    </>
  )
}

/**
 * A folder's readout: the same counts, summed, and a branch slot that says how
 * many repositories they came from — or their branch, on the days they all
 * happen to be on one.
 *
 * The whole readout is one hover target rather than one per chip, because one
 * card explains all of it and three cards fighting over the same rectangle is
 * not an improvement on none.
 */
function FolderChips({ git, label }: { git: GitState; label: string }): React.JSX.Element {
  const card = useHoverCard()

  // A folder that is missing, or that has nothing in it, has no breakdown to
  // offer — it has a sentence, and that is the whole readout.
  if (git.error) return <span className="chip chip--error">{git.error}</span>

  return (
    <span className="git-group" {...card.bind}>
      <span className="pane-header__branch">
        {groupLabelIsBranch(git) ? <IconBranch /> : <IconFolder size={11} />}
        {groupLabel(git)}
      </span>
      <CountChips git={git} titles={false} />
      {card.anchor && (
        <RepoSummary git={git} name={label} anchorEl={card.anchor} onClose={card.close} />
      )}
    </span>
  )
}

/**
 * The counts, for one work tree or for a folder of them.
 *
 * `titles` is off for a folder: the numbers are sums, so "3 staged, 4 modified"
 * would be true of no repository in particular, and a native tooltip appearing
 * on top of the card that does explain it is worse than nothing.
 */
function CountChips({ git, titles }: { git: GitState; titles: boolean }): React.JSX.Element {
  return (
    <>
      {git.conflicted > 0 && <span className="chip chip--conflict">!{git.conflicted}</span>}

      {git.dirty > 0 ? (
        <span
          className="chip chip--dirty"
          title={titles ? `${git.staged} staged, ${git.modified} modified` : undefined}
        >
          ●{git.dirty}
        </span>
      ) : git.untracked === 0 ? (
        <span className="chip chip--clean">clean</span>
      ) : null}

      {git.untracked > 0 && (
        <span className="chip chip--new" title={titles ? `${git.untracked} untracked` : undefined}>
          +{git.untracked}
        </span>
      )}

      {(git.ahead > 0 || git.behind > 0 || git.upstream) && (
        <span className="chip chip--sync" title={titles ? 'ahead / behind upstream' : undefined}>
          ↑{git.ahead} ↓{git.behind}
        </span>
      )}
    </>
  )
}
