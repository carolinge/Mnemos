import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import Mathematics from '@tiptap/extension-mathematics'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight } from 'lowlight'
import python from 'highlight.js/lib/languages/python'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import sql from 'highlight.js/lib/languages/sql'
import r from 'highlight.js/lib/languages/r'
import matlab from 'highlight.js/lib/languages/matlab'
import cpp from 'highlight.js/lib/languages/cpp'
import latex from 'highlight.js/lib/languages/latex'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { Hashtag } from './Hashtag'
import { TyporaKeys } from './TyporaKeys'
import { CodeBlockView } from './CodeBlockView'
import { ResizableImage } from './ResizableImage'
import { CitationNode } from './CitationNode'
import { HtmlEmbed } from './HtmlEmbed'
import { MermaidBlock } from './MermaidBlock'
import { PasteRules } from './pasteRules'
import 'katex/dist/katex.min.css'

// 只注册科研常用语言，避免把 highlight.js 全量语法打进首屏包
const lowlight = createLowlight({
  python, javascript, typescript, bash, json, yaml, sql, r, matlab, cpp, latex,
})

// 导出而不是内联在下面的 configure() 里——EntryCard 的 onBlur 需要用同一个
// 正则去判断"光标是不是恰好停在某个公式的字符范围里"，两边各写一份迟早会
// 走样。
export const MATH_RENDER_RE = /\$\$([^$]+)\$\$|\$(?!\s)([^$\n]*[^$\s])\$/g

export interface ExtensionOpts {
  placeholder?: string
  onTag?: (name: string) => void
  onLink?: () => void     // Mod-K
  onImage?: () => void    // Mod-Shift-I
  onSave?: () => void     // Mod-S
}

export function buildExtensions(opts: ExtensionOpts) {
  return [
    // 标题 1–6，与 Typora 的 Mod-1…Mod-6 对齐
    StarterKit.configure({ codeBlock: false, heading: { levels: [1, 2, 3, 4, 5, 6] } }),
    CodeBlockLowlight.extend({
      addNodeView() { return ReactNodeViewRenderer(CodeBlockView) },
    }).configure({ lowlight }),
    Placeholder.configure({ placeholder: opts.placeholder ?? 'Write something… #task to assign' }),
    Link.configure({ autolink: true, openOnClick: false }),
    Highlight,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    // 默认正则是 /\$([^$]*)\$/，会把 $$…$$ 读成一对空的 $ $，
    // 块级公式因此整段漏成源码。改成两种都吃，$$ 的那一版走 KaTeX 的 display 模式。
    Mathematics.configure({
      regex: MATH_RENDER_RE,
      katexOptions: { throwOnError: false },
    }),
    CitationNode,
    ResizableImage,
    MermaidBlock,
    HtmlEmbed,
    PasteRules,
    TyporaKeys({ onLink: opts.onLink, onImage: opts.onImage, onSave: opts.onSave }),
    ...(opts.onTag ? [Hashtag(opts.onTag)] : []),
  ]
}
