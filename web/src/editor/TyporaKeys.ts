import { Extension } from '@tiptap/core'

// 对齐 Typora 的键盘习惯。Mod = macOS 上的 Cmd，其他平台的 Ctrl。
//
//   Mod-+ / Mod-=   标题升一级（H1←H2←H3…），到 H1 为止
//   Mod--           标题降一级，到正文为止
//   Tab / Shift-Tab 列表内缩进 / 反缩进（不在列表里时不拦截，留给编辑器默认行为）
//   Mod-Shift-[     切换有序列表
//   Mod-Shift-]     切换无序列表
//
// 说明：Typora 的 Mod-+ 在正文上会变成 H1；这里保持一致。

const MAX_LEVEL = 3   // 与 StarterKit 的 heading levels 一致

export const TyporaKeys = Extension.create({
  name: 'typoraKeys',

  addKeyboardShortcuts() {
    const bumpHeading = (delta: number) => () => {
      const { editor } = this
      const active = [1, 2, 3].find(l => editor.isActive('heading', { level: l }))
      if (active === undefined) {
        // 正文：升级 → H1；降级 → 无动作
        if (delta < 0) return editor.chain().focus().setHeading({ level: 1 }).run()
        return false
      }
      const next = active + delta
      if (next < 1) return editor.chain().focus().setHeading({ level: 1 }).run()
      if (next > MAX_LEVEL) return editor.chain().focus().setParagraph().run()
      return editor.chain().focus().setHeading({ level: next as 1 | 2 | 3 }).run()
    }

    const inList = () => this.editor.isActive('listItem') || this.editor.isActive('taskItem')

    return {
      // 升级 = 层级数字变小，所以传 -1
      'Mod-+': bumpHeading(-1),
      'Mod-=': bumpHeading(-1),
      'Mod--': bumpHeading(1),

      Tab: () => {
        if (!inList()) return false        // 不在列表里 → 交还默认行为（不吞 Tab）
        return this.editor.commands.sinkListItem(
          this.editor.isActive('taskItem') ? 'taskItem' : 'listItem')
      },
      'Shift-Tab': () => {
        if (!inList()) return false
        return this.editor.commands.liftListItem(
          this.editor.isActive('taskItem') ? 'taskItem' : 'listItem')
      },

      'Mod-Shift-[': () => this.editor.chain().focus().toggleOrderedList().run(),
      'Mod-Shift-]': () => this.editor.chain().focus().toggleBulletList().run(),
    }
  },
})
