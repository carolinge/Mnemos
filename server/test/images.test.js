import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDb } from '../src/db.js'
import { createApp } from '../src/app.js'

let app, cookie, imagesDir
beforeEach(async () => {
  imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parchment-img-'))
  app = createApp({ db: createDb(':memory:'), imagesDir, password: 'pw' })
  const res = await app.request('/api/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'pw' }),
  })
  cookie = res.headers.get('set-cookie').split(';')[0]
})

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

async function upload(bytes = PNG, name = 'shot.png', type = 'image/png') {
  const fd = new FormData()
  fd.append('file', new File([bytes], name, { type }))
  return app.request('/api/images', { method: 'POST', headers: { Cookie: cookie }, body: fd })
}

describe('images', () => {
  it('上传：按年月归档、返回 /images/YYYY/MM/<hash>.png', async () => {
    const res = await upload()
    expect(res.status).toBe(200)
    const { url } = await res.json()
    expect(url).toMatch(/^\/images\/\d{4}\/\d{2}\/[0-9a-f]{16}\.png$/)
    const abs = path.join(imagesDir, url.replace('/images/', ''))
    expect(fs.existsSync(abs)).toBe(true)
  })

  it('同内容去重：两次上传得到同一 URL', async () => {
    const a = await (await upload()).json()
    const b = await (await upload()).json()
    expect(a.url).toBe(b.url)
  })

  it('GET 回读带正确 Content-Type；未认证 401', async () => {
    const { url } = await (await upload()).json()
    const ok = await app.request(url, { headers: { Cookie: cookie } })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('image/png')
    const anon = await app.request(url)
    expect(anon.status).toBe(401)
  })

  it('路径穿越被拒绝', async () => {
    const res = await app.request('/images/../../etc/passwd', { headers: { Cookie: cookie } })
    expect([400, 404]).toContain(res.status)
  })

  it('无文件字段 400', async () => {
    const fd = new FormData()
    const res = await app.request('/api/images', { method: 'POST', headers: { Cookie: cookie }, body: fd })
    expect(res.status).toBe(400)
  })
})
