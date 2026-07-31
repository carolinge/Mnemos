import { useEffect, useState } from 'react'
import { api, onUnauthorized } from './api'
import { Login } from './components/Login'
import { SaveDot } from './components/SaveDot'
import { Timeline } from './components/Timeline'
import { Sidebar, type Project } from './components/Sidebar'
import { CommandPalette } from './components/CommandPalette'
import { TimeScrubber } from './components/TimeScrubber'
import { Lightbox } from './components/Lightbox'
import { Toast } from './components/Toast'

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [project, setProject] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<string | null>(null)
  const [projRefresh, setProjRefresh] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
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
        <span className="export-menu-wrap">
          <button className="icon-btn" title="导出" onClick={() => setExportOpen(v => !v)}>⤓</button>
          {exportOpen && (
            <div className="export-menu" onMouseLeave={() => setExportOpen(false)}>
              <a href="/api/export?format=full" onClick={() => setExportOpen(false)}>
                整份 Markdown<small>一个文件，可用 Typora 打开</small>
              </a>
              <a href="/api/export?format=monthly" onClick={() => setExportOpen(false)}>
                按月拆分<small>每月一个 .md</small>
              </a>
              <a href="/api/export?format=print" target="_blank" rel="noreferrer"
                onClick={() => setExportOpen(false)}>
                打印 / 存 PDF<small>新标签页打开后 ⌘P</small>
              </a>
            </div>
          )}
        </span>
        <button className="icon-btn" title="切换主题" onClick={() => {
          const cur = document.documentElement.dataset.theme
          const next = cur === 'dark' ? 'light' : 'dark'
          document.documentElement.dataset.theme = next
          localStorage.setItem('theme', next)
        }}>◐</button>
        <button className="icon-btn" title="搜索 (⌘K)" onClick={() => setPaletteOpen(true)}>🔍</button>
        <SaveDot />
      </header>
      <main className="main">
        <Sidebar active={project} refreshKey={projRefresh}
          onSelect={id => { setProject(id); setAnchor(null); setProjRefresh(k => k + 1) }} />
        <Timeline project={project} anchor={anchor} tasks={projects}
          onExitAnchor={() => setAnchor(null)}
          onTasksChanged={() => setProjRefresh(k => k + 1)}
          onTaskClick={id => { setProject(id); setAnchor(null); setProjRefresh(k => k + 1) }} />
        <TimeScrubber refreshKey={projRefresh}
          onJump={day => { setProject(null); setAnchor(day) }} />
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)}
        projects={projects}
        onJumpDay={day => { setProject(null); setAnchor(day) }}
        onSelectProject={id => { setProject(id); setAnchor(null) }} />
      <Lightbox />
      <Toast />
    </div>
  )
}
