import { IconArrowLeft } from 'dev-muxel'

/** Browser — back */
export const Default = (): React.JSX.Element => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--ink-2)' }}>
    <IconArrowLeft />
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)' }}>
      11px — browser — back
    </span>
  </div>
)

/** Icons inherit currentColor, so one glyph carries every state. */
export const Tones = (): React.JSX.Element => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
    {[
      ['var(--ink-dim)', 'rest'],
      ['var(--ink)', 'hover'],
      ['var(--red)', 'signal']
    ].map(([colour, label]) => (
      <div key={label} style={{ display: 'grid', gap: 6, justifyItems: 'center', color: colour }}>
        <IconArrowLeft size={16} />
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
        <IconArrowLeft size={size} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faint)' }}>
          {size}
        </span>
      </div>
    ))}
  </div>
)
