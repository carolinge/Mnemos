import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

// 对齐 Typora 官方快捷键表（support.typora.io/Shortcut-Keys/）。
// Mod = macOS 的 Cmd / 其他平台的 Ctrl。Mac 上 Typora 有一套自己的组合，两套都绑上。
//
//   功能            Windows/Linux        macOS
//   标题 1–6        Mod-1 … Mod-6        同
//   正文            Mod-0                同
//   标题升/降级      Mod-+ / Mod--        同
//   链接            Mod-K                Mod-K
//   代码块          Mod-Shift-K          Mod-Alt-C
//   行内代码         Mod-Shift-`          Mod-Shift-`
//   有序列表         Mod-Shift-[          Mod-Alt-O
//   无序列表         Mod-Shift-]          Mod-Alt-U
//   引用            Mod-Shift-Q          Mod-Alt-Q
//   表格            Mod-T                Mod-Alt-T
//   图片            Mod-Shift-I          Mod-Ctrl-I
//   公式块          Mod-Shift-M          Mod-Alt-B
//   删除线          Alt-Shift-5          Ctrl-Shift-`
//   缩进 / 反缩进    Mod-[ / Mod-] 或 Tab / Shift-Tab
//   清除格式         Mod-\                同
//
// 需要弹窗的两个（链接、图片）由外部注入回调，键位定义留在这里集中管理。

const MAX_LEVEL = 6

export interface TyporaKeyHooks {
  onLink?: () => void     // 弹出输入链接
  onImage?: () => void    // 弹出选择图片
}

export const TyporaKeys = (hooks: TyporaKeyHooks = {}) => Extension.create({
  name: 'typoraKeys',

  addKeyboardShortcuts() {
    const editor = this.editor

    const setLevel = (level: number) => () =>
      editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run()

    // delta<0 升级（层级数字变小），delta>0 降级
    const bumpHeading = (delta: number) => () => {
      const levels = [1, 2, 3, 4, 5, 6]
      const active = levels.find(l => editor.isActive('heading', { level: l }))
      if (active === undefined) {
        if (delta < 0) return editor.chain().focus().setHeading({ level: 1 }).run()
        return false            // 正文再降级无意义
      }
      const next = active + delta
      if (next < 1) return editor.chain().focus().setHeading({ level: 1 }).run()
      if (next > MAX_LEVEL) return editor.chain().focus().setParagraph().run()
      return editor.chain().focus().setHeading({ level: next as 1 | 2 | 3 | 4 | 5 | 6 }).run()
    }

    const inList = () => editor.isActive('listItem') || editor.isActive('taskItem')
    const itemType = () => (editor.isActive('taskItem') ? 'taskItem' : 'listItem')
    const indent = () => inList() && editor.commands.sinkListItem(itemType())
    const outdent = () => inList() && editor.commands.liftListItem(itemType())

    const codeBlock = () => editor.chain().focus().toggleCodeBlock().run()
    const orderedList = () => editor.chain().focus().toggleOrderedList().run()
    const bulletList = () => editor.chain().focus().toggleBulletList().run()
    const blockquote = () => editor.chain().focus().toggleBlockquote().run()
    const table = () => editor.chain().focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    const strike = () => editor.chain().focus().toggleStrike().run()
    const inlineCode = () => editor.chain().focus().toggleCode().run()
    // 公式块：插入一对 $$，光标落回中间，内容交给 Mathematics 渲染
    const mathBlock = () => editor.chain().focus().insertContent('$$  $$')
      .command(({ tr, dispatch }) => {
        if (dispatch) {
          const pos = Math.max(0, tr.selection.from - 3)
          tr.setSelection(TextSelection.near(tr.doc.resolve(pos)))
        }
        return true
      }).run()

    // Clear formatting: drop inline marks (bold/italic/…) and reset the
    // block back to a plain paragraph — the standard "strip whatever this
    // pasted-in content brought with it" command.
    const clearFormat = () => editor.chain().focus().clearNodes().unsetAllMarks().run()

    const link = () => { hooks.onLink?.(); return true }
    const image = () => { hooks.onImage?.(); return true }

    const map: Record<string, () => boolean> = {
      'Mod-0': () => editor.chain().focus().setParagraph().run(),
      'Mod-+': bumpHeading(-1),
      'Mod-=': bumpHeading(-1),
      'Mod--': bumpHeading(1),

      'Mod-k': link,
      'Mod-Shift-k': codeBlock,
      'Mod-Alt-c': codeBlock,
      'Mod-Shift-`': inlineCode,

      'Mod-Shift-[': orderedList,
      'Mod-Alt-o': orderedList,
      'Mod-Shift-]': bulletList,
      'Mod-Alt-u': bulletList,

      'Mod-Shift-q': blockquote,
      'Mod-Alt-q': blockquote,

      'Mod-t': table,
      'Mod-Alt-t': table,

      'Mod-Shift-i': image,
      'Mod-Ctrl-i': image,

      'Mod-Shift-m': mathBlock,
      'Mod-Alt-b': mathBlock,

      'Alt-Shift-5': strike,
      'Ctrl-Shift-`': strike,

      'Mod-[': () => indent() || false,
      'Mod-]': () => outdent() || false,
      'Mod-\\': () => { clearFormat(); return true },
      Tab: () => (inList() ? indent() : false),      // 不在列表里就把 Tab 还给编辑器
      'Shift-Tab': () => (inList() ? outdent() : false),
    }

    for (let l = 1; l <= MAX_LEVEL; l++) map[`Mod-${l}`] = setLevel(l)
    return map
  },
})
