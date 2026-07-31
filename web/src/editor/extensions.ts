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
import { common, createLowlight } from 'lowlight'
import { Hashtag } from './Hashtag'
import { ResizableImage } from './ResizableImage'
import { CitationNode } from './CitationNode'
import { HtmlEmbed } from './HtmlEmbed'
import { MermaidBlock } from './MermaidBlock'
import { PasteRules } from './pasteRules'
import 'katex/dist/katex.min.css'

const lowlight = createLowlight(common)

export interface ExtensionOpts {
  placeholder?: string
  onTag?: (name: string) => void
}

// 后续任务在此追加：Hashtag(T12)、ResizableImage(T15)、Citation(T16)、HtmlEmbed+pasteRules(T17)、Mermaid(T18)
export function buildExtensions(opts: ExtensionOpts) {
  return [
    StarterKit.configure({ codeBlock: false, heading: { levels: [1, 2, 3] } }),
    CodeBlockLowlight.configure({ lowlight }),
    Placeholder.configure({ placeholder: opts.placeholder ?? '写点什么… # 打项目标签' }),
    Link.configure({ autolink: true, openOnClick: false }),
    Highlight,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Mathematics,
    CitationNode,
    ResizableImage,
    MermaidBlock,
    HtmlEmbed,
    PasteRules,
    ...(opts.onTag ? [Hashtag(opts.onTag)] : []),
  ]
}
