import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { fmtDay } from '../lib/groupDays'

// 日期标头：点日期改日期（补笔记用），旁边的按钮单独管碎碎念。
// 之所以不用双击：单击已经进入日期编辑、按钮被输入框替换，双击永远等不到第二下。
export function DayHeader({ day, note, showAsides, onChangeDay, onNoteSaved }: {
  day: string
  note: string
  showAsides: boolean          // 全局开关：关掉后已有碎碎念也收起
  onChangeDay?: (from: string, to: string) => void
  onNoteSaved?: (day: string, text: string) => void
}) {
  const [editingDate, setEditingDate] = useState(false)
  const [openNote, setOpenNote] = useState(false)
  const [draft, setDraft] = useState(note)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => { setDraft(note) }, [note])

  // 关掉全局开关时一并收起手动展开的输入框
  useEffect(() => { if (!showAsides) setOpenNote(false) }, [showAsides])

  function saveNote(text: string) {
    setDraft(text)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      await api(`/api/day-notes/${day}`, { method: 'PUT', body: JSON.stringify({ text }) })
      onNoteSaved?.(day, text)
    }, 800)
  }

  const noteVisible = showAsides && (openNote || Boolean(note))

  return (
    <div className="day-block">
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
        <button className="day-date" title="Click to change the date (for backfilling notes)"
          onClick={() => setEditingDate(true)}>
          {fmtDay(day)}
        </button>
      )}

      {showAsides && (
        <button className="day-note-btn"
          title={note ? 'Edit note' : 'Add a note for this day'}
          onClick={() => setOpenNote(v => !v)}>
          {note ? '✎ Note' : '＋ Note'}
        </button>
      )}
      {!showAsides && note && <span className="day-note-dot" title="This day has a note (hidden by the toolbar toggle)" />}

    </div>

    {/* 碎碎念单独占一行，与下面的卡片对齐，可写多行（随内容长高） */}
    {noteVisible && (
      <textarea className="day-note" value={draft} rows={1}
        placeholder="Note:" autoFocus={openNote && !note}
        ref={el => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` } }}
        onChange={e => {
          e.target.style.height = 'auto'
          e.target.style.height = `${e.target.scrollHeight}px`
          saveNote(e.target.value)
        }}
        onKeyDown={e => { if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur() }} />
    )}
    </div>
  )
}
