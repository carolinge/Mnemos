import { describe, it, expect } from 'vitest'
import { fracToDay, snapToNearest, monthTicks } from '../src/components/TimeScrubber'

describe('scrubber 数学', () => {
  it('fracToDay：0→起点，1→终点，中间线性', () => {
    expect(fracToDay(0, '2026-01-01', '2026-01-11')).toBe('2026-01-01')
    expect(fracToDay(1, '2026-01-01', '2026-01-11')).toBe('2026-01-11')
    expect(fracToDay(0.5, '2026-01-01', '2026-01-11')).toBe('2026-01-06')
  })
  it('snapToNearest 吸附到最近的有记录日', () => {
    const days = ['2026-01-01', '2026-01-10', '2026-02-20']
    expect(snapToNearest('2026-01-02', days)).toBe('2026-01-01')
    expect(snapToNearest('2026-01-08', days)).toBe('2026-01-10')
    expect(snapToNearest('2026-03-01', days)).toBe('2026-02-20')
  })
  it('monthTicks 给出范围内每月 1 日的刻度与比例', () => {
    const ticks = monthTicks('2026-01-15', '2026-03-20')
    expect(ticks.map(t => t.day)).toEqual(['2026-02-01', '2026-03-01'])
    for (const t of ticks) { expect(t.frac).toBeGreaterThan(0); expect(t.frac).toBeLessThan(1) }
  })
})
