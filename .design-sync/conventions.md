# Building with DevMuxel

DevMuxel is the design system of a desktop app: a repo-aware tiled workspace for
terminals, browsers and AI coding sessions. It is **dark-only**, drawn on a blue-black
chassis with a 24px grid ruled into it, one signal red for anything that wants you,
and one soft green for clean and passing. **Square corners are a rule of the system,
not a default** — `tokens.css` sets `border-radius: 0` on `*`. Do not round anything.

## Wrapping and setup

Two things must be true or the design renders wrong:

1. **Paint the chassis.** Every colour here assumes a dark ground. `--ink` is
   `#e6e9ef`, so components on a white page are invisible. Set the page background
   to `var(--bg-chassis)` and the text to `var(--ink)`.
2. **Set the ui font.** `--font-ui` is Space Grotesk, `--font-mono` is JetBrains Mono.
   Both ship with the system; nothing else is needed.

There is no provider, no theme object and no context — the components read a plain
module store, so they render standalone.

```jsx
<div style={{ background: 'var(--bg-chassis)', color: 'var(--ink)', fontFamily: 'var(--font-ui)' }}>
  <YourScreen />
</div>
```

## The styling idiom: CSS classes, not props

DevMuxel styles with a **global stylesheet and BEM-ish class names**. Components take
no `className`, no `sx`, no style props — they carry their own classes internally. For
your own layout glue, use these same classes plus `var(--*)` tokens. Never invent a
class name; if nothing fits, use inline styles built from tokens.

| Family | Names |
|---|---|
| Buttons | `btn`, `btn--primary`, `btn--danger`, `btn--ghost`, `icon-btn`, `icon-btn--danger` |
| Status chips | `chip`, `chip--clean`, `chip--dirty`, `chip--conflict`, `chip--new`, `chip--sync`, `chip--error`, `chip--host`, `chip--device` |
| Dialogs | `overlay`, `scrim`, `dialog`, `dialog--narrow`, `dialog__head`, `dialog__title`, `dialog__body`, `dialog__foot`, `dialog__spacer` |
| Menus | `pmenu`, `pmenu__label`, `pmenu__item`, `pmenu__name`, `pmenu__path`, `pmenu__dot`, `pmenu__sep`, `pmenu__empty`, `menu-item` |
| Forms | `field`, `input`, `select`, `check`, `settings-grid`, `settings-section` |
| Chrome | `titlebar`, `tabstrip`, `pane`, `pane-header`, `pane-body`, `pane-btn`, `grid`, `splitter`, `empty`, `toast`, `kbd`, `keys` |
| Variants | `pane--browser` and `pane--note` recolour a pane; `browser-*` is the cool variant, `note-*` the warm one |

## Tokens

Never hard-code a hex. Every colour, metric and duration is a custom property:

- **Chassis** `--bg-chassis` `--bg-pane` `--bg-term` `--bg-header` `--bg-hover` `--bg-sunken` `--bg-chip`
- **Rules** `--line` `--line-strong` `--line-focus`
- **Ink** `--ink` `--ink-bright` `--ink-2` `--ink-3` `--ink-muted` `--ink-dim` `--ink-faint` `--ink-ghost` `--ink-term`
- **Signal** `--red` `--red-light` `--red-wash` `--red-wash-strong` `--green` `--amber`
- **Variants** `--browser-bg` `--browser-header` `--browser-line` `--blue` `--blue-wash`; `--note-bg` `--note-header` `--note-line` `--note-ink`
- **Type** `--font-ui` `--font-mono`
- **Metrics** `--titlebar-h` (38px) `--tabstrip-h` (30px) `--pane-header-h` (30px) `--statusbar-h` (24px) `--grid-rule` (24px) `--gutter` `--zoom-inset` `--glow`
- **Motion / elevation** `--ease-zoom` `--dur-zoom` `--dur-tint` `--shadow-zoom` `--shadow-dialog` `--scrim`

**Anything the machine wrote is monospace.** Paths, branches, urls, pids, status codes
and log output all take `--font-mono`; interface labels take `--font-ui`. Red is
reserved for *this wants you* and destructive actions — do not use it for decoration.

## Where the truth is

Read these before styling anything: `_ds/<folder>/styles.css` and its imports (the
tokens, the `@font-face` rules and the full component stylesheet), and the
`components/<group>/<Name>/<Name>.prompt.md` for a component's own API.

## An idiomatic build

Library component for the control, DS classes and tokens for your own glue:

```jsx
<div className="dialog dialog--narrow">
  <div className="dialog__head">
    <h2 className="dialog__title">CLOSE PANE</h2>
  </div>
  <div className="dialog__body" style={{ padding: '20px 16px' }}>
    <p style={{ margin: 0, font: '400 13px/1.6 var(--font-ui)', color: 'var(--ink-2)' }}>
      <strong>dev-muxel</strong> is still running (pid 24180).
    </p>
    <p style={{ margin: '10px 0 0', font: '400 11px/1.6 var(--font-mono)', color: 'var(--ink-faint)' }}>
      C:\Users\dev\projects\dev-muxel
    </p>
  </div>
  <div className="dialog__foot">
    <button className="btn btn--danger">Close it</button>
    <button className="btn btn--ghost">Keep it open</button>
  </div>
</div>
```

Titles in `dialog__title` and `pmenu__label` are **upper case with wide tracking** —
that is the system's voice for a section heading. Body copy is sentence case.
