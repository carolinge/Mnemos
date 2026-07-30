import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

// dataDirOrMemory: 目录路径（内建 parchment.db）或 ':memory:'（测试）
export function createDb(dataDirOrMemory) {
  let db
  if (dataDirOrMemory === ':memory:') {
    db = new Database(':memory:')
  } else {
    fs.mkdirSync(dataDirOrMemory, { recursive: true })
    db = new Database(path.join(dataDirOrMemory, 'parchment.db'))
    db.pragma('journal_mode = WAL')
  }
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db) {
  const v = db.pragma('user_version', { simple: true })
  if (v < 1) {
    db.exec(`
      CREATE TABLE entries(
        id TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL DEFAULT '{"type":"doc","content":[]}',
        text TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        deleted_at TEXT
      );
      CREATE INDEX idx_entries_day ON entries(day);
      CREATE TABLE projects(
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE entry_projects(
        entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        PRIMARY KEY(entry_id, project_id)
      );
      CREATE TABLE citations(
        url TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT, authors TEXT, year TEXT, venue TEXT,
        fetched_at TEXT
      );
      CREATE TABLE sessions(
        token TEXT PRIMARY KEY,
        expires_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE entries_fts USING fts5(
        text, content='entries', content_rowid='rowid', tokenize='trigram'
      );
      CREATE TRIGGER entries_ai AFTER INSERT ON entries BEGIN
        INSERT INTO entries_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
      CREATE TRIGGER entries_ad AFTER DELETE ON entries BEGIN
        INSERT INTO entries_fts(entries_fts, rowid, text) VALUES('delete', old.rowid, old.text);
      END;
      CREATE TRIGGER entries_au AFTER UPDATE OF text ON entries BEGIN
        INSERT INTO entries_fts(entries_fts, rowid, text) VALUES('delete', old.rowid, old.text);
        INSERT INTO entries_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
    `)
    db.pragma('user_version = 1')
  }
}
