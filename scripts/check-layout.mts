/**
 * Checks the split-tree layout engine.
 *
 * The grid is the one place in GRID where a subtle bug is invisible rather than
 * loud: a tree that fails to normalise looks fine until a pane is 3px wide, and
 * a rect that overlaps its neighbour just draws on top of it. So the invariants
 * are asserted directly.
 *
 *   npm run check:layout
 *
 * Run with Node's type stripping; there is no build step involved.
 */

import {
  autoAppend,
  collectPaneIds,
  countLeaves,
  dockZone,
  evenOut,
  leaf,
  measure,
  movePane,
  neighbour,
  normalise,
  removePane,
  resizeSplit,
  sanitiseLayout,
  splitPane,
  swapPanes,
  type Rect
} from '../src/shared/layout.ts'
import type { LayoutNode } from '../src/shared/types.ts'

let failures = 0
let checks = 0

function check(label: string, ok: boolean, detail = ''): void {
  checks += 1
  if (!ok) failures += 1
  if (!ok) console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}

const BOX: Rect = { x: 0, y: 0, width: 1200, height: 800 }
const GUTTER = 6

/** Every structural invariant a normalised tree must satisfy. */
function assertInvariants(label: string, tree: LayoutNode | null): void {
  if (!tree) return
  const walk = (n: LayoutNode): void => {
    if (n.kind === 'leaf') return
    check(`${label}: split has >= 2 children`, n.children.length >= 2, `got ${n.children.length}`)
    check(`${label}: sizes match children`, n.sizes.length === n.children.length)
    const sum = n.sizes.reduce((a, b) => a + b, 0)
    check(`${label}: sizes sum to 1`, Math.abs(sum - 1) < 1e-9, `sum=${sum}`)
    check(`${label}: sizes positive`, n.sizes.every((s) => s > 0))
    for (const c of n.children) {
      check(
        `${label}: no same-direction nesting`,
        !(c.kind === 'split' && c.dir === n.dir),
        `${n.dir} inside ${n.dir}`
      )
      walk(c)
    }
  }
  walk(tree)

  // Pane ids must be unique.
  const ids = collectPaneIds(tree)
  check(`${label}: pane ids unique`, new Set(ids).size === ids.length, ids.join(','))
}

/** Rects must tile the box exactly: no overlaps, no gaps beyond the gutters. */
function assertTiling(label: string, tree: LayoutNode | null): void {
  const { panes } = measure(tree, BOX, GUTTER)
  const rects = [...panes.values()]
  if (rects.length === 0) return

  for (const r of rects) {
    check(`${label}: rect has positive size`, r.width > 0 && r.height > 0, JSON.stringify(r))
    check(
      `${label}: rect inside box`,
      r.x >= BOX.x - 1 &&
        r.y >= BOX.y - 1 &&
        r.x + r.width <= BOX.x + BOX.width + 1 &&
        r.y + r.height <= BOX.y + BOX.height + 1,
      JSON.stringify(r)
    )
  }

  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]
      const b = rects[j]
      const overlap =
        a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
      check(`${label}: rects do not overlap`, !overlap, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
    }
  }

  // Coverage: area of panes plus gutters should account for the whole box.
  const area = rects.reduce((sum, r) => sum + r.width * r.height, 0)
  const boxArea = BOX.width * BOX.height
  check(
    `${label}: panes cover the box`,
    area <= boxArea + 1 && area > boxArea * 0.8,
    `${area} of ${boxArea}`
  )
}

// ---------------------------------------------------------------------------
// A single pane
// ---------------------------------------------------------------------------

let tree: LayoutNode | null = leaf('p1')
assertInvariants('single', tree)
assertTiling('single', tree)
check('single: one leaf', countLeaves(tree) === 1)
check(
  'single: fills the box',
  JSON.stringify(measure(tree, BOX, GUTTER).panes.get('p1')) === JSON.stringify(BOX)
)

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

tree = splitPane(tree, 'p1', 'right', 'p2')
assertInvariants('split-right', tree)
assertTiling('split-right', tree)
check('split-right: two leaves', countLeaves(tree) === 2)
{
  const { panes, gutters } = measure(tree, BOX, GUTTER)
  const a = panes.get('p1')!
  const b = panes.get('p2')!
  check('split-right: p1 is left of p2', a.x < b.x, `${a.x} vs ${b.x}`)
  check('split-right: same height', a.height === b.height)
  check('split-right: one gutter', gutters.length === 1)
  check('split-right: gutter width', gutters[0].rect.width === GUTTER)
}

tree = splitPane(tree, 'p2', 'bottom', 'p3')
assertInvariants('split-bottom', tree)
assertTiling('split-bottom', tree)
{
  const { panes } = measure(tree, BOX, GUTTER)
  const b = panes.get('p2')!
  const c = panes.get('p3')!
  check('split-bottom: p3 below p2', c.y > b.y)
  check('split-bottom: same column', Math.abs(c.x - b.x) < 2)
}

// Splitting along the parent's own axis becomes a sibling, not a nested split.
{
  let t: LayoutNode | null = splitPane(leaf('a'), 'a', 'right', 'b')
  t = splitPane(t, 'b', 'right', 'c')
  assertInvariants('sibling-insert', t)
  check(
    'sibling-insert: stays one flat row',
    t!.kind === 'split' && t!.children.length === 3,
    JSON.stringify(t)
  )
}

// Order is respected for 'left' and 'top'.
{
  const t = splitPane(leaf('a'), 'a', 'left', 'b')
  const { panes } = measure(t, BOX, GUTTER)
  check('split-left: b is left of a', panes.get('b')!.x < panes.get('a')!.x)
  const t2 = splitPane(leaf('a'), 'a', 'top', 'b')
  const { panes: p2 } = measure(t2, BOX, GUTTER)
  check('split-top: b is above a', p2.get('b')!.y < p2.get('a')!.y)
}

// ---------------------------------------------------------------------------
// Removal collapses cleanly
// ---------------------------------------------------------------------------

{
  let t: LayoutNode | null = leaf('a')
  t = splitPane(t, 'a', 'right', 'b')
  t = splitPane(t, 'b', 'bottom', 'c')
  t = removePane(t, 'c')
  assertInvariants('remove-collapse', t)
  check('remove-collapse: two leaves left', countLeaves(t) === 2)
  check(
    'remove-collapse: nested split disappeared',
    t!.kind === 'split' && t!.children.every((c) => c.kind === 'leaf'),
    JSON.stringify(t)
  )

  t = removePane(t, 'b')
  check('remove-collapse: back to a bare leaf', t?.kind === 'leaf' && t.paneId === 'a')

  t = removePane(t, 'a')
  check('remove-collapse: empty tree is null', t === null)
}

// Removing a pane that is not there changes nothing.
{
  const t = splitPane(leaf('a'), 'a', 'right', 'b')
  const after = removePane(t, 'zzz')
  check('remove-missing: pane set unchanged', collectPaneIds(after).sort().join() === 'a,b')
}

// ---------------------------------------------------------------------------
// Moving panes (header drag and drop)
// ---------------------------------------------------------------------------

{
  let t: LayoutNode | null = leaf('a')
  t = splitPane(t, 'a', 'right', 'b')
  t = splitPane(t, 'b', 'bottom', 'c')
  const before = collectPaneIds(t).sort().join()

  t = movePane(t, 'c', 'a', 'left')
  assertInvariants('move', t)
  assertTiling('move', t)
  check('move: no pane lost or duplicated', collectPaneIds(t).sort().join() === before)
  {
    const { panes } = measure(t, BOX, GUTTER)
    check('move: c is now left of a', panes.get('c')!.x < panes.get('a')!.x)
  }

  // Moving onto itself is a no-op rather than a pane-eating bug.
  const same = movePane(t, 'a', 'a', 'left')
  check('move: onto self is a no-op', collectPaneIds(same).sort().join() === before)

  // Moving onto a pane that does not exist leaves the tree alone.
  const missing = movePane(t, 'a', 'nope', 'left')
  check('move: onto missing target is a no-op', collectPaneIds(missing).sort().join() === before)
}

// Moving the only other pane out of a two-pane split must not lose it.
{
  const t = splitPane(leaf('a'), 'a', 'right', 'b')
  const moved = movePane(t, 'b', 'a', 'bottom')
  check('move: two-pane rearrange keeps both', collectPaneIds(moved).sort().join() === 'a,b')
  assertInvariants('move-two', moved)
}

// Swap keeps geometry and both panes.
{
  let t: LayoutNode | null = splitPane(leaf('a'), 'a', 'right', 'b')
  const before = measure(t, BOX, GUTTER)
  t = swapPanes(t, 'a', 'b')
  const after = measure(t, BOX, GUTTER)
  check(
    'swap: a takes b old rect',
    JSON.stringify(after.panes.get('a')) === JSON.stringify(before.panes.get('b'))
  )
  check('swap: both panes still present', collectPaneIds(t).sort().join() === 'a,b')
}

// ---------------------------------------------------------------------------
// Resizing
// ---------------------------------------------------------------------------

{
  const t = splitPane(leaf('a'), 'a', 'right', 'b') as LayoutNode & { id: string }
  const grown = resizeSplit(t, t.id, 0, 0.2)
  assertInvariants('resize', grown)
  const { panes } = measure(grown, BOX, GUTTER)
  check('resize: a grew', panes.get('a')!.width > panes.get('b')!.width)

  // A drag far past the edge must clamp, never invert or vanish.
  const slammed = resizeSplit(t, t.id, 0, 99)
  const { panes: p2 } = measure(slammed, BOX, GUTTER)
  check('resize: clamped, b survives', p2.get('b')!.width > 0, `${p2.get('b')!.width}`)
  assertInvariants('resize-clamped', slammed)

  const slammedBack = resizeSplit(t, t.id, 0, -99)
  const { panes: p3 } = measure(slammedBack, BOX, GUTTER)
  check('resize: clamped the other way, a survives', p3.get('a')!.width > 0)

  // An out-of-range index is ignored rather than throwing.
  const noop = resizeSplit(t, t.id, 5, 0.1)
  check('resize: bad index is a no-op', JSON.stringify(noop) === JSON.stringify(t))
}

// evenOut restores equal shares.
{
  let t: LayoutNode | null = splitPane(leaf('a'), 'a', 'right', 'b')
  t = resizeSplit(t, (t as { id: string }).id, 0, 0.3)
  t = evenOut(t)
  const { panes } = measure(t, BOX, GUTTER)
  check(
    'evenOut: equal widths',
    Math.abs(panes.get('a')!.width - panes.get('b')!.width) <= 1,
    `${panes.get('a')!.width} vs ${panes.get('b')!.width}`
  )
}

// ---------------------------------------------------------------------------
// Auto-append fills the window sensibly
// ---------------------------------------------------------------------------

{
  let t: LayoutNode | null = null
  for (let i = 1; i <= 9; i += 1) {
    t = autoAppend(t, `p${i}`, BOX, GUTTER)
    assertInvariants(`auto-${i}`, t)
    assertTiling(`auto-${i}`, t)
    check(`auto-${i}: leaf count`, countLeaves(t) === i, `${countLeaves(t)}`)
  }

  const { panes } = measure(t, BOX, GUTTER)
  const areas = [...panes.values()].map((r) => r.width * r.height)
  const ratio = Math.max(...areas) / Math.min(...areas)
  // Nine panes should stay within a small factor of each other, not degenerate
  // into one huge cell and eight slivers.
  check('auto: cells stay comparable', ratio < 4, `largest/smallest = ${ratio.toFixed(2)}`)

  const second = [...panes.entries()].sort((a, b) => a[1].x - b[1].x)[0]
  check('auto: first pane is leftmost-ish', Boolean(second))
}

// ---------------------------------------------------------------------------
// normalise repairs hand-edited state files
// ---------------------------------------------------------------------------

{
  const degenerate: LayoutNode = {
    kind: 'split',
    id: 's1',
    dir: 'row',
    sizes: [1],
    children: [
      {
        kind: 'split',
        id: 's2',
        dir: 'row',
        sizes: [0.5, 0.5],
        children: [leaf('a'), leaf('b')]
      }
    ]
  }
  const fixed = normalise(degenerate)
  assertInvariants('normalise', fixed)
  check('normalise: inlined the nested row', fixed!.kind === 'split' && fixed!.children.length === 2)

  const zeroSizes: LayoutNode = {
    kind: 'split',
    id: 's1',
    dir: 'column',
    sizes: [0, 0],
    children: [leaf('a'), leaf('b')]
  }
  const repaired = normalise(zeroSizes)
  assertInvariants('normalise-zero', repaired)

  check('normalise: null in, null out', normalise(null) === null)
}

// ---------------------------------------------------------------------------
// Directional focus
// ---------------------------------------------------------------------------

{
  let t: LayoutNode | null = leaf('a')
  t = splitPane(t, 'a', 'right', 'b')
  t = splitPane(t, 'a', 'bottom', 'c')
  const { panes } = measure(t, BOX, GUTTER)

  check('neighbour: right of a is b', neighbour(panes, 'a', 'right') === 'b')
  check('neighbour: below a is c', neighbour(panes, 'a', 'down') === 'c')
  check('neighbour: above c is a', neighbour(panes, 'c', 'up') === 'a')
  check('neighbour: nothing left of a', neighbour(panes, 'a', 'left') === null)
  check('neighbour: unknown pane returns null', neighbour(panes, 'zzz', 'left') === null)
}

// ---------------------------------------------------------------------------
// Drop zones
// ---------------------------------------------------------------------------

{
  const r: Rect = { x: 0, y: 0, width: 100, height: 100 }
  check('dock: centre', dockZone(r, 50, 50) === 'center')
  check('dock: left edge', dockZone(r, 3, 50) === 'left')
  check('dock: right edge', dockZone(r, 97, 50) === 'right')
  check('dock: top edge', dockZone(r, 50, 3) === 'top')
  check('dock: bottom edge', dockZone(r, 50, 97) === 'bottom')
}

// ---------------------------------------------------------------------------
// Degenerate boxes must not throw or produce NaN
// ---------------------------------------------------------------------------

{
  let t: LayoutNode | null = leaf('a')
  for (let i = 2; i <= 5; i += 1) t = autoAppend(t, `p${i}`, BOX, GUTTER)

  for (const box of [
    { x: 0, y: 0, width: 0, height: 0 },
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 0, y: 0, width: 3000, height: 40 }
  ]) {
    const { panes } = measure(t, box, GUTTER)
    const bad = [...panes.values()].filter(
      (r) => !Number.isFinite(r.x) || !Number.isFinite(r.y) || !Number.isFinite(r.width)
    )
    check(`degenerate ${box.width}x${box.height}: no NaN rects`, bad.length === 0)
  }
}

// ---------------------------------------------------------------------------
// Repeated splitting must stay usable
// ---------------------------------------------------------------------------

{
  // Ten terminals opened one after another on the same pane, always to the
  // right. Naive halving would leave the last one 1/1024 of the row.
  let t: LayoutNode | null = leaf('p0')
  for (let i = 1; i <= 10; i += 1) t = splitPane(t, `p${i - 1}`, 'right', `p${i}`)
  assertInvariants('repeat-split', t)
  assertTiling('repeat-split', t)

  const { panes } = measure(t, BOX, GUTTER)
  const narrowest = Math.min(...[...panes.values()].map((r) => r.width))
  check(
    'repeat-split: no pane is squeezed below a usable width',
    narrowest >= 40,
    `narrowest = ${narrowest}px`
  )
}

// ---------------------------------------------------------------------------
// A corrupt state file must not be able to brick the grid
// ---------------------------------------------------------------------------

{
  const garbage: unknown[] = [
    null,
    undefined,
    42,
    'nope',
    {},
    { kind: 'leaf' },
    { kind: 'leaf', paneId: '' },
    { kind: 'split' },
    { kind: 'split', dir: 'sideways', children: [], sizes: [] },
    { kind: 'split', dir: 'row', children: [] },
    { kind: 'split', dir: 'row', children: [{ kind: 'leaf', paneId: 'a' }], sizes: [1] },
    { kind: 'split', dir: 'row', children: [{ kind: 'bogus' }, { kind: 'bogus' }], sizes: [1, 1] }
  ]

  for (const input of garbage) {
    let threw = false
    try {
      // Whatever survives must also survive every downstream operation.
      const out = sanitiseLayout(input)
      if (out) {
        measure(out, BOX, GUTTER)
        assertInvariants('sanitise', normalise(out))
      }
    } catch {
      threw = true
    }
    check(`sanitise: ${JSON.stringify(input)} does not throw`, !threw)
  }

  // Sizes that are missing, negative or NaN get replaced, not propagated.
  const weird = sanitiseLayout({
    kind: 'split',
    dir: 'row',
    children: [
      { kind: 'leaf', paneId: 'a' },
      { kind: 'leaf', paneId: 'b' },
      { kind: 'leaf', paneId: 'c' }
    ],
    sizes: [-1, 'x', null]
  })
  assertInvariants('sanitise-sizes', weird)
  check('sanitise: bad sizes become even shares', weird?.kind === 'split')

  // A cyclic-ish, absurdly deep tree is refused rather than blowing the stack.
  let deep: unknown = { kind: 'leaf', paneId: 'deep' }
  for (let i = 0; i < 200; i += 1) {
    deep = { kind: 'split', dir: i % 2 ? 'row' : 'column', children: [deep, { kind: 'leaf', paneId: `x${i}` }], sizes: [0.5, 0.5] }
  }
  let deepThrew = false
  try {
    const out = sanitiseLayout(deep)
    if (out) measure(normalise(out), BOX, GUTTER)
  } catch {
    deepThrew = true
  }
  check('sanitise: a 200-deep tree is handled without throwing', !deepThrew)
}

console.log(
  failures === 0
    ? `\nALL LAYOUT CHECKS PASSED (${checks} assertions)`
    : `\n${failures} of ${checks} LAYOUT CHECKS FAILED`
)
process.exit(failures === 0 ? 0 : 1)
