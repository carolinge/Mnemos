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
    expect(a.task).toBeNull()
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

  it('task：写名字即建即归属、同名复用同一任务、可改可清空', async () => {
    // 创建时直接带任务名
    const a = await createEntry({ day: '2026-07-01', task: 'PH' })
    expect(a.task).toMatchObject({ name: 'PH' })
    expect(a.task.color).toMatch(/^#[0-9a-f]{6}$/i)

    // 另一条目写同名 → 复用同一任务 id，不新建
    const b = await createEntry({ day: '2026-07-02', task: 'PH' })
    expect(b.task.id).toBe(a.task.id)

    // 传 id 也认
    const c2 = await createEntry({ day: '2026-07-03', task: a.task.id })
    expect(c2.task.id).toBe(a.task.id)

    // PATCH 改任务
    let res = await app.request(`/api/entries/${a.id}`, {
      method: 'PATCH', headers: H(), body: JSON.stringify({ task: 'SAM', version: 0 }),
    })
    let j = await res.json()
    expect(j.task.name).toBe('SAM')

    // PATCH 不传 task → 保持不变
    res = await app.request(`/api/entries/${a.id}`, {
      method: 'PATCH', headers: H(), body: JSON.stringify({ content: doc('改正文'), version: 1 }),
    })
    j = await res.json()
    expect(j.task.name).toBe('SAM')

    // 显式传 null → 清空
    res = await app.request(`/api/entries/${a.id}`, {
      method: 'PATCH', headers: H(), body: JSON.stringify({ task: null, version: 2 }),
    })
    j = await res.json()
    expect(j.task).toBeNull()
  })

  it('每天碎碎念：PUT 保存、GET 读回、随时间流一起返回', async () => {
    await createEntry({ day: '2026-07-01', task: 'PH' })
    const put = await app.request('/api/day-notes/2026-07-01', {
      method: 'PUT', headers: H(), body: JSON.stringify({ text: '今天注意力堪比一头成年大象' }),
    })
    expect(put.status).toBe(200)
    const got = await (await app.request('/api/day-notes/2026-07-01', { headers: H() })).json()
    expect(got.text).toContain('成年大象')
    // 时间流里带出来
    const list = await (await app.request('/api/entries?limit=10', { headers: H() })).json()
    expect(list.days.find(d => d.day === '2026-07-01').note).toContain('成年大象')
    // 没写过碎碎念的天返回空串
    const empty = await (await app.request('/api/day-notes/2020-01-01', { headers: H() })).json()
    expect(empty.text).toBe('')
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
    await createEntry({ task: '纳米线' })
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
