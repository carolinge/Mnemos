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
const j = res => res.json()

const create = body =>
  app.request('/api/entries', { method: 'POST', headers: H(), body: JSON.stringify(body) }).then(j)
const patch = (id, body) =>
  app.request(`/api/entries/${id}`, { method: 'PATCH', headers: H(), body: JSON.stringify(body) })
const revisions = id => app.request(`/api/entries/${id}/revisions`, { headers: H() }).then(j)

describe('历史版本：任何覆盖都能取回', () => {
  it('被最后一次覆盖掉的那一版一定留着（能撤销最近的改动）', async () => {
    const e = await create({ day: '2026-08-03', content: doc('第一版') })
    const a = await patch(e.id, { content: doc('第二版'), version: e.version }).then(j)
    await patch(e.id, { content: doc('第三版'), version: a.version })

    const revs = await revisions(e.id)
    expect(revs[0].text).toBe('第二版')       // 正是被「第三版」盖掉的那一版
    expect(revs[0].reason).toBe('edit')
  })

  it('跨电脑覆盖后，被盖掉的内容仍可取回（本次修复的核心场景）', async () => {
    const e = await create({ day: '2026-08-03', content: doc('原始') })
    // 电脑 A 写了重要内容
    const a = await patch(e.id, { content: doc('电脑A：一整天的实验记录'), version: e.version }).then(j)
    // 电脑 B 用旧版本号 → 被乐观锁挡住
    expect((await patch(e.id, { content: doc('电脑B'), version: e.version })).status).toBe(409)
    // 电脑 B 刷新后拿到新版本号，覆盖成功
    const b = await patch(e.id, { content: doc('电脑B'), version: a.version }).then(j)
    expect(b.text).toBe('电脑B')

    // A 的内容必须还在历史里
    const revs = await revisions(e.id)
    expect(revs.some(r => r.text === '电脑A：一整天的实验记录')).toBe(true)

    // 并且能取回来
    const lost = revs.find(r => r.text === '电脑A：一整天的实验记录')
    const restored = await app.request(`/api/entries/${e.id}/restore`, {
      method: 'POST', headers: H(), body: JSON.stringify({ revisionId: lost.id }),
    }).then(j)
    expect(restored.text).toBe('电脑A：一整天的实验记录')
  })

  it('空内容覆盖后原文可取回', async () => {
    const e = await create({ day: '2026-08-03', content: doc('一段不能丢的笔记') })
    await patch(e.id, { content: { type: 'doc', content: [] }, version: e.version })
    const revs = await revisions(e.id)
    expect(revs[0].text).toBe('一段不能丢的笔记')
  })

  it('删除也留档，且可以整条还原', async () => {
    const e = await create({ day: '2026-08-03', content: doc('删掉试试') })
    await app.request(`/api/entries/${e.id}`, { method: 'DELETE', headers: H() })

    const list = await app.request('/api/entries?limit=50', { headers: H() }).then(j)
    expect(list.days.flatMap(d => d.entries).some(x => x.id === e.id)).toBe(false)

    const revs = await revisions(e.id)
    expect(revs[0].reason).toBe('delete')
    const back = await app.request(`/api/entries/${e.id}/restore`, {
      method: 'POST', headers: H(), body: JSON.stringify({ revisionId: revs[0].id }),
    }).then(j)
    expect(back.text).toBe('删掉试试')

    const after = await app.request('/api/entries?limit=50', { headers: H() }).then(j)
    expect(after.days.flatMap(d => d.entries).some(x => x.id === e.id)).toBe(true)
  })

  it('取回本身也留档，所以取回可以再撤销', async () => {
    const e = await create({ day: '2026-08-03', content: doc('甲') })
    const a = await patch(e.id, { content: doc('乙'), version: e.version }).then(j)
    const revs = await revisions(e.id)
    await app.request(`/api/entries/${e.id}/restore`, {
      method: 'POST', headers: H(), body: JSON.stringify({ revisionId: revs[0].id }),
    })
    const after = await revisions(e.id)
    expect(after.some(r => r.reason === 'restore' && r.text === '乙')).toBe(true)
    expect(a.text).toBe('乙')
  })

  it('快速连改不会攒出一堆副本，但最近一版始终可回退', async () => {
    const e = await create({ day: '2026-08-03', content: doc('v0') })
    let v = e.version
    for (const t of ['v1', 'v2', 'v3']) {
      v = (await patch(e.id, { content: doc(t), version: v }).then(j)).version
    }
    const revs = await revisions(e.id)
    expect(revs.length).toBe(1)
    expect(revs[0].text).toBe('v2')
  })

  it('单张卡片的历史互不串台', async () => {
    const a = await create({ day: '2026-08-03', content: doc('A0') })
    const b = await create({ day: '2026-08-03', content: doc('B0') })
    await patch(a.id, { content: doc('A1'), version: a.version })
    expect((await revisions(a.id)).length).toBe(1)
    expect((await revisions(b.id)).length).toBe(0)
  })
})

describe('历史不会失控增长', () => {
  it('连续打字三十次只留一条检查点（3 分钟合并窗口）', async () => {
    const e = await create({ day: '2026-08-03', content: doc('起始') })
    let v = e.version
    for (let i = 1; i <= 30; i++) {
      v = (await patch(e.id, { content: doc(`打字第 ${i} 次`), version: v }).then(j)).version
    }
    const revs = await revisions(e.id)
    expect(revs.length).toBe(1)
    // 留下的必须是「被最后一次覆盖掉的那一版」——也就是能撤销最近一次改动
    expect(revs[0].text).toBe('打字第 29 次')
  })

  it('删除与取回的存档永不被合并掉', async () => {
    const e = await create({ day: '2026-08-03', content: doc('原文') })
    await app.request(`/api/entries/${e.id}`, { method: 'DELETE', headers: H() })
    const revs = await revisions(e.id)
    const del = revs.find(r => r.reason === 'delete')
    expect(del).toBeTruthy()

    await app.request(`/api/entries/${e.id}/restore`, {
      method: 'POST', headers: H(), body: JSON.stringify({ revisionId: del.id }),
    })
    // 再连续编辑，delete 那条依然在
    let v = (await app.request('/api/entries?limit=50', { headers: H() }).then(j))
      .days.flatMap(d => d.entries).find(x => x.id === e.id).version
    for (const t of ['a', 'b', 'c']) {
      v = (await patch(e.id, { content: doc(t), version: v }).then(j)).version
    }
    expect((await revisions(e.id)).some(r => r.reason === 'delete')).toBe(true)
  })
})

describe('⌘S 手动检查点', () => {
  it('checkpoint 存的那一版永不被后续连续编辑合并掉', async () => {
    const e = await create({ day: '2026-08-06', content: doc('起点') })
    // 手动钉一版
    const a = await patch(e.id, { content: doc('值得留住的一版'), version: e.version, checkpoint: true }).then(j)
    expect((await revisions(e.id))[0].reason).toBe('manual')

    // 之后连续打字若干次
    let v = a.version
    for (const t of ['x1', 'x2', 'x3']) {
      v = (await patch(e.id, { content: doc(t), version: v }).then(j)).version
    }
    const revs = await revisions(e.id)
    // manual 那条还在，且内容正是按下 ⌘S 时被替换掉的那一版
    expect(revs.some(r => r.reason === 'manual' && r.text === '起点')).toBe(true)
  })

  it('不带 checkpoint 时行为不变，仍按 edit 合并', async () => {
    const e = await create({ day: '2026-08-06', content: doc('a') })
    let v = e.version
    for (const t of ['b', 'c', 'd']) {
      v = (await patch(e.id, { content: doc(t), version: v }).then(j)).version
    }
    const revs = await revisions(e.id)
    expect(revs.length).toBe(1)
    expect(revs.every(r => r.reason === 'edit')).toBe(true)
  })
})
