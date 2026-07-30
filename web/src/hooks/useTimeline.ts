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
  const loading = useRef(false)

  useEffect(() => {
    let alive = true
    setDays([]); setReady(false); setHasOlder(true)
    setHasNewer(Boolean(anchor && anchor < todayStr()))
    const params = anchor
      ? { before: nextDay(anchor), limit: '10', project: project ?? undefined }
      : { limit: '10', project: project ?? undefined }
    api<ListResp>(`/api/entries?${qs(params)}`).then(r => {
      if (!alive) return
      setDays(mergeDays([], r.days))
      if (!r.days.length) setHasOlder(false)
      setReady(true)
    }).catch(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [project, anchor])

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

  const removeEntry = useCallback((id: string) => {
    setDays(cur => cur.map(d => ({ ...d, entries: d.entries.filter(e => e.id !== id) }))
      .filter(d => d.entries.length > 0))
  }, [])

  return { days, ready, hasOlder, hasNewer, loadOlder, loadNewer, applyEntry, removeEntry }
}
