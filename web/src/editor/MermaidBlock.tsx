import { InputRule, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useEffect, useState } from 'react'

export const MERMAID_INPUT_RE = /^```mermaid\s$/

let seq = 0

export const MermaidBlock = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,
  addAttributes() { return { code: { default: '' } } },
  parseHTML() {
    return [{ tag: 'pre[data-mermaid]', getAttrs: el => ({ code: (el as HTMLElement).textContent ?? '' }) }]
  },
  renderHTML({ node }) { return ['pre', { 'data-mermaid': '' }, node.attrs.code] },
  addInputRules() {
    return [new InputRule({
      find: MERMAID_INPUT_RE,
      handler: ({ range, chain }) => {
        chain().deleteRange(range).insertContent({ type: 'mermaidBlock', attrs: { code: '' } }).run()
      },
    })]
  },
  addNodeView() { return ReactNodeViewRenderer(MermaidView) },
})

function MermaidView({ node, updateAttributes }: NodeViewProps) {
  const code: string = node.attrs.code
  const [editing, setEditing] = useState(!code)
  const [draft, setDraft] = useState(code)
  const [svg, setSvg] = useState('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (editing || !code) return
    let alive = true
    import('mermaid').then(async m => {
      try {
        m.default.initialize({ startOnLoad: false, securityLevel: 'strict',
          theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default' })
        const { svg } = await m.default.render(`pmmd-${++seq}`, code)
        if (alive) { setSvg(svg); setErr(null) }
      } catch (e) {
        if (alive) setErr(String(e))
      }
    })
    return () => { alive = false }
  }, [code, editing])

  if (editing) {
    return (
      <NodeViewWrapper as="div" className="mermaid-block editing" contentEditable={false}>
        <textarea autoFocus rows={6} value={draft} placeholder={'graph TD\n  idea --> experiment\n  experiment --> paper'}
          onChange={e => setDraft(e.target.value)} />
        <div className="mermaid-actions">
          <button onClick={() => { updateAttributes({ code: draft }); setEditing(false) }}>Done</button>
        </div>
      </NodeViewWrapper>
    )
  }
  return (
    <NodeViewWrapper as="div" className="mermaid-block" contentEditable={false}
      onDoubleClick={() => { setDraft(code); setEditing(true) }}>
      {err
        ? <div className="mermaid-err"><p>Diagram syntax error — double-click to edit</p><pre>{code}</pre></div>
        : <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />}
    </NodeViewWrapper>
  )
}
