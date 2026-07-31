import { describe, it, expect } from 'vitest'
import { isCitationUrl } from '../src/lib/citePatterns'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/editor/extensions'
import { applyCitationResult } from '../src/editor/CitationNode'

describe('isCitationUrl', () => {
  const yes = [
    'https://doi.org/10.1038/s41586-024-07123-7',
    'https://dx.doi.org/10.1021/x',
    'https://arxiv.org/abs/2401.12345',
    'https://arxiv.org/pdf/2401.12345v2',
    'https://pubmed.ncbi.nlm.nih.gov/38012345/',
  ]
  const no = ['https://news.site/article', '不是链接', 'ftp://x/10.1021/y']
  for (const u of yes) it(`✓ ${u}`, () => expect(isCitationUrl(u)).toBe(true))
  for (const u of no) it(`✗ ${u}`, () => expect(isCitationUrl(u)).toBe(false))
})

describe('citation 节点', () => {
  it('可插入 pending 节点；applyCitationResult 按 url 升级属性', () => {
    const ed = new Editor({ extensions: buildExtensions({}), content: { type: 'doc', content: [] } })
    ed.commands.insertContent({ type: 'citation', attrs: { url: 'https://doi.org/10.1/x', status: 'pending' } })
    applyCitationResult(ed.view, 'https://doi.org/10.1/x',
      { ok: true, title: 'Paper T', authors: 'A, B', year: '2024', venue: 'Nat.' })
    const json = JSON.stringify(ed.getJSON())
    expect(json).toContain('Paper T')
    expect(json).toContain('"status":"ok"')
    ed.destroy()
  })

  it('失败结果 → status=error（渲染为普通链接）', () => {
    const ed = new Editor({ extensions: buildExtensions({}), content: { type: 'doc', content: [] } })
    ed.commands.insertContent({ type: 'citation', attrs: { url: 'https://doi.org/10.1/y', status: 'pending' } })
    applyCitationResult(ed.view, 'https://doi.org/10.1/y', { ok: false })
    expect(JSON.stringify(ed.getJSON())).toContain('"status":"error"')
    ed.destroy()
  })
})
