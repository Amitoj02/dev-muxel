import { useEffect } from 'react'

export function Toast({
  text,
  tone,
  onDone
}: {
  text: string
  tone: 'info' | 'error'
  onDone: () => void
}): React.JSX.Element {
  useEffect(() => {
    const id = window.setTimeout(onDone, tone === 'error' ? 6000 : 3400)
    return () => window.clearTimeout(id)
  }, [onDone, tone])

  return (
    <div className="toast" data-tone={tone} onClick={onDone}>
      {text}
    </div>
  )
}
