import { describe, it, expect } from 'vitest'
import { mergeDays, nextDay, todayStr } from '../src/lib/groupDays'
import type { EntryData } from '../src/hooks/useAutosave'

const g = (day: string, ...ids: string[]) => ({
  day,
  entries: ids.map(id => ({
    id, day, position: 0, version: 0, content: {}, created_at: '', updated_at: '', task: null,
  })) as EntryData[],
})

describe('groupDays', () => {
  it('mergeDays：按天合并、条目去重、升序输出', () => {
    const out = mergeDays([g('2026-07-02', 'a')], [g('2026-07-01', 'b'), g('2026-07-02', 'a', 'c')])
    expect(out.map(d => d.day)).toEqual(['2026-07-01', '2026-07-02'])
    expect(out[1].entries.map(e => e.id)).toEqual(['a', 'c'])
  })
  it('nextDay 跨月跨年', () => {
    expect(nextDay('2026-07-31')).toBe('2026-08-01')
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
  })
  it('todayStr 是 YYYY-MM-DD', () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
