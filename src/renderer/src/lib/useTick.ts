import { useEffect, useState } from 'react'

/**
 * Re-render on an interval. Used for the relative "saved 12s ago" labels,
 * which would otherwise freeze at whatever they said when the pane last
 * rendered for some other reason.
 */
export function useTick(everyMs: number, enabled = true): void {
  const [, bump] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => bump((n) => n + 1), everyMs)
    return () => window.clearInterval(id)
  }, [everyMs, enabled])
}
