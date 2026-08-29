import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { ColorWheel } from './ColorWheel'

export interface Project {
  id: string; name: string; color: string; archived: number; position?: number
}

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

  async function setColor(id: string, color: string) {
    setProjects(ps => ps.map(p => p.id === id ? { ...p, color } : p))   // 先变色，不等网络
    await api(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ color }) })
  }

  // 新任务：建一张空卡片带上这个任务名，任务就出现了
  async function addTask() {
    const name = window.prompt('New task name')?.trim()
    if (!name) return
    await api('/api/entries', { method: 'POST', body: JSON.stringify({ task: name }) })
    const list = await api<Project[]>('/api/projects')
    setProjects(list)
    onSelect(list.find(p => p.name === name)?.id ?? null)
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


          {pickerFor === p.id && (
            <ColorWheel value={p.color} onPick={c => setColor(p.id, c)}
              onClose={() => setPickerFor(null)} />
          )}
        </div>
      ))}

      <button className="side-add" title="New task" onClick={addTask}>＋</button>
    </nav>
  )
}
