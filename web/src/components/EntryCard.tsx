import { useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, BubbleMenu, FloatingMenu, type Editor } from '@tiptap/react'
import { buildExtensions } from '../editor/extensions'
import { useAutosave, type EntryData } from '../hooks/useAutosave'
import { api } from '../api'

const EMPTY_DOC = { type: 'doc', content: [] }

export function EntryCard({ entry, day, draftKey, onCreated, onDeleted, onMove, onTagClick }: {
  entry: EntryData | null      // null = 尚未落库的新条目
  day: string
  draftKey: string
  onCreated?: (e: EntryData) => void
  onDeleted?: (id: string) => void
  onMove?: (id: string, dir: -1 | 1) => void
  onTagClick?: (projectId: string) => void
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

  const [tags, setTags] = useState<{ id?: string; name: string; color?: string }[]>(entry?.tags ?? [])
  const tagsRef = useRef(tags)
  tagsRef.current = tags

  const editorRef = useRef<Editor | null>(null)
  const autosave = useAutosave({
    entryId: entry?.id ?? null,
    day,
    version: entry?.version ?? 0,
    draftKey,
    getPayload: () => ({
      content: editorRef.current?.getJSON() ?? EMPTY_DOC,
      tags: tagsRef.current.map(t => t.name),
    }),
    onCreated,
    onSaved: e => setTags(e.tags),
  })

  const editor = useEditor({
    extensions: buildExtensions({
      onTag: name => {
        if (!tagsRef.current.some(t => t.name === name)) {
          setTags([...tagsRef.current, { name }])
          autosave.schedule()
        }
      },
    }),
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
        <span className="entry-tags">
          {tags.map(t => (
            <span key={t.name} className="chip" style={{ borderColor: t.color }}>
              <i style={{ background: t.color ?? 'var(--muted)' }} />
              <button className="chip-name" onClick={() => t.id && onTagClick?.(t.id)}>{t.name}</button>
              <button className="chip-x" title="移除标签" onClick={() => {
                setTags(tagsRef.current.filter(x => x.name !== t.name)); autosave.schedule()
              }}>×</button>
            </span>
          ))}
        </span>
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
          <button onClick={() => {
            const input = document.createElement('input')
            input.type = 'file'; input.accept = 'image/*'
            input.onchange = async () => {
              const f = input.files?.[0]
              if (!f) return
              const { uploadImage } = await import('../api')
              const url = await uploadImage(f)
              editor.chain().focus().insertContent({ type: 'image', attrs: { src: url } }).run()
            }
            input.click()
          }}>图片</button>
          <button onClick={() => {
            const url = window.prompt('文献链接（DOI / arXiv / PubMed）')
            if (url) {
              import('../editor/pasteRules').then(({ insertCitation }) => insertCitation(editor.view, url.trim()))
            }
          }}>引用</button>
          <button onClick={() => {
            const html = window.prompt('粘贴 HTML 源码')
            if (html) {
              import('../editor/pasteRules').then(({ insertHtmlEmbed }) => insertHtmlEmbed(editor.view, html))
            }
          }}>嵌入</button>
          {/* 流程图(T18) 按钮在后续任务追加 */}
        </div>
      </FloatingMenu>}
      <EditorContent editor={editor} />
    </article>
  )
}
