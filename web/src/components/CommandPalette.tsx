import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { DayGroup } from '../lib/groupDays'
import type { Project } from './Sidebar'

export function parseDateQuery(q: string, defaultYear = new Date().getFullYear()): string | null {
  const s = q.trim()
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日?$/)
  if (m) return `${m[1] ?? defaultYear}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return null
}

interface Hit { id: string; day: string; text: string }

export function CommandPalette({ open, onClose, onJumpDay, onSelectProject, projects }: {
  open: boolean
  onClose: () => void
  onJumpDay: (day: string) => void
  onSelectProject: (id: string | null) => void
  projects: Project[]
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) { setQ(''); setHits([]); setTimeout(() => inputRef.current?.focus(), 0) } }, [open])

  useEffect(() => {
    clearTimeout(timer.current)
    if (!q.trim()) { setHits([]); return }
    timer.current = setTimeout(async () => {
      try {
        const r = await api<{ days: DayGroup[] }>(`/api/entries?q=${encodeURIComponent(q)}`)
        setHits(r.days.flatMap(d => d.entries.map(e => ({
          id: e.id, day: d.day, text: e.text || '(无文本)',
        }))).slice(0, 30))
      } catch { setHits([]) }
    }, 300)
    return () => clearTimeout(timer.current)
  }, [q])

  if (!open) return null
  const dateHit = parseDateQuery(q)
  const projHits = q.trim()
    ? projects.filter(p => !p.archived && p.name.toLowerCase().includes(q.trim().toLowerCase()))
    : []

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={e => e.stopPropagation()}>
        <input ref={inputRef} value={q} placeholder="搜索笔记 · 输日期跳转 · 输项目名切换"
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') onClose() }} />
        <div className="palette-list">
          {dateHit && (
            <button className="palette-item" onClick={() => { onJumpDay(dateHit); onClose() }}>
              📅 跳到 {dateHit}
            </button>
          )}
          {projHits.map(p => (
            <button key={p.id} className="palette-item" onClick={() => { onSelectProject(p.id); onClose() }}>
              <i className="dot" style={{ background: p.color }} /> 项目：{p.name}
            </button>
          ))}
          {hits.map(h => (
            <button key={h.id} className="palette-item" onClick={() => { onJumpDay(h.day); onClose() }}>
              <span className="palette-day">{h.day}</span>
              <span className="palette-text">{h.text.slice(0, 80)}</span>
            </button>
          ))}
          {!hits.length && !dateHit && !projHits.length && q.trim() && (
            <p className="palette-empty">没找到 —— 换个词试试</p>
          )}
        </div>
      </div>
    </div>
  )
}
