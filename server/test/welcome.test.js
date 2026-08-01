import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { createDb } from '../src/db.js'
import { resolveTask } from '../src/entries.js'
import { extractText } from '../src/text.js'
import { seedWelcomeIfEmpty, WELCOME_CARDS, WELCOME_TASK } from '../src/welcome.js'

const deps = {
  resolveTask, extractText,
  randomUUID: () => crypto.randomUUID(),
  today: () => '2026-07-31',
}

describe('欢迎卡片', () => {
  it('空库首次启动写入说明卡片，全部归入同一个任务', () => {
    const db = createDb(':memory:')
    expect(seedWelcomeIfEmpty(db, deps)).toBe(true)
    const rows = db.prepare('SELECT * FROM entries ORDER BY position').all()
    expect(rows.length).toBe(WELCOME_CARDS.length)
    const task = db.prepare('SELECT * FROM projects WHERE name = ?').get(WELCOME_TASK)
    expect(task).toBeTruthy()
    expect(rows.every(r => r.task_id === task.id)).toBe(true)
    // 正文进了全文索引，能被搜到
    expect(rows.some(r => r.text.includes('Typora'))).toBe(true)
    const hit = db.prepare(`SELECT rowid FROM entries_fts WHERE entries_fts MATCH '"shortcuts"'`).all()
    expect(hit.length).toBeGreaterThan(0)
  })

  it('已有笔记时不写入，不覆盖用户内容', () => {
    const db = createDb(':memory:')
    db.prepare(`INSERT INTO entries(id, day, text) VALUES ('mine', '2026-01-01', '我自己的笔记')`).run()
    expect(seedWelcomeIfEmpty(db, deps)).toBe(false)
    expect(db.prepare('SELECT COUNT(*) AS n FROM entries').get().n).toBe(1)
  })

  it('重复调用不会重复写入', () => {
    const db = createDb(':memory:')
    seedWelcomeIfEmpty(db, deps)
    seedWelcomeIfEmpty(db, deps)
    expect(db.prepare('SELECT COUNT(*) AS n FROM entries').get().n).toBe(WELCOME_CARDS.length)
  })

  it('每张卡片都是合法的 ProseMirror doc 且有正文', () => {
    for (const card of WELCOME_CARDS) {
      expect(card.type).toBe('doc')
      expect(card.content.length).toBeGreaterThan(0)
      expect(extractText(card).length).toBeGreaterThan(20)
    }
  })
})
