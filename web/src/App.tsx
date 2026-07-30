import { useEffect, useState } from 'react'
import { api, onUnauthorized } from './api'
import { Login } from './components/Login'
import { SaveDot } from './components/SaveDot'
import { Timeline } from './components/Timeline'
import { Sidebar } from './components/Sidebar'

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [project, setProject] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<string | null>(null)
  const [projRefresh, setProjRefresh] = useState(0)

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
        <Sidebar active={project} refreshKey={projRefresh}
          onSelect={id => { setProject(id); setAnchor(null); setProjRefresh(k => k + 1) }} />
        <Timeline project={project} anchor={anchor} onExitAnchor={() => setAnchor(null)}
          onTagClick={id => { setProject(id); setAnchor(null); setProjRefresh(k => k + 1) }} />
      </main>
    </div>
  )
}
