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
  // 已经存进库、但仍以「撰写中卡片」形式留在屏幕上的条目 id。
  // 服务端返回的同一条要跳过，否则会重复显示一张。
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set())
  const [awayFromBottom, setAway] = useState(false)
  // 一键展开/收起：n 递增让所有卡片跟随 on
  const [expandAll, setExpandAll] = useState({ on: false, n: 0 })
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
  useLayoutEffect(() => { setComposers({}); setOwnedIds(new Set()) }, [project, anchor])

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

  function dropComposer(day: string, key: string) {
    setComposers(c => ({ ...c, [day]: (c[day] ?? []).filter(k => k !== key) }))
  }

  // 新卡片刚落库：留在屏幕上继续编辑（不卸载、不重新拉取），
  // 只记下 id 让服务端返回的同一条不要再画一遍。
  function claim(id: string) {
    setOwnedIds(s => new Set(s).add(id))
  }

  // 新的一天：选个日期，那天就出现一张空卡片等你写（保存后自动排到正确位置）
  function addDay() {
    const input = window.prompt('Date for the new entry (YYYY-MM-DD)', todayStr())
    if (!input) return
    const day = input.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { window.alert('Date must look like 2026-07-31'); return }
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
      {!t.hasOlder && t.ready && <p className="flow-edge">— the very beginning —</p>}
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
                {folded && <span className="year-hint"> (collapsed — click to expand)</span>}
              </h1>
            )}
            {!folded && (
              <section data-day={d.day}>
                <DayHeader day={d.day} note={d.note ?? ''} showAsides={showAsides}
                  onChangeDay={moveDay}
                  onNoteSaved={(day, text) => t.applyNote(day, text)} />
                <div className="day-cards">
                  {d.entries.filter(e => !ownedIds.has(e.id)).map(e => (
                    <EntryCard key={e.id} entry={e} day={d.day} draftKey={e.id} tasks={tasks}
                      onDeleted={t.removeEntry} onTaskClick={onTaskClick}
                      expandAll={expandAll} />
                  ))}
                  {(composers[d.day] ?? []).map(key => (
                    <EntryCard key={key} entry={null} day={d.day} draftKey={`new:${key}`} tasks={tasks}
                      onTaskClick={onTaskClick}
                      onDiscard={() => dropComposer(d.day, key)}
                      onDeleted={id => { dropComposer(d.day, key); t.removeEntry(id) }}
                      onCreated={e => { claim(e.id); onTasksChanged?.() }} />
                  ))}
                  <div className="add-row">
                    <button className="new-entry" title={`Add a card under ${d.day}`}
                      onClick={() => addComposer(d.day)}>＋ New entry</button>
                    <button className="new-day" title="Create a card on another date (backfill)"
                      onClick={addDay}>＋ New day</button>
                  </div>
                </div>
              </section>
            )}
          </div>
        )
      })}
      {t.hasNewer && <button className="load-newer" onClick={() => t.loadNewer()}>Load newer ↓</button>}
      {showToday && !hasTodayGroup && (
        <section data-day={today}>
          <DayHeader day={today} note={t.days.find(d => d.day === today)?.note ?? ''} showAsides={showAsides}
            onNoteSaved={(day, text) => t.applyNote(day, text)} />
          <div className="day-cards">
            {(composers[today] ?? []).map(key => (
              <EntryCard key={key} entry={null} day={today} draftKey={`new:${key}`} tasks={tasks}
                onTaskClick={onTaskClick}
                onDiscard={() => dropComposer(today, key)}
                onDeleted={id => { dropComposer(today, key); t.removeEntry(id) }}
                onCreated={e => { claim(e.id); onTasksChanged?.() }} />
            ))}
            <div className="add-row">
              <button className="new-entry" title="Add a card under today"
                onClick={() => addComposer(today)}>＋ New entry</button>
              <button className="new-day" title="Create a card on another date (backfill)"
                onClick={addDay}>＋ New day</button>
            </div>
          </div>
        </section>
      )}
      <button className="expand-all" title={expandAll.on ? 'Collapse all cards' : 'Expand all cards'}
        aria-label={expandAll.on ? 'Collapse all cards' : 'Expand all cards'}
        onClick={() => setExpandAll(v => ({ on: !v.on, n: v.n + 1 }))}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {expandAll.on
            ? <><path d="M4 9l8-5 8 5" /><path d="M4 15l8 5 8-5" /></>
            : <><path d="M4 15l8 5 8-5" /><path d="M4 9l8-5 8 5" transform="rotate(180 12 6.5)" /></>}
        </svg>
      </button>
      {awayFromBottom && (
        <button className="back-today" title="Back to today" aria-label="Back to today" onClick={() => {
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
