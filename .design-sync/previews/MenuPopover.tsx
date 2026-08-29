import { useEffect, useRef, useState } from 'react'
import { IconFolder, IconPlus, MenuPopover } from 'devlobby'

const noop = (): void => {}

/**
 * The menu measures its anchor's rect as it opens, so a preview has to hand it
 * a real mounted element rather than a fake. Render the opener, capture it, and
 * open on the next commit — which is what the titlebar does on a click.
 */
function Anchored({ children }: { children: React.ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  useEffect(() => setAnchor(ref.current), [])

  return (
    <div style={{ minHeight: 300 }}>
      <div
        className="titlebar"
        style={{ display: 'flex', alignItems: 'center', height: 38, padding: '0 8px' }}
      >
        <button ref={ref} className="titlebar__menu" type="button" style={{ whiteSpace: 'nowrap' }}>
          + New terminal
        </button>
      </div>
      {anchor ? (
        <MenuPopover anchorEl={anchor} onClose={noop}>
          {children}
        </MenuPopover>
      ) : null}
    </div>
  )
}

const Repo = ({
  name,
  path,
  colour
}: {
  name: string
  path: string
  colour?: string
}): React.JSX.Element => (
  <button className="pmenu__item" role="menuitem" type="button">
    <span className="pmenu__dot" style={colour ? { background: colour } : undefined} />
    <span className="pmenu__name">{name}</span>
    <span className="pmenu__path">{path}</span>
  </button>
)

/** The repository picker the titlebar's + button opens. */
export const Open = (): React.JSX.Element => (
  <Anchored>
    <span className="pmenu__label">OPEN A TERMINAL ON</span>
    <Repo name="devlobby" path="C:\Users\dev\projects\devlobby" colour="#e5372a" />
    <Repo name="orbit-api" path="C:\Users\dev\projects\orbit-api" colour="#5b8fd6" />
    <Repo name="ledger" path="C:\Users\dev\projects\ledger" colour="#62c08a" />
    <div className="pmenu__sep" />
    <button className="pmenu__item" role="menuitem" type="button">
      <IconFolder size={11} />
      <span className="pmenu__name">Choose a folder…</span>
    </button>
    <button className="pmenu__item" role="menuitem" type="button">
      <IconPlus size={10} />
      <span className="pmenu__name">Repositories…</span>
    </button>
  </Anchored>
)

/** Nothing declared yet — the menu says so rather than opening empty. */
export const Empty = (): React.JSX.Element => (
  <Anchored>
    <span className="pmenu__label">OPEN A TERMINAL ON</span>
    <p className="pmenu__empty">
      No repositories declared yet. Open one anywhere, or go and declare some.
    </p>
    <div className="pmenu__sep" />
    <button className="pmenu__item" role="menuitem" type="button">
      <IconFolder size={11} />
      <span className="pmenu__name">Choose a folder…</span>
    </button>
  </Anchored>
)
