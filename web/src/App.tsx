import { useEffect, useState } from 'react'
import { api, onUnauthorized } from './api'
import { Login } from './components/Login'
import { SaveDot } from './components/SaveDot'

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    const kick = () => setAuthed(false)
    onUnauthorized.add(kick)
    api('/api/projects').then(() => setAuthed(true)).catch(() => {})
    return () => { onUnauthorized.delete(kick) }
  }, [])

  if (authed === null) return null
  if (!authed) return <Login onDone={() => setAuthed(true)} />
  return (
    <div className="app">
      <header className="topbar"><SaveDot /></header>
      <main className="main">{/* Timeline 于 Task 11 接入 */}</main>
    </div>
  )
}
