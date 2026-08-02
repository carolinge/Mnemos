import { useEffect, useRef } from 'react'

// 与卡片同质感的确认弹窗，替代浏览器原生 confirm。
export function Confirm({ message, detail, confirmLabel = 'Delete', danger = true, onConfirm, onCancel }: {
  message: string
  detail?: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const okRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    okRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-box" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <p className="confirm-msg">{message}</p>
        {detail && <p className="confirm-detail">{detail}</p>}
        <div className="confirm-actions">
          <button className="confirm-cancel" onClick={onCancel}>Cancel</button>
          <button ref={okRef} className={`confirm-ok ${danger ? 'danger' : ''}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
