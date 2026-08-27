/**
 * Repository accent colours.
 *
 * A colour is the fastest way to tell a wall of near-identical terminals
 * apart — faster than reading the repo name in every header. It is stored on
 * the repository, so every terminal opened there is tinted the same way.
 *
 * Signal red is deliberately not on the palette: red means "this pane wants
 * you", and a repository that is permanently red would drown that out.
 */

/** Eight colours that sit on the chassis; the first six are the xterm palette. */
export const REPO_COLOURS: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: '#5b8fd6', name: 'blue' },
  { hex: '#4fb3bf', name: 'cyan' },
  { hex: '#62c08a', name: 'green' },
  { hex: '#c9a227', name: 'amber' },
  { hex: '#b071c9', name: 'violet' },
  { hex: '#e08b3e', name: 'orange' },
  { hex: '#d96a9a', name: 'pink' },
  { hex: '#7d8ba1', name: 'slate' }
]

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * A colour safe to hand to CSS, or null.
 *
 * The value comes out of the state file and ends up in an inline style, so it
 * is checked rather than trusted: a hand-edited `color` field cannot smuggle
 * anything past this.
 */
export function accentOf(colour: string | null | undefined): string | null {
  if (typeof colour !== 'string') return null
  const trimmed = colour.trim()
  return HEX.test(trimmed) ? trimmed.toLowerCase() : null
}
