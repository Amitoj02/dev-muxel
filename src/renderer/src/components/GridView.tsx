/**
 * The grid surface.
 *
 * Panes are absolutely positioned from rects computed off the layout tree,
 * rather than being nested flex boxes. Two reasons, both of which matter:
 *
 *   1. The rendered pane list stays flat and keyed by pane id, so reshaping
 *      the tree never unmounts a component — an xterm instance survives being
 *      dragged from one corner of the grid to the other with its scrollback
 *      intact.
 *   2. Zooming is then just a different rect for the same element, so the
 *      "animate to fullscreen" transition is a plain CSS transition on
 *      left/top/width/height instead of a portal and a clone.
 *
 * Tabs fall out of the same property, and are the reason it is worth this
 * much. **Every pane in the app is rendered here, including the ones in tabs
 * you are not looking at** — they are hidden, not unmounted, so a shell keeps
 * running, an xterm keeps its scrollback and a browser pane keeps its page
 * while its grid is off screen. Each tab's tree is measured against the same
 * box as the one on screen, so a hidden pane already has the rect it will be
 * shown at and switching tabs resizes nothing.
 *
 * The reopen window rides on the same mechanism. A pane you just closed, and
 * every pane of a grid you just closed, is in no tab at all but is still in
 * the list — so it is still drawn here, hidden, at the rect it had when it
 * went. That is what makes Ctrl+Shift+T give you back the same shell and the
 * same loaded page rather than a fresh one.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DockSide } from '../../../shared/types'
import { collectPaneIds, dockZone, measure, type Rect } from '../../../shared/layout'
import { actions, paneLabel, useApp } from '../state/hooks'
import { PaneShell } from './PaneShell'
import { EmptyState } from './EmptyState'

export function GridView(): React.JSX.Element {
  const app = useApp()
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 })

  // The tree is measured in container-local pixels, so the grid's own position
  // on screen never enters the maths.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = (): void => {
      const next = { x: 0, y: 0, width: el.clientWidth, height: el.clientHeight }
      setBox(next)
      actions.setGridBox(next)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const gutter = app.settings.gutter ?? 6
  // The grid on screen. Splitters and drop targets only ever come from this
  // one — you cannot reshape a tab you are not looking at.
  const { panes: rects, gutters } = useMemo(
    () => measure(app.layout, box, gutter),
    [app.layout, box, gutter]
  )

  const mine = useMemo(() => new Set(collectPaneIds(app.layout)), [app.layout])

  /**
   * Rects for the panes in every *other* tab.
   *
   * Measured against the same box rather than remembered from when their tab
   * was last on screen: a window resized while a tab is in the background
   * would otherwise show it at the old size and reflow every pty in it on the
   * way in, which is exactly what tabs are meant to avoid.
   *
   * Kept out of the memo above deliberately — that one recomputes on every
   * frame of a splitter drag, and a background grid cannot have changed shape
   * while you were dragging one in front of it.
   */
  const elsewhere = useMemo(() => {
    const out = new Map<string, Rect>()
    for (const tab of app.tabs) {
      if (tab.id === app.activeTabId) continue
      for (const [id, rect] of measure(tab.layout, box, gutter).panes) out.set(id, rect)
    }
    return out
  }, [app.tabs, app.activeTabId, box, gutter])

  /**
   * Rects for the panes being held for a reopen.
   *
   * Measured off the tree each one was closed out of, so a parked pane keeps
   * exactly the box it had — it is coming straight back, and resizing a
   * terminal on the way out and again on the way in would reflow a scrollback
   * nobody asked to have reflowed.
   */
  const parked = useMemo(() => {
    const out = new Map<string, Rect>()
    for (const entry of app.recentlyClosed) {
      if (!entry.parked) continue
      if (entry.kind === 'tab') {
        for (const [id, rect] of measure(entry.tab.layout, box, gutter).panes) out.set(id, rect)
      } else {
        const rect = measure(entry.layout, box, gutter).panes.get(entry.pane.id)
        if (rect) out.set(entry.pane.id, rect)
      }
    }
    return out
  }, [app.recentlyClosed, box, gutter])

  const zoomRect = useMemo((): Rect | null => {
    if (!app.zoomedPaneId) return null
    const inset = app.settings.zoomInset ?? 26
    return {
      x: inset,
      y: inset,
      width: Math.max(80, box.width - inset * 2),
      height: Math.max(60, box.height - inset * 2)
    }
  }, [app.zoomedPaneId, app.settings.zoomInset, box])

  // Zooming animates geometry; un-zooming has to as well, and by then
  // `zoomedPaneId` is already null. So the flag outlives the state by one
  // transition rather than being derived from it.
  const animating = useZoomAnimation(app.zoomedPaneId)

  const drag = useSplitterDrag(ref, gutter)
  const dnd = usePaneDrag(ref, rects)

  return (
    <div
      className="grid"
      data-rules={app.settings.showGridLines}
      /*
       * A browser pane's guest is a separate WebContents, so pointer events
       * over it never reach this document — which would strand a pane drag the
       * moment the cursor crossed a web page, and leave the drop indicator
       * frozen wherever it last saw the pointer. Marking the drag here lets
       * CSS take the guests out of hit-testing until it is over.
       */
      data-dragging={Boolean(app.dragging) || drag.active !== null}
      ref={ref}
      onPointerMove={dnd.onPointerMove}
      onPointerUp={dnd.onPointerUp}
    >
      {/* An empty grid still renders every other tab's panes behind it, which
          is why this is not an early return: unmounting them to show a
          headline would kill the shells the other tabs are holding. */}
      {mine.size === 0 && <EmptyState />}

      {app.zoomedPaneId && (
        <div className="scrim" onPointerDown={() => actions.closeZoom()} />
      )}

      {app.panes.map((pane) => {
        const here = mine.has(pane.id)
        const base = here ? rects.get(pane.id) : (elsewhere.get(pane.id) ?? parked.get(pane.id))
        if (!base) return null
        const zoomed = here && app.zoomedPaneId === pane.id
        return (
          <PaneShell
            key={pane.id}
            pane={pane}
            rect={zoomed && zoomRect ? zoomRect : base}
            zoomed={zoomed}
            hidden={!here}
            animating={animating}
            onDragStart={dnd.begin}
          />
        )
      })}

      {gutters.map((g) => (
        <div
          key={`${g.splitId}:${g.index}`}
          className="splitter"
          data-dir={g.dir}
          data-active={drag.active === `${g.splitId}:${g.index}`}
          style={{ left: g.rect.x, top: g.rect.y, width: g.rect.width, height: g.rect.height }}
          onPointerDown={(e) => drag.begin(e, g)}
        />
      ))}

      {app.dropTarget && (
        <DropIndicator
          rect={rects.get(app.dropTarget.paneId)}
          side={app.dropTarget.side}
          gutter={gutter}
        />
      )}

      {app.dragging && <DragGhost paneId={app.dragging} />}
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * True while a zoom transition is in flight, in either direction.
 *
 * Adjusted during render rather than in an effect — this is state derived from
 * a change in props, and doing it in an effect would paint one frame with the
 * transition already disabled, which is exactly the snap it exists to prevent.
 */
function useZoomAnimation(zoomedPaneId: string | null): boolean {
  const [seen, setSeen] = useState(zoomedPaneId)
  const [animating, setAnimating] = useState(false)

  if (seen !== zoomedPaneId) {
    setSeen(zoomedPaneId)
    setAnimating(true)
  }

  useEffect(() => {
    if (!animating) return
    // Slightly longer than --dur-zoom so the transition is never cut short.
    const id = window.setTimeout(() => setAnimating(false), 300)
    return () => window.clearTimeout(id)
  }, [animating, zoomedPaneId])

  return animating
}

/** Preview of where a dropped pane will land. */
function DropIndicator({
  rect,
  side,
  gutter
}: {
  rect: Rect | undefined
  side: DockSide | 'center'
  gutter: number
}): React.JSX.Element | null {
  if (!rect) return null
  const half = (n: number): number => Math.round(n / 2) - gutter / 2

  let r: Rect
  if (side === 'center') r = rect
  else if (side === 'left') r = { ...rect, width: half(rect.width) }
  else if (side === 'right')
    r = { ...rect, x: rect.x + rect.width - half(rect.width), width: half(rect.width) }
  else if (side === 'top') r = { ...rect, height: half(rect.height) }
  else r = { ...rect, y: rect.y + rect.height - half(rect.height), height: half(rect.height) }

  return <div className="dropzone" style={{ left: r.x, top: r.y, width: r.width, height: r.height }} />
}

function DragGhost({ paneId }: { paneId: string }): React.JSX.Element | null {
  const app = useApp()
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const onMove = (e: PointerEvent): void => setPos({ x: e.clientX, y: e.clientY })
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  const pane = app.panes.find((p) => p.id === paneId)
  if (!pane) return null

  return (
    <div className="drag-ghost" style={{ left: pos.x, top: pos.y }}>
      {paneLabel(app, pane)}
    </div>
  )
}

// ---------------------------------------------------------------------------

type GutterInfo = ReturnType<typeof measure>['gutters'][number]

/**
 * Splitter dragging. Pointer capture on the gutter element means the drag
 * keeps working when the pointer runs over a terminal — which it always does.
 */
function useSplitterDrag(
  container: React.RefObject<HTMLDivElement | null>,
  _gutter: number
): { active: string | null; begin: (e: React.PointerEvent, g: GutterInfo) => void } {
  const [active, setActive] = useState<string | null>(null)
  const state = useRef<{ g: GutterInfo; startPx: number } | null>(null)

  const begin = useCallback((e: React.PointerEvent, g: GutterInfo) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    state.current = { g, startPx: g.dir === 'row' ? e.clientX : e.clientY }
    setActive(`${g.splitId}:${g.index}`)
    document.body.style.cursor = g.dir === 'row' ? 'col-resize' : 'row-resize'
  }, [])

  useEffect(() => {
    if (!active) return

    const onMove = (e: PointerEvent): void => {
      const s = state.current
      const el = container.current
      if (!s || !el) return
      const now = s.g.dir === 'row' ? e.clientX : e.clientY
      const deltaPx = now - s.startPx
      if (s.g.axisPx <= 0) return
      actions.resize(s.g.splitId, s.g.index, deltaPx / s.g.axisPx)
      s.startPx = now
    }

    const onUp = (): void => {
      state.current = null
      setActive(null)
      document.body.style.cursor = ''
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [active, container])

  return { active, begin }
}

/**
 * Dragging a pane by its header to re-dock it. Hand-rolled with pointer events
 * rather than HTML5 drag and drop: the latter cannot draw a live drop preview
 * in the grid's coordinate space and leaves a browser drag image behind.
 */
function usePaneDrag(
  container: React.RefObject<HTMLDivElement | null>,
  rects: Map<string, Rect>
): {
  begin: (paneId: string, e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
} {
  const app = useApp()
  const dragging = app.dragging

  const begin = useCallback((paneId: string, e: React.PointerEvent) => {
    e.preventDefault()
    actions.beginDrag(paneId)
  }, [])

  const locate = useCallback(
    (clientX: number, clientY: number) => {
      const el = container.current
      if (!el) return null
      const bounds = el.getBoundingClientRect()
      const x = clientX - bounds.left
      const y = clientY - bounds.top
      for (const [paneId, r] of rects) {
        if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
          return { paneId, side: dockZone(r, x, y) }
        }
      }
      return null
    },
    [container, rects]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return
      const hit = locate(e.clientX, e.clientY)
      // Dropping a pane onto itself is a no-op; do not flash a preview for it.
      actions.setDropTarget(hit && hit.paneId !== dragging ? hit : null)
    },
    [dragging, locate]
  )

  const onPointerUp = useCallback(() => {
    if (!dragging) return
    actions.endDrag(true)
  }, [dragging])

  // A drag must end even if the pointer is released outside the window, or the
  // pane would stay stuck to the cursor with no way to let go.
  useEffect(() => {
    if (!dragging) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') actions.endDrag(false)
    }
    const onUp = (): void => actions.endDrag(true)
    const onCancel = (): void => actions.endDrag(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [dragging])

  return { begin, onPointerMove, onPointerUp }
}
