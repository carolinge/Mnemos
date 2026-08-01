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
        <h1>Mnemos</h1>
        <input
          type="password" autoFocus value={pw} placeholder="Access password"
          onChange={e => { setPw(e.target.value); setErr(false) }}
        />
        {err && <p className="login-err">Wrong password</p>}
        <button type="submit">Enter</button>
      </form>
    </div>
  )
}
