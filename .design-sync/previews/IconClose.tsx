import { IconClose } from 'devlobby'

/** The size the titlebar and pane headers actually draw it at. */
export const Default = (): React.JSX.Element => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--ink-2)' }}>
    <IconClose />
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)' }}>
      11px — pane header, tab strip
    </span>
  </div>
)

/** Icons inherit currentColor, so the same glyph carries every state. */
export const Tones = (): React.JSX.Element => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
    {[
      ['var(--ink-dim)', 'rest'],
      ['var(--ink)', 'hover'],
      ['var(--red)', 'danger']
    ].map(([colour, label]) => (
      <div key={label} style={{ display: 'grid', gap: 6, justifyItems: 'center', color: colour }}>
        <IconClose size={16} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faint)' }}>
          {label}
        </span>
      </div>
    ))}
  </div>
)

/** The 1px stroke language holds as the box grows. */
export const Scale = (): React.JSX.Element => (
  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, color: 'var(--ink-2)' }}>
    {[11, 16, 24, 32].map((size) => (
      <div key={size} style={{ display: 'grid', gap: 6, justifyItems: 'center' }}>
        <IconClose size={size} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faint)' }}>
          {size}
        </span>
      </div>
    ))}
  </div>
)
