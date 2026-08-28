/**
 * Which key chords belong to GRID rather than to the program running in a pane.
 *
 * This has to be one shared list because two places need to agree exactly:
 *
 *   - `useShortcuts` acts on the chord at the window level, and
 *   - `TerminalSession` must tell xterm to ignore it.
 *
 * That second part is not optional. When xterm decides it handles a key it
 * calls its internal `cancel()`, which does `preventDefault()` **and
 * `stopPropagation()`** — so the event never reaches the window listener and
 * the shortcut silently does nothing. Returning `false` from
 * `attachCustomKeyEventHandler` makes xterm bail out before that, leaving the
 * event free to bubble.
 *
 * The list is deliberately narrow rather than "all of Ctrl+Alt". On many
 * non-US keyboard layouts AltGr *is* Ctrl+Alt, and claiming the whole range
 * would stop those users typing `@`, `\` or `~` into their terminals.
 */

/** Ctrl+Alt chords GRID binds. */
const CTRL_ALT_KEYS = new Set([
  't', // new terminal
  'g', // new browser pane
  'n', // new note
  'd', // split right
  's', // split down
  'w', // close pane
  'z', // zoom
  'e', // even out
  'r', // repositories
  'p', // repositories (alias, for machines where Ctrl+Alt+R is taken)
  'b', // notes
  'o', // open in editor
  ',', // settings
  '/', // shortcut sheet
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'arrowleft',
  'arrowright',
  'arrowup',
  'arrowdown'
])

/**
 * Ctrl+Shift chords. Most act on the focused terminal itself; `t` is the one
 * exception, and belongs to the app — it is the browser's own "bring back what
 * I just closed", which is exactly what it does here.
 */
const CTRL_SHIFT_KEYS = new Set([
  'c', // copy selection
  'v', // paste
  'f', // find
  'k', // clear
  't' // reopen the pane just closed
])

/** Plain Ctrl chords. Only the universal zoom keys, which no CLI binds. */
const CTRL_KEYS = new Set(['=', '+', '-', '_', '0'])

export type ChordKind = 'ctrl-alt' | 'ctrl-shift' | 'ctrl' | null

export function classifyChord(e: KeyboardEvent): ChordKind {
  const key = e.key.toLowerCase()
  if (e.ctrlKey && e.altKey && !e.shiftKey) {
    return CTRL_ALT_KEYS.has(key) ? 'ctrl-alt' : null
  }
  if (e.ctrlKey && e.shiftKey && !e.altKey) {
    return CTRL_SHIFT_KEYS.has(key) ? 'ctrl-shift' : null
  }
  if (e.ctrlKey && !e.altKey && !e.shiftKey) {
    return CTRL_KEYS.has(key) ? 'ctrl' : null
  }
  return null
}

/** True when the terminal must keep its hands off this key. */
export function isGridChord(e: KeyboardEvent): boolean {
  return classifyChord(e) !== null
}
