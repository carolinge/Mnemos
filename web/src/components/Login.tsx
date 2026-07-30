import { useState } from 'react'
import { api } from '../api'

export function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ password: pw }) })
      onDone()
    } catch {
      setErr(true)
    }
  }
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>Parchment</h1>
        <input
          type="password" autoFocus value={pw} placeholder="访问密码"
          onChange={e => { setPw(e.target.value); setErr(false) }}
        />
        {err && <p className="login-err">密码不对</p>}
        <button type="submit">进入</button>
      </form>
    </div>
  )
}
