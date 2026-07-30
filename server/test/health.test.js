import { describe, it, expect } from 'vitest'
import { createApp } from '../src/app.js'

describe('health', () => {
  it('GET /api/health 返回 ok 且无需认证', async () => {
    const app = createApp({ db: null, imagesDir: '/tmp/x', password: 'pw' })
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
