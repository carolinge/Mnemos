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

const post = (path, body) =>
  app.request(path, { method: 'POST', headers: H(), body: JSON.stringify(body) })

describe('源码 / 渲染 双向转换', () => {
  it('文档 → Markdown', async () => {
    const doc = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '实验' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: '用 ' },
        { type: 'text', marks: [{ type: 'bold' }], text: '强调' },
      ] },
    ] }
    const { markdown } = await (await post('/api/convert/to-markdown', { content: doc })).json()
    expect(markdown).toContain('## 实验')
    expect(markdown).toContain('**强调**')
  })

  it('Markdown → 文档', async () => {
    const { content } = await (await post('/api/convert/to-doc', { markdown: '# 标题\n\n- 甲\n- 乙\n' })).json()
    expect(content.content.map(n => n.type)).toEqual(['heading', 'bulletList'])
  })

  it('往返：贴一段外部 Markdown 再转回去，结构不丢', async () => {
    const src = [
      '## 组会记录',
      '',
      '讨论了 **旋涂参数**，见 [论文](https://doi.org/10.1/x)。',
      '',
      '- 甲',
      '  - 甲一',
      '',
      '> 湿度必须低于 10%',
      '',
      '```python',
      'print(1)',
      '```',
    ].join('\n')
    const { content } = await (await post('/api/convert/to-doc', { markdown: src })).json()
    const { markdown } = await (await post('/api/convert/to-markdown', { content })).json()
    expect(markdown).toContain('## 组会记录')
    expect(markdown).toContain('**旋涂参数**')
    expect(markdown).toContain('[论文](https://doi.org/10.1/x)')
    expect(markdown).toContain('  - 甲一')
    expect(markdown).toContain('> 湿度必须低于 10%')
    expect(markdown).toContain('```python')
  })

  it('空输入不炸', async () => {
    const a = await (await post('/api/convert/to-markdown', {})).json()
    expect(typeof a.markdown).toBe('string')
    const b = await (await post('/api/convert/to-doc', {})).json()
    expect(b.content.type).toBe('doc')
  })

  it('未登录 401', async () => {
    const res = await app.request('/api/convert/to-doc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: 'x' }),
    })
    expect(res.status).toBe(401)
  })
})
