import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, BubbleMenu, FloatingMenu, type Editor } from '@tiptap/react'
import { buildExtensions, MATH_RENDER_RE } from '../editor/extensions'
import { useAutosave, type EntryData } from '../hooks/useAutosave'
import { api } from '../api'
import { TaskPicker } from './TaskPicker'
import { Confirm } from './Confirm'
import type { Project } from './Sidebar'

const EMPTY_DOC = { type: 'doc', content: [] }
const COLLAPSED_MAX_PX = 140   // 折叠态约四行，超出显示「展开」

// Mathematics 决定显示原始 "$$…$$" 源码还是渲染成 KaTeX，看的是当前选区是否
// 落在公式自己的字符范围内——每张卡片是独立的 editor 实例，点到别的卡片不会
// 在这个实例上触发任何 transaction，选区留在原地，公式也就停在编辑态。失焦
// 本身不会挪动选区，得手动挪。
//
// 只在选区确实落在某个公式范围内时才挪，且挪到那个公式自己的边界之外（优先
// 挪到公式后面，没地方才挪到前面）——不用 selectAll 或某个固定的绝对位置：
// 试过之后发现 selectAll 会导致重新点回卡片打字时，浏览器原生的光标定位跟
// ProseMirror 内部的选区状态对不上，打字直接把原有内容整个替换掉，这个副作用
// 比要修的原始 bug 严重得多。
//
// 挪到"公式后面"这一步用 setTextSelection 挪完之后要回读一下实际落点：
// ProseMirror 对越界的位置只会 clamp 到文档里离得最近的合法光标位置，公式
// 后面正好没别的内容时会被 clamp 回公式内部，这种情况改挪到公式前面。
// ponytail: 公式是整张卡片唯一内容（前后都没有任何字符）时，文档里根本不存在
// 公式范围之外的合法光标位置，这个函数救不了——公式会停在源码态直到用户输入
// 别的字符。影响面极窄且纯视觉，不动数据，先不管；真要治就得改
// @tiptap/extension-mathematics 自己的 decoration 逻辑。
//
// 这里的正则必须自己 new 一份，不能直接用共享的 MATH_RENDER_RE：那个对象是
// 带 g 标记的，lastIndex 是它自己身上的可变状态，Mathematics 插件内部扫描
// decoration 时也在用同一个对象、且不会在扫之前重置 lastIndex（它没理由防
// 着别处也在用）。下面这个循环一旦找到目标就 return，不会把 exec 循环跑到
// 自然返回 null（那是唯一会把 lastIndex 归零的时机）——用同一个对象会把
// lastIndex 停在中间某个值，插件下一次扫描就从那个位置开始找，直接把这张
// 公式漏掉，decoration 保持旧状态、公式渲染不出来。踩过这个坑：单元测试里
// 一步到位必现，浏览器里因为后面往往还会有别的 transaction 顺带把 lastIndex
// 扫回 0，容易误以为没事。
export function closeActiveFormula(ed: Editor) {
  const { doc, selection } = ed.state
  const pos = selection.from
  const $pos = doc.resolve(pos)
  if (!$pos.parent.isTextblock) return
  const text = $pos.parent.textContent
  const blockStart = $pos.start()
  const re = new RegExp(MATH_RENDER_RE.source, MATH_RENDER_RE.flags)
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    const from = blockStart + match.index
    const to = from + match[0].length
    if (pos < from || pos > to) continue
    ed.commands.setTextSelection(Math.min(to + 1, doc.content.size))
    const landed = ed.state.selection.from
    if (landed > from && landed <= to) {
      ed.commands.setTextSelection(Math.max(from - 1, 0))
    }
    return
  }
}

export function EntryCard({ entry, day, draftKey, tasks, onCreated, onDeleted, onDiscard, onTaskClick, expandAll }: {
  entry: EntryData | null      // null = 尚未落库的新条目
  day: string
  draftKey: string
  tasks: Project[]
  onCreated?: (e: EntryData) => void
  onDeleted?: (id: string) => void
  onDiscard?: () => void       // 丢弃一张还没保存的新卡片
  onTaskClick?: (taskId: string) => void
  // 一键展开/收起：n 变化就跟随 on，本地的展开状态被覆盖
  expandAll?: { on: boolean; n: number }
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
  const expandN = expandAll?.n ?? 0
  const [overflowing, setOverflowing] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  // 源码模式：显示这张卡片的 Markdown 原文，可直接改、可整段粘贴外部 Markdown
  const [confirming, setConfirming] = useState(false)
  const [source, setSource] = useState<string | null>(null)   // null = 渲染模式
  const [busy, setBusy] = useState(false)
  // 链接浮动卡片：⌘K 或点中链接时出现，替代原来的浏览器 prompt
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')

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
    setLinkDraft(ed.getAttributes('link').href ?? '')
    setLinkOpen(true)
  }

  function applyLink() {
    const ed = editorRef.current
    if (!ed) return
    const url = linkDraft.trim()
    setLinkOpen(false)
    if (!url) { ed.chain().focus().unsetLink().run(); return }
    // 只写了域名就补上 https://，省得存成相对链接点不开
    const href = /^[a-z][\w+.-]*:/i.test(url) ? url : `https://${url}`
    ed.chain().focus().extendMarkRange('link').setLink({ href }).run()
  }

  function removeLink() {
    setLinkOpen(false)
    editorRef.current?.chain().focus().extendMarkRange('link').unsetLink().run()
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
      onSave: () => { void autosave.saveNow() },
    }),
    content: initialContent,
    onUpdate: () => autosave.schedule(),
    onBlur: ({ editor: ed }) => closeActiveFormula(ed),
  })
  editorRef.current = editor

  useLayoutEffect(() => {
    if (expandN > 0) setExpanded(expandAll!.on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandN])

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
      window.alert('Could not switch to source — check your connection')
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
      window.alert('Could not parse the Markdown — your source is kept, fix it and try again')
    } finally { setBusy(false) }
  }

  async function remove() {
    const id = autosave.entryIdRef.current
    setConfirming(false)
    if (!id) { localStorage.removeItem(`draft:${draftKey}`); onDiscard?.(); return }
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
            <button className="task-goto" title="Show only this task"
              onClick={() => onTaskClick?.(task.id!)}>↗</button>
          )}
        </span>
        <span className="entry-actions">
          <button className="icon-btn" title={id ? 'Delete this card' : 'Discard this card'}
            onClick={() => setConfirming(true)}>×</button>
        </span>
      </div>
      {/* 链接卡片：⌘K 时编辑，光标停在链接上时显示打开/改/去掉 */}
      {editor && (
        <BubbleMenu editor={editor} pluginKey="linkCard" tippyOptions={{ duration: 120 }}
          shouldShow={({ editor: ed }) => linkOpen || ed.isActive('link')}>
          <div className="link-card">
            {linkOpen ? (
              <>
                <input autoFocus value={linkDraft} placeholder="Paste or type a URL"
                  onChange={e => setLinkDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); applyLink() }
                    if (e.key === 'Escape') { e.preventDefault(); setLinkOpen(false) }
                  }} />
                <button title="Apply" onClick={applyLink}>✓</button>
                <button title="Remove link" onClick={removeLink}>✕</button>
              </>
            ) : (
              <>
                <a href={editor.getAttributes('link').href} target="_blank" rel="noreferrer"
                  title={editor.getAttributes('link').href}>
                  {editor.getAttributes('link').href}
                </a>
                <button title="Edit link" onClick={promptLink}>✎</button>
                <button title="Remove link" onClick={removeLink}>✕</button>
              </>
            )}
          </div>
        </BubbleMenu>
      )}
      {editor && <BubbleMenu editor={editor} pluginKey="formatBar" tippyOptions={{ duration: 120 }}
        shouldShow={({ editor: ed, from, to }) => from !== to && !linkOpen && !ed.isActive('link')}>
        <div className="menu-bar">
          <button className={editor.isActive('bold') ? 'on' : ''}
            onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
          <button className={editor.isActive('italic') ? 'on' : ''}
            onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
          <button className={editor.isActive('code') ? 'on' : ''}
            onClick={() => editor.chain().focus().toggleCode().run()}>{'<>'}</button>
          <button className={editor.isActive('strike') ? 'on' : ''} title="Strikethrough (⌥⇧5)"
            onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></button>
          <button className={editor.isActive('highlight') ? 'on' : ''}
            onClick={() => editor.chain().focus().toggleHighlight().run()}>H</button>
          <button title="Link (⌘K)" onClick={promptLink}>🔗</button>
        </div>
      </BubbleMenu>}
      {editor && <FloatingMenu editor={editor} tippyOptions={{ duration: 120 }}>
        <div className="menu-bar">
          <button title="Heading 2 (⌘2)"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
          <button title="Table (⌘T)"
            onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>Table</button>
          <button title="Code block (⌘⇧K)"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}>Code</button>
          <button title="Task list"
            onClick={() => editor.chain().focus().toggleTaskList().run()}>Todo</button>
          <button title="Insert images (⌘⇧I)" onClick={pickImage}>Image</button>
          <button onClick={() => {
            const url = window.prompt('Reference link (DOI / arXiv / PubMed)')
            if (url) {
              import('../editor/pasteRules').then(({ insertCitation }) => insertCitation(editor.view, url.trim()))
            }
          }}>Cite</button>
          <button onClick={() => {
            const html = window.prompt('Paste HTML source')
            if (html) {
              import('../editor/pasteRules').then(({ insertHtmlEmbed }) => insertHtmlEmbed(editor.view, html))
            }
          }}>Embed</button>
          <button onClick={() => editor.chain().focus()
            .insertContent({ type: 'mermaidBlock', attrs: { code: '' } }).run()}>Diagram</button>
        </div>
      </FloatingMenu>}
      {source !== null ? (
        <textarea className="entry-source" value={source} spellCheck={false}
          placeholder="Paste Markdown here — switch back to rendered view to apply"
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
        <button className="source-toggle foot-left" disabled={busy}
          title={source === null
            ? 'Switch to source: see the raw Markdown, or paste some in'
            : 'Back to rendered view (⌘↩)'}
          onClick={() => (source === null ? toSource() : toRendered())}>
          {busy ? '…' : source === null ? '</> Source' : '✓ Rendered'}
        </button>
        {source === null && overflowing ? (
          <button className="entry-toggle" onClick={() => setExpanded(v => !v)}>
            {expanded ? 'Collapse ↑' : 'Expand ↓'}
          </button>
        ) : <span className="entry-toggle" />}
        <span className="foot-right" />
      </div>

      {confirming && (
        <Confirm
          message={id ? 'Delete this card?' : 'Discard this card?'}
          detail={id ? 'This cannot be undone.' : 'It has not been saved yet.'}
          confirmLabel={id ? 'Delete' : 'Discard'}
          onConfirm={remove}
          onCancel={() => setConfirming(false)} />
      )}
    </article>
  )
}
