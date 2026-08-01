import fs from 'node:fs'
import { Readable } from 'node:stream'
import archiver from 'archiver'
import { taskOf } from './entries.js'
import { mdToPm } from './mdToPm.js'

const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const TASK_COLOR_FALLBACK = '#3388dd'

function ordinal(n) {
  if (n >= 11 && n <= 13) return 'th'
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'
}

// 还原用户原本的 Typora 写法：##### <span id="YYMMDD">Mar 12<sup>th</sup></span>
export function formatDayHeading(day) {
  const [y, m, d] = day.split('-').map(Number)
  const id = `${String(y).slice(2)}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`
  return `##### <span id="${id}">${MONTH_EN[m - 1]} ${String(d).padStart(2, '0')}<sup>${ordinal(d)}</sup></span>`
}

export function formatTaskHeading(task) {
  if (!task) return ''
  return `<font color=${task.color || TASK_COLOR_FALLBACK}>${task.name}</font>`
}

// 全库 → 单份 Markdown（年份 H1 可折叠、日期 H5、任务 font 标记），与旧笔记格式往返一致
export function buildFullMarkdown(db, opts = {}) {
  const imgPrefix = opts.imgPrefix ?? 'images/'
  const onEmbed = opts.onEmbed ?? (() => null)
  const rows = db.prepare(
    `SELECT * FROM entries WHERE deleted_at IS NULL ORDER BY day ASC, position ASC, created_at ASC`).all()
  const notes = new Map(db.prepare('SELECT day, text FROM day_notes').all().map(n => [n.day, n.text]))

  const byDay = new Map()
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, [])
    byDay.get(r.day).push(r)
  }
  for (const day of notes.keys()) if (!byDay.has(day)) byDay.set(day, [])
  const days = [...byDay.keys()].sort()

  let out = ''
  let curYear = null
  for (const day of days) {
    const year = day.slice(0, 4)
    if (year !== curYear) {
      out += `${curYear ? '\n' : ''}# ${year}\n\n`
      curYear = year
    }
    out += `${formatDayHeading(day)}\n\n`
    const note = (notes.get(day) ?? '').trim()
    if (note) out += `${note}\n\n`
    for (const r of byDay.get(day)) {
      const heading = formatTaskHeading(taskOf(db, r.task_id))
      if (heading) out += `${heading}\n\n`
      out += pmToMarkdown(JSON.parse(r.content), { imgPrefix, onEmbed })
      out += '\n'
    }
  }
  return out.replace(/\n{4,}/g, '\n\n\n')
}

// 按月切分：{'2026-07': '...md 内容...'}
export function buildMonthlyMarkdown(db, opts = {}) {
  const full = buildFullMarkdown(db, opts)
  const chunks = new Map()
  const dayRe = /^##### <span id="(\d{6})"/
  let cur = null
  let buf = []
  const flush = () => { if (cur && buf.length) chunks.set(cur, (chunks.get(cur) ?? '') + buf.join('\n') + '\n') ; buf = [] }
  for (const line of full.split('\n')) {
    const m = line.match(dayRe)
    if (m) {
      const month = `20${m[1].slice(0, 2)}-${m[1].slice(2, 4)}`
      if (month !== cur) { flush(); cur = month }
    }
    if (cur) buf.push(line)
  }
  flush()
  return chunks
}

// opts: { imgPrefix?: '/images/' 重写前缀, onEmbed?: (html)=>相对路径 }
export function pmToMarkdown(doc, opts = {}) {
  const ctx = {
    imgPrefix: opts.imgPrefix ?? '/images/',
    onEmbed: opts.onEmbed ?? (() => null),
  }
  return blocks(doc.content || [], ctx, '').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

function blocks(nodes, ctx, indent) {
  return nodes.map(n => block(n, ctx, indent)).join('')
}

function block(n, ctx, indent) {
  const t = n.type
  if (t === 'paragraph') return indent + inline(n.content || [], ctx) + '\n\n'
  if (t === 'heading') return indent + '#'.repeat(n.attrs?.level || 1) + ' ' + inline(n.content || [], ctx) + '\n\n'
  if (t === 'bulletList') return listItems(n, ctx, indent, () => '- ')
  if (t === 'orderedList') return listItems(n, ctx, indent, i => `${i + 1}. `)
  if (t === 'taskList') return listItems(n, ctx, indent, (i, item) => item.attrs?.checked ? '- [x] ' : '- [ ] ')
  if (t === 'blockquote') {
    // 段间空行也要带 '>'，否则 Markdown 会把一段引用读成好几段独立引用
    const inner = blocks(n.content || [], ctx, indent).replace(/\n+$/, '')
    return inner.split('\n').map(l => (l ? '> ' + l : '>')).join('\n') + '\n\n'
  }
  if (t === 'codeBlock') return indent + '```' + (n.attrs?.language || '') + '\n' + text(n) + '\n```\n\n'
  if (t === 'mermaidBlock') return indent + '```mermaid\n' + (n.attrs?.code || '') + '\n```\n\n'
  if (t === 'horizontalRule') return indent + '---\n\n'
  if (t === 'table') return table(n, ctx, indent)
  if (t === 'image') return indent + img(n, ctx) + '\n\n'
  if (t === 'citation') return indent + citeMd(n) + '\n\n'
  if (t === 'htmlEmbed') {
    const p = ctx.onEmbed(n.attrs?.html || '')
    return indent + (p ? `[交互内容](${p})` : '<!-- 交互内容（未导出） -->') + '\n\n'
  }
  // 未知块：递归其子内容，不吞文本
  return blocks(n.content || [], ctx, indent)
}

function listItems(n, ctx, indent, bullet) {
  return (n.content || []).map((item, i) => {
    const b = bullet(i, item)
    const inner = blocks(item.content || [], ctx, '').trimEnd()
    const [first, ...rest] = inner.split('\n')
    const cont = rest.map(l => l ? indent + '  ' + l : l).join('\n')
    return indent + b + first + (cont ? '\n' + cont : '') + '\n'
  }).join('') + '\n'
}

function table(n, ctx, indent) {
  const rows = (n.content || []).map(row =>
    (row.content || []).map(cell => inline((cell.content?.[0]?.content) || [], ctx).replace(/\|/g, '\\|')))
  if (!rows.length) return ''
  let out = indent + '| ' + rows[0].join(' | ') + ' |\n'
  out += indent + '| ' + rows[0].map(() => '---').join(' | ') + ' |\n'
  for (const r of rows.slice(1)) out += indent + '| ' + r.join(' | ') + ' |\n'
  return out + '\n'
}

function inline(nodes, ctx) {
  return nodes.map(n => {
    if (n.type === 'text') return marks(n)
    if (n.type === 'hardBreak') return '  \n'
    if (n.type === 'image') return img(n, ctx)
    if (n.type === 'citation') return citeMd(n)
    return text(n)
  }).join('')
}

function marks(n) {
  let t = n.text || ''
  for (const m of n.marks || []) {
    if (m.type === 'code') t = '`' + t + '`'
    else if (m.type === 'bold') t = `**${t}**`
    else if (m.type === 'italic') t = `*${t}*`
    else if (m.type === 'strike') t = `~~${t}~~`
    else if (m.type === 'highlight') t = `==${t}==`
    else if (m.type === 'link') t = `[${t}](${m.attrs?.href || ''})`
  }
  return t
}

const text = n => (n.content || []).map(c => c.text || text(c)).join('')
const img = (n, ctx) => `![](${(n.attrs?.src || '').replace(/^\/images\//, ctx.imgPrefix)})`
function citeMd(n) {
  const a = n.attrs || {}
  const label = a.title
    ? [a.title, a.year && `(${a.year})`, a.venue && `· ${a.venue}`].filter(Boolean).join(' ')
    : a.url
  return `[${label}](${a.url || ''})`
}

// 卡片的「源码 / 渲染」切换：两个方向都走服务端这套已测过的转换，
// 避免前端另写一份解析器导致两边行为不一致。
export function convertRoutes(app) {
  app.post('/api/convert/to-markdown', async c => {
    const body = await c.req.json().catch(() => ({}))
    const doc = body.content ?? { type: 'doc', content: [] }
    return c.json({ markdown: pmToMarkdown(doc) })
  })

  app.post('/api/convert/to-doc', async c => {
    const body = await c.req.json().catch(() => ({}))
    return c.json({ content: mdToPm(String(body.markdown ?? '')) })
  })
}

export function exportRoutes(app, db, imagesDir) {
  // format=full（默认，单份大 Markdown）| monthly（按月拆分）| print（可打印成 PDF 的 HTML）
  app.get('/api/export', c => {
    const format = c.req.query('format') || 'full'

    if (format === 'print') {
      const md = buildFullMarkdown(db, { imgPrefix: '/images/' })
      return c.html(printableHtml(md))
    }

    const archive = archiver('zip')
    let embedSeq = 0
    const onEmbed = html => {
      const p = `embeds/embed-${++embedSeq}.html`
      archive.append(html, { name: p })
      return p
    }

    if (format === 'monthly') {
      const chunks = buildMonthlyMarkdown(db, { imgPrefix: '../images/', onEmbed })
      for (const [month, text] of chunks) {
        archive.append(text, { name: `notes/${month}.md` })
      }
    } else {
      archive.append(buildFullMarkdown(db, { imgPrefix: 'images/', onEmbed }), { name: 'notes.md' })
    }

    if (fs.existsSync(imagesDir)) archive.directory(imagesDir, 'images')
    archive.finalize()
    return new Response(Readable.toWeb(archive), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="parchment-${format}.zip"`,
      },
    })
  })
}

// 浏览器打开后 Ctrl+P 即可存为 PDF；不引入 PDF 生成依赖，保持轻量
function printableHtml(markdown) {
  const esc = s => s.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>Parchment 笔记</title>
<style>
  body { font: 15px/1.75 -apple-system, "PingFang SC", "Source Han Sans SC", sans-serif;
         max-width: 760px; margin: 40px auto; padding: 0 24px; color: #1a1a18; }
  h1 { font-size: 26px; border-bottom: 2px solid #ddd; padding-bottom: 6px; margin-top: 2em;
       page-break-before: always; }
  h1:first-of-type { page-break-before: avoid; }
  pre { white-space: pre-wrap; word-wrap: break-word; font: 13px/1.6 ui-monospace, Menlo, monospace; }
  @media print { body { margin: 0; max-width: none; } }
</style>
<p style="color:#888;font-size:13px">用浏览器的「打印 → 存为 PDF」即可导出。</p>
<pre>${esc(markdown)}</pre>
</head></html>`
}
