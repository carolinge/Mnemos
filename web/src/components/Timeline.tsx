import { useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api'
import { fmtDay, todayStr } from '../lib/groupDays'
import { useTimeline } from '../hooks/useTimeline'
import type { EntryData } from '../hooks/useAutosave'
import { EntryCard } from './EntryCard'

export function Timeline({ project, anchor, onExitAnchor, onTagClick }: {
  project: string | null
  anchor: string | null
  onExitAnchor: () => void
  onTagClick?: (projectId: string) => void
}) {
  const t = useTimeline(project, anchor)
  const boxRef = useRef<HTMLDivElement>(null)
  const topSentinel = useRef<HTMLDivElement>(null)
  const [composers, setComposers] = useState<string[]>(() => [crypto.randomUUID()])
  const [awayFromBottom, setAway] = useState(false)
  const didInitScroll = useRef(false)

  // 首次加载后定位：锚点日或底部（今天）
  useLayoutEffect(() => {
    if (!t.ready || didInitScroll.current) return
    didInitScroll.current = true
    const el = boxRef.current!
    if (anchor) {
      el.querySelector(`[data-day="${anchor}"]`)?.scrollIntoView()
    } else {
      el.scrollTop = el.scrollHeight
    }
  }, [t.ready, anchor])
  useLayoutEffect(() => { didInitScroll.current = false }, [project, anchor])

  // 顶部哨兵：上翻加载更早，且保持视口不跳
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

  const today = todayStr()
  const showToday = !project && !anchor
  const hasTodayGroup = t.days.some(d => d.day === today)

  return (
    <div className="timeline" ref={boxRef} onScroll={onScroll}>
      <div ref={topSentinel} />
      {!t.hasOlder && t.ready && <p className="flow-edge">— 这里是一切的开始 —</p>}
      {t.days.map(d => (
        <section key={d.day} data-day={d.day}>
          <h2 className="day-head">{fmtDay(d.day)}</h2>
          {d.entries.map(e => (
            <EntryCard key={e.id} entry={e} day={d.day} draftKey={e.id}
              onDeleted={t.removeEntry} onTagClick={onTagClick}
              onMove={(id, dir) => move(d.day, id, dir)} />
          ))}
        </section>
      ))}
      {t.hasNewer && <button className="load-newer" onClick={() => t.loadNewer()}>加载更新的内容 ↓</button>}
      {showToday && (
        <section data-day={today}>
          {!hasTodayGroup && <h2 className="day-head">{fmtDay(today)}</h2>}
          {composers.map(key => (
            <EntryCard key={key} entry={null} day={today} draftKey={`new:${key}`} onTagClick={onTagClick} />
          ))}
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
