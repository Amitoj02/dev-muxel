/**
 * The split-tree layout engine.
 *
 * GRID's grid is a split tree (the same model tmux and VS Code's editor groups
 * use) rather than a fixed CSS grid, because the requirement is "as many panes
 * as I want, dragged into new sections". Every function here is pure: it takes
 * a tree and returns a new tree, so the renderer can keep the tree in React
 * state and snapshot it for undo.
 *
 * Invariants of a *normalised* tree:
 *   - a split has >= 2 children
 *   - a split never has a child split with the same `dir` (those get inlined)
 *   - `sizes.length === children.length` and the sizes sum to 1
 */

import type { DockSide, LayoutNode, LayoutSplit, SplitDir } from './types'

export type Rect = { x: number; y: number; width: number; height: number }

let idCounter = 0
export function nodeId(prefix = 'n'): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`
}

export function leaf(paneId: string, id = nodeId('leaf')): LayoutNode {
  return { kind: 'leaf', id, paneId }
}

/**
 * Smallest share a pane may be given by a *split*. Halving the target each
 * time means the fifth terminal in a row gets 1/32 of it — a couple of columns
 * wide, which xterm cannot even fit. Past this floor the split is evened out
 * instead, which is what you actually want by that point.
 */
const MIN_SPLIT_SHARE = 0.08

function evenSizes(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n)
}

/** Renormalise so the sizes are all positive and sum to exactly 1. */
function normaliseSizes(sizes: number[]): number[] {
  const safe = sizes.map((s) => (Number.isFinite(s) && s > 0 ? s : 0))
  const total = safe.reduce((a, b) => a + b, 0)
  if (total <= 0) return evenSizes(sizes.length)
  return safe.map((s) => s / total)
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function collectPaneIds(node: LayoutNode | null): string[] {
  if (!node) return []
  if (node.kind === 'leaf') return [node.paneId]
  return node.children.flatMap(collectPaneIds)
}

export function countLeaves(node: LayoutNode | null): number {
  if (!node) return 0
  if (node.kind === 'leaf') return 1
  return node.children.reduce((n, c) => n + countLeaves(c), 0)
}

export function findLeaf(node: LayoutNode | null, paneId: string): LayoutNode | null {
  if (!node) return null
  if (node.kind === 'leaf') return node.paneId === paneId ? node : null
  for (const child of node.children) {
    const hit = findLeaf(child, paneId)
    if (hit) return hit
  }
  return null
}

/**
 * Which pane a leaf sits next to, and which side of that pane it is on.
 *
 * This is the address a closed pane needs in order to come back to roughly
 * where it was once the tree has moved on without it: feeding the result to
 * `splitPane` puts it back in the same slot and the same order. When the
 * neighbour is itself a split, the nearest leaf inside it is used, which is
 * the closest thing to "next to" that a single pane id can express.
 */
export function anchorFor(
  root: LayoutNode | null,
  paneId: string
): { paneId: string; side: DockSide } | null {
  if (!root || root.kind === 'leaf') return null

  const stack: LayoutSplit[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) break

    const idx = node.children.findIndex((c) => c.kind === 'leaf' && c.paneId === paneId)
    if (idx !== -1) {
      // Prefer the sibling after it, so the restored pane keeps its order.
      const after = idx + 1 < node.children.length
      const sibling = after ? node.children[idx + 1] : node.children[idx - 1]
      if (!sibling) return null
      const ids = collectPaneIds(sibling)
      const neighbourId = after ? ids[0] : ids[ids.length - 1]
      if (!neighbourId) return null
      const side: DockSide =
        node.dir === 'row' ? (after ? 'left' : 'right') : after ? 'top' : 'bottom'
      return { paneId: neighbourId, side }
    }

    for (const child of node.children) {
      if (child.kind === 'split') stack.push(child)
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export type Gutter = {
  /** Split node the gutter belongs to. */
  splitId: string
  /** Gutter sits between children[index] and children[index + 1]. */
  index: number
  dir: SplitDir
  rect: Rect
  /** Px available to all children of the split, used to convert px to fraction. */
  axisPx: number
}

export type LayoutMeasure = {
  /** Rect per pane id, in container-local px. */
  panes: Map<string, Rect>
  /** One entry per draggable gutter. */
  gutters: Gutter[]
}

/**
 * Walk the tree and produce absolute rects. Absolute positioning (rather than
 * nested flex) is deliberate: the rendered pane list stays flat and stable, so
 * an xterm instance is never unmounted when the layout changes shape.
 */
export function measure(node: LayoutNode | null, box: Rect, gutter: number): LayoutMeasure {
  const panes = new Map<string, Rect>()
  const gutters: Gutter[] = []
  if (node) walkMeasure(node, box, gutter, panes, gutters)
  return { panes, gutters }
}

function walkMeasure(
  node: LayoutNode,
  box: Rect,
  gutter: number,
  panes: Map<string, Rect>,
  gutters: Gutter[]
): void {
  if (node.kind === 'leaf') {
    panes.set(node.paneId, box)
    return
  }

  const horizontal = node.dir === 'row'
  const n = node.children.length
  const totalGutter = gutter * (n - 1)
  const axisPx = Math.max(0, (horizontal ? box.width : box.height) - totalGutter)
  const sizes = normaliseSizes(node.sizes)
  const axisStart = horizontal ? box.x : box.y

  let cursor = axisStart
  for (let i = 0; i < n; i += 1) {
    // The last child soaks up the rounding remainder so panes meet the edge.
    const extent =
      i === n - 1
        ? axisStart + axisPx + totalGutter - cursor
        : Math.round(axisPx * sizes[i])

    const childBox: Rect = horizontal
      ? { x: cursor, y: box.y, width: extent, height: box.height }
      : { x: box.x, y: cursor, width: box.width, height: extent }

    walkMeasure(node.children[i], childBox, gutter, panes, gutters)
    cursor += extent

    if (i < n - 1) {
      gutters.push({
        splitId: node.id,
        index: i,
        dir: node.dir,
        axisPx,
        rect: horizontal
          ? { x: cursor, y: box.y, width: gutter, height: box.height }
          : { x: box.x, y: cursor, width: box.width, height: gutter }
      })
      cursor += gutter
    }
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function mapNode(node: LayoutNode, fn: (n: LayoutNode) => LayoutNode): LayoutNode {
  const next = fn(node)
  if (next.kind === 'leaf') return next
  const children = next.children.map((c) => mapNode(c, fn))
  const changed = children.some((c, i) => c !== next.children[i])
  return changed ? { ...next, children } : next
}

/**
 * Split `targetPaneId` and put `newPaneId` on the given side.
 *
 * When the target's parent already runs along the needed axis the new leaf is
 * inserted as a sibling, stealing space only from the target, instead of
 * nesting another split. That keeps trees shallow and drags predictable.
 */
export function splitPane(
  root: LayoutNode | null,
  targetPaneId: string,
  side: DockSide,
  newPaneId: string
): LayoutNode {
  const newLeaf = leaf(newPaneId)
  if (!root) return newLeaf

  const dir: SplitDir = side === 'left' || side === 'right' ? 'row' : 'column'
  const before = side === 'left' || side === 'top'

  if (root.kind === 'leaf') {
    if (root.paneId !== targetPaneId) return root
    return {
      kind: 'split',
      id: nodeId('split'),
      dir,
      children: before ? [newLeaf, root] : [root, newLeaf],
      sizes: [0.5, 0.5]
    }
  }

  const insertInto = (split: LayoutSplit): LayoutSplit | null => {
    const idx = split.children.findIndex((c) => c.kind === 'leaf' && c.paneId === targetPaneId)
    if (idx === -1) return null

    const sizes = normaliseSizes(split.sizes)

    if (split.dir === dir) {
      // Same axis: become a sibling, halving the target's share.
      const half = sizes[idx] / 2
      const at = before ? idx : idx + 1
      const children = [...split.children]
      children.splice(at, 0, newLeaf)

      if (half < MIN_SPLIT_SHARE) {
        // The target has already been subdivided past usefulness; give every
        // sibling an equal share rather than producing a pane too narrow to
        // render a single column.
        return { ...split, children, sizes: evenSizes(children.length) }
      }

      const nextSizes = [...sizes]
      nextSizes[idx] = half
      nextSizes.splice(at, 0, half)
      return { ...split, children, sizes: normaliseSizes(nextSizes) }
    }

    // Cross axis: wrap the target leaf in a nested split.
    const target = split.children[idx]
    const wrapper: LayoutSplit = {
      kind: 'split',
      id: nodeId('split'),
      dir,
      children: before ? [newLeaf, target] : [target, newLeaf],
      sizes: [0.5, 0.5]
    }
    const children = [...split.children]
    children[idx] = wrapper
    return { ...split, children }
  }

  let done = false
  const next = mapNode(root, (n) => {
    if (done || n.kind !== 'split') return n
    const replaced = insertInto(n)
    if (!replaced) return n
    done = true
    return replaced
  })

  if (!done) return root
  return normalise(next) ?? newLeaf
}

/** Remove a pane's leaf and collapse any split left with a single child. */
export function removePane(root: LayoutNode | null, paneId: string): LayoutNode | null {
  if (!root) return null

  const prune = (node: LayoutNode): LayoutNode | null => {
    if (node.kind === 'leaf') return node.paneId === paneId ? null : node

    const kept: LayoutNode[] = []
    const keptSizes: number[] = []
    const sizes = normaliseSizes(node.sizes)
    node.children.forEach((child, i) => {
      const next = prune(child)
      if (next) {
        kept.push(next)
        keptSizes.push(sizes[i])
      }
    })

    if (kept.length === 0) return null
    if (kept.length === 1) return kept[0]
    return { ...node, children: kept, sizes: normaliseSizes(keptSizes) }
  }

  return normalise(prune(root))
}

/**
 * Move an existing pane next to another one. Used by header drag and drop.
 * Removing first can collapse splits, so the target is re-checked afterwards.
 */
export function movePane(
  root: LayoutNode | null,
  paneId: string,
  targetPaneId: string,
  side: DockSide
): LayoutNode | null {
  if (!root || paneId === targetPaneId) return root
  const without = removePane(root, paneId)
  if (!without) return root
  if (!findLeaf(without, targetPaneId)) return root
  return normalise(splitPane(without, targetPaneId, side, paneId))
}

/** Swap two panes in place, leaving the geometry untouched. */
export function swapPanes(root: LayoutNode | null, a: string, b: string): LayoutNode | null {
  if (!root || a === b) return root
  return mapNode(root, (n) => {
    if (n.kind !== 'leaf') return n
    if (n.paneId === a) return { ...n, paneId: b }
    if (n.paneId === b) return { ...n, paneId: a }
    return n
  })
}

/**
 * Apply a splitter drag. Only the two panes either side of the gutter trade
 * space; everything else in the tree keeps its share.
 */
export function resizeSplit(
  root: LayoutNode | null,
  splitId: string,
  index: number,
  deltaFraction: number
): LayoutNode | null {
  if (!root) return null
  return mapNode(root, (n) => {
    if (n.kind !== 'split' || n.id !== splitId) return n
    const sizes = normaliseSizes(n.sizes)
    if (index < 0 || index + 1 >= sizes.length) return n
    const total = sizes[index] + sizes[index + 1]
    // Leave a sliver so a pane can never be dragged out of existence.
    const min = Math.min(0.04, total / 4)
    const a = Math.min(total - min, Math.max(min, sizes[index] + deltaFraction))
    const next = [...sizes]
    next[index] = a
    next[index + 1] = total - a
    return { ...n, sizes: next }
  })
}

/** Reset every split to equal shares. */
export function evenOut(root: LayoutNode | null): LayoutNode | null {
  if (!root) return null
  return mapNode(root, (n) =>
    n.kind === 'split' ? { ...n, sizes: evenSizes(n.children.length) } : n
  )
}

/**
 * Collapse degenerate structure: single-child splits disappear, and a split
 * nested directly inside a split of the same direction is inlined.
 */
export function normalise(node: LayoutNode | null): LayoutNode | null {
  if (!node) return null
  if (node.kind === 'leaf') return node

  const children: LayoutNode[] = []
  const sizes: number[] = []
  const srcSizes = normaliseSizes(node.sizes)

  node.children.forEach((child, i) => {
    const next = normalise(child)
    if (!next) return
    if (next.kind === 'split' && next.dir === node.dir) {
      // Inline the grandchildren, scaling their sizes into this slot.
      const inner = normaliseSizes(next.sizes)
      next.children.forEach((gc, j) => {
        children.push(gc)
        sizes.push(srcSizes[i] * inner[j])
      })
      return
    }
    children.push(next)
    sizes.push(srcSizes[i])
  })

  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return { ...node, children, sizes: normaliseSizes(sizes) }
}

/**
 * Repair a set of trees against the panes that actually exist.
 *
 * Once there are tabs there is more than one tree, and a pane belongs to
 * exactly one of them. Nothing in the state file enforces that: a hand-edited
 * or half-written one can name the same pane in two trees, or name one the
 * pane list lost. Either is fatal on screen — a pane rendered twice is two
 * components fighting over one pty, and a leaf with nothing behind it is a
 * hole in the grid.
 *
 * First tree to name a pane keeps it; everything else naming it, and
 * everything naming a pane that is not there, is dropped. The trees come back
 * normalised, so a tree left with one child collapses rather than staying a
 * split of one.
 */
export function claimLeaves(
  trees: Array<LayoutNode | null>,
  exists: (paneId: string) => boolean
): Array<LayoutNode | null> {
  const claimed = new Set<string>()

  return trees.map((tree) => {
    let out = normalise(tree)
    for (const paneId of collectPaneIds(out)) {
      if (!claimed.has(paneId) && exists(paneId)) claimed.add(paneId)
      else out = removePane(out, paneId)
    }
    return out
  })
}

// ---------------------------------------------------------------------------
// Auto-placement
// ---------------------------------------------------------------------------

/**
 * Where a brand-new pane goes when the user just hits "+ Terminal".
 *
 * Splits the largest pane across its longer axis, which fills the window
 * left-to-right then top-to-bottom and keeps cells roughly square.
 */
export function autoAppend(
  root: LayoutNode | null,
  newPaneId: string,
  box: Rect,
  gutter: number
): LayoutNode {
  if (!root) return leaf(newPaneId)

  const { panes } = measure(root, box, gutter)
  let bestPane: string | null = null
  let bestArea = -1
  let bestRect: Rect | null = null

  for (const [paneId, rect] of panes) {
    const area = rect.width * rect.height
    if (area > bestArea) {
      bestArea = area
      bestPane = paneId
      bestRect = rect
    }
  }

  if (!bestPane || !bestRect) return root
  // A cell has to be clearly wider than tall before we split it side by side,
  // otherwise a 2x2 grid keeps growing sideways instead of wrapping.
  const side: DockSide = bestRect.width >= bestRect.height * 1.15 ? 'right' : 'bottom'
  return splitPane(root, bestPane, side, newPaneId)
}

// ---------------------------------------------------------------------------
// Directional focus
// ---------------------------------------------------------------------------

/**
 * Pane nearest to `from` in the given direction. Distance along the travel
 * axis dominates; overlap with the source band breaks ties.
 */
export function neighbour(
  measured: Map<string, Rect>,
  from: string,
  dir: 'left' | 'right' | 'up' | 'down'
): string | null {
  const src = measured.get(from)
  if (!src) return null

  const srcMidX = src.x + src.width / 2
  const srcMidY = src.y + src.height / 2
  let best: string | null = null
  let bestScore = Infinity

  for (const [paneId, r] of measured) {
    if (paneId === from) continue
    const midX = r.x + r.width / 2
    const midY = r.y + r.height / 2

    let along: number
    let across: number
    if (dir === 'left') {
      if (r.x + r.width > src.x + 1) continue
      along = src.x - (r.x + r.width)
      across = Math.abs(midY - srcMidY)
    } else if (dir === 'right') {
      if (r.x < src.x + src.width - 1) continue
      along = r.x - (src.x + src.width)
      across = Math.abs(midY - srcMidY)
    } else if (dir === 'up') {
      if (r.y + r.height > src.y + 1) continue
      along = src.y - (r.y + r.height)
      across = Math.abs(midX - srcMidX)
    } else {
      if (r.y < src.y + src.height - 1) continue
      along = r.y - (src.y + src.height)
      across = Math.abs(midX - srcMidX)
    }

    const score = Math.max(0, along) * 4 + across
    if (score < bestScore) {
      bestScore = score
      best = paneId
    }
  }

  return best
}

/**
 * Which edge of a pane a pointer at (px, py) is docking against, or 'center'
 * for a swap. The edge bands are a fixed fraction of the pane so the zones stay
 * usable in both a tiny cell and a full-window one.
 */
export function dockZone(rect: Rect, px: number, py: number): DockSide | 'center' {
  const fx = (px - rect.x) / Math.max(1, rect.width)
  const fy = (py - rect.y) / Math.max(1, rect.height)
  const band = 0.3

  const left = fx
  const right = 1 - fx
  const top = fy
  const bottom = 1 - fy
  const nearest = Math.min(left, right, top, bottom)
  if (nearest > band) return 'center'
  if (nearest === left) return 'left'
  if (nearest === right) return 'right'
  if (nearest === top) return 'top'
  return 'bottom'
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Structurally validate a persisted layout tree, dropping anything malformed. */
export function sanitiseLayout(node: unknown, depth = 0): LayoutNode | null {
  // A tree deeper than this is either corrupt or unusable; either way, refuse.
  if (!node || typeof node !== 'object' || depth > 64) return null
  const n = node as Record<string, unknown>

  if (n.kind === 'leaf') {
    return typeof n.paneId === 'string' && n.paneId
      ? { kind: 'leaf', id: typeof n.id === 'string' ? n.id : `leaf_${n.paneId}`, paneId: n.paneId }
      : null
  }

  if (n.kind !== 'split' || !Array.isArray(n.children)) return null
  if (n.dir !== 'row' && n.dir !== 'column') return null

  const rawSizes = Array.isArray(n.sizes) ? n.sizes : []
  const children: LayoutNode[] = []
  const sizes: number[] = []

  n.children.forEach((child, i) => {
    const next = sanitiseLayout(child, depth + 1)
    if (!next) return
    children.push(next)
    const size = rawSizes[i]
    sizes.push(typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : 1)
  })

  if (children.length === 0) return null
  if (children.length === 1) return children[0]

  const total = sizes.reduce((a, b) => a + b, 0)
  return {
    kind: 'split',
    id: typeof n.id === 'string' ? n.id : `split_${depth}_${children.length}`,
    dir: n.dir,
    children,
    sizes: sizes.map((v) => v / total)
  }
}
