import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { mergeDays, nextDay, todayStr, type DayGroup } from '../lib/groupDays'
import type { EntryData } from './useAutosave'

interface ListResp { days: DayGroup[]; nextBefore: string | null; nextAfter: string | null }

function qs(params: Record<string, string | undefined>) {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v)
  return u.toString()
}

export function useTimeline(project: string | null, anchor: string | null) {
  const [days, setDays] = useState<DayGroup[]>([])
  const [hasOlder, setHasOlder] = useState(true)
  const [hasNewer, setHasNewer] = useState(false)
  const [ready, setReady] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const loading = useRef(false)
  // 上一次渲染的视图；只有视图真的换了才清空列表
  const viewRef = useRef<string | null>(null)

  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  useEffect(() => {
    let alive = true
    // 换项目 / 换锚点 = 换了要看的内容，清空重来是对的；
    // 单纯 reload（比如刚存下一张新卡片）必须保住现有内容，
    // 否则整条时间流会闪成骨架屏、已加载的历史被丢弃、滚动位置塌陷。
    const view = `${project ?? ''}|${anchor ?? ''}`
    const viewChanged = viewRef.current !== view
    viewRef.current = view
    if (viewChanged) { setDays([]); setReady(false); setHasOlder(true) }
    setHasNewer(Boolean(anchor && anchor < todayStr()))
    const params = anchor
      ? { before: nextDay(anchor), limit: '10', project: project ?? undefined }
      : { limit: '10', project: project ?? undefined }
    api<ListResp>(`/api/entries?${qs(params)}`).then(r => {
      if (!alive) return
      // 视图没变就并进现有数据，保住上翻加载出来的历史
      setDays(cur => mergeDays(viewChanged ? [] : cur, r.days))
      if (viewChanged && !r.days.length) setHasOlder(false)
      setReady(true)
    }).catch(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [project, anchor, reloadKey])

  const loadOlder = useCallback(async () => {
    if (loading.current || !hasOlder || !days.length) return
    loading.current = true
    try {
      const r = await api<ListResp>(`/api/entries?${qs({
        before: days[0].day, limit: '10', project: project ?? undefined })}`)
      if (!r.days.length) setHasOlder(false)
      setDays(cur => mergeDays(cur, r.days))
    } finally { loading.current = false }
  }, [days, hasOlder, project])

  const loadNewer = useCallback(async () => {
    if (loading.current || !hasNewer || !days.length) return
    loading.current = true
    try {
      const r = await api<ListResp>(`/api/entries?${qs({
        after: days[days.length - 1].day, limit: '10', project: project ?? undefined })}`)
      if (!r.days.length) setHasNewer(false)
      setDays(cur => mergeDays(cur, r.days))
    } finally { loading.current = false }
  }, [days, hasNewer, project])

  const applyEntry = useCallback((e: EntryData) => {
    setDays(cur => cur.map(d => d.day !== e.day ? d : {
      day: d.day,
      entries: d.entries.map(x => x.id === e.id ? e : x)
        .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at)),
    }))
  }, [])

  const applyNote = useCallback((day: string, note: string) => {
    setDays(cur => cur.map(d => d.day === day ? { ...d, note } : d))
  }, [])

  const removeEntry = useCallback((id: string) => {
    // 留下只剩碎碎念的日子，否则删掉最后一张卡片会把那句话一起带走
    setDays(cur => cur.map(d => ({ ...d, entries: d.entries.filter(e => e.id !== id) }))
      .filter(d => d.entries.length > 0 || d.note?.trim()))
  }, [])

  // 为还没有任何条目的日期插一个空分组，让它先在时间流里占好位置
  const ensureDay = useCallback((day: string) => {
    setDays(cur => cur.some(d => d.day === day)
      ? cur
      : [...cur, { day, entries: [] }].sort((a, b) => a.day.localeCompare(b.day)))
  }, [])

  return {
    days, ready, hasOlder, hasNewer, loadOlder, loadNewer,
    applyEntry, applyNote, removeEntry, ensureDay, reload,
  }
}
