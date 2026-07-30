import { useEffect, useState } from 'react'
import { api } from '../api'

export interface Project { id: string; name: string; color: string; archived: number }

export function Sidebar({ active, onSelect, refreshKey }: {
  active: string | null
  onSelect: (id: string | null) => void
  refreshKey: number      // 变化时重新拉项目列表
}) {
  const [projects, setProjects] = useState<Project[]>([])
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    api<Project[]>('/api/projects').then(setProjects).catch(() => {})
  }, [refreshKey])

  async function archive(id: string) {
    await api(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) })
    setProjects(ps => ps.map(p => p.id === id ? { ...p, archived: 1 } : p))
    if (active === id) onSelect(null)
  }

  if (collapsed) {
    return <nav className="sidebar collapsed"><button className="icon-btn" title="展开" onClick={() => setCollapsed(false)}>»</button></nav>
  }
  return (
    <nav className="sidebar">
      <div className="side-head">
        <button className={`side-item ${active === null ? 'on' : ''}`} onClick={() => onSelect(null)}>
          <span className="side-name">全部</span>
        </button>
        <button className="icon-btn" title="收起" onClick={() => setCollapsed(true)}>«</button>
      </div>
      {projects.filter(p => !p.archived).map(p => (
        <div key={p.id} className={`side-item ${active === p.id ? 'on' : ''}`}>
          <button className="side-name" onClick={() => onSelect(p.id)}>
            <i style={{ background: p.color }} />{p.name}
          </button>
          <button className="icon-btn side-archive" title="归档" onClick={() => archive(p.id)}>⌫</button>
        </div>
      ))}
    </nav>
  )
}
