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

  useEffect(() => {
    // Whatever had focus is almost certainly a terminal; take it away, or the
    // user types their dialog input into a shell.
    const previous = document.activeElement as HTMLElement | null
    previous?.blur?.()

    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()

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
