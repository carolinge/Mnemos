import { describe, it, expect } from 'vitest'
import { classifyUrl } from '../src/cite.js'
import { createDb } from '../src/db.js'
import { createApp } from '../src/app.js'

describe('classifyUrl', () => {
  const cases = [
    ['https://doi.org/10.1038/s41586-024-07123-7', { kind: 'doi', id: '10.1038/s41586-024-07123-7' }],
    ['https://dx.doi.org/10.1021/acsnano.3c01234', { kind: 'doi', id: '10.1021/acsnano.3c01234' }],
    ['https://arxiv.org/abs/2401.12345', { kind: 'arxiv', id: '2401.12345' }],
    ['https://arxiv.org/abs/2401.12345v2', { kind: 'arxiv', id: '2401.12345' }],
    ['https://arxiv.org/pdf/2401.12345', { kind: 'arxiv', id: '2401.12345' }],
    ['https://pubmed.ncbi.nlm.nih.gov/38012345/', { kind: 'pubmed', id: '38012345' }],
    ['https://www.nature.com/articles/xyz', { kind: 'generic', id: 'https://www.nature.com/articles/xyz' }],
  ]
  for (const [url, want] of cases) {
    it(url, () => expect(classifyUrl(url)).toEqual(want))
  }
  it('非 URL 返回 null', () => expect(classifyUrl('普通一句话')).toBeNull())
})

describe('POST /api/cite', () => {
  let app, cookie, calls
  const crossrefBody = JSON.stringify({
    message: {
      title: ['A Great Paper'],
      author: [{ family: 'Li', given: 'Lei' }, { family: 'Wang', given: 'Wei' }],
      issued: { 'date-parts': [[2024, 3]] },
      'container-title': ['Nature Materials'],
    },
  })
  function makeApp(fetchImpl) {
    calls = []
    const wrapped = async (url, opts) => { calls.push(String(url)); return fetchImpl(url, opts) }
    return createApp({ db: createDb(':memory:'), imagesDir: '/tmp/img-test', password: 'pw', fetchImpl: wrapped })
  }
  async function loginAnd(appx) {
    const res = await appx.request('/api/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'pw' }),
    })
    return res.headers.get('set-cookie').split(';')[0]
  }
  async function cite(appx, url) {
    return appx.request('/api/cite', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ url }),
    })
  }

  it('DOI → Crossref 元数据；二次请求走缓存不再外呼', async () => {
    app = makeApp(async () => new Response(crossrefBody, { headers: { 'Content-Type': 'application/json' } }))
    cookie = await loginAnd(app)
    let j = await (await cite(app, 'https://doi.org/10.1038/xyz')).json()
    expect(j).toMatchObject({ ok: true, kind: 'doi', title: 'A Great Paper', year: '2024', venue: 'Nature Materials' })
    expect(j.authors).toContain('Li')
    const n = calls.length
    j = await (await cite(app, 'https://doi.org/10.1038/xyz')).json()
    expect(j.title).toBe('A Great Paper')
    expect(calls.length).toBe(n)   // 无新外呼
  })

  it('arXiv → Atom 解析', async () => {
    const atom = `<feed><title>Query</title><entry><title>Deep Thing</title>
      <author><name>Alice A</name></author><author><name>Bob B</name></author>
      <published>2023-05-01T00:00:00Z</published></entry></feed>`
    app = makeApp(async () => new Response(atom))
    cookie = await loginAnd(app)
    const j = await (await cite(app, 'https://arxiv.org/abs/2305.00001')).json()
    expect(j).toMatchObject({ ok: true, title: 'Deep Thing', year: '2023', venue: 'arXiv' })
  })

  it('generic → 页面 title', async () => {
    app = makeApp(async () => new Response('<html><head><title>Blog Post — Site</title></head></html>'))
    cookie = await loginAnd(app)
    const j = await (await cite(app, 'https://example.com/post')).json()
    expect(j).toMatchObject({ ok: true, title: 'Blog Post — Site' })
  })

  it('抓取失败 → ok:false 降级，不缓存', async () => {
    app = makeApp(async () => { throw new Error('network down') })
    cookie = await loginAnd(app)
    const j = await (await cite(app, 'https://doi.org/10.1/fail')).json()
    expect(j.ok).toBe(false)
    expect(j.url).toBe('https://doi.org/10.1/fail')
  })
})
