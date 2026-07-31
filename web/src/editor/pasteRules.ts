import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
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
      window.alert('图片上传失败，请重试')
    }
  }
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
