import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../src/db.js'
import { createApp } from '../src/app.js'

let app
beforeEach(() => {
  app = createApp({ db: createDb(':memory:'), imagesDir: '/tmp/img-test', password: 'secret-pw' })
})

async function login(pw) {
  return app.request('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw }),
  })
}

describe('auth', () => {
  it('错误密码 401，不发 cookie', async () => {
    const res = await login('wrong')
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('正确密码 200 并设置 HttpOnly session cookie', async () => {
    const res = await login('secret-pw')
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie')
    expect(cookie).toMatch(/session=/)
    expect(cookie).toMatch(/HttpOnly/i)
  })

  it('受保护路由未带 cookie 401，带 cookie 放行', async () => {
    const noAuth = await app.request('/api/projects')
    expect(noAuth.status).toBe(401)
    const cookie = (await login('secret-pw')).headers.get('set-cookie').split(';')[0]
    const ok = await app.request('/api/projects', { headers: { Cookie: cookie } })
    expect(ok.status).not.toBe(401)   // Task 4 之前该路由可能 404，但绝不能 401
  })

  it('伪造 token 401', async () => {
    const res = await app.request('/api/projects', { headers: { Cookie: 'session=deadbeef' } })
    expect(res.status).toBe(401)
  })
})
