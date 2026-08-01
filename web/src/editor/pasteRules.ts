import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { undo } from '@tiptap/pm/history'
import type { EditorView } from '@tiptap/pm/view'
import { api, uploadImage } from '../api'
import { isCitationUrl } from '../lib/citePatterns'
import { applyCitationResult, type CiteResult } from './CitationNode'

export function pickImageFiles(files: File[] | FileList): File[] {
  return Array.from(files).filter(f => f.type.startsWith('image/'))
}

async function insertImages(view: EditorView, files: File[]) {
  for (const f of files) {
    try {
      const url = await uploadImage(f)
      const node = view.state.schema.nodes.image.create({ src: url })
      view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
    } catch {
      window.alert('Image upload failed — please try again')
    }
  }
}

// 含脚本/样式块/交互元素 → 保真嵌入；否则交给编辑器解析为可编辑正文。
// 已知取舍：Word 桌面版粘贴常带 <style> 块会被判为嵌入，可用嵌入块的「转纯文本」逃生。
const EMBED_RE = /<\s*(script|style|canvas|iframe|video|audio|form|object|embed|link)\b|\son\w+\s*=/i

export function classifyHtml(html: string): 'embed' | 'content' {
  return EMBED_RE.test(html) ? 'embed' : 'content'
}

export function looksLikeHtmlSource(text: string): boolean {
  return /^\s*<(!doctype|html|head|body|div|section|article|main|svg|style|script|table|figure|canvas)\b/i.test(text)
}

export function insertHtmlEmbed(view: EditorView, html: string) {
  const node = view.state.schema.nodes.htmlEmbed.create({ html })
  view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
}

export function insertCitation(view: EditorView, url: string) {
  const node = view.state.schema.nodes.citation.create({ url, status: 'pending' })
  view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
  api<CiteResult & { url: string }>('/api/cite', { method: 'POST', body: JSON.stringify({ url }) })
    .then(r => applyCitationResult(view, url, r))
    .catch(() => applyCitationResult(view, url, { ok: false }))
}

export const PasteRules = Extension.create({
  name: 'parchmentPaste',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('parchmentPaste'),
      props: {
        handlePaste: (view, event) => {
          const files = pickImageFiles(event.clipboardData?.files ?? [])
          if (files.length) { void insertImages(view, files); return true }
          const text = event.clipboardData?.getData('text/plain')?.trim() ?? ''
          if (text && isCitationUrl(text)) { insertCitation(view, text); return true }
          const html = event.clipboardData?.getData('text/html') ?? ''
          if (html && classifyHtml(html) === 'embed') { insertHtmlEmbed(view, html); return true }
          if (!html && looksLikeHtmlSource(text)) { insertHtmlEmbed(view, text); return true }
          if (html) {
            // 内容型：交给默认粘贴（可编辑），但给一个「改为嵌入块」的逃生口
            window.dispatchEvent(new CustomEvent('parchment:toast', {
              detail: {
                message: 'Pasted as editable text',
                actionLabel: 'Keep as embed',
                onAction: () => {
                  undo(view.state, view.dispatch)
                  insertHtmlEmbed(view, html)
                },
              },
            }))
          }
          return false
        },
        handleDrop: (view, event) => {
          const files = pickImageFiles(event.dataTransfer?.files ?? [])
          if (files.length) { event.preventDefault(); void insertImages(view, files); return true }
          return false
        },
      },
    })]
  },
})
