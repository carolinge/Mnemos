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

async function seed(day, text, tags = []) {
  const res = await app.request('/api/entries', {
    method: 'POST', headers: H(), body: JSON.stringify({ day, content: doc(text), tags }),
  })
  return res.json()
}

describe('entries list', () => {
  it('默认按 day 降序分组返回，nextBefore/nextAfter 正确', async () => {
    for (const d of ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04']) await seed(d, `note ${d}`)
    const res = await app.request('/api/entries?limit=2', { headers: H() })
    const j = await res.json()
    expect(j.days.map(d => d.day)).toEqual(['2026-07-04', '2026-07-03'])
    expect(j.nextBefore).toBe('2026-07-03')
    expect(j.nextAfter).toBe('2026-07-04')
    const older = await (await app.request(`/api/entries?limit=2&before=${j.nextBefore}`, { headers: H() })).json()
    expect(older.days.map(d => d.day)).toEqual(['2026-07-02', '2026-07-01'])
  })

  it('after 向新方向翻页（时间条跳转后加载更新内容）', async () => {
    for (const d of ['2026-07-01', '2026-07-02', '2026-07-03']) await seed(d, `note ${d}`)
    const res = await app.request('/api/entries?limit=2&after=2026-07-01', { headers: H() })
    const j = await res.json()
    expect(j.days.map(d => d.day)).toEqual(['2026-07-03', '2026-07-02'])
  })

  it('project 过滤只返回该项目条目所在的天', async () => {
    await seed('2026-07-01', 'A 相关', ['A'])
    await seed('2026-07-02', '无关')
    const projects = await (await app.request('/api/projects', { headers: H() })).json()
    const res = await app.request(`/api/entries?project=${projects[0].id}`, { headers: H() })
    const j = await res.json()
    expect(j.days.length).toBe(1)
    expect(j.days[0].day).toBe('2026-07-01')
  })

  it('搜索：英文≥3字符走 FTS，中文2字符走 LIKE 兜底', async () => {
    await seed('2026-07-01', 'graphene transfer process')
    await seed('2026-07-02', '钙钛矿太阳能电池')
    let j = await (await app.request('/api/entries?q=graphene', { headers: H() })).json()
    expect(j.days.flatMap(d => d.entries).length).toBe(1)
    j = await (await app.request(`/api/entries?q=${encodeURIComponent('钙钛')}`, { headers: H() })).json()
    expect(j.days.flatMap(d => d.entries).length).toBe(1)
    j = await (await app.request('/api/entries?q=nothing-here', { headers: H() })).json()
    expect(j.days.length).toBe(0)
  })

  it('/api/days 返回全部有笔记的日期与计数（供时间条）', async () => {
    await seed('2026-07-01', 'a'); await seed('2026-07-01', 'b'); await seed('2026-07-03', 'c')
    const j = await (await app.request('/api/days', { headers: H() })).json()
    expect(j).toEqual([{ day: '2026-07-01', count: 2 }, { day: '2026-07-03', count: 1 }])
  })
})
