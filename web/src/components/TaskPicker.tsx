import { useEffect, useRef, useState } from 'react'
import type { Project } from './Sidebar'

// 卡片左上角的任务选择器：点开下拉，可搜、可选已有任务、可回车新建。
export function TaskPicker({ value, tasks, onPick }: {
  value: { id?: string; name: string; color?: string } | null
  tasks: Project[]
  onPick: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const boxRef = useRef<HTMLSpanElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQ('')
    setTimeout(() => inputRef.current?.focus(), 0)
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const needle = q.trim().toLowerCase()
  const matches = tasks.filter(t => !t.archived && t.name.toLowerCase().includes(needle))
  const exact = tasks.some(t => t.name.toLowerCase() === needle)

  function pick(name: string) {
    onPick(name)
    setOpen(false)
  }

  return (
    <span className="task-picker" ref={boxRef}>
      <button className={`task-chip ${value ? '' : 'empty'}`} onClick={() => setOpen(v => !v)}
        title="Assign a task">
        {value
          ? <><i style={{ background: value.color ?? 'var(--muted)' }} />{value.name}</>
          : '＋ Task'}
      </button>
      {open && (
        <div className="task-menu">
          <input ref={inputRef} value={q} placeholder="Search or create a task"
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { setOpen(false); return }
              if (e.key === 'Enter') {
                const first = matches[0]
                if (needle && !exact) pick(q.trim())
                else if (first) pick(first.name)
              }
            }} />
          <div className="task-menu-list">
            {matches.map(t => (
              <button key={t.id} className="task-menu-item" onClick={() => pick(t.name)}>
                <i style={{ background: t.color }} />{t.name}
              </button>
            ))}
            {needle && !exact && (
              <button className="task-menu-item create" onClick={() => pick(q.trim())}>
                ＋ Create “{q.trim()}”
              </button>
            )}
            {!matches.length && !needle && <p className="task-menu-empty">No tasks yet — type a name to create one</p>}
          </div>
          {value && (
            <button className="task-menu-item clear" onClick={() => { onPick(''); setOpen(false) }}>
              Clear task
            </button>
          )}
        </div>
      )}
    </span>
  )
}
