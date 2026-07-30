import { describe, it, expect } from 'vitest'
import { extractText } from '../src/text.js'

describe('extractText', () => {
  it('抽取嵌套文本、引用卡片与 mermaid 源码，折叠空白', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '实验记录' }] },
        { type: 'paragraph', content: [
          { type: 'text', text: '今天合成了 ' },
          { type: 'text', marks: [{ type: 'bold' }], text: '量子点' },
        ] },
        { type: 'citation', attrs: { url: 'https://doi.org/10.1/x', title: 'Great Paper', authors: 'Li L', venue: 'Nature', year: '2024' } },
        { type: 'mermaidBlock', attrs: { code: 'graph TD; A-->B' } },
        { type: 'htmlEmbed', attrs: { html: '<script>evil()</script>' } },
      ],
    }
    const t = extractText(doc)
    expect(t).toContain('实验记录')
    expect(t).toContain('量子点')
    expect(t).toContain('Great Paper')
    expect(t).toContain('A-->B')
    expect(t).not.toContain('evil')   // 嵌入块的原始 HTML 不进索引
    expect(t).not.toMatch(/\s{2,}/)
  })

  it('空文档返回空串', () => {
    expect(extractText({ type: 'doc', content: [] })).toBe('')
    expect(extractText(null)).toBe('')
  })
})
