import { useEffect, useState } from 'react'
import { api, onUnauthorized, API_PREFIX } from './api'
import { Login } from './components/Login'
import { SaveDot } from './components/SaveDot'
import { Timeline } from './components/Timeline'
import { Sidebar, type Project } from './components/Sidebar'
import { CommandPalette } from './components/CommandPalette'
import { TimeScrubber } from './components/TimeScrubber'
import { Lightbox } from './components/Lightbox'
import { Toast } from './components/Toast'
import { Waking } from './components/Waking'
import { ShortcutsHelp } from './components/ShortcutsHelp'
import { recoverDrafts } from './lib/recoverDrafts'

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [project, setProject] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<string | null>(null)
  const [projRefresh, setProjRefresh] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  // 碎碎念显示与否，记在本地，刷新后保持
  const [showAsides, setShowAsides] = useState(() => localStorage.getItem('showAsides') !== 'off')

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

  // 断网时写在「还没保存过的新卡片」里的字会留在 localStorage，但刷新后没有任何
  // 组件会再读它——启动时把这些补传成正式条目。联网事件也触发一次，免得非要重开页面。
  useEffect(() => {
    if (!authed) return
    let done = false     // StrictMode 下 effect 会跑两次，别补传两遍
    const flush = async () => {
      if (done) return
      done = true
      try {
        const r = await recoverDrafts(body =>
          api('/api/entries', { method: 'POST', body: JSON.stringify(body) }))
        if (r.recovered > 0) {
          setProjRefresh(k => k + 1)
          window.dispatchEvent(new CustomEvent('parchment:toast', {
            detail: {
              message: r.recovered === 1
                ? `Recovered 1 unsaved note (${r.days[0]})`
                : `Recovered ${r.recovered} unsaved notes (${r.days.join(', ')})`,
            },
          }))
        }
      } finally { done = false }
    }
    void flush()
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [authed])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      // ⌘P 总是开面板；⌘K 让位给 Typora 的「插入链接」——正在编辑时不抢
      const inEditor = (e.target as HTMLElement | null)?.closest?.('.ProseMirror') != null
      if (key === 'p' || (key === 'k' && !inEditor)) {
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
          <button className="icon-btn" title="Export" onClick={() => setExportOpen(v => !v)}>⤓</button>
          {exportOpen && (
            <div className="export-menu" onMouseLeave={() => setExportOpen(false)}>
              <a href={`${API_PREFIX}/api/export?format=full`} onClick={() => setExportOpen(false)}>
                Single Markdown<small>One file, opens in Typora</small>
              </a>
              <a href={`${API_PREFIX}/api/export?format=monthly`} onClick={() => setExportOpen(false)}>
                Split by month<small>One .md per month</small>
              </a>
              <a href={`${API_PREFIX}/api/export?format=print`} target="_blank" rel="noreferrer"
                onClick={() => setExportOpen(false)}>
                Print / save PDF<small>Opens a new tab, then ⌘P</small>
              </a>
            </div>
          )}
        </span>
        <button className="icon-btn" title="Toggle theme" onClick={() => {
          const cur = document.documentElement.dataset.theme
          const next = cur === 'dark' ? 'light' : 'dark'
          document.documentElement.dataset.theme = next
          localStorage.setItem('theme', next)
        }}>◐</button>
        <ShortcutsHelp />
        <button className={`icon-btn ${showAsides ? '' : 'off'}`}
          title={showAsides ? 'Hide daily notes' : 'Show daily notes'}
          onClick={() => {
            const next = !showAsides
            setShowAsides(next)
            localStorage.setItem('showAsides', next ? 'on' : 'off')
          }}>💭</button>
        <button className="icon-btn" title="Search (⌘P, or ⌘K outside the editor)"
          onClick={() => setPaletteOpen(true)}>🔍</button>
        <SaveDot />
      </header>
      <main className="main">
        <Sidebar active={project} refreshKey={projRefresh}
          onSelect={id => { setProject(id); setAnchor(null); setProjRefresh(k => k + 1) }} />
        <Timeline project={project} anchor={anchor} tasks={projects} showAsides={showAsides}
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
      <Waking />
    </div>
  )
}
