import { describe, it, expect } from 'vitest'
import { mdToPm } from '../src/mdToPm.js'
import { pmToMarkdown } from '../src/export.js'

const types = doc => doc.content.map(n => n.type)
const firstText = node => JSON.stringify(node)

describe('mdToPm 块级', () => {
  it('段落与标题', () => {
    const d = mdToPm('## 组会记录\n\n讨论了旋涂参数。\n')
    expect(types(d)).toEqual(['heading', 'paragraph'])
    expect(d.content[0].attrs.level).toBe(2)
    expect(firstText(d)).toContain('组会记录')
    expect(firstText(d)).toContain('讨论了旋涂参数。')
  })

  it('连续行合并为一个段落，空行分段', () => {
    const d = mdToPm('第一行\n第二行\n\n新段落\n')
    expect(types(d)).toEqual(['paragraph', 'paragraph'])
    expect(firstText(d.content[0])).toContain('第一行 第二行')
  })

  it('无序列表含嵌套', () => {
    const d = mdToPm('-  Tyler: 长RNA有优势\n   -  interaction strength 10kt\n   -  base stacking\n-  第二条\n')
    expect(types(d)).toEqual(['bulletList'])
    const items = d.content[0].content
    expect(items.length).toBe(2)
    // 第一项内含嵌套列表
    expect(items[0].content.map(n => n.type)).toEqual(['paragraph', 'bulletList'])
    expect(items[0].content[1].content.length).toBe(2)
  })

  it('有序列表', () => {
    const d = mdToPm('1. 第一\n2. 第二\n')
    expect(types(d)).toEqual(['orderedList'])
    expect(d.content[0].content.length).toBe(2)
  })

  it('待办清单', () => {
    const d = mdToPm('- [x] 已做\n- [ ] 未做\n')
    expect(types(d)).toEqual(['taskList'])
    expect(d.content[0].content[0].attrs.checked).toBe(true)
    expect(d.content[0].content[1].attrs.checked).toBe(false)
  })

  it('引用块（多行合并，保留内部块结构）', () => {
    const d = mdToPm('> bug_linux: 找不到路径\n>\n> 多次重新提交可恢复\n')
    expect(types(d)).toEqual(['blockquote'])
    expect(d.content[0].content.length).toBe(2)
    expect(firstText(d)).toContain('bug_linux')
  })

  it('代码块保留语言与原文', () => {
    const d = mdToPm('```python\nprint(1)\nx = 2\n```\n')
    expect(types(d)).toEqual(['codeBlock'])
    expect(d.content[0].attrs.language).toBe('python')
    expect(d.content[0].content[0].text).toBe('print(1)\nx = 2')
  })

  it('mermaid 代码块变成流程图节点', () => {
    const d = mdToPm('```mermaid\ngraph TD; A-->B\n```\n')
    expect(types(d)).toEqual(['mermaidBlock'])
    expect(d.content[0].attrs.code).toBe('graph TD; A-->B')
  })

  it('表格（表头 + 分隔行 + 数据行）', () => {
    const d = mdToPm('| test7 | 100 chimeras | 770 μM |\n| --- | --- | --- |\n| test8 | 800 chimeras | 6.2 mM |\n')
    expect(types(d)).toEqual(['table'])
    const rows = d.content[0].content
    expect(rows.length).toBe(2)
    expect(rows[0].content[0].type).toBe('tableHeader')
    expect(rows[1].content[0].type).toBe('tableCell')
    expect(firstText(rows[1])).toContain('800 chimeras')
  })

  it('分割线', () => {
    expect(types(mdToPm('---\n'))).toEqual(['horizontalRule'])
  })
})

describe('mdToPm 行内', () => {
  const marksOf = md => {
    const d = mdToPm(md)
    return d.content[0].content
  }

  it('粗体/斜体/行内代码/删除线/高亮', () => {
    const n = marksOf('用 **强调** 与 *斜* 与 `code` 与 ~~删~~ 与 ==亮==')
    const json = JSON.stringify(n)
    for (const m of ['bold', 'italic', 'code', 'strike', 'highlight']) {
      expect(json).toContain(m)
    }
  })

  it('链接', () => {
    const n = marksOf('见 [Nature](https://www.nature.com/articles/x) 一文')
    const link = n.find(x => x.marks?.some(m => m.type === 'link'))
    expect(link.marks[0].attrs.href).toBe('https://www.nature.com/articles/x')
    expect(link.text).toBe('Nature')
  })

  it('裸链接自动成链接', () => {
    const n = marksOf('参考 https://www.nature.com/articles/s41467-025-59676-4 这篇')
    const link = n.find(x => x.marks?.some(m => m.type === 'link'))
    expect(link.text).toContain('nature.com')
  })

  it('图片', () => {
    const d = mdToPm('![](/images/2026/07/a.png)')
    expect(d.content[0].content[0].type).toBe('image')
    expect(d.content[0].content[0].attrs.src).toBe('/images/2026/07/a.png')
  })

  it('残留行内 HTML 被剥成纯文本（<sup>、<span>）', () => {
    const n = marksOf('Mar 12<sup>th</sup> 的 <span id="260312">记录</span>')
    const text = n.map(x => x.text).join('')
    expect(text).toContain('Mar 12th')
    expect(text).toContain('记录')
    expect(text).not.toContain('<')
  })

  it('行内公式原样保留文本，交给编辑器渲染', () => {
    const n = marksOf('其中 $E=mc^2$ 成立')
    expect(n.map(x => x.text).join('')).toContain('$E=mc^2$')
  })

  it('块级 $$…$$ 不被从中间切开', () => {
    const n = marksOf('$$U = U_{\\text{bond}} + U_{\\text{DH}}$$')
    const joined = n.map(x => x.text).join('')
    expect(joined).toBe('$$U = U_{\\text{bond}} + U_{\\text{DH}}$$')
    // 不应出现被拆成孤立的 "$" 片段
    expect(n.some(x => x.text === '$')).toBe(false)
  })

  it('下划线转义与星号不成对时不误伤', () => {
    const n = marksOf('文件名 mu_ij 和 2 * 3 = 6')
    const text = n.map(x => x.text).join('')
    expect(text).toContain('mu_ij')
    expect(text).toContain('2 * 3 = 6')
  })
})

describe('导入导出往返', () => {
  it('mdToPm → pmToMarkdown 保住主要结构', () => {
    const src = [
      '## 实验记录',
      '',
      '今天合成了 **量子点**，见 [论文](https://doi.org/10.1/x)。',
      '',
      '- 甲',
      '  - 甲一',
      '- 乙',
      '',
      '> 注意：湿度必须低于 10%',
      '',
      '```python',
      'print(1)',
      '```',
    ].join('\n')
    const back = pmToMarkdown(mdToPm(src))
    expect(back).toContain('## 实验记录')
    expect(back).toContain('**量子点**')
    expect(back).toContain('[论文](https://doi.org/10.1/x)')
    expect(back).toContain('- 甲')
    expect(back).toContain('  - 甲一')
    expect(back).toContain('> 注意：湿度必须低于 10%')
    expect(back).toContain('```python\nprint(1)\n```')
  })
})
