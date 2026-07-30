import { useEffect, useState } from 'react'
import { api, onUnauthorized } from './api'
import { Login } from './components/Login'
import { SaveDot } from './components/SaveDot'
import { EntryCard } from './components/EntryCard'

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
      <main className="main">
        <div style={{ maxWidth: 720, margin: '0 auto', padding: 16, width: '100%' }}>
          <EntryCard entry={null} day={new Date().toISOString().slice(0, 10)} draftKey="scratch" />
        </div>
      </main>
    </div>
  )
}
