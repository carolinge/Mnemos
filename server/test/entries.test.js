import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../src/db.js'
import { createApp } from '../src/app.js'

let app, cookie
beforeEach(async () => {
  app = createApp({ db: createDb(':memory:'), imagesDir: '/tmp/img-test', password: 'pw' })
  const res = await app.request('/api/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'pw' }),
  })
  cookie = res.headers.get('set-cookie').split(';')[0]
})

const H = () => ({ 'Content-Type': 'application/json', Cookie: cookie })
const doc = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
async function createEntry(body = {}) {
  const res = await app.request('/api/entries', { method: 'POST', headers: H(), body: JSON.stringify(body) })
  expect(res.status).toBe(200)
  return res.json()
}

describe('entries CRUD', () => {
  it('POST 创建：默认今天、position 递增、返回完整行', async () => {
    const a = await createEntry({ day: '2026-07-01' })
    const b = await createEntry({ day: '2026-07-01' })
    expect(a.id).toBeTruthy()
    expect(a.day).toBe('2026-07-01')
    expect(b.position).toBe(a.position + 1)
    expect(a.version).toBe(0)
    expect(a.tags).toEqual([])
  })

  it('PATCH 保存内容：text 被抽取、version 自增', async () => {
    const e = await createEntry({ day: '2026-07-01' })
    const res = await app.request(`/api/entries/${e.id}`, {
      method: 'PATCH', headers: H(),
      body: JSON.stringify({ content: doc('石墨烯转移工艺'), version: 0 }),
    })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.version).toBe(1)
    // 全文可搜（FTS 触发器生效）
    const list = await app.request('/api/entries?q=石墨烯', { headers: H() })
    const { days } = await list.json()
    expect(days.flatMap(d => d.entries).some(x => x.id === e.id)).toBe(true)
  })

  it('PATCH 版本不匹配 → 409 带当前内容', async () => {
    const e = await createEntry({})
    await app.request(`/api/entries/${e.id}`, {
      method: 'PATCH', headers: H(), body: JSON.stringify({ content: doc('v1'), version: 0 }),
    })
    const res = await app.request(`/api/entries/${e.id}`, {
      method: 'PATCH', headers: H(), body: JSON.stringify({ content: doc('旧标签页'), version: 0 }),
    })
    expect(res.status).toBe(409)
    const j = await res.json()
    expect(j.version).toBe(1)
    expect(j.content).toBeTruthy()
  })

  it('tags：即建即打标、复用同名项目、可移除', async () => {
    const e = await createEntry({ day: '2026-07-01' })
    let res = await app.request(`/api/entries/${e.id}`, {
      method: 'PATCH', headers: H(),
      body: JSON.stringify({ tags: ['钙钛矿', '综述'], version: 0 }),
    })
    let j = await res.json()
    expect(j.tags.map(t => t.name).sort()).toEqual(['综述', '钙钛矿'].sort())
    const first = j.tags.find(t => t.name === '钙钛矿')
    // 第二个条目复用同名项目（同 id）
    const e2 = await createEntry({ day: '2026-07-02' })
    res = await app.request(`/api/entries/${e2.id}`, {
      method: 'PATCH', headers: H(), body: JSON.stringify({ tags: ['钙钛矿'], version: 0 }),
    })
    j = await res.json()
    expect(j.tags[0].id).toBe(first.id)
    // 移除标签
    res = await app.request(`/api/entries/${e.id}`, {
      method: 'PATCH', headers: H(), body: JSON.stringify({ tags: ['综述'], version: 1 }),
    })
    j = await res.json()
    expect(j.tags.map(t => t.name)).toEqual(['综述'])
  })

  it('DELETE 软删除：列表不再返回', async () => {
    const e = await createEntry({ day: '2026-07-01' })
    const del = await app.request(`/api/entries/${e.id}`, { method: 'DELETE', headers: H() })
    expect(del.status).toBe(200)
    const list = await app.request('/api/entries?limit=50', { headers: H() })
    const { days } = await list.json()
    expect(days.flatMap(d => d.entries).some(x => x.id === e.id)).toBe(false)
  })

  it('GET /api/projects 返回项目；PATCH 可改色/归档', async () => {
    const e = await createEntry({})
    await app.request(`/api/entries/${e.id}`, {
      method: 'PATCH', headers: H(), body: JSON.stringify({ tags: ['纳米线'], version: 0 }),
    })
    let res = await app.request('/api/projects', { headers: H() })
    const projects = await res.json()
    expect(projects.length).toBe(1)
    const p = projects[0]
    res = await app.request(`/api/projects/${p.id}`, {
      method: 'PATCH', headers: H(), body: JSON.stringify({ archived: true, color: '#123456' }),
    })
    expect(res.status).toBe(200)
    res = await app.request('/api/projects', { headers: H() })
    const after = await res.json()
    expect(after[0].archived).toBe(1)
    expect(after[0].color).toBe('#123456')
  })
})
