import { useEffect, useState } from 'react'
import { api, onUnauthorized } from './api'
import { Login } from './components/Login'
import { SaveDot } from './components/SaveDot'
import { Timeline } from './components/Timeline'
import { Sidebar, type Project } from './components/Sidebar'
import { CommandPalette } from './components/CommandPalette'

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [project, setProject] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<string | null>(null)
  const [projRefresh, setProjRefresh] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])

  useEffect(() => {
    const kick = () => setAuthed(false)
    onUnauthorized.add(kick)
    api('/api/projects').then(() => setAuthed(true)).catch(() => {})
    return () => { onUnauthorized.delete(kick) }
  }, [])

  useEffect(() => {
    if (!authed) return
    api<Project[]>('/api/projects').then(setProjects).catch(() => {})
  }, [authed, projRefresh, paletteOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setPaletteOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (authed === null) return null
  if (!authed) return <Login onDone={() => setAuthed(true)} />
  return (
    <div className="app">
      <header className="topbar">
        <button className="icon-btn" title="搜索 (⌘K)" onClick={() => setPaletteOpen(true)}>🔍</button>
        <SaveDot />
      </header>
      <main className="main">
        <Sidebar active={project} refreshKey={projRefresh}
          onSelect={id => { setProject(id); setAnchor(null); setProjRefresh(k => k + 1) }} />
        <Timeline project={project} anchor={anchor} onExitAnchor={() => setAnchor(null)}
          onTagClick={id => { setProject(id); setAnchor(null); setProjRefresh(k => k + 1) }} />
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)}
        projects={projects}
        onJumpDay={day => { setProject(null); setAnchor(day) }}
        onSelectProject={id => { setProject(id); setAnchor(null) }} />
    </div>
  )
}
