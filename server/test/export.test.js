import { describe, it, expect } from 'vitest'
import { pmToMarkdown, buildFullMarkdown, buildMonthlyMarkdown } from '../src/export.js'
import { parseNotesMarkdown } from '../src/importMd.js'
import { createDb } from '../src/db.js'
import { createApp } from '../src/app.js'

const P = (...inline) => ({ type: 'paragraph', content: inline })
const T = (text, ...marks) => ({ type: 'text', text, ...(marks.length ? { marks } : {}) })

describe('pmToMarkdown', () => {
  it('标题/段落/行内标记/链接', () => {
    const md = pmToMarkdown({ type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [T('实验')] },
      P(T('用 '), T('强调', { type: 'bold' }), T(' 与 '), T('代码', { type: 'code' }),
        T(' 及 '), T('链接', { type: 'link', attrs: { href: 'https://x.com' } })),
    ] })
    expect(md).toContain('## 实验')
    expect(md).toContain('**强调**')
    expect(md).toContain('`代码`')
    expect(md).toContain('[链接](https://x.com)')
  })

  it('列表（嵌套/任务）与引用块、分割线', () => {
    const md = pmToMarkdown({ type: 'doc', content: [
      { type: 'bulletList', content: [
        { type: 'listItem', content: [P(T('甲')), { type: 'bulletList', content: [
          { type: 'listItem', content: [P(T('甲一'))] }] }] },
      ] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [P(T('第一'))] }] },
      { type: 'taskList', content: [
        { type: 'taskItem', attrs: { checked: true }, content: [P(T('已做'))] },
        { type: 'taskItem', attrs: { checked: false }, content: [P(T('未做'))] },
      ] },
      { type: 'blockquote', content: [P(T('引言'))] },
      { type: 'horizontalRule' },
    ] })
    expect(md).toContain('- 甲')
    expect(md).toContain('  - 甲一')
    expect(md).toContain('1. 第一')
    expect(md).toContain('- [x] 已做')
    expect(md).toContain('- [ ] 未做')
    expect(md).toContain('> 引言')
    expect(md).toContain('---')
  })

  it('代码块/mermaid/表格/图片路径重写/引用卡片/嵌入块', () => {
    const embeds = []
    const md = pmToMarkdown({ type: 'doc', content: [
      { type: 'codeBlock', attrs: { language: 'python' }, content: [T('print(1)')] },
      { type: 'mermaidBlock', attrs: { code: 'graph TD; A-->B' } },
      { type: 'table', content: [
        { type: 'tableRow', content: [
          { type: 'tableHeader', content: [P(T('列1'))] }, { type: 'tableHeader', content: [P(T('列2'))] }] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [P(T('a'))] }, { type: 'tableCell', content: [P(T('b'))] }] },
      ] },
      P({ type: 'image', attrs: { src: '/images/2026/07/abc.png', width: 50 } }),
      { type: 'citation', attrs: { url: 'https://doi.org/10.1/x', title: 'Paper', year: '2024', venue: 'Nat.' } },
      { type: 'htmlEmbed', attrs: { html: '<div><script>x()</script></div>' } },
    ] }, { imgPrefix: '../../images/', onEmbed: html => { embeds.push(html); return `embeds/e${embeds.length}.html` } })
    expect(md).toContain('```python\nprint(1)\n```')
    expect(md).toContain('```mermaid\ngraph TD; A-->B\n```')
    expect(md).toContain('| 列1 | 列2 |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| a | b |')
    expect(md).toContain('![](../../images/2026/07/abc.png)')
    expect(md).toContain('[Paper (2024) · Nat.](https://doi.org/10.1/x)')
    expect(md).toContain('[交互内容](embeds/e1.html)')
    expect(embeds.length).toBe(1)
  })
})

describe('GET /api/export', () => {
  it('返回 zip（PK 魔数）', async () => {
    const app = createApp({ db: createDb(':memory:'), imagesDir: '/tmp/img-test', password: 'pw' })
    const login = await app.request('/api/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'pw' }),
    })
    const cookie = login.headers.get('set-cookie').split(';')[0]
    await app.request('/api/entries', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ day: '2026-07-01', content: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello export' }] }] } }),
    })
    const res = await app.request('/api/export', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.length).toBeGreaterThan(100)
    expect(buf.subarray(0, 2).toString()).toBe('PK')
  })
})

describe('导出格式：整份 / 按月 / 往返', () => {
  function seededDb() {
    const db = createDb(':memory:')
    const app = createApp({ db, imagesDir: '/tmp/img-test', password: 'pw' })
    return { db, app }
  }
  const doc2 = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

  async function seed(app, entries, notes = {}) {
    const login = await app.request('/api/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'pw' }),
    })
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const H = { 'Content-Type': 'application/json', Cookie: cookie }
    for (const [day, task, text] of entries) {
      await app.request('/api/entries', {
        method: 'POST', headers: H, body: JSON.stringify({ day, task, content: doc2(text) }),
      })
    }
    for (const [day, text] of Object.entries(notes)) {
      await app.request(`/api/day-notes/${day}`, { method: 'PUT', headers: H, body: JSON.stringify({ text }) })
    }
    return cookie
  }

  it('整份 Markdown：年份 H1、日期 H5 带 span id、任务 font 标记', async () => {
    const { db, app } = seededDb()
    await seed(app, [
      ['2025-12-20', 'PH', '年底的记录'],
      ['2026-03-12', 'talk', '原来有这么多人做 condensate'],
      ['2026-03-12', 'SAM', '调了一下密度'],
    ], { '2026-03-12': '今天注意力堪比大象' })

    const md = buildFullMarkdown(db)
    expect(md).toContain('# 2025')
    expect(md).toContain('# 2026')
    expect(md).toContain('##### <span id="251220">Dec 20<sup>th</sup></span>')
    expect(md).toContain('##### <span id="260312">Mar 12<sup>th</sup></span>')
    expect(md).toMatch(/<font color=#[0-9a-f]{6}>talk<\/font>/i)
    expect(md).toContain('今天注意力堪比大象')
    // 年份顺序：2025 在 2026 之前
    expect(md.indexOf('# 2025')).toBeLessThan(md.indexOf('# 2026'))
    // 同一天两张卡片都在
    expect(md).toContain('原来有这么多人做 condensate')
    expect(md).toContain('调了一下密度')
  })

  it('按月拆分：每月一份，键为 YYYY-MM', async () => {
    const { db, app } = seededDb()
    await seed(app, [
      ['2026-06-02', 'FIB', '六月的事'],
      ['2026-07-14', 'FIB', '七月的事'],
      ['2026-07-26', 'PH', '七月另一件'],
    ])
    const chunks = buildMonthlyMarkdown(db)
    expect([...chunks.keys()].sort()).toEqual(['2026-06', '2026-07'])
    expect(chunks.get('2026-06')).toContain('六月的事')
    expect(chunks.get('2026-06')).not.toContain('七月的事')
    expect(chunks.get('2026-07')).toContain('七月的事')
    expect(chunks.get('2026-07')).toContain('七月另一件')
  })

  it('往返一致：导出的 Markdown 能被解析器原样读回', async () => {
    const { db, app } = seededDb()
    await seed(app, [
      ['2026-03-12', 'talk', '第一条记录'],
      ['2026-03-12', 'PH', '第二条记录'],
      ['2026-05-08', 'DEN', '另一天的记录'],
    ], { '2026-05-08': '碎碎念一句' })

    const md = buildFullMarkdown(db)
    const back = parseNotesMarkdown(md)
    expect(back.warnings).toEqual([])
    expect(back.entries.map(e => [e.day, e.task])).toEqual([
      ['2026-03-12', 'talk'], ['2026-03-12', 'PH'], ['2026-05-08', 'DEN'],
    ])
    expect(back.asides).toEqual([{ day: '2026-05-08', text: '碎碎念一句' }])
    expect(back.entries[0].markdown).toContain('第一条记录')
  })
})
