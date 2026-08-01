import { useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api'
import { todayStr } from '../lib/groupDays'
import { useTimeline } from '../hooks/useTimeline'
import type { Project } from './Sidebar'
import { EntryCard } from './EntryCard'
import { DayHeader } from './DayHeader'

export function Timeline({ project, anchor, tasks, showAsides, onExitAnchor, onTaskClick, onTasksChanged }: {
  project: string | null
  anchor: string | null
  tasks: Project[]
  showAsides: boolean
  onExitAnchor: () => void
  onTaskClick?: (taskId: string) => void
  onTasksChanged?: () => void
}) {
  const t = useTimeline(project, anchor)
  const boxRef = useRef<HTMLDivElement>(null)
  const topSentinel = useRef<HTMLDivElement>(null)
  // 每天各自的「正在撰写」卡片：day → 若干临时 key
  const [composers, setComposers] = useState<Record<string, string[]>>({})
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

  function addComposer(day: string) {
    setComposers(c => ({ ...c, [day]: [...(c[day] ?? []), crypto.randomUUID()] }))
  }

  // 新的一天：选个日期，那天就出现一张空卡片等你写（保存后自动排到正确位置）
  function addDay() {
    const input = window.prompt('新条目的日期（YYYY-MM-DD）', todayStr())
    if (!input) return
    const day = input.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { window.alert('日期格式应为 2026-07-31'); return }
    addComposer(day)
    if (!t.days.some(d => d.day === day)) t.ensureDay(day)
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
                <DayHeader day={d.day} note={d.note ?? ''} showAsides={showAsides}
                  onChangeDay={moveDay}
                  onNoteSaved={(day, text) => t.applyNote(day, text)} />
                <div className="day-cards">
                  {d.entries.map(e => (
                    <EntryCard key={e.id} entry={e} day={d.day} draftKey={e.id} tasks={tasks}
                      onDeleted={t.removeEntry} onTaskClick={onTaskClick} />
                  ))}
                  {(composers[d.day] ?? []).map(key => (
                    <EntryCard key={key} entry={null} day={d.day} draftKey={`new:${key}`} tasks={tasks}
                      onTaskClick={onTaskClick}
                      onCreated={() => { t.reload(); onTasksChanged?.() }} />
                  ))}
                  <div className="add-row">
                    <button className="new-entry" title={`在 ${d.day} 下新增一张卡片`}
                      onClick={() => addComposer(d.day)}>＋ 新条目</button>
                    <button className="new-day" title="新建另一个日期的卡片（补以前的笔记）"
                      onClick={addDay}>＋ 新的一天</button>
                  </div>
                </div>
              </section>
            )}
          </div>
        )
      })}
      {t.hasNewer && <button className="load-newer" onClick={() => t.loadNewer()}>加载更新的内容 ↓</button>}
      {showToday && !hasTodayGroup && (
        <section data-day={today}>
          <DayHeader day={today} note="" showAsides={showAsides}
            onNoteSaved={(day, text) => t.applyNote(day, text)} />
          <div className="day-cards">
            {(composers[today] ?? []).map(key => (
              <EntryCard key={key} entry={null} day={today} draftKey={`new:${key}`} tasks={tasks}
                onTaskClick={onTaskClick}
                onCreated={() => { t.reload(); onTasksChanged?.() }} />
            ))}
            <div className="add-row">
              <button className="new-entry" title="在今天下新增一张卡片"
                onClick={() => addComposer(today)}>＋ 新条目</button>
              <button className="new-day" title="新建另一个日期的卡片（补以前的笔记）"
                onClick={addDay}>＋ 新的一天</button>
            </div>
          </div>
        </section>
      )}
      {awayFromBottom && (
        <button className="back-today" title="回到今天" aria-label="回到今天" onClick={() => {
          if (anchor) onExitAnchor()
          else boxRef.current!.scrollTo({ top: boxRef.current!.scrollHeight, behavior: 'smooth' })
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}
    </div>
  )
}
