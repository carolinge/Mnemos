import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/editor/extensions'

let ed: Editor
beforeEach(() => {
  ed = new Editor({
    extensions: buildExtensions({}),
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '一段文字' }] }] },
  })
})
afterEach(() => ed.destroy())

// 直接调用扩展注册的快捷键处理函数，绕开 jsdom 的按键事件模拟
function press(key: string): boolean {
  const ext = ed.extensionManager.extensions.find(e => e.name === 'typoraKeys')!
  const fn = ext.config.addKeyboardShortcuts as unknown as
    (this: { editor: Editor }) => Record<string, () => boolean>
  return fn.call({ editor: ed })[key]()
}

describe('Typora 快捷键', () => {
  it('Mod-+ 从正文升为 H1，再升仍是 H1', () => {
    ed.commands.setTextSelection(2)
    press('Mod-+')
    expect(ed.isActive('heading', { level: 1 })).toBe(true)
    press('Mod-+')
    expect(ed.isActive('heading', { level: 1 })).toBe(true)
  })

  it('Mod-= 与 Mod-+ 等价（无需按 Shift 也能升级）', () => {
    ed.commands.setTextSelection(2)
    press('Mod-=')
    expect(ed.isActive('heading', { level: 1 })).toBe(true)
  })

  it('Mod-- 逐级降级，H6 之后回到正文（标题层级与 Typora 一致为 1–6）', () => {
    ed.commands.setHeading({ level: 1 })
    for (const level of [2, 3, 4, 5, 6] as const) {
      press('Mod--')
      expect(ed.isActive('heading', { level })).toBe(true)
    }
    press('Mod--')
    expect(ed.isActive('paragraph')).toBe(true)
  })

  it('Mod-1…Mod-6 直接设标题层级，Mod-0 回正文', () => {
    ed.commands.setTextSelection(2)
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      press(`Mod-${level}`)
      expect(ed.isActive('heading', { level })).toBe(true)
    }
    press('Mod-0')
    expect(ed.isActive('paragraph')).toBe(true)
  })

  it('Typora 键位：Mod-Shift-K 代码块、Mod-Shift-Q 引用、Mod-T 表格', () => {
    ed.commands.setTextSelection(2)
    press('Mod-Shift-k')
    expect(ed.isActive('codeBlock')).toBe(true)
    press('Mod-Shift-k')          // 再按一次取消

    press('Mod-Shift-q')
    expect(ed.isActive('blockquote')).toBe(true)
    press('Mod-Shift-q')

    press('Mod-t')
    expect(ed.isActive('table')).toBe(true)
  })

  it('Mod-K 走注入的链接回调，不直接改文档', () => {
    let called = 0
    const ed2 = new Editor({
      extensions: buildExtensions({ onLink: () => { called++ } }),
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    })
    const ext = ed2.extensionManager.extensions.find(e => e.name === 'typoraKeys')!
    const fn = ext.config.addKeyboardShortcuts as unknown as
      (this: { editor: Editor }) => Record<string, () => boolean>
    fn.call({ editor: ed2 })['Mod-k']()
    expect(called).toBe(1)
    ed2.destroy()
  })

  it('Mod-Shift-[ 切有序列表、Mod-Shift-] 切无序列表', () => {
    ed.commands.setTextSelection(2)
    press('Mod-Shift-[')
    expect(ed.isActive('orderedList')).toBe(true)
    press('Mod-Shift-[')          // 再按一次取消
    expect(ed.isActive('orderedList')).toBe(false)

    press('Mod-Shift-]')
    expect(ed.isActive('bulletList')).toBe(true)
  })

  it('Tab 在列表里缩进，不在列表里不拦截', () => {
    ed.commands.setTextSelection(2)
    expect(press('Tab')).toBe(false)      // 正文中放行，不吞 Tab

    ed.chain().toggleBulletList().run()
    ed.commands.insertContent('第一项')
    ed.chain().splitListItem('listItem').run()
    ed.commands.insertContent('第二项')
    expect(press('Tab')).toBe(true)       // 第二项缩进为子项
    expect(JSON.stringify(ed.getJSON())).toContain('bulletList')
  })

  it('Shift-Tab 在列表里反缩进', () => {
    ed.chain().toggleBulletList().run()
    ed.commands.insertContent('甲')
    ed.chain().splitListItem('listItem').run()
    ed.commands.insertContent('乙')
    press('Tab')
    expect(press('Shift-Tab')).toBe(true)
  })

  it('Mod-\\ 清除格式：粗体/高亮标记和标题都回到纯正文', () => {
    ed.commands.setTextSelection(2)
    ed.chain().setHeading({ level: 2 }).selectAll().toggleBold().toggleHighlight().run()
    expect(ed.isActive('heading', { level: 2 })).toBe(true)
    expect(ed.isActive('bold')).toBe(true)
    press('Mod-\\')
    expect(ed.isActive('paragraph')).toBe(true)
    expect(ed.isActive('bold')).toBe(false)
    expect(ed.isActive('highlight')).toBe(false)
  })
})
