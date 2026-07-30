// ProseMirror JSON → 供 FTS 索引的纯文本。
export function extractText(node) {
  if (!node) return ''
  const parts = []
  if (node.type === 'text' && node.text) parts.push(node.text)
  const a = node.attrs || {}
  if (node.type === 'citation') {
    parts.push([a.title, a.authors, a.venue, a.year, a.url].filter(Boolean).join(' '))
  }
  if (node.type === 'mermaidBlock' && a.code) parts.push(a.code)
  for (const child of node.content || []) parts.push(extractText(child))
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}
