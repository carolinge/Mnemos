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

async function seed(day, text, task = null) {
  const res = await app.request('/api/entries', {
    method: 'POST', headers: H(), body: JSON.stringify({ day, content: doc(text), task }),
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
    await seed('2026-07-01', 'A 相关', 'A')
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
    expect(j).toEqual([
      { day: '2026-07-01', count: 2, todo: 0 },
      { day: '2026-07-03', count: 1, todo: 0 },
    ])
  })
})

describe('/api/days 的待办标记（时间条上标橙点用）', () => {
  const todoDoc = (text, checked) => ({ type: 'doc', content: [
    { type: 'taskList', content: [
      { type: 'taskItem', attrs: { checked },
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    ] },
  ] })
  const put = (day, content, task) => app.request('/api/entries', {
    method: 'POST', headers: H(), body: JSON.stringify({ day, content, task }),
  })

  it('有未打勾的待办 → todo=1；全部打勾 → todo=0', async () => {
    await put('2026-07-01', todoDoc('还没做', false))
    await put('2026-07-02', todoDoc('做完了', true))
    const j = await (await app.request('/api/days', { headers: H() })).json()
    expect(j.find(d => d.day === '2026-07-01').todo).toBe(1)
    expect(j.find(d => d.day === '2026-07-02').todo).toBe(0)
  })

  it('同一天只要有一条没做完就算', async () => {
    await put('2026-07-05', todoDoc('做完了', true))
    await put('2026-07-05', todoDoc('还没做', false))
    const j = await (await app.request('/api/days', { headers: H() })).json()
    expect(j.find(d => d.day === '2026-07-05').todo).toBe(1)
  })

  it('按任务过滤时只看该任务的待办', async () => {
    await put('2026-07-08', todoDoc('A 的待办', false), 'A')
    await put('2026-07-09', todoDoc('B 做完了', true), 'B')
    const projects = await (await app.request('/api/projects', { headers: H() })).json()
    const b = projects.find(p => p.name === 'B')
    const j = await (await app.request(`/api/days?project=${b.id}`, { headers: H() })).json()
    expect(j.map(d => d.day)).toEqual(['2026-07-09'])
    expect(j[0].todo).toBe(0)
  })
})

describe('只有碎碎念、没有卡片的日子', () => {
  it('照样出现在时间流里（否则那句话再也看不到）', async () => {
    await app.request('/api/day-notes/2026-07-01', {
      method: 'PUT', headers: H(), body: JSON.stringify({ text: '今天只留一句话' }),
    })
    const j = await (await app.request('/api/entries?limit=50', { headers: H() })).json()
    const day = j.days.find(d => d.day === '2026-07-01')
    expect(day).toBeTruthy()
    expect(day.note).toBe('今天只留一句话')
    expect(day.entries).toEqual([])
  })

  it('删掉当天最后一张卡片，碎碎念仍在', async () => {
    const e = await seed('2026-07-02', '唯一一张卡片')
    await app.request('/api/day-notes/2026-07-02', {
      method: 'PUT', headers: H(), body: JSON.stringify({ text: '别把我一起删了' }),
    })
    await app.request(`/api/entries/${e.id}`, { method: 'DELETE', headers: H() })
    const j = await (await app.request('/api/entries?limit=50', { headers: H() })).json()
    expect(j.days.find(d => d.day === '2026-07-02')?.note).toBe('别把我一起删了')
  })

  it('空白碎碎念不会凭空造出一天', async () => {
    await app.request('/api/day-notes/2026-07-03', {
      method: 'PUT', headers: H(), body: JSON.stringify({ text: '   ' }),
    })
    const j = await (await app.request('/api/entries?limit=50', { headers: H() })).json()
    expect(j.days.some(d => d.day === '2026-07-03')).toBe(false)
  })

  it('before 翻页时也照样带上这种日子', async () => {
    await seed('2026-07-20', '较新的一条')
    await app.request('/api/day-notes/2026-07-10', {
      method: 'PUT', headers: H(), body: JSON.stringify({ text: '更早的一句话' }),
    })
    const j = await (await app.request('/api/entries?limit=50&before=2026-07-15', { headers: H() })).json()
    expect(j.days.some(d => d.day === '2026-07-10')).toBe(true)
  })
})
