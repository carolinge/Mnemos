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
