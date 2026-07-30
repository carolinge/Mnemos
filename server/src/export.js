import fs from 'node:fs'
import { Readable } from 'node:stream'
import archiver from 'archiver'
import { tagsOf } from './entries.js'

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
  if (t === 'blockquote') return blocks(n.content || [], ctx, indent).split('\n').map(l => l ? '> ' + l : l).join('\n') + '\n'
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

export function exportRoutes(app, db, imagesDir) {
  app.get('/api/export', c => {
    const rows = db.prepare(`SELECT * FROM entries WHERE deleted_at IS NULL ORDER BY day ASC, position ASC`).all()
    const archive = archiver('zip')
    const byDay = new Map()
    for (const r of rows) {
      if (!byDay.has(r.day)) byDay.set(r.day, [])
      byDay.get(r.day).push(r)
    }
    let embedSeq = 0
    for (const [day, entries] of byDay) {
      let md = `# ${day}\n\n`
      for (const r of entries) {
        const tags = tagsOf(db, r.id).map(t => `#${t.name}`).join(' ')
        md += `## ${r.created_at.slice(11, 16)}${tags ? ' ' + tags : ''}\n\n`
        md += pmToMarkdown(JSON.parse(r.content), {
          imgPrefix: '../../images/',
          onEmbed: html => {
            const p = `embeds/${day}-${++embedSeq}.html`
            archive.append(html, { name: p })
            return `../../${p}`
          },
        })
        md += '\n'
      }
      archive.append(md, { name: `notes/${day.slice(0, 4)}/${day}.md` })
    }
    if (fs.existsSync(imagesDir)) archive.directory(imagesDir, 'images')
    archive.finalize()
    return new Response(Readable.toWeb(archive), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="parchment-export.zip"',
      },
    })
  })
}
