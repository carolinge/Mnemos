import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listOrphanDrafts, recoverDrafts, hasText } from '../src/lib/recoverDrafts'

// 独立的假 Storage，免得和 jsdom 的 localStorage 互相干扰
function fakeStore(entries: Record<string, string> = {}): Storage {
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

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const draft = (o: Record<string, unknown>) => JSON.stringify(o)

describe('hasText', () => {
  it('空文档不算有内容', () => {
    expect(hasText({ type: 'doc', content: [] })).toBe(false)
    expect(hasText({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(false)
    expect(hasText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }] })).toBe(false)
  })
  it('文字、图片、引用、嵌入、流程图都算', () => {
    expect(hasText(doc('写了字'))).toBe(true)
    expect(hasText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: '/x.png' } }] }] })).toBe(true)
    expect(hasText({ type: 'doc', content: [{ type: 'citation', attrs: { url: 'u' } }] })).toBe(true)
    expect(hasText({ type: 'doc', content: [{ type: 'mermaidBlock', attrs: { code: 'graph TD' } }] })).toBe(true)
    expect(hasText({ type: 'doc', content: [{ type: 'mermaidBlock', attrs: { code: '  ' } }] })).toBe(false)
  })
})

describe('listOrphanDrafts', () => {
  it('只认 draft:new:*，已落库卡片的草稿不动', () => {
    const s = fakeStore({
      'draft:new:aaa': draft({ at: 1, day: '2026-08-03', payload: { content: doc('孤儿') } }),
      'draft:abc-123': draft({ at: 2, day: '2026-08-03', payload: { content: doc('已落库的，归它自己恢复') } }),
      'theme': 'dark',
    })
    const got = listOrphanDrafts(s)
    expect(got.length).toBe(1)
    expect(got[0].key).toBe('draft:new:aaa')
    expect(got[0].day).toBe('2026-08-03')
  })

  it('没记日期的老草稿，用最后打字时间兜底', () => {
    const at = new Date(2026, 6, 4, 15, 30).getTime()   // 本地时间 2026-07-04
    const s = fakeStore({ 'draft:new:x': draft({ at, payload: { content: doc('老草稿') } }) })
    expect(listOrphanDrafts(s)[0].day).toBe('2026-07-04')
  })

  it('空草稿不补传，损坏的草稿跳过但不删', () => {
    const s = fakeStore({
      'draft:new:empty': draft({ at: 1, day: '2026-08-03', payload: { content: { type: 'doc', content: [] } } }),
      'draft:new:broken': '{不是 json',
    })
    expect(listOrphanDrafts(s)).toEqual([])
    expect(s.getItem('draft:new:broken')).toBe('{不是 json')
  })

  it('带上任务归属', () => {
    const s = fakeStore({
      'draft:new:t': draft({ at: 1, day: '2026-08-03', payload: { content: doc('x'), task: 'PH' } }),
    })
    expect(listOrphanDrafts(s)[0].task).toBe('PH')
  })
})

describe('recoverDrafts', () => {
  let store: Storage
  beforeEach(() => {
    store = fakeStore({
      'draft:new:a': draft({ at: 1, day: '2026-08-03', payload: { content: doc('第一段'), task: 'PH' } }),
      'draft:new:b': draft({ at: 2, day: '2026-08-02', payload: { content: doc('第二段') } }),
    })
  })

  it('补传成功后删掉草稿，并报告落在哪几天', async () => {
    const post = vi.fn().mockResolvedValue({ id: 'x' })
    const r = await recoverDrafts(post, store)
    expect(r).toEqual({ recovered: 2, days: ['2026-08-02', '2026-08-03'], failed: 0 })
    expect(post).toHaveBeenCalledWith({ day: '2026-08-03', content: expect.anything(), task: 'PH' })
    expect(store.getItem('draft:new:a')).toBeNull()
    expect(store.getItem('draft:new:b')).toBeNull()
  })

  it('补传失败绝不删草稿——下次启动还能再试', async () => {
    const post = vi.fn().mockRejectedValue(new Error('offline'))
    const r = await recoverDrafts(post, store)
    expect(r.recovered).toBe(0)
    expect(r.failed).toBe(2)
    expect(store.getItem('draft:new:a')).not.toBeNull()
    expect(store.getItem('draft:new:b')).not.toBeNull()
  })

  it('部分失败：成功的删掉，失败的留着', async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ id: 'x' })
      .mockRejectedValueOnce(new Error('offline'))
    const r = await recoverDrafts(post, store)
    expect(r.recovered).toBe(1)
    expect(r.failed).toBe(1)
    const left = [store.getItem('draft:new:a'), store.getItem('draft:new:b')].filter(Boolean)
    expect(left.length).toBe(1)
  })

  it('没有孤儿草稿时什么也不做', async () => {
    const post = vi.fn()
    const r = await recoverDrafts(post, fakeStore({ 'draft:abc': draft({ at: 1, payload: { content: doc('已落库') } }) }))
    expect(r.recovered).toBe(0)
    expect(post).not.toHaveBeenCalled()
  })
})
