// 文献链接分类与元数据抓取。全部外呼走注入的 fetchImpl，便于测试与超时控制。
export function classifyUrl(raw) {
  let u
  try { u = new URL(String(raw).trim()) } catch { return null }
  if (!/^https?:$/.test(u.protocol)) return null
  const host = u.hostname.replace(/^www\./, '')
  if (host === 'doi.org' || host === 'dx.doi.org') {
    const id = decodeURIComponent(u.pathname.slice(1))
    if (/^10\.\d{4,9}\/\S+$/.test(id)) return { kind: 'doi', id }
  }
  if (host === 'arxiv.org') {
    const m = u.pathname.match(/^\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(v\d+)?/)
    if (m) return { kind: 'arxiv', id: m[1] }
  }
  if (host === 'pubmed.ncbi.nlm.nih.gov') {
    const m = u.pathname.match(/^\/(\d+)/)
    if (m) return { kind: 'pubmed', id: m[1] }
  }
  return { kind: 'generic', id: u.href }
}

async function fetchMeta(kind, id, fetchImpl) {
  const opts = { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'parchment-notes/1.0' } }
  if (kind === 'doi') {
    const res = await fetchImpl(`https://api.crossref.org/works/${encodeURIComponent(id)}`, opts)
    const m = (await res.json()).message
    return {
      title: m.title?.[0] || null,
      authors: fmtAuthors((m.author || []).map(a => a.family ? `${a.family} ${a.given || ''}`.trim() : a.name)),
      year: m.issued?.['date-parts']?.[0]?.[0]?.toString() || null,
      venue: m['container-title']?.[0] || m.publisher || null,
    }
  }
  if (kind === 'arxiv') {
    const res = await fetchImpl(`https://export.arxiv.org/api/query?id_list=${id}`, opts)
    const xml = await res.text()
    const entry = xml.split(/<entry[\s>]/)[1] || ''
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, ' ').trim() || null
    const authors = [...entry.matchAll(/<name>(.*?)<\/name>/g)].map(m => m[1])
    const year = entry.match(/<published>(\d{4})/)?.[1] || null
    return { title, authors: fmtAuthors(authors), year, venue: 'arXiv' }
  }
  if (kind === 'pubmed') {
    const res = await fetchImpl(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${id}&retmode=json`, opts)
    const r = (await res.json()).result?.[id] || {}
    return {
      title: r.title || null,
      authors: fmtAuthors((r.authors || []).map(a => a.name)),
      year: (r.pubdate || '').slice(0, 4) || null,
      venue: r.source || null,
    }
  }
  // generic：抓页面 title
  const res = await fetchImpl(id, opts)
  const html = await res.text()
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || null
  return { title, authors: null, year: null, venue: new URL(id).hostname.replace(/^www\./, '') }
}

function fmtAuthors(list) {
  const names = (list || []).filter(Boolean)
  if (!names.length) return null
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} et al.` : names.join(', ')
}

export function citeRoutes(app, db, fetchImpl) {
  app.post('/api/cite', async c => {
    const { url } = await c.req.json().catch(() => ({}))
    const cls = url && classifyUrl(url)
    if (!cls) return c.json({ ok: false, error: 'not a url' }, 400)
    const cached = db.prepare('SELECT * FROM citations WHERE url = ?').get(url)
    if (cached) return c.json({ ok: true, ...cached })
    try {
      const meta = await fetchMeta(cls.kind, cls.id, fetchImpl)
      if (!meta.title) throw new Error('no title')
      const row = { url, kind: cls.kind, ...meta, fetched_at: new Date().toISOString() }
      db.prepare(`INSERT OR REPLACE INTO citations(url, kind, title, authors, year, venue, fetched_at)
                  VALUES (@url, @kind, @title, @authors, @year, @venue, @fetched_at)`).run(row)
      return c.json({ ok: true, ...row })
    } catch {
      return c.json({ ok: false, url, kind: cls.kind })   // 降级为普通链接，前端保底
    }
  })
}
