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

// 粘贴时该走哪条路。抽成纯函数，好单独测顺序。
export type PasteAction = 'citation' | 'embed-source' | 'embed-html' | 'default'

export function choosePaste(text: string, html: string): PasteAction {
  if (text && isCitationUrl(text)) return 'citation'
  // 整份 HTML 文档：不管剪贴板里有没有 text/html，都按源码嵌入
  if (looksLikeHtmlSource(text)) return 'embed-source'
  if (html && classifyHtml(html) === 'embed') return 'embed-html'
  return 'default'
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
          const html = event.clipboardData?.getData('text/html') ?? ''
          const action = choosePaste(text, html)
          if (action === 'citation') { insertCitation(view, text); return true }
          // 源码优先于剪贴板的 text/html：从代码视图复制时两种都在，
          // 走 html 分支会把带高亮的代码当正文粘进来，糊一大片。
          if (action === 'embed-source') { insertHtmlEmbed(view, text); return true }
          if (action === 'embed-html') { insertHtmlEmbed(view, html); return true }
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
          const all = Array.from(event.dataTransfer?.files ?? [])
          const files = pickImageFiles(all)
          if (files.length) { event.preventDefault(); void insertImages(view, files); return true }
          // 拖一个 .html 进来（比如 artifact 下载下来的那个文件）→ 直接变嵌入块
          const page = all.find(f => /\.html?$/i.test(f.name) || f.type === 'text/html')
          if (page) {
            event.preventDefault()
            page.text().then(t => insertHtmlEmbed(view, t))
            return true
          }
          return false
        },
      },
    })]
  },
})
