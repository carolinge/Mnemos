import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

vi.mock('../src/api', () => ({ api: vi.fn() }))
import { api } from '../src/api'
import { useTimeline } from '../src/hooks/useTimeline'
import type { EntryData } from '../src/hooks/useAutosave'

const mockApi = api as unknown as ReturnType<typeof vi.fn>
const entry = (id: string, day: string, position = 0): EntryData =>
  ({ id, day, position, version: 0, content: {}, created_at: '2026-07-28T09:00:00Z', updated_at: '', task: null })
const resp = (days: [string, string[]][]) => ({
  days: days.map(([day, ids]) => ({ day, entries: ids.map(id => entry(id, day)) })),
  nextBefore: days.length ? days[days.length - 1][0] : null,
  nextAfter: days.length ? days[0][0] : null,
})

beforeEach(() => mockApi.mockReset())

describe('useTimeline', () => {
  it('初始加载：天升序存放', async () => {
    mockApi.mockResolvedValueOnce(resp([['2026-07-28', ['b']], ['2026-07-27', ['a']]]))
    const { result } = renderHook(() => useTimeline(null, null))
    await waitFor(() => expect(result.current.days.length).toBe(2))
    expect(result.current.days.map(d => d.day)).toEqual(['2026-07-27', '2026-07-28'])
  })

  it('loadOlder 合并到头部并去重；空响应后 hasOlder=false', async () => {
    mockApi.mockResolvedValueOnce(resp([['2026-07-28', ['b']]]))
    const { result } = renderHook(() => useTimeline(null, null))
    await waitFor(() => expect(result.current.days.length).toBe(1))
    mockApi.mockResolvedValueOnce(resp([['2026-07-27', ['a']]]))
    await act(() => result.current.loadOlder())
    expect(result.current.days.map(d => d.day)).toEqual(['2026-07-27', '2026-07-28'])
    expect(mockApi.mock.calls[1][0]).toContain('before=2026-07-28')
    mockApi.mockResolvedValueOnce(resp([]))
    await act(() => result.current.loadOlder())
    expect(result.current.hasOlder).toBe(false)
  })

  it('anchor 模式：before=次日 使锚点当天被包含，hasNewer=true，loadNewer 追加', async () => {
    mockApi.mockResolvedValueOnce(resp([['2026-03-12', ['x']]]))
    const { result } = renderHook(() => useTimeline(null, '2026-03-12'))
    await waitFor(() => expect(result.current.days.length).toBe(1))
    expect(mockApi.mock.calls[0][0]).toContain('before=2026-03-13')
    expect(result.current.hasNewer).toBe(true)
    mockApi.mockResolvedValueOnce(resp([['2026-03-14', ['y']]]))
    await act(() => result.current.loadNewer())
    expect(result.current.days.map(d => d.day)).toEqual(['2026-03-12', '2026-03-14'])
    expect(mockApi.mock.calls[1][0]).toContain('after=2026-03-12')
  })

  it('project 过滤透传参数', async () => {
    mockApi.mockResolvedValueOnce(resp([]))
    renderHook(() => useTimeline('p1', null))
    await waitFor(() => expect(mockApi).toHaveBeenCalled())
    expect(mockApi.mock.calls[0][0]).toContain('project=p1')
  })

  it('applyEntry 按 position 重排；removeEntry 删除', async () => {
    mockApi.mockResolvedValueOnce(resp([['2026-07-28', ['a', 'b']]]))
    const { result } = renderHook(() => useTimeline(null, null))
    await waitFor(() => expect(result.current.days.length).toBe(1))
    act(() => result.current.applyEntry({ ...entry('a', '2026-07-28', 9), version: 1 }))
    expect(result.current.days[0].entries.map(e => e.id)).toEqual(['b', 'a'])
    act(() => result.current.removeEntry('b'))
    expect(result.current.days[0].entries.map(e => e.id)).toEqual(['a'])
  })
})
