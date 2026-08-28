/**
 * A menu hung off a button in the titlebar.
 *
 * Fixed rather than absolutely positioned inside its opener: the titlebar is a
 * 38px strip and anything inside it is clipped by it. The anchor's rect is
 * measured as the menu opens and it does not follow — the window moving out
 * from under a menu closes it instead, which is what every OS menu does.
 *
 * Not the `Overlay` dialog shell. That one takes focus away from the terminal
 * and traps Tab, which is right for a modal and wrong for a menu you opened by
 * mistake and want to dismiss by carrying on typing.
 */

import { useEffect, useRef } from 'react'

export function MenuPopover({
  anchorEl,
  onClose,
  children
}: {
  /** The button this hangs off. Excluded from the outside-click test, or its
   *  own toggle would close the menu and immediately reopen it. */
  anchorEl: HTMLElement
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (anchorEl.contains(target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    // Capture, because a click landing in a terminal is swallowed by xterm
    // before it would ever reach a bubbling listener here.
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [anchorEl, onClose])

  const rect = anchorEl.getBoundingClientRect()

  return (
    <div
      className="pmenu"
      role="menu"
      ref={ref}
      style={{
        // Kept on screen whatever the window is doing: a menu opened off a
        // button near the right edge would otherwise hang off it.
        left: Math.max(6, Math.min(rect.left, window.innerWidth - 260)),
        top: rect.bottom
      }}
    >
      {children}
    </div>
  )
}
