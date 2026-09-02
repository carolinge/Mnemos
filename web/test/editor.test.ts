import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/editor/extensions'
import { closeActiveFormula } from '../src/components/EntryCard'

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
  it('光标离开公式（前后都还有别的文字）后渲染成 KaTeX，而不是停在原始源码状态', () => {
    // 复现过的真实 bug：公式是否显示成 KaTeX 还是原始源码，只看当前选区
    // 是否落在公式的字符范围内，跟编辑器有没有焦点无关。光标失焦时不会自
    // 己挪走，所以要靠 EntryCard 的 onBlur 调 closeActiveFormula 主动把选区
    // 移出公式范围。
    const ed = new Editor({
      extensions: buildExtensions({}),
      content: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: '公式 $$E = mc^2$$ 就在这句话里' }] }] },
    })
    // 模拟"正在编辑公式"：把选区放在公式内部
    ed.commands.setTextSelection(6)
    expect(ed.view.dom.innerHTML).not.toContain('katex')

    closeActiveFormula(ed)
    expect(ed.view.dom.innerHTML).toContain('katex')
    ed.destroy()
  })

  it('公式在段落开头，前面没有字符可退——挪到公式后面而不是卡在边界上', () => {
    const ed = new Editor({
      extensions: buildExtensions({}),
      content: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: '$$E = mc^2$$ 是这段话的开头' }] }] },
    })
    ed.commands.setTextSelection(3)
    closeActiveFormula(ed)
    expect(ed.view.dom.innerHTML).toContain('katex')
    ed.destroy()
  })

  it('已知边界情况：公式是整篇文档唯一内容时，挪不出这个公式的范围，暂不处理', () => {
    // ponytail：文档里除了这个公式什么都没有，任何合法光标位置都落在公式
    // 自己的字符范围内，closeActiveFormula 救不了——公式会停在源码态直到
    // 用户输入别的字符。影响面极窄且纯视觉、不动数据，记录下来是为了不让
    // 以后有人以为这是新引入的回归。
    const ed = new Editor({
      extensions: buildExtensions({}),
      content: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: '$$E = mc^2$$' }] }] },
    })
    ed.commands.setTextSelection(3)
    closeActiveFormula(ed)
    expect(ed.view.dom.innerHTML).not.toContain('katex')
    ed.destroy()
  })

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
