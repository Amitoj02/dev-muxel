/**
 * The mark, and the lockup it sits in.
 *
 * A D built out of the product: a narrow pane (the stem), the gutter between
 * them, and a wide pane crossed by its header rule (the bowl). Two radii,
 * never one — r7.5 on the stem, r17.5 on the bowl — and that asymmetry is what
 * makes the silhouette read as a letter at 16px rather than as a pill.
 *
 * The paths are `brand-kit/svg/mark.svg` verbatim, on the brand's own 64-unit
 * construction grid. `scripts/make-icon.mjs` draws the same construction from
 * the same fractions into `build/icon.ico`, so the window, the taskbar and the
 * installer all wear this shape.
 *
 * The radii are the one place the system's square corners do not apply — see
 * the brand guide's "NOT THIS". `* { border-radius: 0 }` in tokens.css cannot
 * reach SVG geometry, so nothing here is fighting it.
 */

type MarkProps = {
  /** Edge of the square the mark is drawn in. Never below 16 — the gutter
   *  stops being a gutter, and the D closes up into a blob. */
  size?: number
}

export function BrandMark({ size = 16 }: MarkProps): React.JSX.Element {
  return (
    <svg
      className="brandmark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden
      focusable={false}
    >
      <path d="M7.5,0 H22.5 V64 H7.5 A7.5,7.5 0 0 1 0,56.5 V7.5 A7.5,7.5 0 0 1 7.5,0 Z" />
      <path d="M26.5,0 H46.5 A17.5,17.5 0 0 1 64,17.5 V46.5 A17.5,17.5 0 0 1 46.5,64 H26.5 Z" />
      <rect className="brandmark__rule" x="26.5" y="24" width="37.5" height="16" />
    </svg>
  )
}

/**
 * The horizontal lockup — the primary one.
 *
 * Both measures below are fractions of the mark, so the whole thing scales off
 * one number: the gap is 0.28 of it and the wordmark 0.72, which is what puts
 * the 24px mark and the 17px wordmark at their floors together. Below that,
 * the brand asks for the mark on its own, which is why the titlebar carries a
 * plain app name beside a 16px mark rather than this.
 */
export function BrandLockup({ size = 28 }: MarkProps): React.JSX.Element {
  return (
    <div className="lockup" style={{ gap: size * 0.28 }}>
      <BrandMark size={size} />
      <span className="lockup__word" style={{ fontSize: size * 0.72 }}>
        <span className="lockup__dev">Dev</span>
        <span className="lockup__lobby">Lobby</span>
      </span>
    </div>
  )
}
