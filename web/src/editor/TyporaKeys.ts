import { Extension, InputRule } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

// 行首打两个 $ 再打一个空格，等同 Mod-Shift-M——跟 MermaidBlock 的
// ```mermaid 输入规则同一个机制（见 test/mermaid.test.ts），空格触发，
// 不是 Enter：Enter 在 ProseMirror 里走的是分段命令，不会经过输入规则这条
// 路径，勉强接进去容易连累到正常换行。
export const MATH_INPUT_RE = /^\$\$\s$/

// 对齐 Typora 官方快捷键表（support.typora.io/Shortcut-Keys/）。
// Mod = macOS 的 Cmd / 其他平台的 Ctrl。Mac 上 Typora 有一套自己的组合，两套都绑上。
// 这份表既是文档也是数据——ShortcutsHelp 面板直接读它，跟下面 addKeyboardShortcuts()
// 里真正注册的键位改到不同步。需要弹窗的两个（链接、图片）由外部注入回调。
export const SHORTCUT_GROUPS: { title: string; items: { keys: string; desc: string }[] }[] = [
  { title: '标题', items: [
    { keys: 'Mod-1 … Mod-6', desc: '标题 1–6' },
    { keys: 'Mod-0', desc: '正文' },
    { keys: 'Mod-+ / Mod--', desc: '标题升级 / 降级' },
  ] },
  { title: '格式', items: [
    { keys: 'Mod-K', desc: '链接（Chrome/Safari 常把这个键抢去地址栏，收不到就用下面那个）' },
    { keys: 'Mod-Alt-K', desc: '链接（备用，不会被浏览器抢）' },
    { keys: 'Mod-Shift-K / Mod-Alt-C', desc: '代码块' },
    { keys: 'Mod-Shift-`', desc: '行内代码' },
    { keys: 'Alt-Shift-5 / Ctrl-Shift-`', desc: '删除线' },
    { keys: 'Mod-\\', desc: '清除格式' },
  ] },
  { title: '列表 / 结构', items: [
    { keys: 'Mod-Shift-[ / Mod-Alt-O', desc: '有序列表' },
    { keys: 'Mod-Shift-] / Mod-Alt-U', desc: '无序列表' },
    { keys: 'Mod-Shift-Q / Mod-Alt-Q', desc: '引用' },
    { keys: 'Mod-T / Mod-Alt-T', desc: '表格' },
    { keys: 'Tab / Shift-Tab', desc: '列表缩进 / 反缩进（光标得先在列表项里）' },
  ] },
  { title: '插入', items: [
    { keys: 'Mod-Shift-I / Mod-Ctrl-I', desc: '图片' },
    { keys: 'Mod-Shift-M / Mod-Alt-B', desc: '公式块（行首打 "$$" 加空格也行）' },
  ] },
]

const MAX_LEVEL = 6

export interface TyporaKeyHooks {
  onLink?: () => void     // 弹出输入链接
  onImage?: () => void    // 弹出选择图片
}

export const TyporaKeys = (hooks: TyporaKeyHooks = {}) => Extension.create({
  name: 'typoraKeys',

  addInputRules() {
    return [new InputRule({
      find: MATH_INPUT_RE,
      handler: ({ range, chain }) => {
        chain().deleteRange(range).insertContent('$$  $$')
          .command(({ tr, dispatch }) => {
            if (dispatch) {
              const pos = Math.max(0, tr.selection.from - 3)
              tr.setSelection(TextSelection.near(tr.doc.resolve(pos)))
            }
            return true
          }).run()
      },
    })]
  },

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

      'Mod-k': link,           // 浏览器常把这个键抢去地址栏，未必收得到——见上面的表
      'Mod-Alt-k': link,       // 不会被浏览器抢，收不到 Mod-K 时用这个
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
