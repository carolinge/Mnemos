import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { fmtDay } from '../lib/groupDays'

// 日期标头：点日期可改成别的日期（补笔记用），双击展开当天碎碎念。
export function DayHeader({ day, note, onChangeDay, onNoteSaved }: {
  day: string
  note: string
  onChangeDay?: (from: string, to: string) => void
  onNoteSaved?: (day: string, text: string) => void
}) {
  const [editingDate, setEditingDate] = useState(false)
  const [showNote, setShowNote] = useState(Boolean(note))
  const [draft, setDraft] = useState(note)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => { setDraft(note); if (note) setShowNote(true) }, [note])

  function saveNote(text: string) {
    setDraft(text)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      await api(`/api/day-notes/${day}`, { method: 'PUT', body: JSON.stringify({ text }) })
      onNoteSaved?.(day, text)
    }, 800)
  }

  return (
    <div className="day-head">
      {editingDate ? (
        <input className="day-date-input" type="date" defaultValue={day} autoFocus
          onBlur={e => {
            setEditingDate(false)
            if (e.target.value && e.target.value !== day) onChangeDay?.(day, e.target.value)
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') setEditingDate(false)
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }} />
      ) : (
        <button className="day-date" title="点击改日期 · 双击写今日碎碎念"
          onClick={() => setEditingDate(true)}
          onDoubleClick={e => { e.stopPropagation(); setEditingDate(false); setShowNote(v => !v) }}>
          {fmtDay(day)}
        </button>
      )}
      {!showNote && note && <span className="day-note-dot" title="有碎碎念" />}
      {showNote && (
        <input className="day-note" value={draft} placeholder="今天的碎碎念…"
          onChange={e => saveNote(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') (e.target as HTMLInputElement).blur() }} />
      )}
    </div>
  )
}
