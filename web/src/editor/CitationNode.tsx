import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import type { EditorView } from '@tiptap/pm/view'

export interface CiteResult {
  ok: boolean; title?: string | null; authors?: string | null
  year?: string | null; venue?: string | null
}

export const CitationNode = Node.create({
  name: 'citation',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      url: { default: '' }, status: { default: 'pending' },
      title: { default: null }, authors: { default: null },
      year: { default: null }, venue: { default: null },
    }
  },
  parseHTML() {
    return [{
      tag: 'div[data-citation]',
      getAttrs: el => {
        const d = (el as HTMLElement).dataset
        return { url: d.url ?? '', status: d.status ?? 'error', title: d.title ?? null,
          authors: d.authors ?? null, year: d.year ?? null, venue: d.venue ?? null }
      },
    }]
  },
  renderHTML({ node }) {
    const a = node.attrs
    return ['div', mergeAttributes({ 'data-citation': '', 'data-url': a.url, 'data-status': a.status,
      'data-title': a.title, 'data-authors': a.authors, 'data-year': a.year, 'data-venue': a.venue })]
  },
  addNodeView() { return ReactNodeViewRenderer(CitationView) },
})

// 按 url 找到 pending 的引用节点并写入抓取结果
export function applyCitationResult(view: EditorView, url: string, r: CiteResult) {
  const { doc, tr } = view.state
  doc.descendants((node, pos) => {
    if (node.type.name === 'citation' && node.attrs.url === url && node.attrs.status === 'pending') {
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        status: r.ok ? 'ok' : 'error',
        title: r.title ?? null, authors: r.authors ?? null,
        year: r.year ?? null, venue: r.venue ?? null,
      })
    }
  })
  if (tr.docChanged) view.dispatch(tr)
}

function CitationView({ node }: NodeViewProps) {
  const a = node.attrs
  if (a.status === 'ok') {
    return (
      <NodeViewWrapper as="div" className="cite-card" data-status="ok">
        <a href={a.url} target="_blank" rel="noreferrer" className="cite-title">{a.title}</a>
        <span className="cite-meta">
          {[a.authors, a.year, a.venue].filter(Boolean).join(' · ')}
        </span>
      </NodeViewWrapper>
    )
  }
  return (
    <NodeViewWrapper as="div" className="cite-card" data-status={a.status}>
      <a href={a.url} target="_blank" rel="noreferrer" className="cite-title plain">{a.url}</a>
      {a.status === 'pending' && <span className="cite-meta">Fetching reference…</span>}
    </NodeViewWrapper>
  )
}
