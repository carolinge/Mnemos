import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../src/api', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public body: unknown) { super(`api ${status}`) }
  },
}))
import { api, ApiError } from '../src/api'
import { useAutosave } from '../src/hooks/useAutosave'

const mockApi = api as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  mockApi.mockReset()
})
afterEach(() => vi.useRealTimers())

const DOC = { type: 'doc', content: [] }

function hook(over: Partial<Parameters<typeof useAutosave>[0]> = {}) {
  return renderHook(() => useAutosave({
    entryId: 'e1', day: '2026-07-28', version: 0, draftKey: 'e1',
    getPayload: () => ({ content: DOC }),
    ...over,
  }))
}

describe('useAutosave', () => {
  it('防抖：连续 schedule 只发一次 PATCH，成功后清 draft、版本更新', async () => {
    mockApi.mockResolvedValue({ id: 'e1', version: 1 })
    const { result } = hook()
    act(() => { result.current.schedule(); result.current.schedule(); result.current.schedule() })
    expect(localStorage.getItem('draft:e1')).toBeTruthy()
    await act(() => vi.advanceTimersByTimeAsync(1100))
    expect(mockApi).toHaveBeenCalledTimes(1)
    expect(mockApi.mock.calls[0][0]).toBe('/api/entries/e1')
    expect(JSON.parse((mockApi.mock.calls[0][1] as RequestInit).body as string).version).toBe(0)
    expect(localStorage.getItem('draft:e1')).toBeNull()
    expect(result.current.status).toBe('saved')
    // 第二次保存携带新版本号
    mockApi.mockResolvedValue({ id: 'e1', version: 2 })
    act(() => result.current.schedule())
    await act(() => vi.advanceTimersByTimeAsync(1100))
    expect(JSON.parse((mockApi.mock.calls[1][1] as RequestInit).body as string).version).toBe(1)
  })

  it('网络失败：status=offline、draft 保留、退避后自动重试成功', async () => {
    mockApi.mockRejectedValueOnce(new TypeError('fetch failed'))
    mockApi.mockResolvedValueOnce({ id: 'e1', version: 1 })
    const { result } = hook()
    act(() => result.current.schedule())
    await act(() => vi.advanceTimersByTimeAsync(1100))
    expect(result.current.status).toBe('offline')
    expect(localStorage.getItem('draft:e1')).toBeTruthy()
    await act(() => vi.advanceTimersByTimeAsync(2100))
    expect(mockApi).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('saved')
  })

  it('409 → conflict，不再重试', async () => {
    mockApi.mockRejectedValue(new ApiError(409, { version: 5 }))
    const { result } = hook()
    act(() => result.current.schedule())
    await act(() => vi.advanceTimersByTimeAsync(1100))
    expect(result.current.status).toBe('conflict')
    await act(() => vi.advanceTimersByTimeAsync(60000))
    expect(mockApi).toHaveBeenCalledTimes(1)
  })

  it('entryId 为空：先 POST 创建并回调 onCreated，之后走 PATCH', async () => {
    mockApi.mockResolvedValueOnce({ id: 'new-id', version: 0, day: '2026-07-28' })
    mockApi.mockResolvedValueOnce({ id: 'new-id', version: 1 })
    const created = vi.fn()
    const { result } = hook({ entryId: null, draftKey: 'new:x', onCreated: created })
    act(() => result.current.schedule())
    await act(() => vi.advanceTimersByTimeAsync(1100))
    expect(mockApi.mock.calls[0][0]).toBe('/api/entries')
    expect((mockApi.mock.calls[0][1] as RequestInit).method).toBe('POST')
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-id' }))
    act(() => result.current.schedule())
    await act(() => vi.advanceTimersByTimeAsync(1100))
    expect(mockApi.mock.calls[1][0]).toBe('/api/entries/new-id')
  })

  it('挂载时已有 draft → 自动补发一次保存', async () => {
    localStorage.setItem('draft:e1', JSON.stringify({ at: 1, payload: { content: DOC } }))
    mockApi.mockResolvedValue({ id: 'e1', version: 1 })
    hook()
    await act(() => vi.advanceTimersByTimeAsync(1100))
    expect(mockApi).toHaveBeenCalledTimes(1)
  })
})
