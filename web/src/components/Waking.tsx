import { useEffect, useState } from 'react'

// 服务器休眠后第一次请求要等它启动。这条提示让「界面卡住」变成「知道在等什么」。
export function Waking() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const h = (e: Event) => setOn((e as CustomEvent<boolean>).detail)
    window.addEventListener('parchment:waking', h)
    return () => window.removeEventListener('parchment:waking', h)
  }, [])
  if (!on) return null
  return (
    <div className="waking" role="status">
      <span className="waking-dot" />
      Waking the server…
    </div>
  )
}
