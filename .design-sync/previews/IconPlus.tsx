import { IconPlus } from 'devlobby'

/** Titlebar — new terminal, new tab */
export const Default = (): React.JSX.Element => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--ink-2)' }}>
    <IconPlus />
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)' }}>
      12px — titlebar — new terminal, new tab
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
        <IconPlus size={16} />
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
    {[12, 16, 24, 32].map((size) => (
      <div key={size} style={{ display: 'grid', gap: 6, justifyItems: 'center' }}>
        <IconPlus size={size} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faint)' }}>
          {size}
        </span>
      </div>
    ))}
  </div>
)
