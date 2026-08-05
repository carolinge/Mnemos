import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/editor/extensions'

describe('buildExtensions', () => {
  it('能创建编辑器并回读 JSON/文本，粗体命令可用', () => {
    const ed = new Editor({
      extensions: buildExtensions({ placeholder: '记点什么…' }),
      content: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: '你好实验' }] }] },
    })
    expect(ed.getText()).toContain('你好实验')
    ed.commands.selectAll()
    ed.commands.toggleBold()
    const json = ed.getJSON()
    expect(JSON.stringify(json)).toContain('bold')
    ed.destroy()
  })

  it('包含表格/任务清单/代码高亮/数学扩展', () => {
    const names = buildExtensions({}).map(e => e.name)
    for (const n of ['table', 'taskList', 'codeBlock', 'Mathematics']) {
      expect(names).toContain(n)
    }
  })
})

describe('公式渲染', () => {
  it('$$…$$ 与 $…$ 都能被识别（默认正则只认后者，块级公式会漏成源码）', () => {
    const math = buildExtensions({}).find(e => e.name === 'Mathematics')!
    const re: RegExp = (math.options as { regex: RegExp }).regex
    const grab = (t: string) => {
      re.lastIndex = 0
      return [...t.matchAll(re)].map(m => m[1] ?? m[2])
    }
    expect(grab('$$F = -k_B T \\ln Z$$')).toEqual(['F = -k_B T \\ln Z'])
    expect(grab('inline $E=mc^2$ here')).toEqual(['E=mc^2'])
    expect(grab('$a$ and $b$')).toEqual(['a', 'b'])
    expect(grab('costs $5 and $7')).toEqual([])   // 不该把价格当公式
  })
})
