import crypto from 'node:crypto'
import { extractText } from './text.js'
import { mdToPm } from './mdToPm.js'
import { parseNotesMarkdown } from './importMd.js'

const PALETTE = ['#e05252', '#e08d52', '#d9a13b', '#6cae3f', '#3fae8c', '#4a90d9', '#7a6fd9', '#c45fb8']

const now = () => new Date().toISOString()
const today = () => now().slice(0, 10)

function hashCode(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

// 按名字取任务；不存在则新建（配色按名字哈希，稳定不随机）
export function resolveTask(db, nameOrId) {
  const raw = String(nameOrId ?? '').trim().replace(/^#/, '')
  if (!raw) return null
  const byId = db.prepare('SELECT id, name, color, archived FROM projects WHERE id = ?').get(raw)
  if (byId) return byId
  const byName = db.prepare('SELECT id, name, color, archived FROM projects WHERE name = ?').get(raw)
  if (byName) return byName
  const p = { id: crypto.randomUUID(), name: raw, color: PALETTE[hashCode(raw) % PALETTE.length] }
  db.prepare('INSERT INTO projects(id, name, color) VALUES (?, ?, ?)').run(p.id, p.name, p.color)
  return { ...p, archived: 0 }
}

export function taskOf(db, taskId) {
  if (!taskId) return null
  return db.prepare('SELECT id, name, color, archived FROM projects WHERE id = ?').get(taskId) ?? null
}

function rowToEntry(db, row) {
  return {
    id: row.id, day: row.day, position: row.position,
    content: JSON.parse(row.content), version: row.version,
    created_at: row.created_at, updated_at: row.updated_at,
    text: row.text, task: taskOf(db, row.task_id),
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

    const taskCond = project ? 'AND e.task_id = ?' : ''
    const p1 = project ? [project] : []
    let dayCond = ''
    if (before) { dayCond = 'AND e.day < ?'; p1.push(before) }
    if (after) { dayCond = 'AND e.day > ?'; p1.push(after) }
    p1.push(limit)
    const order = after ? 'ASC' : 'DESC'
    const days = db.prepare(`
      SELECT DISTINCT e.day FROM entries e
      WHERE e.deleted_at IS NULL ${taskCond} ${dayCond} ORDER BY e.day ${order} LIMIT ?
    `).all(...p1).map(r => r.day)
    days.sort().reverse()   // 统一为降序输出
    const rows = days.length ? db.prepare(`
      SELECT e.* FROM entries e
      WHERE e.deleted_at IS NULL ${taskCond} AND e.day IN (${days.map(() => '?').join(',')})
      ORDER BY e.day DESC, e.position ASC, e.created_at ASC
    `).all(...(project ? [project] : []), ...days) : []
    return c.json(groupDays(db, rows, days))
  })

  app.get('/api/days', c => {
    return c.json(db.prepare(`
      SELECT day, COUNT(*) AS count FROM entries WHERE deleted_at IS NULL GROUP BY day ORDER BY day
    `).all())
  })

  // 导入旧 Typora 日记：body.markdown 为文件全文，dryRun=true 时只返回统计
  app.post('/api/import', async c => {
    const body = await c.req.json().catch(() => ({}))
    if (typeof body.markdown !== 'string' || !body.markdown.trim()) {
      return c.json({ error: 'missing markdown' }, 400)
    }
    const parsed = parseNotesMarkdown(body.markdown, { defaultYear: body.defaultYear })
    const stats = importParsed(db, parsed, { dryRun: Boolean(body.dryRun) })
    return c.json({ ...stats, warnings: parsed.warnings, dryRun: Boolean(body.dryRun) })
  })

  // 每日碎碎念：日期标头下的小字，默认隐藏，双击日期展开
  app.get('/api/day-notes/:day', c => {
    const row = db.prepare('SELECT day, text FROM day_notes WHERE day = ?').get(c.req.param('day'))
    return c.json(row ?? { day: c.req.param('day'), text: '' })
  })

  app.put('/api/day-notes/:day', async c => {
    const day = c.req.param('day')
    const body = await c.req.json().catch(() => ({}))
    const text = String(body.text ?? '')
    db.prepare(`INSERT INTO day_notes(day, text, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(day) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`)
      .run(day, text, now())
    return c.json({ day, text })
  })

  app.post('/api/entries', async c => {
    const body = await c.req.json().catch(() => ({}))
    const id = crypto.randomUUID()
    const day = body.day || today()
    const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM entries WHERE day = ?').get(day).p
    const content = body.content || { type: 'doc', content: [] }
    const task = body.task !== undefined ? resolveTask(db, body.task) : null
    db.prepare(`INSERT INTO entries(id, day, position, content, text, task_id) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, day, pos, JSON.stringify(content), extractText(content), task?.id ?? null)
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
    // task: 传字符串或 id 则设置/新建，传 null 显式清空，不传则保持原样
    const taskId = body.task === undefined
      ? row.task_id
      : (body.task === null ? null : resolveTask(db, body.task)?.id ?? null)
    db.prepare(`UPDATE entries SET content = ?, text = ?, day = ?, position = ?, task_id = ?,
                version = version + 1, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(content), extractText(content), day, position, taskId, now(), id)
    return c.json(rowToEntry(db, db.prepare('SELECT * FROM entries WHERE id = ?').get(id)))
  })

  app.delete('/api/entries/:id', c => {
    const id = c.req.param('id')
    db.prepare('UPDATE entries SET deleted_at = ? WHERE id = ?').run(now(), id)
    return c.json({ ok: true })
  })

  app.get('/api/projects', c => {
    return c.json(db.prepare('SELECT * FROM projects ORDER BY position, name').all())
  })

  // 边栏拖动排序：整份新顺序一次提交
  app.put('/api/projects/order', async c => {
    const body = await c.req.json().catch(() => ({}))
    const ids = Array.isArray(body.ids) ? body.ids : []
    const upd = db.prepare('UPDATE projects SET position = ? WHERE id = ?')
    db.transaction(() => ids.forEach((id, i) => upd.run(i, id)))()
    return c.json(db.prepare('SELECT * FROM projects ORDER BY position, name').all())
  })

  app.patch('/api/projects/:id', async c => {
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
    if (!row) return c.json({ error: 'not found' }, 404)
    const name = body.name !== undefined ? String(body.name).trim() : row.name
    const color = body.color !== undefined ? body.color : row.color
    const archived = body.archived !== undefined ? (body.archived ? 1 : 0) : row.archived
    const position = body.position !== undefined ? Number(body.position) : row.position
    db.prepare('UPDATE projects SET name = ?, color = ?, archived = ?, position = ? WHERE id = ?')
      .run(name, color, archived, position, id)
    return c.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(id))
  })
}

// 把解析好的旧笔记写入库。dryRun 时只统计不落库，供导入前预览。
export function importParsed(db, parsed, opts = {}) {
  const { dryRun = false } = opts
  const stats = { entries: 0, notes: 0, tasks: new Set(), days: new Set(), skipped: 0 }

  const run = () => {
    for (const e of parsed.entries) {
      if (!e.markdown?.trim() && !e.task) { stats.skipped++; continue }
      stats.days.add(e.day)
      if (e.task) stats.tasks.add(e.task)
      stats.entries++
      if (dryRun) continue
      const content = mdToPm(e.markdown)
      const task = e.task ? resolveTask(db, e.task) : null
      db.prepare(`INSERT INTO entries(id, day, position, content, text, task_id) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), e.day, e.position ?? 0,
             JSON.stringify(content), extractText(content), task?.id ?? null)
    }
    for (const n of parsed.asides ?? []) {
      if (!n.text?.trim()) continue
      stats.notes++
      if (dryRun) continue
      db.prepare(`INSERT INTO day_notes(day, text, updated_at) VALUES (?, ?, ?)
                  ON CONFLICT(day) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`)
        .run(n.day, n.text, now())
    }
  }

  // 整批要么全进要么全不进，避免半截数据
  if (dryRun) run()
  else db.transaction(run)()

  return {
    entries: stats.entries, notes: stats.notes, skipped: stats.skipped,
    tasks: [...stats.tasks], days: stats.days.size,
  }
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

// emptyDays：该天在筛选条件下存在但没有条目（例如只有碎碎念），仍需出现在时间流里
function groupDays(db, rows, dayList = null) {
  const byDay = new Map()
  for (const d of dayList ?? []) byDay.set(d, [])
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, [])
    byDay.get(r.day).push(rowToEntry(db, r))
  }
  const noteRows = byDay.size
    ? db.prepare(`SELECT day, text FROM day_notes WHERE day IN (${[...byDay.keys()].map(() => '?').join(',')})`)
        .all(...byDay.keys())
    : []
  const notes = new Map(noteRows.map(n => [n.day, n.text]))
  const days = [...byDay.entries()].map(([day, entries]) => ({ day, entries, note: notes.get(day) ?? '' }))
    .sort((a, b) => b.day.localeCompare(a.day))
  return {
    days,
    nextBefore: days.length ? days[days.length - 1].day : null,
    nextAfter: days.length ? days[0].day : null,
  }
}
