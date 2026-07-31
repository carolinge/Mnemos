import { useEffect, useState } from 'react'

export function Lightbox() {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const on = (e: Event) => setSrc((e as CustomEvent<string>).detail)
    window.addEventListener('parchment:lightbox', on)
    return () => window.removeEventListener('parchment:lightbox', on)
  }, [])
  if (!src) return null
  return (
    <div className="lightbox" onClick={() => setSrc(null)}>
      <img src={src} alt="" />
    </div>
  )
}
