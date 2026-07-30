import { useMemo, useRef } from 'react'
import { EditorContent, useEditor, BubbleMenu, FloatingMenu, type Editor } from '@tiptap/react'
import { buildExtensions } from '../editor/extensions'
import { useAutosave, type EntryData } from '../hooks/useAutosave'
import { api } from '../api'

const EMPTY_DOC = { type: 'doc', content: [] }

export function EntryCard({ entry, day, draftKey, onCreated, onDeleted, onMove }: {
  entry: EntryData | null      // null = 尚未落库的新条目
  day: string
  draftKey: string
  onCreated?: (e: EntryData) => void
  onDeleted?: (id: string) => void
  onMove?: (id: string, dir: -1 | 1) => void
}) {
  // 断网草稿优先于服务器内容
  const initialContent = useMemo(() => {
    try {
      const d = localStorage.getItem(`draft:${draftKey}`)
      if (d) return JSON.parse(d).payload.content ?? entry?.content ?? EMPTY_DOC
    } catch { /* 草稿损坏则忽略 */ }
    return entry?.content ?? EMPTY_DOC
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])

  const editorRef = useRef<Editor | null>(null)
  const autosave = useAutosave({
    entryId: entry?.id ?? null,
    day,
    version: entry?.version ?? 0,
    draftKey,
    getPayload: () => ({ content: editorRef.current?.getJSON() ?? EMPTY_DOC }),
    onCreated,
  })

  const editor = useEditor({
    extensions: buildExtensions({}),
    content: initialContent,
    onUpdate: () => autosave.schedule(),
  })
  editorRef.current = editor

  async function remove() {
    const id = autosave.entryIdRef.current
    if (!id) return
    if (!window.confirm('删除这个条目？')) return
    await api(`/api/entries/${id}`, { method: 'DELETE' })
    onDeleted?.(id)
  }

  const id = autosave.entryIdRef.current
  return (
    <article className="entry-card" data-entry-id={id ?? ''}>
      <div className="entry-head">
        <span className="entry-time">{entry ? entry.created_at.slice(11, 16) : ''}</span>
        <span className="entry-actions">
          {id && onMove && <>
            <button className="icon-btn" title="上移" onClick={() => onMove(id, -1)}>↑</button>
            <button className="icon-btn" title="下移" onClick={() => onMove(id, 1)}>↓</button>
          </>}
          {id && <button className="icon-btn" title="删除" onClick={remove}>×</button>}
        </span>
      </div>
      {editor && <BubbleMenu editor={editor} tippyOptions={{ duration: 120 }}>
        <div className="menu-bar">
          <button className={editor.isActive('bold') ? 'on' : ''}
            onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
          <button className={editor.isActive('italic') ? 'on' : ''}
            onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
          <button className={editor.isActive('code') ? 'on' : ''}
            onClick={() => editor.chain().focus().toggleCode().run()}>{'<>'}</button>
          <button className={editor.isActive('highlight') ? 'on' : ''}
            onClick={() => editor.chain().focus().toggleHighlight().run()}>H</button>
          <button onClick={() => {
            const url = window.prompt('链接地址')
            if (url) editor.chain().focus().setLink({ href: url }).run()
          }}>🔗</button>
        </div>
      </BubbleMenu>}
      {editor && <FloatingMenu editor={editor} tippyOptions={{ duration: 120 }}>
        <div className="menu-bar">
          <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
          <button onClick={() => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()}>表格</button>
          <button onClick={() => editor.chain().focus().toggleCodeBlock().run()}>代码</button>
          <button onClick={() => editor.chain().focus().toggleTaskList().run()}>待办</button>
          {/* 图片(T15)、引用(T16)、嵌入(T17)、流程图(T18) 按钮在后续任务追加 */}
        </div>
      </FloatingMenu>}
      <EditorContent editor={editor} />
    </article>
  )
}
