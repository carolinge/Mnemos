import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api, onUnauthorized } from '../src/api'

beforeEach(() => onUnauthorized.clear())

describe('api client', () => {
  it('成功返回 JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ a: 1 }))))
    expect(await api('/api/x')).toEqual({ a: 1 })
  })

  it('401 触发 onUnauthorized 回调并抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    const cb = vi.fn()
    onUnauthorized.add(cb)
    await expect(api('/api/x')).rejects.toMatchObject({ status: 401 })
    expect(cb).toHaveBeenCalled()
  })

  it('非 2xx 抛 ApiError 携带 status 与 body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ conflict: true, version: 3 }), { status: 409 })))
    await expect(api('/api/x')).rejects.toMatchObject({ status: 409, body: { conflict: true, version: 3 } })
  })
})
