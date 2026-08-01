import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

export interface Project {
  id: string; name: string; color: string; archived: number; position?: number
}

// 任务配色盘：与服务端 entries.js 的 PALETTE 一致，另加几个中性色
const SWATCHES = [
  '#e05252', '#e08d52', '#d9a13b', '#6cae3f', '#3fae8c',
  '#4a90d9', '#7a6fd9', '#c45fb8', '#8a877e', '#5b6b7a',
]

export function Sidebar({ active, onSelect, refreshKey }: {
  active: string | null
  onSelect: (id: string | null) => void
  refreshKey: number      // 变化时重新拉项目列表
}) {
  const [projects, setProjects] = useState<Project[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const dragId = useRef<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  useEffect(() => {
    api<Project[]>('/api/projects').then(setProjects).catch(() => {})
  }, [refreshKey])

  const visible = projects.filter(p => !p.archived)

  async function archive(id: string) {
    await api(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) })
    setProjects(ps => ps.map(p => p.id === id ? { ...p, archived: 1 } : p))
    if (active === id) onSelect(null)
  }

  async function setColor(id: string, color: string) {
    setProjects(ps => ps.map(p => p.id === id ? { ...p, color } : p))   // 先变色，不等网络
    setPickerFor(null)
    await api(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ color }) })
  }

  // 拖动排序：把被拖的那个插到目标位置，整份新顺序提交给服务端
  async function dropOn(targetId: string) {
    const from = dragId.current
    dragId.current = null
    setDragOver(null)
    if (!from || from === targetId) return

    const order = visible.map(p => p.id)
    const fromIdx = order.indexOf(from)
    const toIdx = order.indexOf(targetId)
    if (fromIdx < 0 || toIdx < 0) return
    order.splice(toIdx, 0, ...order.splice(fromIdx, 1))

    const rank = new Map(order.map((id, i) => [id, i]))
    setProjects(ps => [...ps].sort((a, b) =>
      (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999)))
    await api('/api/projects/order', { method: 'PUT', body: JSON.stringify({ ids: order }) })
  }

  if (collapsed) {
    return (
      <nav className="sidebar collapsed">
        <button className="icon-btn" title="Expand sidebar" onClick={() => setCollapsed(false)}>»</button>
      </nav>
    )
  }

  return (
    <nav className="sidebar">
      <div className="side-head">
        <button className={`side-item ${active === null ? 'on' : ''}`} onClick={() => onSelect(null)}>
          <span className="side-name">All</span>
        </button>
        <button className="icon-btn" title="Collapse sidebar" onClick={() => setCollapsed(true)}>«</button>
      </div>

      {visible.map(p => (
        <div key={p.id}
          className={`side-item ${active === p.id ? 'on' : ''} ${dragOver === p.id ? 'drag-over' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(p.id) }}
          onDragLeave={() => setDragOver(cur => (cur === p.id ? null : cur))}
          onDrop={e => { e.preventDefault(); void dropOn(p.id) }}>

          <span className="side-grip" title="Drag to reorder" draggable
            onDragStart={() => { dragId.current = p.id }}
            onDragEnd={() => { dragId.current = null; setDragOver(null) }}>⋮⋮</span>

          <button className="side-dot" title="Change colour"
            onClick={e => { e.stopPropagation(); setPickerFor(v => (v === p.id ? null : p.id)) }}>
            <i style={{ background: p.color }} />
          </button>

          <button className="side-name" onClick={() => onSelect(p.id)}>{p.name}</button>

          <button className="icon-btn side-archive" title="Archive this task (notes are kept)"
            onClick={() => archive(p.id)}>⌫</button>

          {pickerFor === p.id && (
            <div className="color-pop" onMouseLeave={() => setPickerFor(null)}>
              {SWATCHES.map(c => (
                <button key={c} className={`swatch ${c === p.color ? 'on' : ''}`}
                  style={{ background: c }} title={c}
                  onClick={() => setColor(p.id, c)} />
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  )
}
