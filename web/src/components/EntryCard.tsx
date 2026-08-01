import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, BubbleMenu, FloatingMenu, type Editor } from '@tiptap/react'
import { buildExtensions } from '../editor/extensions'
import { useAutosave, type EntryData } from '../hooks/useAutosave'
import { api } from '../api'
import { TaskPicker } from './TaskPicker'
import type { Project } from './Sidebar'

const EMPTY_DOC = { type: 'doc', content: [] }
const COLLAPSED_MAX_PX = 140   // 折叠态约四行，超出显示「展开」

export function EntryCard({ entry, day, draftKey, tasks, onCreated, onDeleted, onTaskClick }: {
  entry: EntryData | null      // null = 尚未落库的新条目
  day: string
  draftKey: string
  tasks: Project[]
  onCreated?: (e: EntryData) => void
  onDeleted?: (id: string) => void
  onTaskClick?: (taskId: string) => void
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

  const [task, setTask] = useState<{ id?: string; name: string; color?: string } | null>(entry?.task ?? null)
  const taskRef = useRef(task)
  taskRef.current = task

  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  // 源码模式：显示这张卡片的 Markdown 原文，可直接改、可整段粘贴外部 Markdown
  const [source, setSource] = useState<string | null>(null)   // null = 渲染模式
  const [busy, setBusy] = useState(false)

  const editorRef = useRef<Editor | null>(null)
  const autosave = useAutosave({
    entryId: entry?.id ?? null,
    day,
    version: entry?.version ?? 0,
    draftKey,
    getPayload: () => ({
      content: editorRef.current?.getJSON() ?? EMPTY_DOC,
      task: taskRef.current?.name ?? null,
    }),
    onCreated,
    onSaved: e => setTask(e.task),
  })

  // 链接与插图既给工具条按钮用，也给 Mod-K / Mod-Shift-I 快捷键用
  function promptLink() {
    const ed = editorRef.current
    if (!ed) return
    const url = window.prompt('链接地址', ed.getAttributes('link').href ?? 'https://')
    if (url === null) return
    if (!url.trim()) { ed.chain().focus().unsetLink().run(); return }
    ed.chain().focus().setLink({ href: url.trim() }).run()
  }

  function pickImage() {
    const ed = editorRef.current
    if (!ed) return
    const input = document.createElement('input')
    input.type = 'file'; input.accept = 'image/*'; input.multiple = true
    input.onchange = async () => {
      const { uploadImage } = await import('../api')
      for (const f of Array.from(input.files ?? [])) {
        const url = await uploadImage(f)
        ed.chain().focus().insertContent({ type: 'image', attrs: { src: url } }).run()
      }
    }
    input.click()
  }

  const editor = useEditor({
    extensions: buildExtensions({
      // 正文里敲 #名字 也能设置任务（与选择器等价）
      onTag: name => {
        if (taskRef.current?.name !== name) {
          setTask({ name })
          autosave.schedule()
        }
      },
      onLink: promptLink,
      onImage: pickImage,
    }),
    content: initialContent,
    onUpdate: () => autosave.schedule(),
  })
  editorRef.current = editor

  // 内容超过折叠高度才显示「展开」按钮
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const check = () => setOverflowing(el.scrollHeight > COLLAPSED_MAX_PX + 8)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [editor])

  // 渲染 → 源码：把当前文档转成 Markdown 显示
  async function toSource() {
    const ed = editorRef.current
    if (!ed || busy) return
    setBusy(true)
    try {
      const r = await api<{ markdown: string }>('/api/convert/to-markdown', {
        method: 'POST', body: JSON.stringify({ content: ed.getJSON() }),
      })
      setSource(r.markdown)
    } catch {
      window.alert('转换源码失败，请检查网络')
    } finally { setBusy(false) }
  }

  // 源码 → 渲染：解析回文档并落库
  async function toRendered() {
    const ed = editorRef.current
    if (!ed || source === null || busy) return
    setBusy(true)
    try {
      const r = await api<{ content: unknown }>('/api/convert/to-doc', {
        method: 'POST', body: JSON.stringify({ markdown: source }),
      })
      ed.commands.setContent(r.content as never, false)   // 不触发 onUpdate，下面手动排保存
      setSource(null)
      autosave.schedule()
    } catch {
      window.alert('解析 Markdown 失败，源码已保留，可修改后重试')
    } finally { setBusy(false) }
  }

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
        <span className="entry-head-left">
          <TaskPicker value={task} tasks={tasks} onPick={name => {
            setTask(name ? { name } : null)
            autosave.schedule()
          }} />
          {task?.id && (
            <button className="task-goto" title="只看这个任务"
              onClick={() => onTaskClick?.(task.id!)}>↗</button>
          )}
        </span>
        <span className="entry-actions">
          {id && <button className="icon-btn" title="删除这张卡片" onClick={remove}>×</button>}
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
          <button title="链接 (⌘K)" onClick={promptLink}>🔗</button>
        </div>
      </BubbleMenu>}
      {editor && <FloatingMenu editor={editor} tippyOptions={{ duration: 120 }}>
        <div className="menu-bar">
          <button title="二级标题 (⌘2)"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
          <button title="表格 (⌘T)"
            onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>表格</button>
          <button title="代码块 (⌘⇧K)"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}>代码</button>
          <button title="待办清单"
            onClick={() => editor.chain().focus().toggleTaskList().run()}>待办</button>
          <button title="插入图片，可多选 (⌘⇧I)" onClick={pickImage}>图片</button>
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
          <button onClick={() => editor.chain().focus()
            .insertContent({ type: 'mermaidBlock', attrs: { code: '' } }).run()}>流程图</button>
        </div>
      </FloatingMenu>}
      {source !== null ? (
        <textarea className="entry-source" value={source} spellCheck={false}
          placeholder="在这里贴 Markdown，切回渲染模式即生效"
          onChange={e => setSource(e.target.value)}
          onKeyDown={e => {
            // ⌘↩ 快速切回渲染
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void toRendered() }
          }} />
      ) : (
        <div className={`entry-body ${expanded || !overflowing ? '' : 'collapsed'}`} ref={bodyRef}
          style={expanded || !overflowing ? undefined : { maxHeight: COLLAPSED_MAX_PX }}>
          <EditorContent editor={editor} />
        </div>
      )}

      <div className="entry-foot">
        <button className="source-toggle" disabled={busy}
          title={source === null
            ? '切到源码模式：看到 Markdown 原文，也可以整段粘贴进来'
            : '切回渲染模式（⌘↩）'}
          onClick={() => (source === null ? toSource() : toRendered())}>
          {busy ? '…' : source === null ? '</> 源码' : '✓ 渲染'}
        </button>
        {source === null && overflowing && (
          <button className="entry-toggle" onClick={() => setExpanded(v => !v)}>
            {expanded ? '收起 ↑' : '展开 ↓'}
          </button>
        )}
      </div>
    </article>
  )
}
