import { describe, it, expect } from 'vitest'
import { createDb } from '../src/db.js'

function memDb() { return createDb(':memory:') }

describe('db schema', () => {
  it('建出全部表', () => {
    const db = memDb()
    const names = db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','trigger')`).all().map(r => r.name)
    for (const t of ['entries', 'projects', 'entry_projects', 'citations', 'sessions', 'entries_fts']) {
      expect(names).toContain(t)
    }
  })

  it('FTS 触发器随 insert/update/delete 同步', () => {
    const db = memDb()
    db.prepare(`INSERT INTO entries(id, day, text) VALUES ('e1', '2026-07-28', 'hello 量子点合成')`).run()
    let hit = db.prepare(`SELECT rowid FROM entries_fts WHERE entries_fts MATCH '"量子点"'`).all()
    expect(hit.length).toBe(1)
    db.prepare(`UPDATE entries SET text = 'graphene only' WHERE id = 'e1'`).run()
    hit = db.prepare(`SELECT rowid FROM entries_fts WHERE entries_fts MATCH '"量子点"'`).all()
    expect(hit.length).toBe(0)
    db.prepare(`DELETE FROM entries WHERE id = 'e1'`).run()
    hit = db.prepare(`SELECT rowid FROM entries_fts WHERE entries_fts MATCH '"graphene"'`).all()
    expect(hit.length).toBe(0)
  })
})
