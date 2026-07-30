import crypto from 'node:crypto'
import { extractText } from './text.js'

const PALETTE = ['#e05252', '#e08d52', '#d9a13b', '#6cae3f', '#3fae8c', '#4a90d9', '#7a6fd9', '#c45fb8']

const now = () => new Date().toISOString()
const today = () => now().slice(0, 10)

function hashCode(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export function upsertTags(db, entryId, names) {
  db.prepare('DELETE FROM entry_projects WHERE entry_id = ?').run(entryId)
  const out = []
  const seen = new Set()
  for (const raw of names || []) {
    const name = String(raw).trim().replace(/^#/, '')
    if (!name || seen.has(name)) continue
    seen.add(name)
    let p = db.prepare('SELECT id, name, color FROM projects WHERE name = ?').get(name)
    if (!p) {
      p = { id: crypto.randomUUID(), name, color: PALETTE[hashCode(name) % PALETTE.length] }
      db.prepare('INSERT INTO projects(id, name, color) VALUES (?, ?, ?)').run(p.id, p.name, p.color)
    }
    db.prepare('INSERT OR IGNORE INTO entry_projects(entry_id, project_id) VALUES (?, ?)').run(entryId, p.id)
    out.push(p)
  }
  return out
}

export function tagsOf(db, entryId) {
  return db.prepare(`
    SELECT p.id, p.name, p.color FROM entry_projects ep
    JOIN projects p ON p.id = ep.project_id WHERE ep.entry_id = ? ORDER BY p.name
  `).all(entryId)
}

function rowToEntry(db, row) {
  return {
    id: row.id, day: row.day, position: row.position,
    content: JSON.parse(row.content), version: row.version,
    created_at: row.created_at, updated_at: row.updated_at,
    text: row.text, tags: tagsOf(db, row.id),
  }
}

export function entriesRoutes(app, db) {
  app.get('/api/entries', c => {
    const q = c.req.query('q')
    const project = c.req.query('project')
    const before = c.req.query('before')
    const after = c.req.query('after')
    const limit = Math.min(Number(c.req.query('limit') || 10), 60)

    if (q) {
      const rows = searchEntries(db, q, 100)
      return c.json(groupDays(db, rows))
    }

    const joins = project ? 'JOIN entry_projects ep ON ep.entry_id = e.id AND ep.project_id = ?' : ''
    const p1 = project ? [project] : []
    let dayCond = ''
    if (before) { dayCond = 'AND e.day < ?'; p1.push(before) }
    if (after) { dayCond = 'AND e.day > ?'; p1.push(after) }
    p1.push(limit)
    const order = after ? 'ASC' : 'DESC'
    const days = db.prepare(`
      SELECT DISTINCT e.day FROM entries e ${joins}
      WHERE e.deleted_at IS NULL ${dayCond} ORDER BY e.day ${order} LIMIT ?
    `).all(...p1).map(r => r.day)
    days.sort().reverse()   // 统一为降序输出
    const rows = days.length ? db.prepare(`
      SELECT DISTINCT e.* FROM entries e ${joins}
      WHERE e.deleted_at IS NULL AND e.day IN (${days.map(() => '?').join(',')})
      ORDER BY e.day DESC, e.position ASC, e.created_at ASC
    `).all(...(project ? [project] : []), ...days) : []
    return c.json(groupDays(db, rows))
  })

  app.get('/api/days', c => {
    return c.json(db.prepare(`
      SELECT day, COUNT(*) AS count FROM entries WHERE deleted_at IS NULL GROUP BY day ORDER BY day
    `).all())
  })

  app.post('/api/entries', async c => {
    const body = await c.req.json().catch(() => ({}))
    const id = crypto.randomUUID()
    const day = body.day || today()
    const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM entries WHERE day = ?').get(day).p
    const content = body.content || { type: 'doc', content: [] }
    db.prepare(`INSERT INTO entries(id, day, position, content, text) VALUES (?, ?, ?, ?, ?)`)
      .run(id, day, pos, JSON.stringify(content), extractText(content))
    if (body.tags) upsertTags(db, id, body.tags)
    return c.json(rowToEntry(db, db.prepare('SELECT * FROM entries WHERE id = ?').get(id)))
  })

  app.patch('/api/entries/:id', async c => {
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const row = db.prepare('SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL').get(id)
    if (!row) return c.json({ error: 'not found' }, 404)
    if (typeof body.version !== 'number' || body.version !== row.version) {
      return c.json({ conflict: true, ...rowToEntry(db, row) }, 409)
    }
    const content = body.content !== undefined ? body.content : JSON.parse(row.content)
    const day = body.day !== undefined ? body.day : row.day
    const position = body.position !== undefined ? body.position : row.position
    db.prepare(`UPDATE entries SET content = ?, text = ?, day = ?, position = ?,
                version = version + 1, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(content), extractText(content), day, position, now(), id)
    if (body.tags !== undefined) upsertTags(db, id, body.tags)
    return c.json(rowToEntry(db, db.prepare('SELECT * FROM entries WHERE id = ?').get(id)))
  })

  app.delete('/api/entries/:id', c => {
    const id = c.req.param('id')
    db.prepare('UPDATE entries SET deleted_at = ? WHERE id = ?').run(now(), id)
    return c.json({ ok: true })
  })

  app.get('/api/projects', c => {
    return c.json(db.prepare('SELECT * FROM projects ORDER BY name').all())
  })

  app.patch('/api/projects/:id', async c => {
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
    if (!row) return c.json({ error: 'not found' }, 404)
    const name = body.name !== undefined ? String(body.name).trim() : row.name
    const color = body.color !== undefined ? body.color : row.color
    const archived = body.archived !== undefined ? (body.archived ? 1 : 0) : row.archived
    db.prepare('UPDATE projects SET name = ?, color = ?, archived = ? WHERE id = ?').run(name, color, archived, id)
    return c.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(id))
  })
}

export function searchEntries(db, q, limit = 100) {
  const trimmed = String(q).trim()
  if (!trimmed) return []
  const cps = [...trimmed]
  if (cps.length >= 3) {
    const quoted = `"${trimmed.replace(/"/g, '""')}"`
    return db.prepare(`
      SELECT e.* FROM entries_fts f JOIN entries e ON e.rowid = f.rowid
      WHERE entries_fts MATCH ? AND e.deleted_at IS NULL
      ORDER BY e.day DESC, e.position ASC LIMIT ?
    `).all(quoted, limit)
  }
  const like = '%' + trimmed.replace(/[\\%_]/g, m => '\\' + m) + '%'
  return db.prepare(`
    SELECT * FROM entries WHERE deleted_at IS NULL AND text LIKE ? ESCAPE '\\'
    ORDER BY day DESC, position ASC LIMIT ?
  `).all(like, limit)
}

function groupDays(db, rows) {
  const byDay = new Map()
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, [])
    byDay.get(r.day).push(rowToEntry(db, r))
  }
  const days = [...byDay.entries()].map(([day, entries]) => ({ day, entries }))
    .sort((a, b) => b.day.localeCompare(a.day))
  return {
    days,
    nextBefore: days.length ? days[days.length - 1].day : null,
    nextAfter: days.length ? days[0].day : null,
  }
}
