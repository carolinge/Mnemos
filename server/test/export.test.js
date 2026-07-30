import { describe, it, expect } from 'vitest'
import { pmToMarkdown } from '../src/export.js'
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
