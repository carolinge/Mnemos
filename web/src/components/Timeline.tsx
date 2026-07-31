import { useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api'
import { todayStr } from '../lib/groupDays'
import { useTimeline } from '../hooks/useTimeline'
import type { EntryData } from '../hooks/useAutosave'
import type { Project } from './Sidebar'
import { EntryCard } from './EntryCard'
import { DayHeader } from './DayHeader'

export function Timeline({ project, anchor, tasks, onExitAnchor, onTaskClick, onTasksChanged }: {
  project: string | null
  anchor: string | null
  tasks: Project[]
  onExitAnchor: () => void
  onTaskClick?: (taskId: string) => void
  onTasksChanged?: () => void
}) {
  const t = useTimeline(project, anchor)
  const boxRef = useRef<HTMLDivElement>(null)
  const topSentinel = useRef<HTMLDivElement>(null)
  const [composers, setComposers] = useState<string[]>(() => [crypto.randomUUID()])
  const [awayFromBottom, setAway] = useState(false)
  const [foldedYears, setFoldedYears] = useState<Set<string>>(new Set())
  const didInitScroll = useRef(false)

  useLayoutEffect(() => {
    if (!t.ready || didInitScroll.current) return
    didInitScroll.current = true
    const el = boxRef.current!
    if (anchor) el.querySelector(`[data-day="${anchor}"]`)?.scrollIntoView()
    else el.scrollTop = el.scrollHeight
  }, [t.ready, anchor])
  useLayoutEffect(() => { didInitScroll.current = false }, [project, anchor])

  useLayoutEffect(() => {
    const el = boxRef.current, s = topSentinel.current
    if (!el || !s) return
    const io = new IntersectionObserver(async ents => {
      if (!ents[0].isIntersecting || !t.ready) return
      const h = el.scrollHeight
      await t.loadOlder()
      requestAnimationFrame(() => { el.scrollTop += el.scrollHeight - h })
    }, { root: el, rootMargin: '200px 0px 0px 0px' })
    io.observe(s)
    return () => io.disconnect()
  }, [t.ready, t.loadOlder])

  function onScroll() {
    const el = boxRef.current!
    setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 800 || Boolean(anchor))
  }

  async function move(day: string, id: string, dir: -1 | 1) {
    const group = t.days.find(d => d.day === day)
    if (!group) return
    const i = group.entries.findIndex(e => e.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= group.entries.length) return
    const a = group.entries[i], b = group.entries[j]
    const ra = await api<EntryData>(`/api/entries/${a.id}`, {
      method: 'PATCH', body: JSON.stringify({ position: b.position, version: a.version }) })
    const rb = await api<EntryData>(`/api/entries/${b.id}`, {
      method: 'PATCH', body: JSON.stringify({ position: a.position, version: b.version }) })
    t.applyEntry(ra); t.applyEntry(rb)
  }

  // 改日期：把这一天的所有卡片搬到新日期
  async function moveDay(from: string, to: string) {
    const group = t.days.find(d => d.day === from)
    if (!group) return
    for (const e of group.entries) {
      await api(`/api/entries/${e.id}`, {
        method: 'PATCH', body: JSON.stringify({ day: to, version: e.version }),
      })
    }
    t.reload()
  }

  function toggleYear(year: string) {
    setFoldedYears(prev => {
      const next = new Set(prev)
      next.has(year) ? next.delete(year) : next.add(year)
      return next
    })
  }

  const today = todayStr()
  const showToday = !project && !anchor
  const hasTodayGroup = t.days.some(d => d.day === today)

  // 天按年份分组，年份标头可折叠一整年
  let lastYear: string | null = null

  return (
    <div className="timeline" ref={boxRef} onScroll={onScroll}>
      <div ref={topSentinel} />
      {!t.ready && <div className="skeleton"><div /><div /><div /></div>}
      {!t.hasOlder && t.ready && <p className="flow-edge">— 这里是一切的开始 —</p>}
      {t.days.map(d => {
        const year = d.day.slice(0, 4)
        const yearHead = year !== lastYear ? year : null
        lastYear = year
        const folded = foldedYears.has(year)
        return (
          <div key={d.day}>
            {yearHead && (
              <h1 className="year-head" onClick={() => toggleYear(year)}>
                <span className="year-caret">{folded ? '▸' : '▾'}</span> {year}
                {folded && <span className="year-hint">（已折叠，点击展开）</span>}
              </h1>
            )}
            {!folded && (
              <section data-day={d.day}>
                <DayHeader day={d.day} note={d.note ?? ''}
                  onChangeDay={moveDay}
                  onNoteSaved={(day, text) => t.applyNote(day, text)} />
                <div className="day-cards">
                  {d.entries.map(e => (
                    <EntryCard key={e.id} entry={e} day={d.day} draftKey={e.id} tasks={tasks}
                      onDeleted={t.removeEntry} onTaskClick={onTaskClick}
                      onMove={(id, dir) => move(d.day, id, dir)} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )
      })}
      {t.hasNewer && <button className="load-newer" onClick={() => t.loadNewer()}>加载更新的内容 ↓</button>}
      {showToday && (
        <section data-day={today}>
          {!hasTodayGroup && <DayHeader day={today} note="" onNoteSaved={(day, text) => t.applyNote(day, text)} />}
          <div className="day-cards">
            {composers.map(key => (
              <EntryCard key={key} entry={null} day={today} draftKey={`new:${key}`} tasks={tasks}
                onTaskClick={onTaskClick}
                onCreated={() => { t.reload(); onTasksChanged?.() }} />
            ))}
          </div>
          <button className="new-entry" onClick={() => setComposers(c => [...c, crypto.randomUUID()])}>
            ＋ 新条目
          </button>
        </section>
      )}
      {awayFromBottom && (
        <button className="back-today" onClick={() => {
          if (anchor) onExitAnchor()
          else boxRef.current!.scrollTo({ top: boxRef.current!.scrollHeight, behavior: 'smooth' })
        }}>回到今天 ↓</button>
      )}
    </div>
  )
}
