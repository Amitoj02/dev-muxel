/**
 * The tab strip: one row, one entry per grid.
 *
 * A tab is a whole grid — its own split tree, its own focus, its own zoom —
 * and nothing in it is torn down when you leave it. So the strip is not a
 * router: switching is a state change and every pane in every tab stays
 * mounted behind it, which is what makes a build running in one grid keep
 * running while you work in another. `GridView` is where that is enforced.
 *
 * It doubles as a drop target. Dragging a pane by its header onto a tab moves
 * it into that grid, which is the only way to get one across; the drag itself
 * is the same one that re-docks panes inside a grid, so nothing special has to
 * happen to start it.
 *
 * The empty space to the right of the last tab carries the window's drag
 * region, so the strip is also somewhere to grab a frameless window by.
 */

import { useEffect, useRef, useState } from 'react'
import {
  actions,
  getState,
  tabAttention,
  tabPaneIds,
  tabRunning,
  tabTitle,
  tabUnsent,
  useApp
} from '../state/hooks'
import { focusPaneHard } from '../lib/focus'
import { IconClose, IconPlus } from './Icons'

const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

/** Pointer travel before a press on a tab becomes a reorder rather than a click. */
const REORDER_SLOP = 5

export function TabStrip(): React.JSX.Element {
  const app = useApp()
  const [renaming, setRenaming] = useState<string | null>(null)
  const reorder = useTabReorder()

  const open = (tabId: string): void => {
    if (tabId === app.activeTabId) return
    actions.switchTab(tabId)
    // Switching the store is not the same as the keyboard going there: a
    // terminal's keys live in xterm's textarea and a browser pane's in another
    // process, so whichever pane this grid was left on is told directly.
    focusPaneHard(getState().focusedPaneId)
  }

  const close = (tabId: string): void => {
    // Same promise as closing a pane, undo included: the grid comes back with
    // Ctrl+Shift+T for five seconds. Still worth asking, because a grid full
    // of agents is the expensive thing to lose track of — and so is one
    // holding comments nobody has collected yet.
    const worth = tabRunning(app, tabId) > 0 || tabUnsent(app, tabId) > 0
    if (app.settings.confirmClose && worth) {
      actions.showOverlay({ kind: 'confirm-close-tab', tabId })
      return
    }
    actions.closeTab(tabId)
  }

  return (
    <div className="tabstrip" style={NO_DRAG} role="tablist" aria-label="Grids">
      {app.tabs.map((tab, index) => (
        <TabEntry
          key={tab.id}
          tabId={tab.id}
          index={index}
          active={tab.id === app.activeTabId}
          closeable={app.tabs.length > 1}
          renaming={renaming === tab.id}
          reorder={reorder}
          onOpen={() => open(tab.id)}
          onClose={() => close(tab.id)}
          onRename={() => setRenaming(tab.id)}
          onRenamed={() => setRenaming(null)}
        />
      ))}

      <button
        className="tabstrip__add"
        onClick={() => actions.addTab()}
        title="New grid — Ctrl+Alt+Shift+T"
        aria-label="New grid"
      >
        <IconPlus size={11} />
      </button>

      <div className="tabstrip__drag" />
    </div>
  )
}

// ---------------------------------------------------------------------------

function TabEntry({
  tabId,
  index,
  active,
  closeable,
  renaming,
  reorder,
  onOpen,
  onClose,
  onRename,
  onRenamed
}: {
  tabId: string
  index: number
  active: boolean
  closeable: boolean
  renaming: boolean
  reorder: TabReorder
  onOpen: () => void
  onClose: () => void
  onRename: () => void
  onRenamed: () => void
}): React.JSX.Element {
  const app = useApp()
  const title = tabTitle(app, tabId)
  const count = tabPaneIds(app, tabId).length
  const waiting = tabAttention(app, tabId)
  const draggingPane = app.dragging !== null

  return (
    <div
      className="tabstrip__tab"
      role="tab"
      aria-selected={active}
      data-active={active}
      data-dropping={app.tabDropTarget === tabId}
      data-moving={reorder.dragging === tabId}
      /*
       * Enter and leave rather than a test on release, so the tab under the
       * cursor lights up while the pane drag is still in flight. The pane drag
       * does not capture the pointer, which is what lets these fire at all.
       */
      onPointerEnter={() => {
        if (draggingPane) actions.setTabDropTarget(tabId)
      }}
      onPointerLeave={() => {
        if (draggingPane) actions.setTabDropTarget(null)
      }}
      onPointerMove={(e) => reorder.over(tabId, index, e)}
      onDoubleClick={onRename}
    >
      {renaming ? (
        <RenameField tabId={tabId} initial={app.tabs[index]?.name ?? ''} onDone={onRenamed} />
      ) : (
        <>
          <button
            className="tabstrip__open"
            onPointerDown={(e) => reorder.press(tabId, e)}
            onClick={() => {
              // A press that turned into a reorder is not also a click on the
              // tab it happened to end up over.
              if (reorder.moved()) return
              onOpen()
            }}
            title={`${title} — ${count} pane${count === 1 ? '' : 's'}. Double-click to rename.`}
          >
            {waiting > 0 && <span className="tabstrip__dot" />}
            <span className="tabstrip__name">{title}</span>
            {count > 0 && <span className="tabstrip__count">{count}</span>}
          </button>

          {closeable && (
            <button className="tabstrip__close" onClick={onClose} aria-label={`Close ${title}`}>
              <IconClose size={9} />
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

type TabReorder = {
  dragging: string | null
  press: (tabId: string, e: React.PointerEvent) => void
  over: (tabId: string, index: number, e: React.PointerEvent) => void
  /** True if the press that just ended had become a drag. */
  moved: () => boolean
}

/**
 * Dragging a tab along the strip to reorder it.
 *
 * A tab only takes its new place once the pointer is past the *midpoint* of
 * the one it is displacing, and in the direction of travel. Swapping on first
 * contact looks simpler and oscillates: two tabs of different widths trade
 * places, the narrower one lands back under the cursor, and they flip again
 * every frame. The midpoint is what makes the exchange one-way.
 */
function useTabReorder(): TabReorder {
  const [dragging, setDragging] = useState<string | null>(null)
  const from = useRef<{ tabId: string; x: number } | null>(null)
  const moved = useRef(false)

  /**
   * A press ends on release, whether or not it ever became a drag.
   *
   * Bound for the life of the strip rather than only while one is in flight,
   * which is the whole point: an ordinary click on a tab never crosses the
   * slop, so nothing would clear the press it opened — and the next time the
   * pointer crossed the strip, button up, `over` would read it as that press
   * still going and reorder the tabs under the cursor. Grids are numbered by
   * position when they are unnamed, so the strip goes on reading "grid 1,
   * grid 2" while the two of them trade contents: a swap nobody asked for,
   * arrived at by clicking a tab and then moving the mouse.
   */
  useEffect(() => {
    const end = (): void => {
      from.current = null
      setDragging(null)
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [])

  return {
    dragging,

    press(tabId, e) {
      if (e.button !== 0) return
      from.current = { tabId, x: e.clientX }
      moved.current = false
    },

    over(tabId, index, e) {
      const start = from.current
      if (!start) return

      // A release the window never saw — let go outside it, or taken by the
      // OS — leaves the press standing with nothing to end it. The button
      // itself is the truth, and it says this is a bare pointer move.
      if (e.buttons === 0) {
        from.current = null
        return
      }

      // Below the slop it is still a click, not a drag.
      if (!moved.current && Math.abs(e.clientX - start.x) < REORDER_SLOP) return
      if (!moved.current) {
        moved.current = true
        setDragging(start.tabId)
      }
      if (start.tabId === tabId) return

      const tabs = getState().tabs
      const at = tabs.findIndex((t) => t.id === start.tabId)
      if (at < 0) return

      const rect = e.currentTarget.getBoundingClientRect()
      const midpoint = rect.left + rect.width / 2
      if (at < index ? e.clientX > midpoint : e.clientX < midpoint) {
        actions.moveTab(start.tabId, index)
      }
    },

    moved() {
      return moved.current
    }
  }
}

// ---------------------------------------------------------------------------

/** Renaming, in place. Empty puts the tab back to being numbered. */
function RenameField({
  tabId,
  initial,
  onDone
}: {
  tabId: string
  initial: string
  onDone: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(initial)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const commit = (): void => {
    actions.renameTab(tabId, draft.trim())
    onDone()
  }

  return (
    <input
      ref={ref}
      className="tabstrip__rename"
      value={draft}
      spellCheck={false}
      maxLength={40}
      placeholder="name this grid"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        // Nothing else in the window should act on a key typed into this: the
        // shortcut listener is on the window in the capture phase and ignores
        // plain letters, but xterm is not so fussy.
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onDone()
        }
      }}
    />
  )
}
