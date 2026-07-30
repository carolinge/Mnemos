import type { EntryData } from '../hooks/useAutosave'

export interface DayGroup { day: string; entries: EntryData[] }

export function mergeDays(existing: DayGroup[], incoming: DayGroup[]): DayGroup[] {
  const map = new Map(existing.map(d => [d.day, d]))
  for (const d of incoming) {
    const cur = map.get(d.day)
    if (!cur) { map.set(d.day, d); continue }
    const ids = new Set(cur.entries.map(e => e.id))
    map.set(d.day, { day: d.day, entries: [...cur.entries, ...d.entries.filter(e => !ids.has(e.id))] })
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day))
}

export function nextDay(day: string): string {
  const d = new Date(day + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fmtDay(day: string): string {
  const d = new Date(day + 'T00:00:00')
  const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日 · 周${wd}${day === todayStr() ? ' · 今天' : ''}`
}
