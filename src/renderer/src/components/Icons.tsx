/**
 * Inline icons.
 *
 * The design mocks these as text glyphs (⑂ ⤢ ✕ ＋). Those come from font
 * fallback on Windows, so their weight and baseline drift from pane to pane.
 * Drawing them keeps the 1px stroke language of the chassis exact, and the
 * shapes stay identical whatever fonts the machine has.
 *
 * All icons inherit `currentColor` and default to a 12px box on a 24px grid.
 */

type IconProps = {
  size?: number
  className?: string
  strokeWidth?: number
}

function svgProps(size: number, strokeWidth: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'square' as const,
    strokeLinejoin: 'miter' as const,
    'aria-hidden': true,
    focusable: false
  }
}

export function IconBranch({ size = 11, strokeWidth = 1.4 }: IconProps): React.JSX.Element {
  // The ⑂ fork from the design: one line splitting into two.
  return (
    <svg {...svgProps(size, strokeWidth)}>
      <path d="M4.5 2.5v5.5a2.5 2.5 0 0 0 2.5 2.5h4.5" />
      <path d="M4.5 10.5v3" />
      <circle cx="4.5" cy="2" r="1.4" />
      <circle cx="12" cy="10.5" r="1.4" />
      <circle cx="4.5" cy="14" r="1.4" />
    </svg>
  )
}

export function IconZoom({ size = 11, strokeWidth = 1.4 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size, strokeWidth)}>
      <path d="M9.5 2.5h4v4" />
      <path d="M13.5 2.5 9 7" />
      <path d="M6.5 13.5h-4v-4" />
      <path d="M2.5 13.5 7 9" />
    </svg>
  )
}

export function IconUnzoom({ size = 11, strokeWidth = 1.4 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size, strokeWidth)}>
      <path d="M13.5 2.5 9.5 6.5" />
      <path d="M9.5 2.5v4h4" />
      <path d="M2.5 13.5 6.5 9.5" />
      <path d="M6.5 13.5v-4h-4" />
    </svg>
  )
}

export function IconClose({ size = 11, strokeWidth = 1.4 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size, strokeWidth)}>
      <path d="m3.5 3.5 9 9" />
      <path d="m12.5 3.5-9 9" />
    </svg>
  )
}

export function IconPlus({ size = 12, strokeWidth = 1.4 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size, strokeWidth)}>
      <path d="M8 3v10" />
      <path d="M3 8h10" />
    </svg>
  )
}

export function IconMinimise({ size = 11, strokeWidth = 1.2 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size, strokeWidth)}>
      <path d="M3 8h10" />
    </svg>
  )
}

export function IconMaximise({ size = 10, strokeWidth = 1.2 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size, strokeWidth)}>
      <rect x="3" y="3" width="10" height="10" />
    </svg>
  )
}

export function IconRestore({ size = 10, strokeWidth = 1.2 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size, strokeWidth)}>
      <rect x="3" y="5.5" width="7.5" height="7.5" />
      <path d="M5.5 3h7.5v7.5" />
    </svg>
  )
}

export function IconFolder({ size = 12, strokeWidth = 1.3 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size, strokeWidth)}>
      <path d="M2 4h4l1.5 2H14v7.5H2z" />
    </svg>
  )
}

export function IconTrash({ size = 12, strokeWidth = 1.3 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size, strokeWidth)}>
      <path d="M3 4.5h10" />
      <path d="M6 4.5V3h4v1.5" />
      <path d="M4.5 4.5v9h7v-9" />
      <path d="M6.75 7v4M9.25 7v4" />
    </svg>
  )
}

export function IconSearch({ size = 12, strokeWidth = 1.3 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size, strokeWidth)}>
      <circle cx="7" cy="7" r="4" />
      <path d="m10 10 3.5 3.5" />
    </svg>
  )
}

export function IconArrowUp({ size = 10, strokeWidth = 1.4 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size, strokeWidth)}>
      <path d="M8 13V3.5" />
      <path d="m4 7 4-4 4 4" />
    </svg>
  )
}

export function IconArrowDown({ size = 10, strokeWidth = 1.4 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size, strokeWidth)}>
      <path d="M8 3v9.5" />
      <path d="m4 9 4 4 4-4" />
    </svg>
  )
}

export function IconSend({ size = 12, strokeWidth = 1.3 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size, strokeWidth)}>
      <path d="M2.5 8h9" />
      <path d="m8 4.5 3.5 3.5L8 11.5" />
      <path d="M13.5 3v10" />
    </svg>
  )
}

export function IconRefresh({ size = 12, strokeWidth = 1.3 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size, strokeWidth)}>
      <path d="M13 8a5 5 0 1 1-1.6-3.7" />
      <path d="M13.5 2v3h-3" />
    </svg>
  )
}

export function IconScan({ size = 12, strokeWidth = 1.3 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size, strokeWidth)}>
      <path d="M2.5 5.5v-3h3" />
      <path d="M13.5 5.5v-3h-3" />
      <path d="M2.5 10.5v3h3" />
      <path d="M13.5 10.5v3h-3" />
      <path d="M2.5 8h11" />
    </svg>
  )
}

export function IconDot({ size = 6 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 6 6" aria-hidden focusable={false}>
      <rect width="6" height="6" fill="currentColor" />
    </svg>
  )
}
