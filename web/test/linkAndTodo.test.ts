import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/editor/extensions'

const press = (ed: Editor, key: string) => {
  const ext = ed.extensionManager.extensions.find(e => e.name === 'typoraKeys')!
  const fn = ext.config.addKeyboardShortcuts as unknown as
    (this: { editor: Editor }) => Record<string, () => boolean>
  return fn.call({ editor: ed })[key]()
}

describe('待办清单', () => {
  it('Mod-Shift-X 把当前行变成 todo，再按一次变回来', () => {
    const ed = new Editor({
      extensions: buildExtensions({}),
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '写完这段' }] }] },
    })
    ed.commands.setTextSelection(2)
    press(ed, 'Mod-Shift-x')
    expect(ed.isActive('taskList')).toBe(true)
    // 新建的待办默认未打勾——时间条据此标橙点
    expect(JSON.stringify(ed.getJSON())).toContain('"checked":false')
    press(ed, 'Mod-Shift-x')
    expect(ed.isActive('taskList')).toBe(false)
    ed.destroy()
  })
})

describe('⌘S', () => {
  it('触发注入的保存回调，且不改动文档', () => {
    let saved = 0
    const ed = new Editor({
      extensions: buildExtensions({ onSave: () => { saved++ } }),
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
    })
    const before = JSON.stringify(ed.getJSON())
    expect(press(ed, 'Mod-s')).toBe(true)
    expect(saved).toBe(1)
    expect(JSON.stringify(ed.getJSON())).toBe(before)
    ed.destroy()
  })
})

describe('链接', () => {
  it('setLink 后 href 可读回，unsetLink 后消失', () => {
    const ed = new Editor({
      extensions: buildExtensions({}),
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nature' }] }] },
    })
    ed.commands.selectAll()
    ed.chain().setLink({ href: 'https://www.nature.com' }).run()
    expect(ed.getAttributes('link').href).toBe('https://www.nature.com')
    ed.chain().extendMarkRange('link').unsetLink().run()
    expect(ed.getAttributes('link').href).toBeUndefined()
    ed.destroy()
  })

  it('只写域名时补 https://（EntryCard 里的同一条规则）', () => {
    const norm = (url: string) => /^[a-z][\w+.-]*:/i.test(url) ? url : `https://${url}`
    expect(norm('nature.com')).toBe('https://nature.com')
    expect(norm('https://x.org')).toBe('https://x.org')
    expect(norm('mailto:a@b.c')).toBe('mailto:a@b.c')
  })
})
