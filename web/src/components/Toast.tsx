import { useEffect, useRef, useState } from 'react'

interface ToastMsg { message: string; actionLabel?: string; onAction?: () => void }

export function Toast() {
  const [msg, setMsg] = useState<ToastMsg | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    const on = (e: Event) => {
      setMsg((e as CustomEvent<ToastMsg>).detail)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setMsg(null), 6000)
    }
    window.addEventListener('parchment:toast', on)
    return () => { window.removeEventListener('parchment:toast', on); clearTimeout(timer.current) }
  }, [])
  if (!msg) return null
  return (
    <div className="toast">
      <span>{msg.message}</span>
      {msg.actionLabel && (
        <button onClick={() => { msg.onAction?.(); setMsg(null) }}>{msg.actionLabel}</button>
      )}
    </div>
  )
}
