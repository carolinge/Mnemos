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

  it('Mod-- 逐级降到正文', () => {
    ed.commands.setHeading({ level: 1 })
    press('Mod--')
    expect(ed.isActive('heading', { level: 2 })).toBe(true)
    press('Mod--')
    expect(ed.isActive('heading', { level: 3 })).toBe(true)
    press('Mod--')
    expect(ed.isActive('paragraph')).toBe(true)
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
})
