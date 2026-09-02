/**
 * What a folder of repositories owes, broken down one row per repository.
 *
 * A folder's header carries the sum — nine uncommitted files, three to push —
 * which is the right number to glance at and useless to act on. This is the
 * other half: which repository each of those belongs to, and what branch it is
 * sitting on. Worst first, because a folder of thirty projects is read from the
 * top down; the clean ones fall to the bottom and are counted rather than
 * listed once there are more than the card will hold.
 *
 * Two mechanics worth knowing before editing:
 *
 * **It is portalled to `document.body`.** `.pane` sets `container-type`, and
 * that makes it a containing block for `position: fixed` descendants — a card
 * rendered in place would anchor to the pane and be clipped by it, which is
 * not obvious from reading either file.
 *
 * **It never takes pointer events.** There is nothing to click here, and the
 * card overlaps the header it hangs off; letting it swallow a click would cost
 * you the zoom button. That also means it needs no outside-click handling and
 * cannot trap a drag, so the pane can still be picked up by its header while
 * the card is up.
 */

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { GitState } from '../../../shared/types'
import { SUMMARY_ROWS, summaryRows, type SummaryRow } from '../../../shared/git'

const MAX_WIDTH = 480

export function RepoSummary({
  git,
  name,
  anchorEl,
  onClose
}: {
  /** A folder's state — the one carrying `members`. */
  git: GitState
  /** What the folder is called, for the card's own heading. */
  name: string
  /** The element the card hangs under; re-measured on every render. */
  anchorEl: HTMLElement
  onClose: () => void
}): React.JSX.Element | null {
  // Anything that moves the anchor out from under the card dismisses it, the
  // same way an OS menu behaves. There is no reposition-on-scroll case here:
  // the grid does not scroll, and the repository list closes its own rows.
  useEffect(() => {
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const rows = summaryRows(git)
  if (rows.length === 0) return null

  const shown = rows.slice(0, SUMMARY_ROWS)
  const rest = rows.length - shown.length
  const restClean = rows.slice(shown.length).every((r) => r.clean)

  const rect = anchorEl.getBoundingClientRect()

  return createPortal(
    <div
      className="repo-card"
      role="tooltip"
      style={{
        left: Math.max(6, Math.min(rect.left, window.innerWidth - MAX_WIDTH - 6)),
        top: rect.bottom + 6
      }}
    >
      <div className="repo-card__head">
        {rows.length} {rows.length === 1 ? 'repository' : 'repositories'}
        <span className="repo-card__where">{name}</span>
      </div>

      <div className="repo-card__rows">
        {shown.map((row) => (
          <Row key={row.path} row={row} />
        ))}
      </div>

      {rest > 0 && (
        <div className="repo-card__more">
          + {rest} more{restClean ? ', all clean' : ''}
        </div>
      )}
    </div>,
    document.body
  )
}

/**
 * One repository. The four columns are fixed by the grid in CSS rather than
 * being laid out per row, which is the whole point — the branch names line up
 * under each other and the counts read as a column you can scan down.
 */
function Row({ row }: { row: SummaryRow }): React.JSX.Element {
  return (
    <div className="repo-card__row" data-clean={row.clean}>
      <span className="repo-card__name" title={row.path}>
        {row.name}
      </span>

      <span className="repo-card__branch" data-error={Boolean(row.error) || undefined}>
        {row.branch}
      </span>

      <span className="repo-card__owed">
        {row.operation && <em className="repo-card__op">{row.operation}</em>}
        {row.conflicted > 0 && <em className="repo-card__conflict">!{row.conflicted}</em>}
        {row.dirty > 0 && <em className="repo-card__dirty">●{row.dirty}</em>}
        {row.untracked > 0 && <em className="repo-card__new">+{row.untracked}</em>}
        {row.clean && <em className="repo-card__clean">clean</em>}
      </span>

      <span className="repo-card__sync">
        {row.ahead > 0 && <em>↑{row.ahead}</em>}
        {row.behind > 0 && <em>↓{row.behind}</em>}
      </span>
    </div>
  )
}
