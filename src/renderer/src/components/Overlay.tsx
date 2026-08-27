/**
 * The shell every dialog sits in.
 *
 * A modal over a grid of terminals has a problem an ordinary web modal does
 * not: xterm keeps DOM focus in its hidden textarea, so without intervention
 * the dialog looks modal but every keystroke still goes to the shell behind it.
 * Opening one therefore blurs the terminal and moves focus inside, and Tab is
 * trapped so it cannot wander back out.
 */

import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

export function Overlay({
  children,
  onClose
}: {
  children: React.ReactNode
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  /**
   * Move focus into the dialog — once, as it opens.
   *
   * Deliberately depends on nothing. The store publishes a new state object on
   * every git poll, every pty byte and every keystroke, so a dialog re-renders
   * constantly; repeating the handoff on each of those blurs whatever the user
   * is in the middle of. That is not cosmetic — it made the notes panel
   * unusable. Typing in a field lost the caret after one character, and
   * "Really delete" was blurred by the very render its own click caused, so
   * its onBlur reverted it to the bin icon before the click could land.
   */
  useEffect(() => {
    // Whatever had focus is almost certainly a terminal; take it away, or the
    // user types their dialog input into a shell.
    const previous = document.activeElement as HTMLElement | null
    previous?.blur?.()

    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
  }, [])

  // Escape and Tab, by contrast, do have to keep up with `onClose`: callers
  // pass a fresh arrow every render. Re-binding a listener is cheap, and
  // unlike the handoff above it touches nothing the user is holding.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }

      if (e.key !== 'Tab') return
      const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
        (el) => el.offsetParent !== null
      )
      if (items.length === 0) return

      const active = document.activeElement as HTMLElement | null
      const index = active ? items.indexOf(active) : -1
      const next = e.shiftKey
        ? items[(index <= 0 ? items.length : index) - 1]
        : items[(index + 1) % items.length]

      e.preventDefault()
      next?.focus()
    }

    // Capture phase, so this wins against xterm's own key handling.
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      ref={ref}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {children}
    </div>
  )
}
