/**
 * Opening a hover card off whatever the pointer is resting on.
 *
 * Only the anchor lives here; what gets drawn is the caller's business. The
 * delay is the point — a header is a row of small things next to each other,
 * and a card that appeared the instant the pointer crossed one would flash
 * every time somebody moved the mouse across the grid to press a button.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** How long the pointer rests before the card appears. */
const HOVER_DELAY_MS = 220

export type HoverCard = {
  /** The element the card should hang off, or null while there is no card. */
  anchor: HTMLElement | null
  close: () => void
  /** Spread onto the element being hovered. */
  bind: {
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => void
    onPointerLeave: () => void
    onPointerDown: () => void
  }
}

export function useHoverCard(): HoverCard {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const timer = useRef<number | null>(null)

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }, [])

  const close = useCallback(() => {
    cancel()
    setAnchor(null)
  }, [cancel])

  // A pending open outliving the component would set state on nothing.
  useEffect(() => cancel, [cancel])

  return {
    anchor,
    close,
    bind: {
      onPointerEnter: (e) => {
        // Touch and pen do not hover, so their "enter" is a tap — which would
        // leave a card up with nothing on its way to dismiss it.
        if (e.pointerType !== 'mouse') return
        const el = e.currentTarget
        cancel()
        timer.current = window.setTimeout(() => setAnchor(el), HOVER_DELAY_MS)
      },
      onPointerLeave: close,
      // A pane header is a drag handle. Whatever this is hanging off, pressing
      // on it means something is about to move, and the card must not ride along.
      onPointerDown: close
    }
  }
}
