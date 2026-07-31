import { Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useState } from 'react'

export const HtmlEmbed = Node.create({
  name: 'htmlEmbed',
  group: 'block',
  atom: true,
  addAttributes() {
    return { html: { default: '' }, height: { default: 320 }, collapsed: { default: false } }
  },
  parseHTML() {
    return [{
      tag: 'div[data-html-embed]',
      getAttrs: el => ({ html: (el as HTMLElement).dataset.html ?? '' }),
    }]
  },
  renderHTML({ node }) {
    return ['div', { 'data-html-embed': '', 'data-html': node.attrs.html }]
  },
  addNodeView() { return ReactNodeViewRenderer(EmbedView) },
})

function EmbedView({ node, updateAttributes, deleteNode, editor, getPos }: NodeViewProps) {
  const [showSource, setShowSource] = useState(false)
  const a = node.attrs

  function startHeightDrag(e: React.PointerEvent) {
    e.preventDefault()
    const startY = e.clientY, startH = a.height
    const move = (ev: PointerEvent) =>
      updateAttributes({ height: Math.max(80, startH + (ev.clientY - startY)) })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function toPlainText() {
    const doc = new DOMParser().parseFromString(a.html, 'text/html')
    const text = doc.body.textContent?.replace(/\n{3,}/g, '\n\n').trim() ?? ''
    const pos = typeof getPos === 'function' ? getPos() : null
    if (pos === null || pos === undefined) return
    editor.chain().focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .insertContentAt(pos, text.split(/\n+/).map(t => ({
        type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] })))
      .run()
  }

  return (
    <NodeViewWrapper as="div" className="embed-block">
      <div className="embed-bar" contentEditable={false}>
        <span className="embed-tag">HTML</span>
        <span className="embed-actions">
          <button onClick={() => updateAttributes({ collapsed: !a.collapsed })}>{a.collapsed ? '展开' : '折叠'}</button>
          <button onClick={() => setShowSource(v => !v)}>{showSource ? '预览' : '源码'}</button>
          <button onClick={toPlainText}>转纯文本</button>
          <button onClick={() => deleteNode()}>删除</button>
        </span>
      </div>
      {!a.collapsed && (showSource ? (
        <textarea className="embed-source" value={a.html} rows={10}
          onChange={e => updateAttributes({ html: e.target.value })} />
      ) : (
        <>
          <iframe className="embed-frame" sandbox="allow-scripts" srcDoc={a.html}
            style={{ height: a.height }} title="嵌入内容" />
          <div className="embed-resize" onPointerDown={startHeightDrag} title="拖动调整高度" />
        </>
      ))}
    </NodeViewWrapper>
  )
}
