import { describe, it, expect, beforeAll } from 'vitest'
import { recoverDrafts } from '../src/lib/recoverDrafts'

// 对着真正跑起来的服务器走一遍：断网时留下的草稿 → 补传 → 服务器上真的出现了这条笔记。
// 服务器没起就跳过，不让本地缺环境的人卡在这条测试上。
const BASE = 'http://localhost:8797'
let up = false
let cookie = ''

async function login() {
  const r = await fetch(`${BASE}/api/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'dev' }),
  })
  cookie = (r.headers.get('set-cookie') || '').split(';')[0]
  return r.ok
}

beforeAll(async () => {
  try { up = await login() } catch { up = false }
})

function fakeStore(entries: Record<string, string>): Storage {
  const m = new Map(Object.entries(entries))
  return {
    get length() { return m.size },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
  } as unknown as Storage
}

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

describe.runIf(process.env.E2E === '1')('断网草稿补传（对真实服务器）', () => {
  it('孤儿草稿补传后，服务器上能查到这段字', async () => {
    expect(up).toBe(true)
    const text = `断网时写的 ${Date.now()}`
    const store = fakeStore({
      'draft:new:orphan': JSON.stringify({ at: Date.now(), day: '2026-08-11', payload: { content: doc(text), task: 'PH' } }),
    })

    const r = await recoverDrafts(async body => {
      const res = await fetch(`${BASE}/api/entries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    }, store)

    expect(r).toMatchObject({ recovered: 1, failed: 0, days: ['2026-08-11'] })
    expect(store.getItem('draft:new:orphan')).toBeNull()

    const list = await fetch(`${BASE}/api/entries?q=${encodeURIComponent(text.slice(0, 8))}`,
      { headers: { Cookie: cookie } }).then(x => x.json())
    const hit = list.days.flatMap((d: any) => d.entries).find((e: any) => e.text.includes(text))
    expect(hit).toBeTruthy()
    expect(hit.day).toBe('2026-08-11')
    expect(hit.task?.name).toBe('PH')
  })

  it('服务器不可达时草稿原样保留', async () => {
    const store = fakeStore({
      'draft:new:keepme': JSON.stringify({ at: Date.now(), day: '2026-08-11', payload: { content: doc('不能丢') } }),
    })
    const r = await recoverDrafts(async () => { throw new Error('offline') }, store)
    expect(r.failed).toBe(1)
    expect(store.getItem('draft:new:keepme')).not.toBeNull()
  })
})
