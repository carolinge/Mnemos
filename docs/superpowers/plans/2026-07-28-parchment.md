# Parchment 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为科研工作者构建单用户自部署的极简网页笔记本：日期时间流 + 项目标签，类 Typora 编辑，图片/引用/AI HTML/流程图/公式原生支持，自动保存到 fly.io。

**Architecture:** 单 Docker 容器：Hono(Node.js) 后端 + SQLite(FTS5) + 磁盘图片存储，静态托管 Vite+React+TipTap 前端。规格见 `docs/superpowers/specs/2026-07-28-parchment-design.md`（以下称「规格」）。

**Tech Stack:** Node 22 / Hono 4 / better-sqlite3 11 / archiver 7 / Vite 5 / React 18 / TypeScript / TipTap 2.26 / KaTeX / Mermaid 11 / vitest

---

## 全局执行说明

- 服务端为纯 ESM JavaScript（无构建步骤）；前端为 TypeScript。
- 测试命令：服务端 `cd server && npx vitest run`；前端 `cd web && npx vitest run`。
- 手动验证需要两个终端：`cd server && ACCESS_PASSWORD=dev npm run dev`（端口 8787）和 `cd web && npm run dev`（Vite 代理 /api 与 /images 到 8787）。标记为【人工验证】的步骤在浏览器完成。
- 每个提交信息结尾加上：`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 设计意图不明时，回读规格对应章节；规格是唯一权威。
- 两处相对规格的已确认落地方式：`/` 插入菜单以「空行浮出插入条 + 选中浮出格式条」实现同等能力；「条目拖动排序」以上移/下移按钮实现（拖拽属后续打磨）。乐观锁以整数 `version` 列实现规格中「updated_at 比对」的意图。

## 文件结构总览

```
server/
  package.json
  src/index.js      # 进程入口：读环境变量、createDb、createApp、serve、静态托管
  src/app.js        # Hono app 工厂（可注入 db/imagesDir/password/fetchImpl，供测试）
  src/db.js         # createDb：schema 迁移（entries/projects/entry_projects/citations/sessions/FTS5）
  src/text.js       # extractText：ProseMirror JSON → 纯文本（供全文索引）
  src/auth.js       # POST /api/auth + requireAuth 中间件（session cookie）
  src/entries.js    # entries CRUD、tags upsert、projects 路由、列表/分页/过滤/搜索、/api/days
  src/images.js     # POST /api/images 上传归档 + GET /images/* 静态服务
  src/cite.js       # URL 分类（doi/arxiv/pubmed/generic）、元数据抓取、缓存、POST /api/cite
  src/export.js     # pmToMarkdown 序列化 + GET /api/export zip
  test/*.test.js
web/
  package.json  vite.config.ts  tsconfig.json  index.html
  src/main.tsx  src/App.tsx  src/api.ts  src/styles.css
  src/saveStatus.ts            # 全局保存状态小仓库（useSyncExternalStore）
  src/components/Login.tsx Sidebar.tsx Timeline.tsx EntryCard.tsx SaveDot.tsx
  src/components/CommandPalette.tsx TimeScrubber.tsx Lightbox.tsx
  src/editor/extensions.ts     # 扩展装配（StarterKit/表格/任务/数学/代码高亮/链接/占位）
  src/editor/pasteRules.ts     # classifyHtml + handlePaste（图片文件/引用URL/HTML嵌入分流）
  src/editor/HtmlEmbed.tsx  CitationNode.tsx  ResizableImage.tsx  MermaidBlock.tsx  Hashtag.ts
  src/hooks/useAutosave.ts  src/hooks/useTimeline.ts
  src/lib/citePatterns.ts      # 前端 URL 快速判定（与后端规则一致）
  src/lib/groupDays.ts         # day 分组合并/去重工具
  test/*.test.ts(x)  test/setup.ts
Dockerfile  fly.toml  README.md  .gitignore  .dockerignore
```

---

### Task 1: 仓库脚手架 + server 健康检查

**Files:**
- Create: `.gitignore`, `server/package.json`, `server/src/app.js`, `server/src/index.js`, `server/test/health.test.js`

- [ ] **Step 1: 写 .gitignore 与 server/package.json**

`.gitignore`：

```
node_modules/
dist/
data/
*.log
.DS_Store
```

`server/package.json`：

```json
{
  "name": "parchment-server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.7",
    "archiver": "^7.0.1",
    "better-sqlite3": "^11.7.0",
    "hono": "^4.6.14"
  },
  "devDependencies": {
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: 安装依赖**

Run: `cd server && npm install`
Expected: 无报错，生成 package-lock.json。

- [ ] **Step 3: 写失败测试 `server/test/health.test.js`**

```js
import { describe, it, expect } from 'vitest'
import { createApp } from '../src/app.js'

describe('health', () => {
  it('GET /api/health 返回 ok 且无需认证', async () => {
    const app = createApp({ db: null, imagesDir: '/tmp/x', password: 'pw' })
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
```

Run: `cd server && npx vitest run`
Expected: FAIL（app.js 不存在）。

- [ ] **Step 4: 写 `server/src/app.js` 最小实现**

```js
import { Hono } from 'hono'

export function createApp({ db, imagesDir, password, fetchImpl = fetch, webDist = null }) {
  const app = new Hono()
  app.get('/api/health', c => c.json({ ok: true }))
  return app
}
```

- [ ] **Step 5: 写 `server/src/index.js`**

```js
import path from 'node:path'
import fs from 'node:fs'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'

const password = process.env.ACCESS_PASSWORD
if (!password) {
  console.error('缺少环境变量 ACCESS_PASSWORD')
  process.exit(1)
}
const dataDir = process.env.DATA_DIR || './data'
fs.mkdirSync(dataDir, { recursive: true })

const app = createApp({
  db: null, // Task 2 接入 createDb(dataDir)
  imagesDir: path.join(dataDir, 'images'),
  password,
  webDist: process.env.WEB_DIST || null,
})
const port = Number(process.env.PORT || 8787)
serve({ fetch: app.fetch, port })
console.log(`parchment server on :${port}`)
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd server && npx vitest run`
Expected: PASS 1 test。

- [ ] **Step 7: 提交**

```bash
git add .gitignore server
git commit -m "feat(server): 脚手架与健康检查端点"
```

---

### Task 2: 数据库 schema + 纯文本抽取

**Files:**
- Create: `server/src/db.js`, `server/src/text.js`
- Test: `server/test/db.test.js`, `server/test/text.test.js`

- [ ] **Step 1: 写失败测试 `server/test/db.test.js`**

```js
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
```

Run: `cd server && npx vitest run test/db.test.js` → Expected: FAIL。

- [ ] **Step 2: 写 `server/src/db.js`**

```js
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
```

- [ ] **Step 3: 跑 db 测试确认通过**

Run: `cd server && npx vitest run test/db.test.js` → Expected: PASS。

- [ ] **Step 4: 写失败测试 `server/test/text.test.js`**

```js
import { describe, it, expect } from 'vitest'
import { extractText } from '../src/text.js'

describe('extractText', () => {
  it('抽取嵌套文本、引用卡片与 mermaid 源码，折叠空白', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '实验记录' }] },
        { type: 'paragraph', content: [
          { type: 'text', text: '今天合成了 ' },
          { type: 'text', marks: [{ type: 'bold' }], text: '量子点' },
        ] },
        { type: 'citation', attrs: { url: 'https://doi.org/10.1/x', title: 'Great Paper', authors: 'Li L', venue: 'Nature', year: '2024' } },
        { type: 'mermaidBlock', attrs: { code: 'graph TD; A-->B' } },
        { type: 'htmlEmbed', attrs: { html: '<script>evil()</script>' } },
      ],
    }
    const t = extractText(doc)
    expect(t).toContain('实验记录')
    expect(t).toContain('量子点')
    expect(t).toContain('Great Paper')
    expect(t).toContain('A-->B')
    expect(t).not.toContain('evil')   // 嵌入块的原始 HTML 不进索引
    expect(t).not.toMatch(/\s{2,}/)
  })

  it('空文档返回空串', () => {
    expect(extractText({ type: 'doc', content: [] })).toBe('')
    expect(extractText(null)).toBe('')
  })
})
```

Run: `cd server && npx vitest run test/text.test.js` → Expected: FAIL。

- [ ] **Step 5: 写 `server/src/text.js`**

```js
// ProseMirror JSON → 供 FTS 索引的纯文本。
export function extractText(node) {
  if (!node) return ''
  const parts = []
  if (node.type === 'text' && node.text) parts.push(node.text)
  const a = node.attrs || {}
  if (node.type === 'citation') {
    parts.push([a.title, a.authors, a.venue, a.year, a.url].filter(Boolean).join(' '))
  }
  if (node.type === 'mermaidBlock' && a.code) parts.push(a.code)
  for (const child of node.content || []) parts.push(extractText(child))
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}
```

- [ ] **Step 6: 全量测试**

Run: `cd server && npx vitest run` → Expected: PASS 全部。

- [ ] **Step 7: 提交**

```bash
git add server/src/db.js server/src/text.js server/test/db.test.js server/test/text.test.js
git commit -m "feat(server): SQLite schema(FTS5 trigram) 与 ProseMirror 文本抽取"
```

---

### Task 3: 认证（单密码 + session cookie）

**Files:**
- Create: `server/src/auth.js`
- Modify: `server/src/app.js`（接入路由与中间件）, `server/src/index.js`（接入 createDb）
- Test: `server/test/auth.test.js`

- [ ] **Step 1: 写失败测试 `server/test/auth.test.js`**

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../src/db.js'
import { createApp } from '../src/app.js'

let app
beforeEach(() => {
  app = createApp({ db: createDb(':memory:'), imagesDir: '/tmp/img-test', password: 'secret-pw' })
})

async function login(pw) {
  return app.request('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw }),
  })
}

describe('auth', () => {
  it('错误密码 401，不发 cookie', async () => {
    const res = await login('wrong')
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('正确密码 200 并设置 HttpOnly session cookie', async () => {
    const res = await login('secret-pw')
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie')
    expect(cookie).toMatch(/session=/)
    expect(cookie).toMatch(/HttpOnly/i)
  })

  it('受保护路由未带 cookie 401，带 cookie 放行', async () => {
    const noAuth = await app.request('/api/projects')
    expect(noAuth.status).toBe(401)
    const cookie = (await login('secret-pw')).headers.get('set-cookie').split(';')[0]
    const ok = await app.request('/api/projects', { headers: { Cookie: cookie } })
    expect(ok.status).not.toBe(401)   // Task 4 之前该路由可能 404，但绝不能 401
  })

  it('伪造 token 401', async () => {
    const res = await app.request('/api/projects', { headers: { Cookie: 'session=deadbeef' } })
    expect(res.status).toBe(401)
  })
})
```

Run: `cd server && npx vitest run test/auth.test.js` → Expected: FAIL。

- [ ] **Step 2: 写 `server/src/auth.js`**

```js
import crypto from 'node:crypto'
import { getCookie, setCookie } from 'hono/cookie'

const SESSION_DAYS = 90
const PUBLIC_PATHS = new Set(['/api/auth', '/api/health'])

export function authRoutes(app, db, password) {
  app.post('/api/auth', async c => {
    const body = await c.req.json().catch(() => ({}))
    if (!body.password || !safeEqual(String(body.password), password)) {
      return c.json({ error: 'wrong password' }, 401)
    }
    const token = crypto.randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000)
    db.prepare('INSERT INTO sessions(token, expires_at) VALUES (?, ?)').run(token, expires.toISOString())
    setCookie(c, 'session', token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires,
    })
    return c.json({ ok: true })
  })
}

export function requireAuth(db) {
  return async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path)) return next()
    const token = getCookie(c, 'session')
    const row = token && db.prepare('SELECT token FROM sessions WHERE token = ? AND expires_at > ?')
      .get(token, new Date().toISOString())
    if (!row) return c.json({ error: 'unauthorized' }, 401)
    await next()
  }
}

// 双方 sha256 后 timingSafeEqual，规避长度泄露
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}
```

- [ ] **Step 3: 接入 `server/src/app.js`**

整文件替换为：

```js
import { Hono } from 'hono'
import { authRoutes, requireAuth } from './auth.js'

export function createApp({ db, imagesDir, password, fetchImpl = fetch, webDist = null }) {
  const app = new Hono()
  app.get('/api/health', c => c.json({ ok: true }))
  authRoutes(app, db, password)
  app.use('/api/*', requireAuth(db))
  app.use('/images/*', requireAuth(db))
  return app
}
```

- [ ] **Step 4: `server/src/index.js` 接入真实 db**

把 `db: null, // Task 2 接入 createDb(dataDir)` 替换为 `db: createDb(dataDir),`，并在文件头部加 `import { createDb } from './db.js'`。

- [ ] **Step 5: 跑测试**

Run: `cd server && npx vitest run` → Expected: PASS 全部（auth 4 个用例）。

- [ ] **Step 6: 提交**

```bash
git add server/src
git add server/test/auth.test.js
git commit -m "feat(server): 单密码认证与 session 中间件"
```

---

### Task 4: 条目 CRUD + 标签 + 项目路由 + 乐观锁 + 软删除

**Files:**
- Create: `server/src/entries.js`
- Modify: `server/src/app.js`
- Test: `server/test/entries.test.js`

- [ ] **Step 1: 写失败测试 `server/test/entries.test.js`**

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../src/db.js'
import { createApp } from '../src/app.js'

let app, cookie
beforeEach(async () => {
  app = createApp({ db: createDb(':memory:'), imagesDir: '/tmp/img-test', password: 'pw' })
  const res = await app.request('/api/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'pw' }),
  })
  cookie = res.headers.get('set-cookie').split(';')[0]
})

const H = () => ({ 'Content-Type': 'application/json', Cookie: cookie })
const doc = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
async function createEntry(body = {}) {
  const res = await app.request('/api/entries', { method: 'POST', headers: H(), body: JSON.stringify(body) })
  expect(res.status).toBe(200)
  return res.json()
}

describe('entries CRUD', () => {
  it('POST 创建：默认今天、position 递增、返回完整行', async () => {
    const a = await createEntry({ day: '2026-07-01' })
    const b = await createEntry({ day: '2026-07-01' })
    expect(a.id).toBeTruthy()
    expect(a.day).toBe('2026-07-01')
    expect(b.position).toBe(a.position + 1)
    expect(a.version).toBe(0)
    expect(a.tags).toEqual([])
  })

  it('PATCH 保存内容：text 被抽取、version 自增', async () => {
    const e = await createEntry({ day: '2026-07-01' })
    const res = await app.request(`/api/entries/${e.id}`, {
      method: 'PATCH', headers: H(),
      body: JSON.stringify({ content: doc('石墨烯转移工艺'), version: 0 }),
    })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.version).toBe(1)
    // 全文可搜（FTS 触发器生效）
    const list = await app.request('/api/entries?q=石墨烯', { headers: H() })
    const { days } = await list.json()
    expect(days.flatMap(d => d.entries).some(x => x.id === e.id)).toBe(true)
  })

  it('PATCH 版本不匹配 → 409 带当前内容', async () => {
    const e = await createEntry({})
    await app.request(`/api/entries/${e.id}`, {
      method: 'PATCH', headers: H(), body: JSON.stringify({ content: doc('v1'), version: 0 }),
    })
    const res = await app.request(`/api/entries/${e.id}`, {
      method: 'PATCH', headers: H(), body: JSON.stringify({ content: doc('旧标签页'), version: 0 }),
    })
    expect(res.status).toBe(409)
    const j = await res.json()
    expect(j.version).toBe(1)
    expect(j.content).toBeTruthy()
  })

  it('tags：即建即打标、复用同名项目、可移除', async () => {
    const e = await createEntry({ day: '2026-07-01' })
    let res = await app.request(`/api/entries/${e.id}`, {
      method: 'PATCH', headers: H(),
      body: JSON.stringify({ tags: ['钙钛矿', '综述'], version: 0 }),
    })
    let j = await res.json()
    expect(j.tags.map(t => t.name).sort()).toEqual(['综述', '钙钛矿'])
    const first = j.tags.find(t => t.name === '钙钛矿')
    // 第二个条目复用同名项目（同 id）
    const e2 = await createEntry({ day: '2026-07-02' })
    res = await app.request(`/api/entries/${e2.id}`, {
      method: 'PATCH', headers: H(), body: JSON.stringify({ tags: ['钙钛矿'], version: 0 }),
    })
    j = await res.json()
    expect(j.tags[0].id).toBe(first.id)
    // 移除标签
    res = await app.request(`/api/entries/${e.id}`, {
      method: 'PATCH', headers: H(), body: JSON.stringify({ tags: ['综述'], version: 1 }),
    })
    j = await res.json()
    expect(j.tags.map(t => t.name)).toEqual(['综述'])
  })

  it('DELETE 软删除：列表不再返回', async () => {
    const e = await createEntry({ day: '2026-07-01' })
    const del = await app.request(`/api/entries/${e.id}`, { method: 'DELETE', headers: H() })
    expect(del.status).toBe(200)
    const list = await app.request('/api/entries?limit=50', { headers: H() })
    const { days } = await list.json()
    expect(days.flatMap(d => d.entries).some(x => x.id === e.id)).toBe(false)
  })

  it('GET /api/projects 返回项目；PATCH 可改色/归档', async () => {
    const e = await createEntry({})
    await app.request(`/api/entries/${e.id}`, {
      method: 'PATCH', headers: H(), body: JSON.stringify({ tags: ['纳米线'], version: 0 }),
    })
    let res = await app.request('/api/projects', { headers: H() })
    const projects = await res.json()
    expect(projects.length).toBe(1)
    const p = projects[0]
    res = await app.request(`/api/projects/${p.id}`, {
      method: 'PATCH', headers: H(), body: JSON.stringify({ archived: true, color: '#123456' }),
    })
    expect(res.status).toBe(200)
    res = await app.request('/api/projects', { headers: H() })
    const after = await res.json()
    expect(after[0].archived).toBe(1)
    expect(after[0].color).toBe('#123456')
  })
})
```

Run: `cd server && npx vitest run test/entries.test.js` → Expected: FAIL。

- [ ] **Step 2: 写 `server/src/entries.js`**

```js
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
```

- [ ] **Step 3: 接入 `server/src/app.js`**

在 `app.use('/images/*', requireAuth(db))` 之后加：

```js
  entriesRoutes(app, db)
```

并在头部加 `import { entriesRoutes } from './entries.js'`。

- [ ] **Step 4: 跑测试**

Run: `cd server && npx vitest run test/entries.test.js`
Expected: 列表相关用例（q= / limit=）仍 FAIL——GET /api/entries 属 Task 5；其余用例 PASS。若非列表用例失败，先修复再继续。

- [ ] **Step 5: 提交**

```bash
git add server/src server/test/entries.test.js
git commit -m "feat(server): 条目 CRUD、标签即建即打、项目路由、乐观锁与软删除"
```

---

### Task 5: 列表分页（before/after）+ 项目过滤 + 混合搜索 + /api/days

**Files:**
- Modify: `server/src/entries.js`
- Test: `server/test/list.test.js`

- [ ] **Step 1: 写失败测试 `server/test/list.test.js`**

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../src/db.js'
import { createApp } from '../src/app.js'

let app, cookie
beforeEach(async () => {
  app = createApp({ db: createDb(':memory:'), imagesDir: '/tmp/img-test', password: 'pw' })
  const res = await app.request('/api/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'pw' }),
  })
  cookie = res.headers.get('set-cookie').split(';')[0]
})
const H = () => ({ 'Content-Type': 'application/json', Cookie: cookie })
const doc = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

async function seed(day, text, tags = []) {
  const res = await app.request('/api/entries', {
    method: 'POST', headers: H(), body: JSON.stringify({ day, content: doc(text), tags }),
  })
  return res.json()
}

describe('entries list', () => {
  it('默认按 day 降序分组返回，nextBefore/nextAfter 正确', async () => {
    for (const d of ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04']) await seed(d, `note ${d}`)
    const res = await app.request('/api/entries?limit=2', { headers: H() })
    const j = await res.json()
    expect(j.days.map(d => d.day)).toEqual(['2026-07-04', '2026-07-03'])
    expect(j.nextBefore).toBe('2026-07-03')
    expect(j.nextAfter).toBe('2026-07-04')
    const older = await (await app.request(`/api/entries?limit=2&before=${j.nextBefore}`, { headers: H() })).json()
    expect(older.days.map(d => d.day)).toEqual(['2026-07-02', '2026-07-01'])
  })

  it('after 向新方向翻页（时间条跳转后加载更新内容）', async () => {
    for (const d of ['2026-07-01', '2026-07-02', '2026-07-03']) await seed(d, `note ${d}`)
    const res = await app.request('/api/entries?limit=2&after=2026-07-01', { headers: H() })
    const j = await res.json()
    expect(j.days.map(d => d.day)).toEqual(['2026-07-03', '2026-07-02'])
  })

  it('project 过滤只返回该项目条目所在的天', async () => {
    await seed('2026-07-01', 'A 相关', ['A'])
    await seed('2026-07-02', '无关')
    const projects = await (await app.request('/api/projects', { headers: H() })).json()
    const res = await app.request(`/api/entries?project=${projects[0].id}`, { headers: H() })
    const j = await res.json()
    expect(j.days.length).toBe(1)
    expect(j.days[0].day).toBe('2026-07-01')
  })

  it('搜索：英文≥3字符走 FTS，中文2字符走 LIKE 兜底', async () => {
    await seed('2026-07-01', 'graphene transfer process')
    await seed('2026-07-02', '钙钛矿太阳能电池')
    let j = await (await app.request('/api/entries?q=graphene', { headers: H() })).json()
    expect(j.days.flatMap(d => d.entries).length).toBe(1)
    j = await (await app.request(`/api/entries?q=${encodeURIComponent('钙钛')}`, { headers: H() })).json()
    expect(j.days.flatMap(d => d.entries).length).toBe(1)
    j = await (await app.request('/api/entries?q=nothing-here', { headers: H() })).json()
    expect(j.days.length).toBe(0)
  })

  it('/api/days 返回全部有笔记的日期与计数（供时间条）', async () => {
    await seed('2026-07-01', 'a'); await seed('2026-07-01', 'b'); await seed('2026-07-03', 'c')
    const j = await (await app.request('/api/days', { headers: H() })).json()
    expect(j).toEqual([{ day: '2026-07-01', count: 2 }, { day: '2026-07-03', count: 1 }])
  })
})
```

Run: `cd server && npx vitest run test/list.test.js` → Expected: FAIL。

- [ ] **Step 2: 在 `server/src/entries.js` 的 `entriesRoutes` 内（`app.post('/api/entries'` 之前）加列表与 days 路由**

```js
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

    const joins = project ? 'JOIN entry_projects ep ON ep.entry_id = e.id AND ep.project_id = @project' : ''
    let dayCond = ''
    if (before) dayCond = 'AND e.day < @before'
    if (after) dayCond = 'AND e.day > @after'
    const order = after ? 'ASC' : 'DESC'
    const days = db.prepare(`
      SELECT DISTINCT e.day FROM entries e ${joins}
      WHERE e.deleted_at IS NULL ${dayCond} ORDER BY e.day ${order} LIMIT @limit
    `).all({ project, before, after, limit }).map(r => r.day)
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
```

注意：`joins` 里用了命名参数 `@project`，与位置参数混用会出错——按上面写法，DISTINCT day 查询用命名参数对象，第二个查询用位置参数数组（project 在前）。保持与代码块一致即可。

- [ ] **Step 3: 同文件底部加搜索与分组工具函数（`entriesRoutes` 外）**

```js
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
```

- [ ] **Step 4: 跑全部测试（含 Task 4 里遗留的列表用例）**

Run: `cd server && npx vitest run`
Expected: PASS 全部。

- [ ] **Step 5: 提交**

```bash
git add server/src/entries.js server/test/list.test.js
git commit -m "feat(server): 双向分页、项目过滤、FTS/LIKE 混合搜索与 /api/days"
```

---

### Task 6: 图片上传归档与静态服务

**Files:**
- Create: `server/src/images.js`
- Modify: `server/src/app.js`
- Test: `server/test/images.test.js`

- [ ] **Step 1: 写失败测试 `server/test/images.test.js`**

```js
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDb } from '../src/db.js'
import { createApp } from '../src/app.js'

let app, cookie, imagesDir
beforeEach(async () => {
  imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parchment-img-'))
  app = createApp({ db: createDb(':memory:'), imagesDir, password: 'pw' })
  const res = await app.request('/api/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'pw' }),
  })
  cookie = res.headers.get('set-cookie').split(';')[0]
})

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

async function upload(bytes = PNG, name = 'shot.png', type = 'image/png') {
  const fd = new FormData()
  fd.append('file', new File([bytes], name, { type }))
  return app.request('/api/images', { method: 'POST', headers: { Cookie: cookie }, body: fd })
}

describe('images', () => {
  it('上传：按年月归档、返回 /images/YYYY/MM/<hash>.png', async () => {
    const res = await upload()
    expect(res.status).toBe(200)
    const { url } = await res.json()
    expect(url).toMatch(/^\/images\/\d{4}\/\d{2}\/[0-9a-f]{16}\.png$/)
    const abs = path.join(imagesDir, url.replace('/images/', ''))
    expect(fs.existsSync(abs)).toBe(true)
  })

  it('同内容去重：两次上传得到同一 URL', async () => {
    const a = await (await upload()).json()
    const b = await (await upload()).json()
    expect(a.url).toBe(b.url)
  })

  it('GET 回读带正确 Content-Type；未认证 401', async () => {
    const { url } = await (await upload()).json()
    const ok = await app.request(url, { headers: { Cookie: cookie } })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('image/png')
    const anon = await app.request(url)
    expect(anon.status).toBe(401)
  })

  it('路径穿越被拒绝', async () => {
    const res = await app.request('/images/../../etc/passwd', { headers: { Cookie: cookie } })
    expect([400, 404]).toContain(res.status)
  })

  it('无文件字段 400', async () => {
    const fd = new FormData()
    const res = await app.request('/api/images', { method: 'POST', headers: { Cookie: cookie }, body: fd })
    expect(res.status).toBe(400)
  })
})
```

Run: `cd server && npx vitest run test/images.test.js` → Expected: FAIL。

- [ ] **Step 2: 写 `server/src/images.js`**

```js
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif',
}
const EXT_MIME = Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m]))

export function imagesRoutes(app, imagesDir) {
  app.post('/api/images', async c => {
    const body = await c.req.parseBody()
    const file = body.file
    if (!(file instanceof File)) return c.json({ error: 'no file' }, 400)
    const buf = Buffer.from(await file.arrayBuffer())
    const ext = MIME_EXT[file.type] || 'bin'
    const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
    const d = new Date()
    const rel = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${hash}.${ext}`
    const abs = path.join(imagesDir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    if (!fs.existsSync(abs)) fs.writeFileSync(abs, buf)
    return c.json({ url: `/images/${rel}` })
  })

  app.get('/images/*', c => {
    const rel = decodeURIComponent(c.req.path.replace(/^\/images\//, ''))
    const abs = path.resolve(imagesDir, rel)
    if (!abs.startsWith(path.resolve(imagesDir) + path.sep)) return c.text('bad path', 400)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return c.notFound()
    const mime = EXT_MIME[path.extname(abs).slice(1)] || 'application/octet-stream'
    return c.body(fs.readFileSync(abs), 200, {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
  })
}
```

注意去重语义：URL 含年月，同内容跨月重传会得到不同 URL——可接受（罕见且无害），测试只覆盖同月去重。

- [ ] **Step 3: 接入 `server/src/app.js`**

在 `entriesRoutes(app, db)` 之后加 `imagesRoutes(app, imagesDir)`，头部加 `import { imagesRoutes } from './images.js'`。

- [ ] **Step 4: 跑测试**

Run: `cd server && npx vitest run` → Expected: PASS 全部。

- [ ] **Step 5: 提交**

```bash
git add server/src server/test/images.test.js
git commit -m "feat(server): 图片上传按年月归档、内容去重与受保护静态服务"
```

---

### Task 7: 文献引用——URL 分类、元数据抓取与缓存

**Files:**
- Create: `server/src/cite.js`
- Modify: `server/src/app.js`
- Test: `server/test/cite.test.js`

- [ ] **Step 1: 写失败测试 `server/test/cite.test.js`**

```js
import { describe, it, expect, beforeEach } from 'vitest'
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
```

Run: `cd server && npx vitest run test/cite.test.js` → Expected: FAIL。

- [ ] **Step 2: 写 `server/src/cite.js`**

```js
// 文献链接分类与元数据抓取。全部外呼走注入的 fetchImpl，便于测试与超时控制。
export function classifyUrl(raw) {
  let u
  try { u = new URL(String(raw).trim()) } catch { return null }
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
```

- [ ] **Step 3: 接入 `server/src/app.js`**

在 `imagesRoutes(app, imagesDir)` 之后加 `citeRoutes(app, db, fetchImpl)`，头部加 `import { citeRoutes } from './cite.js'`。

- [ ] **Step 4: 跑测试**

Run: `cd server && npx vitest run` → Expected: PASS 全部。

- [ ] **Step 5: 提交**

```bash
git add server/src server/test/cite.test.js
git commit -m "feat(server): 文献 URL 分类、Crossref/arXiv/PubMed/generic 抓取与缓存降级"
```

---

### Task 8: 导出——ProseMirror→Markdown 序列化 + zip 下载

**Files:**
- Create: `server/src/export.js`
- Modify: `server/src/app.js`
- Test: `server/test/export.test.js`

- [ ] **Step 1: 写失败测试 `server/test/export.test.js`**

```js
import { describe, it, expect } from 'vitest'
import { pmToMarkdown } from '../src/export.js'

const P = (...inline) => ({ type: 'paragraph', content: inline })
const T = (text, ...marks) => ({ type: 'text', text, ...(marks.length ? { marks } : {}) })

describe('pmToMarkdown', () => {
  it('标题/段落/行内标记/链接', () => {
    const md = pmToMarkdown({ type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [T('实验')] },
      P(T('用 '), T('强调', { type: 'bold' }), T(' 与 '), T('代码', { type: 'code' }),
        T(' 及 '), T('链接', { type: 'link', attrs: { href: 'https://x.com' } })),
    ] })
    expect(md).toContain('## 实验')
    expect(md).toContain('**强调**')
    expect(md).toContain('`代码`')
    expect(md).toContain('[链接](https://x.com)')
  })

  it('列表（嵌套/任务）与引用块、分割线', () => {
    const md = pmToMarkdown({ type: 'doc', content: [
      { type: 'bulletList', content: [
        { type: 'listItem', content: [P(T('甲')), { type: 'bulletList', content: [
          { type: 'listItem', content: [P(T('甲一'))] }] }] },
      ] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [P(T('第一'))] }] },
      { type: 'taskList', content: [
        { type: 'taskItem', attrs: { checked: true }, content: [P(T('已做'))] },
        { type: 'taskItem', attrs: { checked: false }, content: [P(T('未做'))] },
      ] },
      { type: 'blockquote', content: [P(T('引言'))] },
      { type: 'horizontalRule' },
    ] })
    expect(md).toContain('- 甲')
    expect(md).toContain('  - 甲一')
    expect(md).toContain('1. 第一')
    expect(md).toContain('- [x] 已做')
    expect(md).toContain('- [ ] 未做')
    expect(md).toContain('> 引言')
    expect(md).toContain('---')
  })

  it('代码块/mermaid/表格/图片路径重写/引用卡片/嵌入块', () => {
    const embeds = []
    const md = pmToMarkdown({ type: 'doc', content: [
      { type: 'codeBlock', attrs: { language: 'python' }, content: [T('print(1)')] },
      { type: 'mermaidBlock', attrs: { code: 'graph TD; A-->B' } },
      { type: 'table', content: [
        { type: 'tableRow', content: [
          { type: 'tableHeader', content: [P(T('列1'))] }, { type: 'tableHeader', content: [P(T('列2'))] }] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [P(T('a'))] }, { type: 'tableCell', content: [P(T('b'))] }] },
      ] },
      P({ type: 'image', attrs: { src: '/images/2026/07/abc.png', width: 50 } }),
      { type: 'citation', attrs: { url: 'https://doi.org/10.1/x', title: 'Paper', year: '2024', venue: 'Nat.' } },
      { type: 'htmlEmbed', attrs: { html: '<div><script>x()</script></div>' } },
    ] }, { imgPrefix: '../../images/', onEmbed: html => { embeds.push(html); return `embeds/e${embeds.length}.html` } })
    expect(md).toContain('```python\nprint(1)\n```')
    expect(md).toContain('```mermaid\ngraph TD; A-->B\n```')
    expect(md).toContain('| 列1 | 列2 |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| a | b |')
    expect(md).toContain('![](../../images/2026/07/abc.png)')
    expect(md).toContain('[Paper (2024) · Nat.](https://doi.org/10.1/x)')
    expect(md).toContain('[交互内容](embeds/e1.html)')
    expect(embeds.length).toBe(1)
  })
})
```

Run: `cd server && npx vitest run test/export.test.js` → Expected: FAIL。

- [ ] **Step 2: 写 `server/src/export.js`**

```js
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
    archive.directory(imagesDir, 'images')
    archive.finalize()
    return new Response(Readable.toWeb(archive), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="parchment-export.zip"',
      },
    })
  })
}
```

- [ ] **Step 3: 接入 `server/src/app.js`**

在 `citeRoutes(...)` 之后加 `exportRoutes(app, db, imagesDir)`，头部加 `import { exportRoutes } from './export.js'`。

- [ ] **Step 4: 在 `server/test/export.test.js` 末尾追加 zip 冒烟用例**

```js
import { createDb } from '../src/db.js'
import { createApp } from '../src/app.js'

describe('GET /api/export', () => {
  it('返回 zip（PK 魔数）', async () => {
    const app = createApp({ db: createDb(':memory:'), imagesDir: '/tmp/img-test', password: 'pw' })
    const login = await app.request('/api/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'pw' }),
    })
    const cookie = login.headers.get('set-cookie').split(';')[0]
    await app.request('/api/entries', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ day: '2026-07-01', content: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello export' }] }] } }),
    })
    const res = await app.request('/api/export', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.length).toBeGreaterThan(100)
    expect(buf.subarray(0, 2).toString()).toBe('PK')
  })
})
```

- [ ] **Step 5: 跑测试**

Run: `cd server && npx vitest run` → Expected: PASS 全部。

- [ ] **Step 6: 提交**

```bash
git add server/src server/test/export.test.js
git commit -m "feat(server): Markdown 序列化与 zip 全量导出"
```

---

### Task 9: 前端脚手架 + API 客户端 + 登录 + 基础样式

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/test/setup.ts`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/api.ts`, `web/src/saveStatus.ts`, `web/src/components/Login.tsx`, `web/src/components/SaveDot.tsx`, `web/src/styles.css`
- Test: `web/test/api.test.ts`, `web/test/saveStatus.test.ts`

- [ ] **Step 1: 写配置文件**

`web/package.json`：

```json
{
  "name": "parchment-web",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@tiptap/core": "^2.26.0",
    "@tiptap/extension-code-block-lowlight": "^2.26.0",
    "@tiptap/extension-highlight": "^2.26.0",
    "@tiptap/extension-image": "^2.26.0",
    "@tiptap/extension-link": "^2.26.0",
    "@tiptap/extension-mathematics": "^2.26.0",
    "@tiptap/extension-placeholder": "^2.26.0",
    "@tiptap/extension-table": "^2.26.0",
    "@tiptap/extension-table-cell": "^2.26.0",
    "@tiptap/extension-table-header": "^2.26.0",
    "@tiptap/extension-table-row": "^2.26.0",
    "@tiptap/extension-task-item": "^2.26.0",
    "@tiptap/extension-task-list": "^2.26.0",
    "@tiptap/pm": "^2.26.0",
    "@tiptap/react": "^2.26.0",
    "@tiptap/starter-kit": "^2.26.0",
    "katex": "^0.16.11",
    "lowlight": "^3.1.0",
    "mermaid": "^11.4.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.3",
    "vite": "^5.4.11",
    "vitest": "^2.1.8"
  }
}
```

`web/vite.config.ts`：

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/images': 'http://localhost:8787',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './test/setup.ts',
  },
})
```

`web/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "test"]
}
```

`web/test/setup.ts`：

```ts
import '@testing-library/jest-dom'
```

`web/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Parchment</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: 安装依赖**

Run: `cd web && npm install` → Expected: 无报错。

- [ ] **Step 3: 写失败测试 `web/test/api.test.ts` 与 `web/test/saveStatus.test.ts`**

`web/test/api.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api, onUnauthorized } from '../src/api'

beforeEach(() => onUnauthorized.clear())

describe('api client', () => {
  it('成功返回 JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ a: 1 }))))
    expect(await api('/api/x')).toEqual({ a: 1 })
  })

  it('401 触发 onUnauthorized 回调并抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    const cb = vi.fn()
    onUnauthorized.add(cb)
    await expect(api('/api/x')).rejects.toMatchObject({ status: 401 })
    expect(cb).toHaveBeenCalled()
  })

  it('非 2xx 抛 ApiError 携带 status 与 body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ conflict: true, version: 3 }), { status: 409 })))
    await expect(api('/api/x')).rejects.toMatchObject({ status: 409, body: { conflict: true, version: 3 } })
  })
})
```

`web/test/saveStatus.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { setSaveStatus, worstStatus } from '../src/saveStatus'

describe('saveStatus', () => {
  it('取最严重状态：conflict > offline > saving > saved', () => {
    setSaveStatus('a', 'saved')
    expect(worstStatus()).toBe('saved')
    setSaveStatus('b', 'saving')
    expect(worstStatus()).toBe('saving')
    setSaveStatus('c', 'offline')
    expect(worstStatus()).toBe('offline')
    setSaveStatus('d', 'conflict')
    expect(worstStatus()).toBe('conflict')
    setSaveStatus('d', null)
    setSaveStatus('c', null)
    expect(worstStatus()).toBe('saving')
  })
})
```

Run: `cd web && npx vitest run` → Expected: FAIL。

- [ ] **Step 4: 写 `web/src/api.ts`**

```ts
export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`api ${status}`)
  }
}

export const onUnauthorized = new Set<() => void>()

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (res.status === 401) {
    onUnauthorized.forEach(f => f())
    throw new ApiError(401, null)
  }
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null))
  return res.json() as Promise<T>
}

export async function uploadImage(file: File): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/images', { method: 'POST', body: fd })
  if (res.status === 401) { onUnauthorized.forEach(f => f()); throw new ApiError(401, null) }
  if (!res.ok) throw new ApiError(res.status, null)
  return (await res.json()).url
}
```

- [ ] **Step 5: 写 `web/src/saveStatus.ts`**

```ts
import { useSyncExternalStore } from 'react'

export type SaveState = 'saved' | 'saving' | 'offline' | 'conflict'
const RANK: SaveState[] = ['saved', 'saving', 'offline', 'conflict']

const statuses = new Map<string, SaveState>()
const subs = new Set<() => void>()

export function setSaveStatus(id: string, s: SaveState | null) {
  if (s === null) statuses.delete(id)
  else statuses.set(id, s)
  subs.forEach(f => f())
}

export function worstStatus(): SaveState {
  let worst: SaveState = 'saved'
  for (const s of statuses.values()) {
    if (RANK.indexOf(s) > RANK.indexOf(worst)) worst = s
  }
  return worst
}

export function useGlobalSaveStatus(): SaveState {
  return useSyncExternalStore(
    cb => { subs.add(cb); return () => subs.delete(cb) },
    worstStatus,
  )
}
```

- [ ] **Step 6: 写壳组件**

`web/src/components/SaveDot.tsx`：

```tsx
import { useGlobalSaveStatus } from '../saveStatus'

const LABEL = { saved: '已保存', saving: '保存中…', offline: '离线，改动已缓存', conflict: '有冲突，请刷新' }

export function SaveDot() {
  const s = useGlobalSaveStatus()
  return <span className={`save-dot save-${s}`} title={LABEL[s]} />
}
```

`web/src/components/Login.tsx`：

```tsx
import { useState } from 'react'
import { api } from '../api'

export function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ password: pw }) })
      onDone()
    } catch {
      setErr(true)
    }
  }
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>Parchment</h1>
        <input
          type="password" autoFocus value={pw} placeholder="访问密码"
          onChange={e => { setPw(e.target.value); setErr(false) }}
        />
        {err && <p className="login-err">密码不对</p>}
        <button type="submit">进入</button>
      </form>
    </div>
  )
}
```

`web/src/App.tsx`（本任务先立骨架，Timeline 等后续任务填充）：

```tsx
import { useEffect, useState } from 'react'
import { api, onUnauthorized } from './api'
import { Login } from './components/Login'
import { SaveDot } from './components/SaveDot'

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    const kick = () => setAuthed(false)
    onUnauthorized.add(kick)
    api('/api/projects').then(() => setAuthed(true)).catch(() => {})
    return () => { onUnauthorized.delete(kick) }
  }, [])

  if (authed === null) return null
  if (!authed) return <Login onDone={() => setAuthed(true)} />
  return (
    <div className="app">
      <header className="topbar"><SaveDot /></header>
      <main className="main">{/* Timeline 于 Task 11 接入 */}</main>
    </div>
  )
}
```

`web/src/main.tsx`：

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

const saved = localStorage.getItem('theme')
if (saved) document.documentElement.dataset.theme = saved

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
)
```

- [ ] **Step 7: 写 `web/src/styles.css`（排版即美的底座，后续任务只增不改）**

```css
:root {
  --bg: #faf9f6; --fg: #1a1a18; --muted: #8a877e; --card: #ffffff;
  --border: #e8e5dd; --accent: #4a7dbd; --danger: #c04d3f;
  --shadow: 0 1px 3px rgba(30, 25, 10, 0.06);
  --serif: "Iowan Old Style", "Source Han Serif SC", Georgia, "Songti SC", serif;
  --sans: -apple-system, "PingFang SC", "Source Han Sans SC", "Segoe UI", "Microsoft YaHei", sans-serif;
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
}
[data-theme="dark"] {
  --bg: #191917; --fg: #e6e4de; --muted: #85817a; --card: #22221f;
  --border: #33322d; --accent: #7aa5d8; --danger: #d97b6c;
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #191917; --fg: #e6e4de; --muted: #85817a; --card: #22221f;
    --border: #33322d; --accent: #7aa5d8; --danger: #d97b6c;
    --shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  }
}

* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  background: var(--bg); color: var(--fg);
  font-family: var(--sans); font-size: 16px; line-height: 1.75;
  -webkit-font-smoothing: antialiased;
}

.app { display: flex; flex-direction: column; height: 100%; }
.topbar {
  display: flex; align-items: center; justify-content: flex-end; gap: 12px;
  padding: 8px 16px; border-bottom: 1px solid var(--border);
}
.main { flex: 1; display: flex; min-height: 0; }

.save-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; transition: background 0.3s; }
.save-saved { background: #7bb26a; }
.save-saving { background: #d9a13b; }
.save-offline { background: var(--muted); }
.save-conflict { background: var(--danger); }

.login-wrap { height: 100%; display: grid; place-items: center; }
.login-card {
  background: var(--card); border: 1px solid var(--border); border-radius: 14px;
  padding: 36px 40px; display: flex; flex-direction: column; gap: 14px;
  width: min(320px, 90vw); box-shadow: var(--shadow);
}
.login-card h1 { margin: 0 0 6px; font-family: var(--serif); font-size: 26px; text-align: center; }
.login-card input {
  font-size: 16px; padding: 9px 12px; border: 1px solid var(--border);
  border-radius: 8px; background: var(--bg); color: var(--fg);
}
.login-card button {
  font-size: 15px; padding: 9px; border: none; border-radius: 8px;
  background: var(--accent); color: #fff; cursor: pointer;
}
.login-err { color: var(--danger); margin: 0; font-size: 13px; }
```

- [ ] **Step 8: 跑测试**

Run: `cd web && npx vitest run` → Expected: PASS 全部。

- [ ] **Step 9:【人工验证】**

启动双终端（见全局执行说明），浏览器开 Vite 地址：出现登录卡片；输错密码得到提示；输 `dev` 进入空壳页（右上角绿色小圆点）。

- [ ] **Step 10: 提交**

```bash
git add web
git commit -m "feat(web): 脚手架、API 客户端、登录与保存状态底座"
```

---

### Task 10: 编辑器核心 + EntryCard + 自动保存

**Files:**
- Create: `web/src/editor/extensions.ts`, `web/src/hooks/useAutosave.ts`, `web/src/components/EntryCard.tsx`
- Modify: `web/src/styles.css`（追加编辑器样式）
- Test: `web/test/useAutosave.test.ts`, `web/test/editor.test.ts`

- [ ] **Step 1: 写失败测试 `web/test/useAutosave.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../src/api', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public body: unknown) { super(`api ${status}`) }
  },
}))
import { api } from '../src/api'
import { useAutosave } from '../src/hooks/useAutosave'

const mockApi = api as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  mockApi.mockReset()
})
afterEach(() => vi.useRealTimers())

const DOC = { type: 'doc', content: [] }

function hook(over: Partial<Parameters<typeof useAutosave>[0]> = {}) {
  return renderHook(() => useAutosave({
    entryId: 'e1', day: '2026-07-28', version: 0, draftKey: 'e1',
    getPayload: () => ({ content: DOC }),
    ...over,
  }))
}

describe('useAutosave', () => {
  it('防抖：连续 schedule 只发一次 PATCH，成功后清 draft、版本更新', async () => {
    mockApi.mockResolvedValue({ id: 'e1', version: 1 })
    const { result } = hook()
    act(() => { result.current.schedule(); result.current.schedule(); result.current.schedule() })
    expect(localStorage.getItem('draft:e1')).toBeTruthy()
    await act(() => vi.advanceTimersByTimeAsync(1100))
    expect(mockApi).toHaveBeenCalledTimes(1)
    expect(mockApi.mock.calls[0][0]).toBe('/api/entries/e1')
    expect(JSON.parse((mockApi.mock.calls[0][1] as RequestInit).body as string).version).toBe(0)
    expect(localStorage.getItem('draft:e1')).toBeNull()
    expect(result.current.status).toBe('saved')
    // 第二次保存携带新版本号
    mockApi.mockResolvedValue({ id: 'e1', version: 2 })
    act(() => result.current.schedule())
    await act(() => vi.advanceTimersByTimeAsync(1100))
    expect(JSON.parse((mockApi.mock.calls[1][1] as RequestInit).body as string).version).toBe(1)
  })

  it('网络失败：status=offline、draft 保留、退避后自动重试成功', async () => {
    mockApi.mockRejectedValueOnce(new TypeError('fetch failed'))
    mockApi.mockResolvedValueOnce({ id: 'e1', version: 1 })
    const { result } = hook()
    act(() => result.current.schedule())
    await act(() => vi.advanceTimersByTimeAsync(1100))
    expect(result.current.status).toBe('offline')
    expect(localStorage.getItem('draft:e1')).toBeTruthy()
    await act(() => vi.advanceTimersByTimeAsync(2100))
    expect(mockApi).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('saved')
  })

  it('409 → conflict，不再重试', async () => {
    const { ApiError } = await import('../src/api')
    mockApi.mockRejectedValue(new ApiError(409, { version: 5 }))
    const { result } = hook()
    act(() => result.current.schedule())
    await act(() => vi.advanceTimersByTimeAsync(1100))
    expect(result.current.status).toBe('conflict')
    await act(() => vi.advanceTimersByTimeAsync(60000))
    expect(mockApi).toHaveBeenCalledTimes(1)
  })

  it('entryId 为空：先 POST 创建并回调 onCreated，之后走 PATCH', async () => {
    mockApi.mockResolvedValueOnce({ id: 'new-id', version: 0, day: '2026-07-28' })
    mockApi.mockResolvedValueOnce({ id: 'new-id', version: 1 })
    const created = vi.fn()
    const { result } = hook({ entryId: null, draftKey: 'new:x', onCreated: created })
    act(() => result.current.schedule())
    await act(() => vi.advanceTimersByTimeAsync(1100))
    expect(mockApi.mock.calls[0][0]).toBe('/api/entries')
    expect((mockApi.mock.calls[0][1] as RequestInit).method).toBe('POST')
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-id' }))
    act(() => result.current.schedule())
    await act(() => vi.advanceTimersByTimeAsync(1100))
    expect(mockApi.mock.calls[1][0]).toBe('/api/entries/new-id')
  })

  it('挂载时已有 draft → 自动补发一次保存', async () => {
    localStorage.setItem('draft:e1', JSON.stringify({ at: 1, payload: { content: DOC } }))
    mockApi.mockResolvedValue({ id: 'e1', version: 1 })
    hook()
    await act(() => vi.advanceTimersByTimeAsync(1100))
    expect(mockApi).toHaveBeenCalledTimes(1)
  })
})
```

Run: `cd web && npx vitest run test/useAutosave.test.ts` → Expected: FAIL。

- [ ] **Step 2: 写 `web/src/hooks/useAutosave.ts`**

```ts
import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { setSaveStatus, type SaveState } from '../saveStatus'

export interface EntryData {
  id: string; day: string; position: number; version: number
  content: unknown; created_at: string; updated_at: string
  tags: { id: string; name: string; color: string }[]
}

interface Opts {
  entryId: string | null
  day: string
  version: number
  draftKey: string
  getPayload: () => { content?: unknown; tags?: string[] }
  onCreated?: (e: EntryData) => void
  onSaved?: (e: EntryData) => void
}

const DEBOUNCE_MS = 1000
const RETRY_BASE_MS = 2000
const RETRY_MAX_MS = 30000

export function useAutosave(opts: Opts) {
  const idRef = useRef(opts.entryId)
  const versionRef = useRef(opts.version)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const retryMs = useRef(RETRY_BASE_MS)
  const creating = useRef(false)
  const again = useRef(false)
  const [status, setLocal] = useState<SaveState>('saved')
  const optsRef = useRef(opts)
  optsRef.current = opts

  const key = `draft:${opts.draftKey}`

  function setStatus(s: SaveState) {
    setLocal(s)
    setSaveStatus(optsRef.current.draftKey, s === 'saved' ? null : s)
  }

  async function save() {
    const payload = optsRef.current.getPayload()
    if (!idRef.current) {
      if (creating.current) { again.current = true; return }
      creating.current = true
      try {
        const e = await api<EntryData>('/api/entries', {
          method: 'POST',
          body: JSON.stringify({ day: optsRef.current.day, ...payload }),
        })
        idRef.current = e.id
        versionRef.current = e.version
        localStorage.removeItem(key)
        retryMs.current = RETRY_BASE_MS
        setStatus('saved')
        optsRef.current.onCreated?.(e)
        if (again.current) { again.current = false; void save() }
      } catch (err) {
        handleErr(err)
      } finally {
        creating.current = false
      }
      return
    }
    try {
      const e = await api<EntryData>(`/api/entries/${idRef.current}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...payload, version: versionRef.current }),
      })
      versionRef.current = e.version
      localStorage.removeItem(key)
      retryMs.current = RETRY_BASE_MS
      setStatus('saved')
      optsRef.current.onSaved?.(e)
    } catch (err) {
      handleErr(err)
    }
  }

  function handleErr(err: unknown) {
    if (err instanceof ApiError && err.status === 409) {
      setStatus('conflict')   // 停止重试，等用户刷新
      return
    }
    setStatus('offline')
    clearTimeout(timer.current)
    timer.current = setTimeout(save, retryMs.current)
    retryMs.current = Math.min(retryMs.current * 2, RETRY_MAX_MS)
  }

  function schedule() {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), payload: optsRef.current.getPayload() }))
    setStatus('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(save, DEBOUNCE_MS)
  }

  useEffect(() => {
    if (localStorage.getItem(key)) schedule()   // 上次断网留下的草稿，补发
    return () => {
      clearTimeout(timer.current)
      setSaveStatus(optsRef.current.draftKey, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { status, schedule, flush: save, entryIdRef: idRef }
}
```

- [ ] **Step 3: 跑 useAutosave 测试**

Run: `cd web && npx vitest run test/useAutosave.test.ts` → Expected: PASS。

- [ ] **Step 4: 写失败测试 `web/test/editor.test.ts`（扩展装配冒烟）**

```ts
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/editor/extensions'

describe('buildExtensions', () => {
  it('能创建编辑器并回读 JSON/文本，粗体命令可用', () => {
    const ed = new Editor({
      extensions: buildExtensions({ placeholder: '记点什么…' }),
      content: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: '你好实验' }] }] },
    })
    expect(ed.getText()).toContain('你好实验')
    ed.commands.selectAll()
    ed.commands.toggleBold()
    const json = ed.getJSON()
    expect(JSON.stringify(json)).toContain('bold')
    ed.destroy()
  })

  it('包含表格/任务清单/代码高亮/数学扩展', () => {
    const names = buildExtensions({}).map(e => e.name)
    for (const n of ['table', 'taskList', 'codeBlockLowlight', 'mathematics']) {
      expect(names).toContain(n)
    }
  })
})
```

Run: `cd web && npx vitest run test/editor.test.ts` → Expected: FAIL。

- [ ] **Step 5: 写 `web/src/editor/extensions.ts`**

```ts
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { Mathematics } from '@tiptap/extension-mathematics'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import 'katex/dist/katex.min.css'

const lowlight = createLowlight(common)

export interface ExtensionOpts {
  placeholder?: string
}

// 后续任务在此追加：Hashtag(T12)、ResizableImage(T15)、Citation(T16)、HtmlEmbed+pasteRules(T17)、Mermaid(T18)
export function buildExtensions(opts: ExtensionOpts) {
  return [
    StarterKit.configure({ codeBlock: false, heading: { levels: [1, 2, 3] } }),
    CodeBlockLowlight.configure({ lowlight }),
    Placeholder.configure({ placeholder: opts.placeholder ?? '写点什么… # 打项目标签' }),
    Link.configure({ autolink: true, openOnClick: false }),
    Highlight,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Mathematics,
  ]
}
```

- [ ] **Step 6: 跑 editor 测试**

Run: `cd web && npx vitest run test/editor.test.ts` → Expected: PASS。若 `mathematics` 名不匹配，用 `console.log(names)` 查实际注册名并修正断言（不同小版本可能叫 `mathematics` 或 `Mathematics`）。

- [ ] **Step 7: 写 `web/src/components/EntryCard.tsx`**

```tsx
import { useMemo, useRef } from 'react'
import { EditorContent, useEditor, BubbleMenu, FloatingMenu } from '@tiptap/react'
import { buildExtensions } from '../editor/extensions'
import { useAutosave, type EntryData } from '../hooks/useAutosave'
import { api } from '../api'

const EMPTY_DOC = { type: 'doc', content: [] }

export function EntryCard({ entry, day, draftKey, onCreated, onDeleted, onMove }: {
  entry: EntryData | null      // null = 尚未落库的新条目
  day: string
  draftKey: string
  onCreated?: (e: EntryData) => void
  onDeleted?: (id: string) => void
  onMove?: (id: string, dir: -1 | 1) => void
}) {
  // 断网草稿优先于服务器内容
  const initialContent = useMemo(() => {
    try {
      const d = localStorage.getItem(`draft:${draftKey}`)
      if (d) return JSON.parse(d).payload.content ?? entry?.content ?? EMPTY_DOC
    } catch { /* 草稿损坏则忽略 */ }
    return entry?.content ?? EMPTY_DOC
  }, [draftKey])   // eslint-disable-line react-hooks/exhaustive-deps

  const editorRef = useRef<ReturnType<typeof useEditor>>(null)
  const autosave = useAutosave({
    entryId: entry?.id ?? null,
    day,
    version: entry?.version ?? 0,
    draftKey,
    getPayload: () => ({ content: editorRef.current?.getJSON() ?? EMPTY_DOC }),
    onCreated,
  })

  const editor = useEditor({
    extensions: buildExtensions({}),
    content: initialContent,
    onUpdate: () => autosave.schedule(),
  })
  // @ts-expect-error 写入 ref 供 getPayload 读取
  editorRef.current = editor

  async function remove() {
    const id = autosave.entryIdRef.current
    if (!id) return
    if (!window.confirm('删除这个条目？')) return
    await api(`/api/entries/${id}`, { method: 'DELETE' })
    onDeleted?.(id)
  }

  const id = autosave.entryIdRef.current
  return (
    <article className="entry-card" data-entry-id={id ?? ''}>
      <div className="entry-head">
        <span className="entry-time">{entry ? entry.created_at.slice(11, 16) : ''}</span>
        <span className="entry-actions">
          {id && onMove && <>
            <button className="icon-btn" title="上移" onClick={() => onMove(id, -1)}>↑</button>
            <button className="icon-btn" title="下移" onClick={() => onMove(id, 1)}>↓</button>
          </>}
          {id && <button className="icon-btn" title="删除" onClick={remove}>×</button>}
        </span>
      </div>
      {editor && <BubbleMenu editor={editor} tippyOptions={{ duration: 120 }}>
        <div className="menu-bar">
          <button className={editor.isActive('bold') ? 'on' : ''}
            onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
          <button className={editor.isActive('italic') ? 'on' : ''}
            onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
          <button className={editor.isActive('code') ? 'on' : ''}
            onClick={() => editor.chain().focus().toggleCode().run()}>{'<>'}</button>
          <button className={editor.isActive('highlight') ? 'on' : ''}
            onClick={() => editor.chain().focus().toggleHighlight().run()}>H</button>
          <button onClick={() => {
            const url = window.prompt('链接地址')
            if (url) editor.chain().focus().setLink({ href: url }).run()
          }}>🔗</button>
        </div>
      </BubbleMenu>}
      {editor && <FloatingMenu editor={editor} tippyOptions={{ duration: 120 }}>
        <div className="menu-bar">
          <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
          <button onClick={() => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()}>表格</button>
          <button onClick={() => editor.chain().focus().toggleCodeBlock().run()}>代码</button>
          <button onClick={() => editor.chain().focus().toggleTaskList().run()}>待办</button>
          {/* 图片(T15)、引用(T16)、嵌入(T17)、流程图(T18) 按钮在后续任务追加 */}
        </div>
      </FloatingMenu>}
      <EditorContent editor={editor} />
    </article>
  )
}
```

- [ ] **Step 8: `web/src/styles.css` 末尾追加编辑器与卡片样式**

```css
/* ---------- 条目卡片与编辑器 ---------- */
.entry-card {
  background: var(--card); border: 1px solid var(--border); border-radius: 12px;
  padding: 10px 18px 14px; margin: 10px 0; box-shadow: var(--shadow);
  transition: border-color 0.2s;
}
.entry-card:focus-within { border-color: var(--accent); }
.entry-head {
  display: flex; justify-content: space-between; align-items: center;
  min-height: 22px; font-size: 12px; color: var(--muted);
}
.entry-actions { opacity: 0; transition: opacity 0.15s; display: flex; gap: 2px; }
.entry-card:hover .entry-actions { opacity: 1; }
.icon-btn {
  border: none; background: none; color: var(--muted); cursor: pointer;
  font-size: 14px; padding: 2px 6px; border-radius: 6px;
}
.icon-btn:hover { background: var(--border); color: var(--fg); }

.menu-bar {
  display: flex; gap: 2px; background: var(--card); border: 1px solid var(--border);
  border-radius: 8px; padding: 3px; box-shadow: var(--shadow);
}
.menu-bar button {
  border: none; background: none; color: var(--fg); cursor: pointer;
  font-size: 13px; padding: 4px 8px; border-radius: 6px; white-space: nowrap;
}
.menu-bar button:hover { background: var(--border); }
.menu-bar button.on { background: var(--accent); color: #fff; }

.ProseMirror { outline: none; min-height: 28px; }
.ProseMirror p { margin: 0.4em 0; }
.ProseMirror h1, .ProseMirror h2, .ProseMirror h3 {
  font-family: var(--serif); line-height: 1.35; margin: 0.8em 0 0.3em;
}
.ProseMirror h1 { font-size: 1.5em; } .ProseMirror h2 { font-size: 1.3em; } .ProseMirror h3 { font-size: 1.12em; }
.ProseMirror code {
  font-family: var(--mono); font-size: 0.88em; background: var(--border);
  padding: 0.1em 0.35em; border-radius: 4px;
}
.ProseMirror pre {
  font-family: var(--mono); font-size: 0.85em; background: var(--bg);
  border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; overflow-x: auto;
}
.ProseMirror pre code { background: none; padding: 0; }
.ProseMirror blockquote {
  border-left: 3px solid var(--accent); margin: 0.5em 0; padding: 0.1em 0 0.1em 1em; color: var(--muted);
}
.ProseMirror mark { background: #f5e07a; border-radius: 2px; padding: 0 2px; }
.ProseMirror img { max-width: 100%; border-radius: 8px; }
.ProseMirror a { color: var(--accent); }
.ProseMirror table { border-collapse: collapse; margin: 0.6em 0; width: 100%; }
.ProseMirror th, .ProseMirror td { border: 1px solid var(--border); padding: 5px 10px; }
.ProseMirror th { background: var(--bg); font-weight: 600; }
.ProseMirror ul[data-type="taskList"] { list-style: none; padding-left: 0.2em; }
.ProseMirror ul[data-type="taskList"] li { display: flex; gap: 8px; }
.ProseMirror .is-editor-empty:first-child::before {
  content: attr(data-placeholder); color: var(--muted); float: left; height: 0; pointer-events: none;
}
```

- [ ] **Step 9: 临时接线到 App 以便人工验证**

`web/src/App.tsx` 中把 `{/* Timeline 于 Task 11 接入 */}` 替换为：

```tsx
<div style={{ maxWidth: 720, margin: '0 auto', padding: 16, width: '100%' }}>
  <EntryCard entry={null} day={new Date().toISOString().slice(0, 10)} draftKey="scratch" />
</div>
```

头部加 `import { EntryCard } from './components/EntryCard'`。（Task 11 会用 Timeline 整体替换。）

- [ ] **Step 10:【人工验证】**

浏览器中：打字出现内容；`## ` 变标题、`- ` 变列表、`**粗**` 变粗体、`` ` `` 变行内代码、```py 变代码块、`$E=mc^2$` 渲染公式；选中文字浮出格式条；空行浮出插入条（表格/代码/待办可插入）；停笔 1 秒右上角圆点由黄转绿；刷新页面内容还在（自动落库）；断开后端（Ctrl+C server）再打字→圆点变灰，重启后端→自动补存转绿。

- [ ] **Step 11: 全部测试再确认**

Run: `cd web && npx vitest run` → Expected: PASS。

- [ ] **Step 12: 提交**

```bash
git add web/src web/test
git commit -m "feat(web): TipTap 编辑器核心、条目卡片与断网安全的自动保存"
```

---

### Task 11: 时间流视图（聊天式布局 + 双向加载 + 今日撰写）

**Files:**
- Create: `web/src/lib/groupDays.ts`, `web/src/hooks/useTimeline.ts`, `web/src/components/Timeline.tsx`
- Modify: `web/src/App.tsx`, `web/src/styles.css`
- Test: `web/test/groupDays.test.ts`, `web/test/useTimeline.test.ts`

- [ ] **Step 1: 写失败测试 `web/test/groupDays.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { mergeDays, nextDay, todayStr } from '../src/lib/groupDays'

const g = (day: string, ...ids: string[]) =>
  ({ day, entries: ids.map(id => ({ id, day, position: 0, version: 0, content: {}, created_at: '', updated_at: '', tags: [] })) })

describe('groupDays', () => {
  it('mergeDays：按天合并、条目去重、升序输出', () => {
    const out = mergeDays([g('2026-07-02', 'a')], [g('2026-07-01', 'b'), g('2026-07-02', 'a', 'c')])
    expect(out.map(d => d.day)).toEqual(['2026-07-01', '2026-07-02'])
    expect(out[1].entries.map(e => e.id)).toEqual(['a', 'c'])
  })
  it('nextDay 跨月跨年', () => {
    expect(nextDay('2026-07-31')).toBe('2026-08-01')
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
  })
  it('todayStr 是 YYYY-MM-DD', () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
```

Run: `cd web && npx vitest run test/groupDays.test.ts` → Expected: FAIL。

- [ ] **Step 2: 写 `web/src/lib/groupDays.ts`**

```ts
import type { EntryData } from '../hooks/useAutosave'

export interface DayGroup { day: string; entries: EntryData[] }

export function mergeDays(existing: DayGroup[], incoming: DayGroup[]): DayGroup[] {
  const map = new Map(existing.map(d => [d.day, d]))
  for (const d of incoming) {
    const cur = map.get(d.day)
    if (!cur) { map.set(d.day, d); continue }
    const ids = new Set(cur.entries.map(e => e.id))
    map.set(d.day, { day: d.day, entries: [...cur.entries, ...d.entries.filter(e => !ids.has(e.id))] })
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day))
}

export function nextDay(day: string): string {
  const d = new Date(day + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fmtDay(day: string): string {
  const d = new Date(day + 'T00:00:00')
  const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日 · 周${wd}${day === todayStr() ? ' · 今天' : ''}`
}
```

- [ ] **Step 3: 写失败测试 `web/test/useTimeline.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

vi.mock('../src/api', () => ({ api: vi.fn() }))
import { api } from '../src/api'
import { useTimeline } from '../src/hooks/useTimeline'

const mockApi = api as ReturnType<typeof vi.fn>
const entry = (id: string, day: string, position = 0) =>
  ({ id, day, position, version: 0, content: {}, created_at: '2026-07-28T09:00:00Z', updated_at: '', tags: [] })
const resp = (days: [string, string[]][]) => ({
  days: days.map(([day, ids]) => ({ day, entries: ids.map(id => entry(id, day)) })),
  nextBefore: days.length ? days[days.length - 1][0] : null,
  nextAfter: days.length ? days[0][0] : null,
})

beforeEach(() => mockApi.mockReset())

describe('useTimeline', () => {
  it('初始加载：天升序存放', async () => {
    mockApi.mockResolvedValueOnce(resp([['2026-07-28', ['b']], ['2026-07-27', ['a']]]))
    const { result } = renderHook(() => useTimeline(null, null))
    await waitFor(() => expect(result.current.days.length).toBe(2))
    expect(result.current.days.map(d => d.day)).toEqual(['2026-07-27', '2026-07-28'])
  })

  it('loadOlder 合并到头部并去重；空响应后 hasOlder=false', async () => {
    mockApi.mockResolvedValueOnce(resp([['2026-07-28', ['b']]]))
    const { result } = renderHook(() => useTimeline(null, null))
    await waitFor(() => expect(result.current.days.length).toBe(1))
    mockApi.mockResolvedValueOnce(resp([['2026-07-27', ['a']]]))
    await act(() => result.current.loadOlder())
    expect(result.current.days.map(d => d.day)).toEqual(['2026-07-27', '2026-07-28'])
    expect(mockApi.mock.calls[1][0]).toContain('before=2026-07-27'.replace('27', '27'))
    mockApi.mockResolvedValueOnce(resp([]))
    await act(() => result.current.loadOlder())
    expect(result.current.hasOlder).toBe(false)
  })

  it('anchor 模式：before=次日 使锚点当天被包含，hasNewer=true，loadNewer 追加', async () => {
    mockApi.mockResolvedValueOnce(resp([['2026-03-12', ['x']]]))
    const { result } = renderHook(() => useTimeline(null, '2026-03-12'))
    await waitFor(() => expect(result.current.days.length).toBe(1))
    expect(mockApi.mock.calls[0][0]).toContain('before=2026-03-13')
    expect(result.current.hasNewer).toBe(true)
    mockApi.mockResolvedValueOnce(resp([['2026-03-14', ['y']]]))
    await act(() => result.current.loadNewer())
    expect(result.current.days.map(d => d.day)).toEqual(['2026-03-12', '2026-03-14'])
    expect(mockApi.mock.calls[1][0]).toContain('after=2026-03-12')
  })

  it('project 过滤透传参数', async () => {
    mockApi.mockResolvedValueOnce(resp([]))
    renderHook(() => useTimeline('p1', null))
    await waitFor(() => expect(mockApi).toHaveBeenCalled())
    expect(mockApi.mock.calls[0][0]).toContain('project=p1')
  })

  it('applyEntry 按 position 重排；removeEntry 删除', async () => {
    mockApi.mockResolvedValueOnce(resp([['2026-07-28', ['a', 'b']]]))
    const { result } = renderHook(() => useTimeline(null, null))
    await waitFor(() => expect(result.current.days.length).toBe(1))
    act(() => result.current.applyEntry({ ...entry('a', '2026-07-28', 9), version: 1 }))
    expect(result.current.days[0].entries.map(e => e.id)).toEqual(['b', 'a'])
    act(() => result.current.removeEntry('b'))
    expect(result.current.days[0].entries.map(e => e.id)).toEqual(['a'])
  })
})
```

Run: `cd web && npx vitest run test/useTimeline.test.ts` → Expected: FAIL。

- [ ] **Step 4: 写 `web/src/hooks/useTimeline.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { mergeDays, nextDay, todayStr, type DayGroup } from '../lib/groupDays'
import type { EntryData } from './useAutosave'

interface ListResp { days: DayGroup[]; nextBefore: string | null; nextAfter: string | null }

function qs(params: Record<string, string | undefined>) {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v)
  return u.toString()
}

export function useTimeline(project: string | null, anchor: string | null) {
  const [days, setDays] = useState<DayGroup[]>([])
  const [hasOlder, setHasOlder] = useState(true)
  const [hasNewer, setHasNewer] = useState(false)
  const [ready, setReady] = useState(false)
  const loading = useRef(false)

  useEffect(() => {
    let alive = true
    setDays([]); setReady(false); setHasOlder(true)
    setHasNewer(Boolean(anchor && anchor < todayStr()))
    const params = anchor
      ? { before: nextDay(anchor), limit: '10', project: project ?? undefined }
      : { limit: '10', project: project ?? undefined }
    api<ListResp>(`/api/entries?${qs(params)}`).then(r => {
      if (!alive) return
      setDays(mergeDays([], r.days))
      if (!r.days.length) setHasOlder(false)
      setReady(true)
    }).catch(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [project, anchor])

  const loadOlder = useCallback(async () => {
    if (loading.current || !hasOlder || !days.length) return
    loading.current = true
    try {
      const r = await api<ListResp>(`/api/entries?${qs({
        before: days[0].day, limit: '10', project: project ?? undefined })}`)
      if (!r.days.length) setHasOlder(false)
      setDays(cur => mergeDays(cur, r.days))
    } finally { loading.current = false }
  }, [days, hasOlder, project])

  const loadNewer = useCallback(async () => {
    if (loading.current || !hasNewer || !days.length) return
    loading.current = true
    try {
      const r = await api<ListResp>(`/api/entries?${qs({
        after: days[days.length - 1].day, limit: '10', project: project ?? undefined })}`)
      if (!r.days.length) setHasNewer(false)
      setDays(cur => mergeDays(cur, r.days))
    } finally { loading.current = false }
  }, [days, hasNewer, project])

  const applyEntry = useCallback((e: EntryData) => {
    setDays(cur => cur.map(d => d.day !== e.day ? d : {
      day: d.day,
      entries: d.entries.map(x => x.id === e.id ? e : x)
        .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at)),
    }))
  }, [])

  const removeEntry = useCallback((id: string) => {
    setDays(cur => cur.map(d => ({ ...d, entries: d.entries.filter(e => e.id !== id) }))
      .filter(d => d.entries.length > 0))
  }, [])

  return { days, ready, hasOlder, hasNewer, loadOlder, loadNewer, applyEntry, removeEntry }
}
```

- [ ] **Step 5: 跑 hook 测试**

Run: `cd web && npx vitest run test/useTimeline.test.ts test/groupDays.test.ts` → Expected: PASS。

- [ ] **Step 6: 写 `web/src/components/Timeline.tsx`**

```tsx
import { useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api'
import { fmtDay, todayStr } from '../lib/groupDays'
import { useTimeline } from '../hooks/useTimeline'
import type { EntryData } from '../hooks/useAutosave'
import { EntryCard } from './EntryCard'

export function Timeline({ project, anchor, onExitAnchor }: {
  project: string | null
  anchor: string | null
  onExitAnchor: () => void
}) {
  const t = useTimeline(project, anchor)
  const boxRef = useRef<HTMLDivElement>(null)
  const topSentinel = useRef<HTMLDivElement>(null)
  const [composers, setComposers] = useState<string[]>(() => [crypto.randomUUID()])
  const [awayFromBottom, setAway] = useState(false)
  const didInitScroll = useRef(false)

  // 首次加载后定位：锚点日或底部（今天）
  useLayoutEffect(() => {
    if (!t.ready || didInitScroll.current) return
    didInitScroll.current = true
    const el = boxRef.current!
    if (anchor) {
      el.querySelector(`[data-day="${anchor}"]`)?.scrollIntoView()
    } else {
      el.scrollTop = el.scrollHeight
    }
  }, [t.ready, anchor])
  useLayoutEffect(() => { didInitScroll.current = false }, [project, anchor])

  // 顶部哨兵：上翻加载更早，且保持视口不跳
  useLayoutEffect(() => {
    const el = boxRef.current, s = topSentinel.current
    if (!el || !s) return
    const io = new IntersectionObserver(async ents => {
      if (!ents[0].isIntersecting || !t.ready) return
      const h = el.scrollHeight
      await t.loadOlder()
      requestAnimationFrame(() => { el.scrollTop += el.scrollHeight - h })
    }, { root: el, rootMargin: '200px 0px 0px 0px' })
    io.observe(s)
    return () => io.disconnect()
  }, [t.ready, t.loadOlder])

  function onScroll() {
    const el = boxRef.current!
    setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 800 || Boolean(anchor))
  }

  async function move(day: string, id: string, dir: -1 | 1) {
    const group = t.days.find(d => d.day === day)
    if (!group) return
    const i = group.entries.findIndex(e => e.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= group.entries.length) return
    const a = group.entries[i], b = group.entries[j]
    const ra = await api<EntryData>(`/api/entries/${a.id}`, {
      method: 'PATCH', body: JSON.stringify({ position: b.position, version: a.version }) })
    const rb = await api<EntryData>(`/api/entries/${b.id}`, {
      method: 'PATCH', body: JSON.stringify({ position: a.position, version: b.version }) })
    t.applyEntry(ra); t.applyEntry(rb)
  }

  const today = todayStr()
  const showToday = !project && !anchor
  const hasTodayGroup = t.days.some(d => d.day === today)

  return (
    <div className="timeline" ref={boxRef} onScroll={onScroll}>
      <div ref={topSentinel} />
      {!t.hasOlder && t.ready && <p className="flow-edge">— 这里是一切的开始 —</p>}
      {t.days.map(d => (
        <section key={d.day} data-day={d.day}>
          <h2 className="day-head">{fmtDay(d.day)}</h2>
          {d.entries.map(e => (
            <EntryCard key={e.id} entry={e} day={d.day} draftKey={e.id}
              onDeleted={t.removeEntry}
              onMove={(id, dir) => move(d.day, id, dir)} />
          ))}
        </section>
      ))}
      {t.hasNewer && <button className="load-newer" onClick={() => t.loadNewer()}>加载更新的内容 ↓</button>}
      {showToday && (
        <section data-day={today}>
          {!hasTodayGroup && <h2 className="day-head">{fmtDay(today)}</h2>}
          {composers.map(key => (
            <EntryCard key={key} entry={null} day={today} draftKey={`new:${key}`} />
          ))}
          <button className="new-entry" onClick={() => setComposers(c => [...c, crypto.randomUUID()])}>
            ＋ 新条目
          </button>
        </section>
      )}
      {awayFromBottom && (
        <button className="back-today" onClick={() => {
          if (anchor) onExitAnchor()
          else boxRef.current!.scrollTo({ top: boxRef.current!.scrollHeight, behavior: 'smooth' })
        }}>回到今天 ↓</button>
      )}
    </div>
  )
}
```

- [ ] **Step 7: 接入 `web/src/App.tsx`**

用下面内容替换 Task 10 第 9 步的临时接线（`<div style=...>...</div>` 整块）：

```tsx
<Timeline project={project} anchor={anchor} onExitAnchor={() => setAnchor(null)} />
```

并在 `App` 组件内加状态、头部加 import：

```tsx
import { Timeline } from './components/Timeline'
// App 组件内：
const [project, setProject] = useState<string | null>(null)
const [anchor, setAnchor] = useState<string | null>(null)
```

（`setProject` 在 Task 12 边栏接入；此处先建状态。）

- [ ] **Step 8: `web/src/styles.css` 末尾追加时间流样式**

```css
/* ---------- 时间流 ---------- */
.timeline {
  flex: 1; overflow-y: auto; padding: 0 20px 40px;
  scroll-behavior: auto; position: relative;
}
.timeline > section, .timeline > p, .timeline > button { max-width: 720px; margin-left: auto; margin-right: auto; }
.day-head {
  position: sticky; top: 0; z-index: 5;
  font-family: var(--serif); font-size: 15px; font-weight: 600; color: var(--muted);
  background: linear-gradient(var(--bg) 75%, transparent);
  margin: 18px 0 4px; padding: 6px 2px;
}
.flow-edge { text-align: center; color: var(--muted); font-size: 13px; padding: 24px 0; }
.new-entry {
  display: block; width: 100%; text-align: left; color: var(--muted);
  background: none; border: 1px dashed var(--border); border-radius: 12px;
  padding: 10px 18px; font-size: 14px; cursor: pointer; margin: 6px 0;
}
.new-entry:hover { color: var(--fg); border-color: var(--muted); }
.load-newer {
  display: block; margin: 12px auto; background: var(--card); color: var(--accent);
  border: 1px solid var(--border); border-radius: 20px; padding: 6px 18px; cursor: pointer;
}
.back-today {
  position: fixed; right: 46px; bottom: 28px; z-index: 20;
  background: var(--card); color: var(--fg); border: 1px solid var(--border);
  border-radius: 20px; padding: 8px 16px; cursor: pointer; box-shadow: var(--shadow);
  font-size: 13px;
}
```

- [ ] **Step 9: 全部前端测试**

Run: `cd web && npx vitest run` → Expected: PASS。

- [ ] **Step 10:【人工验证】**

后端造几天数据（可用 curl 或直接在页面写然后手改库；最快是页面里写一条，然后 `sqlite3 server/data/parchment.db "update entries set day='2026-07-25' where ..."` 再刷新——注意别删东西）。验证：打开落在底部今天；向上滚自动加载更早的天；日期头吸顶；上翻较远出现「回到今天」，点击平滑回底；「＋ 新条目」出新卡片，输入后自动落库；条目 hover 出 ↑↓× 按钮，↑↓ 交换顺序，× 确认后删除。

- [ ] **Step 11: 提交**

```bash
git add web/src web/test
git commit -m "feat(web): 聊天式时间流、双向加载、今日撰写与条目排序删除"
```

---

### Task 12: 项目标签（#即打即标）+ 边栏 + 项目过滤视图

**Files:**
- Create: `web/src/editor/Hashtag.ts`, `web/src/components/Sidebar.tsx`
- Modify: `web/src/editor/extensions.ts`, `web/src/components/EntryCard.tsx`, `web/src/App.tsx`, `web/src/styles.css`
- Test: `web/test/hashtag.test.ts`

- [ ] **Step 1: 写失败测试 `web/test/hashtag.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { TAG_RE, parseTag } from '../src/editor/Hashtag'

describe('hashtag 规则', () => {
  const hits: [string, string][] = [
    ['#钙钛矿 ', '钙钛矿'],
    ['前文 #graphene ', 'graphene'],
    ['#双-连_字.符 ', '双-连_字.符'],
  ]
  for (const [input, want] of hits) {
    it(`识别 "${input}" → ${want}`, () => {
      const m = input.match(TAG_RE)
      expect(m).toBeTruthy()
      expect(parseTag(m!)).toBe(want)
    })
  }
  const misses = ['# 空格开头 ', '无井号 ', '#还没敲空格']
  for (const s of misses) {
    it(`不识别 "${s}"`, () => expect(s.match(TAG_RE)).toBeNull())
  }
})
```

Run: `cd web && npx vitest run test/hashtag.test.ts` → Expected: FAIL。

- [ ] **Step 2: 写 `web/src/editor/Hashtag.ts`**

```ts
import { Extension } from '@tiptap/core'
import { InputRule } from '@tiptap/core'

// 行内敲 `#标签名 `（以空格收尾）→ 文本被移除、回调打标
export const TAG_RE = /(?:^|\s)#([^\s#]{1,32})\s$/

export function parseTag(m: RegExpMatchArray): string {
  return m[1]
}

export function Hashtag(onTag: (name: string) => void) {
  return Extension.create({
    name: 'hashtagCapture',
    addInputRules() {
      return [new InputRule({
        find: TAG_RE,
        handler: ({ range, match, commands }) => {
          const full = match[0]
          const hashIdx = full.indexOf('#')
          commands.deleteRange({ from: range.from + hashIdx, to: range.to })
          onTag(parseTag(match))
        },
      })]
    },
  })
}
```

- [ ] **Step 3: `web/src/editor/extensions.ts` 接入**

`ExtensionOpts` 增加 `onTag?: (name: string) => void`；import 头部加 `import { Hashtag } from './Hashtag'`；`buildExtensions` 返回数组末尾（`Mathematics,` 之后）加：

```ts
    ...(opts.onTag ? [Hashtag(opts.onTag)] : []),
```

- [ ] **Step 4: 跑 hashtag 测试**

Run: `cd web && npx vitest run test/hashtag.test.ts` → Expected: PASS。

- [ ] **Step 5: `web/src/components/EntryCard.tsx` 加标签状态与 chips**

改动点（保持其余不变）：

1. import 区加：`import { useState } from 'react'`（并入现有 react import）。
2. 组件 props 增加 `onTagClick?: (projectId: string) => void`。
3. 组件体内、`useAutosave` 调用之前加：

```tsx
  const [tags, setTags] = useState<{ id?: string; name: string; color?: string }[]>(entry?.tags ?? [])
  const tagsRef = useRef(tags)
  tagsRef.current = tags
```

4. `useAutosave` 的参数改为（`getPayload` 带上标签、`onSaved` 回填服务器生成的 id/颜色）：

```tsx
  const autosave = useAutosave({
    entryId: entry?.id ?? null,
    day,
    version: entry?.version ?? 0,
    draftKey,
    getPayload: () => ({
      content: editorRef.current?.getJSON() ?? EMPTY_DOC,
      tags: tagsRef.current.map(t => t.name),
    }),
    onCreated,
    onSaved: e => setTags(e.tags),
  })
```

5. `useEditor` 的 `extensions` 改为：

```tsx
    extensions: buildExtensions({
      onTag: name => {
        if (!tagsRef.current.some(t => t.name === name)) {
          setTags([...tagsRef.current, { name }])
          autosave.schedule()
        }
      },
    }),
```

6. `<div className="entry-head">` 里 `entry-time` 之后插入 chips：

```tsx
        <span className="entry-tags">
          {tags.map(t => (
            <span key={t.name} className="chip" style={{ borderColor: t.color }}>
              <i style={{ background: t.color ?? 'var(--muted)' }} />
              <button className="chip-name" onClick={() => t.id && onTagClick?.(t.id)}>{t.name}</button>
              <button className="chip-x" title="移除标签" onClick={() => {
                setTags(tagsRef.current.filter(x => x.name !== t.name)); autosave.schedule()
              }}>×</button>
            </span>
          ))}
        </span>
```

- [ ] **Step 6: 写 `web/src/components/Sidebar.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { api } from '../api'

export interface Project { id: string; name: string; color: string; archived: number }

export function Sidebar({ active, onSelect, refreshKey }: {
  active: string | null
  onSelect: (id: string | null) => void
  refreshKey: number      // 变化时重新拉项目列表
}) {
  const [projects, setProjects] = useState<Project[]>([])
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    api<Project[]>('/api/projects').then(setProjects).catch(() => {})
  }, [refreshKey])

  async function archive(id: string) {
    await api(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) })
    setProjects(ps => ps.map(p => p.id === id ? { ...p, archived: 1 } : p))
    if (active === id) onSelect(null)
  }

  if (collapsed) {
    return <nav className="sidebar collapsed"><button className="icon-btn" title="展开" onClick={() => setCollapsed(false)}>»</button></nav>
  }
  return (
    <nav className="sidebar">
      <div className="side-head">
        <button className={`side-item ${active === null ? 'on' : ''}`} onClick={() => onSelect(null)}>全部</button>
        <button className="icon-btn" title="收起" onClick={() => setCollapsed(true)}>«</button>
      </div>
      {projects.filter(p => !p.archived).map(p => (
        <div key={p.id} className={`side-item ${active === p.id ? 'on' : ''}`}>
          <button className="side-name" onClick={() => onSelect(p.id)}>
            <i style={{ background: p.color }} />{p.name}
          </button>
          <button className="icon-btn side-archive" title="归档" onClick={() => archive(p.id)}>⌫</button>
        </div>
      ))}
    </nav>
  )
}
```

- [ ] **Step 7: `web/src/App.tsx` 接入边栏与过滤**

1. import 加 `import { Sidebar } from './components/Sidebar'`。
2. `App` 内加 `const [projRefresh, setProjRefresh] = useState(0)`。
3. `<main className="main">` 内容改为：

```tsx
        <Sidebar active={project} refreshKey={projRefresh}
          onSelect={id => { setProject(id); setAnchor(null) }} />
        <Timeline project={project} anchor={anchor} onExitAnchor={() => setAnchor(null)} />
```

4. Timeline 需要把 `onTagClick` 传进 EntryCard 并在保存后刷新项目列表：`Timeline` props 增加 `onTagClick?: (id: string) => void` 与 `onProjectsChanged?: () => void`，两处 `<EntryCard ...>` 都加 `onTagClick={onTagClick}`；App 传：

```tsx
        <Timeline project={project} anchor={anchor} onExitAnchor={() => setAnchor(null)}
          onTagClick={id => { setProject(id); setAnchor(null) }} />
```

（`onProjectsChanged` 简化处理：Sidebar 的 `refreshKey` 用 `project` 与一个 10 秒轮询替代会引入复杂度——直接在 Sidebar 挂载后每次 `refreshKey` 变化拉取即可；App 在 `onTagClick` 里顺带 `setProjRefresh(k => k + 1)`，并在 Timeline 空闲时不刷。新标签创建后最迟在下次切换视图时出现在边栏，可接受。）

- [ ] **Step 8: `web/src/styles.css` 末尾追加边栏与 chips 样式**

```css
/* ---------- 边栏与标签 ---------- */
.sidebar {
  width: 200px; border-right: 1px solid var(--border); padding: 10px 8px;
  overflow-y: auto; flex-shrink: 0; display: flex; flex-direction: column; gap: 2px;
}
.sidebar.collapsed { width: 36px; align-items: center; }
.side-head { display: flex; justify-content: space-between; align-items: center; }
.side-item {
  display: flex; align-items: center; border-radius: 8px; font-size: 14px;
  color: var(--fg); background: none; border: none; text-align: left; width: 100%;
}
.side-item.on { background: var(--border); }
.side-name {
  flex: 1; display: flex; align-items: center; gap: 8px; padding: 6px 10px;
  background: none; border: none; color: inherit; font-size: 14px; cursor: pointer; text-align: left;
}
.side-name i, .chip i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.side-archive { opacity: 0; }
.side-item:hover .side-archive { opacity: 1; }
.entry-tags { display: inline-flex; gap: 6px; flex-wrap: wrap; margin-left: 10px; flex: 1; }
.chip {
  display: inline-flex; align-items: center; gap: 4px; font-size: 12px;
  border: 1px solid var(--border); border-radius: 10px; padding: 0 4px 0 6px;
}
.chip-name { border: none; background: none; color: var(--fg); cursor: pointer; font-size: 12px; padding: 1px 0; }
.chip-x { border: none; background: none; color: var(--muted); cursor: pointer; padding: 0 2px; }
.chip-x:hover { color: var(--danger); }
```

- [ ] **Step 9: 全部测试 + 【人工验证】**

Run: `cd web && npx vitest run` → Expected: PASS。
浏览器：条目里敲 `#超导 `（含尾随空格）→ 文本消失、条目头部出现「超导」chip；保存后 chip 出现颜色点；切换视图后边栏出现「超导」；点边栏项目→只看该项目条目（含跨天的项目时间线）；点「全部」还原；chip 上 × 移除标签；边栏 hover 出归档按钮，归档后项目从边栏消失、条目仍在。

- [ ] **Step 10: 提交**

```bash
git add web/src web/test
git commit -m "feat(web): #标签即打即标、项目边栏与项目过滤时间线"
```

---

### Task 13: 全文搜索 + Cmd/Ctrl+K 命令面板

**Files:**
- Create: `web/src/components/CommandPalette.tsx`
- Modify: `web/src/App.tsx`, `web/src/styles.css`
- Test: `web/test/palette.test.tsx`

- [ ] **Step 1: 写失败测试 `web/test/palette.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

vi.mock('../src/api', () => ({ api: vi.fn() }))
import { api } from '../src/api'
import { CommandPalette, parseDateQuery } from '../src/components/CommandPalette'

const mockApi = api as ReturnType<typeof vi.fn>
beforeEach(() => { mockApi.mockReset(); vi.useFakeTimers({ shouldAdvanceTime: true }) })

describe('parseDateQuery', () => {
  it('识别 2026-03-12 / 2026.3.12 / 3月12', () => {
    expect(parseDateQuery('2026-03-12')).toBe('2026-03-12')
    expect(parseDateQuery('2026.3.2')).toBe('2026-03-02')
    expect(parseDateQuery('3月12', 2026)).toBe('2026-03-12')
    expect(parseDateQuery('随便写点')).toBeNull()
  })
})

describe('CommandPalette', () => {
  it('输入触发防抖搜索并渲染结果；点击回调跳转', async () => {
    mockApi.mockResolvedValue({ days: [{ day: '2026-07-01', entries: [
      { id: 'e1', day: '2026-07-01', text: '钙钛矿旋涂参数摸索', tags: [], position: 0, version: 0, content: {}, created_at: '', updated_at: '' },
    ] }] })
    const onJump = vi.fn()
    render(<CommandPalette open onClose={() => {}} onJumpDay={onJump} onSelectProject={() => {}} projects={[]} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '钙钛矿' } })
    await act(() => vi.advanceTimersByTimeAsync(400))
    await waitFor(() => expect(screen.getByText(/旋涂参数/)).toBeInTheDocument())
    fireEvent.click(screen.getByText(/旋涂参数/))
    expect(onJump).toHaveBeenCalledWith('2026-07-01')
  })

  it('输入日期样式出现跳转项', async () => {
    render(<CommandPalette open onClose={() => {}} onJumpDay={() => {}} onSelectProject={() => {}} projects={[]} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '2026-03-12' } })
    await waitFor(() => expect(screen.getByText(/跳到 2026-03-12/)).toBeInTheDocument())
  })
})
```

Run: `cd web && npx vitest run test/palette.test.tsx` → Expected: FAIL。

- [ ] **Step 2: 写 `web/src/components/CommandPalette.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { DayGroup } from '../lib/groupDays'
import type { Project } from './Sidebar'

export function parseDateQuery(q: string, defaultYear = new Date().getFullYear()): string | null {
  const s = q.trim()
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日?$/)
  if (m) return `${m[1] ?? defaultYear}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return null
}

interface Hit { id: string; day: string; text: string }

export function CommandPalette({ open, onClose, onJumpDay, onSelectProject, projects }: {
  open: boolean
  onClose: () => void
  onJumpDay: (day: string) => void
  onSelectProject: (id: string | null) => void
  projects: Project[]
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) { setQ(''); setHits([]); setTimeout(() => inputRef.current?.focus(), 0) } }, [open])

  useEffect(() => {
    clearTimeout(timer.current)
    if (!q.trim()) { setHits([]); return }
    timer.current = setTimeout(async () => {
      try {
        const r = await api<{ days: DayGroup[] }>(`/api/entries?q=${encodeURIComponent(q)}`)
        setHits(r.days.flatMap(d => d.entries.map(e => ({
          id: e.id, day: d.day, text: (e as unknown as { text?: string }).text || '(无文本)',
        }))).slice(0, 30))
      } catch { setHits([]) }
    }, 300)
    return () => clearTimeout(timer.current)
  }, [q])

  if (!open) return null
  const dateHit = parseDateQuery(q)
  const projHits = q.trim()
    ? projects.filter(p => !p.archived && p.name.toLowerCase().includes(q.trim().toLowerCase()))
    : []

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={e => e.stopPropagation()}>
        <input ref={inputRef} value={q} placeholder="搜索笔记 · 输日期跳转 · 输项目名切换"
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') onClose() }} />
        <div className="palette-list">
          {dateHit && (
            <button className="palette-item" onClick={() => { onJumpDay(dateHit); onClose() }}>
              📅 跳到 {dateHit}
            </button>
          )}
          {projHits.map(p => (
            <button key={p.id} className="palette-item" onClick={() => { onSelectProject(p.id); onClose() }}>
              <i className="dot" style={{ background: p.color }} /> 项目：{p.name}
            </button>
          ))}
          {hits.map(h => (
            <button key={h.id} className="palette-item" onClick={() => { onJumpDay(h.day); onClose() }}>
              <span className="palette-day">{h.day}</span>
              <span className="palette-text">{h.text.slice(0, 80)}</span>
            </button>
          ))}
          {!hits.length && !dateHit && !projHits.length && q.trim() && (
            <p className="palette-empty">没找到 —— 换个词试试</p>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: `web/src/App.tsx` 接入（快捷键 + 状态）**

1. import 加 `import { CommandPalette } from './components/CommandPalette'` 与 `import type { Project } from './components/Sidebar'`。
2. `App` 内加：

```tsx
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  useEffect(() => {
    if (!authed) return
    api<Project[]>('/api/projects').then(setProjects).catch(() => {})
  }, [authed, projRefresh, paletteOpen])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setPaletteOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
```

3. `topbar` 里 SaveDot 前加一个搜索入口按钮：

```tsx
        <button className="icon-btn" title="搜索 (⌘K)" onClick={() => setPaletteOpen(true)}>🔍</button>
```

4. 根 `<div className="app">` 末尾（`</main>` 之后）加：

```tsx
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)}
        projects={projects}
        onJumpDay={day => { setProject(null); setAnchor(day) }}
        onSelectProject={id => { setProject(id); setAnchor(null) }} />
```

- [ ] **Step 4: `web/src/styles.css` 末尾追加面板样式**

```css
/* ---------- 命令面板 ---------- */
.palette-overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.35); z-index: 50;
  display: flex; justify-content: center; padding-top: 12vh;
}
.palette {
  width: min(560px, 92vw); max-height: 60vh; background: var(--card);
  border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,0.25);
  display: flex; flex-direction: column; overflow: hidden; height: fit-content;
}
.palette input {
  font-size: 16px; padding: 14px 18px; border: none; outline: none;
  background: none; color: var(--fg); border-bottom: 1px solid var(--border);
}
.palette-list { overflow-y: auto; padding: 6px; }
.palette-item {
  display: flex; gap: 10px; align-items: baseline; width: 100%; text-align: left;
  background: none; border: none; padding: 9px 12px; border-radius: 8px;
  color: var(--fg); cursor: pointer; font-size: 14px;
}
.palette-item:hover { background: var(--border); }
.palette-item .dot { width: 8px; height: 8px; border-radius: 50%; align-self: center; }
.palette-day { color: var(--muted); font-size: 12px; flex-shrink: 0; font-family: var(--mono); }
.palette-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.palette-empty { color: var(--muted); text-align: center; font-size: 13px; padding: 16px; }
```

- [ ] **Step 5: 服务端补充——列表响应带 text 字段确认**

`rowToEntry` 已包含 `text`（Task 4），无需改动；若测试发现缺失则补上。

- [ ] **Step 6: 全部测试 + 【人工验证】**

Run: `cd web && npx vitest run` → Expected: PASS。
浏览器：⌘K（或 Ctrl+K）呼出面板；输中文关键词出条目结果，点击跳到那一天（时间流锚定，可上下继续滚）；输 `3月12` 或 `2026-03-12` 出「跳到」项；输项目名出项目项，点击切到项目视图；Esc 或点遮罩关闭。

- [ ] **Step 7: 提交**

```bash
git add web/src web/test
git commit -m "feat(web): 全文搜索与 Cmd+K 命令面板（搜索/跳日期/切项目）"
```

---

### Task 14: 右侧时间条（拖动跳日期，吸附有记录日）

**Files:**
- Create: `web/src/components/TimeScrubber.tsx`
- Modify: `web/src/App.tsx`, `web/src/styles.css`
- Test: `web/test/scrubber.test.ts`

- [ ] **Step 1: 写失败测试 `web/test/scrubber.test.ts`（纯函数：比例↔日期换算与吸附）**

```ts
import { describe, it, expect } from 'vitest'
import { fracToDay, snapToNearest, monthTicks } from '../src/components/TimeScrubber'

describe('scrubber 数学', () => {
  it('fracToDay：0→起点，1→终点，中间线性', () => {
    expect(fracToDay(0, '2026-01-01', '2026-01-11')).toBe('2026-01-01')
    expect(fracToDay(1, '2026-01-01', '2026-01-11')).toBe('2026-01-11')
    expect(fracToDay(0.5, '2026-01-01', '2026-01-11')).toBe('2026-01-06')
  })
  it('snapToNearest 吸附到最近的有记录日', () => {
    const days = ['2026-01-01', '2026-01-10', '2026-02-20']
    expect(snapToNearest('2026-01-02', days)).toBe('2026-01-01')
    expect(snapToNearest('2026-01-08', days)).toBe('2026-01-10')
    expect(snapToNearest('2026-03-01', days)).toBe('2026-02-20')
  })
  it('monthTicks 给出范围内每月 1 日的刻度与比例', () => {
    const ticks = monthTicks('2026-01-15', '2026-03-20')
    expect(ticks.map(t => t.day)).toEqual(['2026-02-01', '2026-03-01'])
    for (const t of ticks) { expect(t.frac).toBeGreaterThan(0); expect(t.frac).toBeLessThan(1) }
  })
})
```

Run: `cd web && npx vitest run test/scrubber.test.ts` → Expected: FAIL。

- [ ] **Step 2: 写 `web/src/components/TimeScrubber.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { todayStr } from '../lib/groupDays'

const MS_DAY = 86400000
const toMs = (d: string) => new Date(d + 'T00:00:00Z').getTime()
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function fracToDay(frac: number, first: string, last: string): string {
  const a = toMs(first), b = toMs(last)
  const ms = a + Math.round(((b - a) * Math.min(Math.max(frac, 0), 1)) / MS_DAY) * MS_DAY
  return toDay(ms)
}

export function snapToNearest(day: string, days: string[]): string {
  if (!days.length) return day
  const t = toMs(day)
  let best = days[0], bestDist = Infinity
  for (const d of days) {
    const dist = Math.abs(toMs(d) - t)
    if (dist < bestDist) { best = d; bestDist = dist }
  }
  return best
}

export function monthTicks(first: string, last: string): { day: string; frac: number; label: string }[] {
  const a = toMs(first), b = toMs(last)
  if (b <= a) return []
  const out: { day: string; frac: number; label: string }[] = []
  const cur = new Date(a)
  cur.setUTCDate(1); cur.setUTCMonth(cur.getUTCMonth() + 1)
  while (cur.getTime() < b) {
    const day = toDay(cur.getTime())
    out.push({
      day,
      frac: (cur.getTime() - a) / (b - a),
      label: day.slice(5, 7) === '01' ? `${day.slice(0, 4)}年` : `${Number(day.slice(5, 7))}月`,
    })
    cur.setUTCMonth(cur.getUTCMonth() + 1)
  }
  return out
}

export function TimeScrubber({ onJump, refreshKey }: { onJump: (day: string) => void; refreshKey: number }) {
  const [days, setDays] = useState<string[]>([])
  const [drag, setDrag] = useState<{ frac: number; day: string } | null>(null)
  const railRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api<{ day: string; count: number }[]>('/api/days')
      .then(r => setDays(r.map(x => x.day))).catch(() => {})
  }, [refreshKey])

  if (days.length < 2) return null
  const first = days[0], last = todayStr()
  const ticks = monthTicks(first, last)

  function fracAt(clientY: number) {
    const rect = railRef.current!.getBoundingClientRect()
    return (clientY - rect.top) / rect.height
  }
  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId)
    update(e.clientY)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (drag) update(e.clientY)
  }
  function update(clientY: number) {
    const frac = Math.min(Math.max(fracAt(clientY), 0), 1)
    setDrag({ frac, day: snapToNearest(fracToDay(frac, first, last), days) })
  }
  function onPointerUp() {
    if (drag) onJump(drag.day)
    setDrag(null)
  }

  return (
    <div className="scrubber" ref={railRef}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div className="scrubber-rail" />
      {ticks.map(t => (
        <div key={t.day} className="scrubber-tick" style={{ top: `${t.frac * 100}%` }}>
          <span>{t.label}</span>
        </div>
      ))}
      {days.map(d => (
        <i key={d} className="scrubber-dot"
          style={{ top: `${((toMs(d) - toMs(first)) / Math.max(toMs(last) - toMs(first), 1)) * 100}%` }} />
      ))}
      {drag && (
        <div className="scrubber-thumb" style={{ top: `${drag.frac * 100}%` }}>
          <span className="scrubber-label">{drag.day}</span>
        </div>
      )}
    </div>
  )
}
```

注意 `onPointerDown` 里先 `update` 再等 move：点击即预览，拖动更新，松手跳转。`drag` 为 null 时 move 不响应——需在 down 时置 `drag`（`update` 已做）。

- [ ] **Step 3: `web/src/App.tsx` 接入**

1. import 加 `import { TimeScrubber } from './components/TimeScrubber'`。
2. `<main className="main">` 里 `<Timeline .../>` 之后加：

```tsx
        <TimeScrubber refreshKey={projRefresh}
          onJump={day => { setProject(null); setAnchor(day) }} />
```

- [ ] **Step 4: `web/src/styles.css` 末尾追加时间条样式**

```css
/* ---------- 时间条 ---------- */
.scrubber {
  width: 34px; flex-shrink: 0; position: relative; cursor: grab;
  touch-action: none; user-select: none;
}
.scrubber:active { cursor: grabbing; }
.scrubber-rail {
  position: absolute; top: 8px; bottom: 8px; right: 15px; width: 2px;
  background: var(--border); border-radius: 1px;
}
.scrubber-tick {
  position: absolute; right: 10px; height: 1px; width: 12px; background: var(--muted);
  opacity: 0.5;
}
.scrubber-tick span {
  position: absolute; right: 16px; top: -8px; font-size: 10px; color: var(--muted);
  white-space: nowrap; opacity: 0; transition: opacity 0.2s;
}
.scrubber:hover .scrubber-tick span { opacity: 1; }
.scrubber-dot {
  position: absolute; right: 13px; width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent); opacity: 0.45; transform: translateY(-3px);
}
.scrubber-thumb {
  position: absolute; right: 8px; width: 16px; height: 16px; border-radius: 50%;
  background: var(--accent); transform: translateY(-8px); box-shadow: var(--shadow);
}
.scrubber-label {
  position: absolute; right: 24px; top: -4px; background: var(--card);
  border: 1px solid var(--border); border-radius: 8px; padding: 3px 10px;
  font-size: 12px; font-family: var(--mono); white-space: nowrap; box-shadow: var(--shadow);
}
```

- [ ] **Step 5: 全部测试 + 【人工验证】**

Run: `cd web && npx vitest run` → Expected: PASS。
浏览器（先造出跨几个月的假数据）：右缘出现细轨，蓝点表示有记录日；hover 显示月份刻度；按住拖动出现日期气泡并吸附蓝点；松手时间流跳到那一天（锚定模式），出现「加载更新的内容」与「回到今天」；点「回到今天」还原。

- [ ] **Step 6: 提交**

```bash
git add web/src web/test
git commit -m "feat(web): 右缘时间条拖动跳转，吸附有记录日"
```

---

### Task 15: 图片——粘贴/拖入上传、拖角缩放、点击放大

**Files:**
- Create: `web/src/editor/ResizableImage.tsx`, `web/src/editor/pasteRules.ts`, `web/src/components/Lightbox.tsx`
- Modify: `web/src/editor/extensions.ts`, `web/src/App.tsx`, `web/src/styles.css`
- Test: `web/test/pasteRules.test.ts`（本任务先测图片分支，HTML 分类在 Task 17 扩充）

- [ ] **Step 1: 写失败测试 `web/test/pasteRules.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { pickImageFiles } from '../src/editor/pasteRules'

function fakeFile(type: string, name = 'f') { return new File([new Uint8Array([1])], name, { type }) }

describe('pickImageFiles', () => {
  it('过滤出图片文件', () => {
    const files = [fakeFile('image/png'), fakeFile('text/plain'), fakeFile('image/jpeg')]
    expect(pickImageFiles(files).map(f => f.type)).toEqual(['image/png', 'image/jpeg'])
  })
  it('无图片返回空数组', () => {
    expect(pickImageFiles([fakeFile('application/pdf')])).toEqual([])
  })
})
```

Run: `cd web && npx vitest run test/pasteRules.test.ts` → Expected: FAIL。

- [ ] **Step 2: 写 `web/src/editor/pasteRules.ts`（本任务只做图片分支，Task 16/17 在此文件扩充）**

```ts
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { uploadImage } from '../api'

export function pickImageFiles(files: File[] | FileList): File[] {
  return Array.from(files).filter(f => f.type.startsWith('image/'))
}

async function insertImages(view: EditorView, files: File[]) {
  for (const f of files) {
    try {
      const url = await uploadImage(f)
      const node = view.state.schema.nodes.image.create({ src: url })
      view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
    } catch {
      window.alert('图片上传失败，请重试')
    }
  }
}

export const PasteRules = Extension.create({
  name: 'parchmentPaste',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('parchmentPaste'),
      props: {
        handlePaste: (view, event) => {
          const files = pickImageFiles(event.clipboardData?.files ?? [])
          if (files.length) { void insertImages(view, files); return true }
          return false
        },
        handleDrop: (view, event) => {
          const files = pickImageFiles(event.dataTransfer?.files ?? [])
          if (files.length) { event.preventDefault(); void insertImages(view, files); return true }
          return false
        },
      },
    })]
  },
})
```

- [ ] **Step 3: 写 `web/src/editor/ResizableImage.tsx`**

```tsx
import Image from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useRef } from 'react'

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {   // 百分比宽度，null = 原始
        default: null,
        parseHTML: el => {
          const w = (el as HTMLElement).style.width
          return w?.endsWith('%') ? Number(w.slice(0, -1)) : null
        },
        renderHTML: attrs => attrs.width ? { style: `width:${attrs.width}%` } : {},
      },
    }
  },
  addNodeView() { return ReactNodeViewRenderer(ImageView) },
})

function ImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null)

  function startResize(e: React.PointerEvent) {
    e.preventDefault(); e.stopPropagation()
    const container = wrapRef.current!.parentElement as HTMLElement
    const total = container.getBoundingClientRect().width
    const move = (ev: PointerEvent) => {
      const rect = wrapRef.current!.getBoundingClientRect()
      const pct = Math.min(Math.max(((ev.clientX - rect.left) / total) * 100, 10), 100)
      updateAttributes({ width: Math.round(pct) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function openLightbox() {
    window.dispatchEvent(new CustomEvent('parchment:lightbox', { detail: node.attrs.src }))
  }

  return (
    <NodeViewWrapper as="div" className={`img-wrap ${selected ? 'selected' : ''}`}
      ref={wrapRef} style={{ width: node.attrs.width ? `${node.attrs.width}%` : undefined }}>
      <img src={node.attrs.src} alt={node.attrs.alt ?? ''} onClick={openLightbox} draggable={false} />
      <span className="img-handle" onPointerDown={startResize} title="拖动调整大小" />
    </NodeViewWrapper>
  )
}
```

- [ ] **Step 4: 写 `web/src/components/Lightbox.tsx` 并接入 App**

```tsx
import { useEffect, useState } from 'react'

export function Lightbox() {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const on = (e: Event) => setSrc((e as CustomEvent<string>).detail)
    window.addEventListener('parchment:lightbox', on)
    return () => window.removeEventListener('parchment:lightbox', on)
  }, [])
  if (!src) return null
  return (
    <div className="lightbox" onClick={() => setSrc(null)}>
      <img src={src} alt="" />
    </div>
  )
}
```

`web/src/App.tsx`：import 加 `import { Lightbox } from './components/Lightbox'`；根 div 内 `<CommandPalette .../>` 之后加 `<Lightbox />`。

- [ ] **Step 5: `web/src/editor/extensions.ts` 接入**

头部加：

```ts
import { ResizableImage } from './ResizableImage'
import { PasteRules } from './pasteRules'
```

`buildExtensions` 返回数组 `Mathematics,` 之后加：

```ts
    ResizableImage,
    PasteRules,
```

FloatingMenu（EntryCard 中）追加图片按钮，放在「待办」按钮后：

```tsx
          <button onClick={() => {
            const input = document.createElement('input')
            input.type = 'file'; input.accept = 'image/*'
            input.onchange = async () => {
              const f = input.files?.[0]
              if (!f) return
              const { uploadImage } = await import('../api')
              const url = await uploadImage(f)
              editor.chain().focus().insertContent({ type: 'image', attrs: { src: url } }).run()
            }
            input.click()
          }}>图片</button>
```

- [ ] **Step 6: `web/src/styles.css` 末尾追加**

```css
/* ---------- 图片与灯箱 ---------- */
.img-wrap { position: relative; display: inline-block; max-width: 100%; line-height: 0; }
.img-wrap img { width: 100%; border-radius: 8px; cursor: zoom-in; }
.img-wrap.selected img { outline: 2px solid var(--accent); }
.img-handle {
  position: absolute; right: -6px; bottom: -6px; width: 14px; height: 14px;
  border-radius: 50%; background: var(--accent); border: 2px solid var(--card);
  cursor: nwse-resize; opacity: 0; transition: opacity 0.15s;
}
.img-wrap:hover .img-handle, .img-wrap.selected .img-handle { opacity: 1; }
.lightbox {
  position: fixed; inset: 0; z-index: 100; background: rgba(0, 0, 0, 0.85);
  display: grid; place-items: center; cursor: zoom-out;
}
.lightbox img { max-width: 94vw; max-height: 94vh; border-radius: 4px; }
```

- [ ] **Step 7: 全部测试 + 【人工验证】**

Run: `cd web && npx vitest run` → Expected: PASS。
浏览器：截图后 Ctrl+V → 图片出现在光标处（网络面板可见 /api/images 上传，URL 形如 /images/2026/07/xxx.png）；拖文件进编辑器同效；hover 图片右下角出现圆点手柄，拖动改变宽度，刷新后宽度保持；点图片全屏放大，点任意处关闭；插入条「图片」按钮可选文件。

- [ ] **Step 8: 提交**

```bash
git add web/src web/test
git commit -m "feat(web): 图片粘贴/拖入上传、拖角百分比缩放与灯箱"
```

---

### Task 16: 引用粘贴流 + 引用卡片节点

**Files:**
- Create: `web/src/lib/citePatterns.ts`, `web/src/editor/CitationNode.tsx`
- Modify: `web/src/editor/pasteRules.ts`, `web/src/editor/extensions.ts`, `web/src/components/EntryCard.tsx`, `web/src/styles.css`
- Test: `web/test/citation.test.ts`

- [ ] **Step 1: 写失败测试 `web/test/citation.test.ts`**

```ts
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
```

Run: `cd web && npx vitest run test/citation.test.ts` → Expected: FAIL。

- [ ] **Step 2: 写 `web/src/lib/citePatterns.ts`**

```ts
// 与后端 classifyUrl 的「学术源」子集保持一致：只有这些域触发引用卡片
const CITE_RE = [
  /^https?:\/\/(dx\.)?doi\.org\/10\.\d{4,9}\/\S+$/i,
  /^https?:\/\/(www\.)?arxiv\.org\/(abs|pdf)\/\d{4}\.\d{4,5}(v\d+)?\/?$/i,
  /^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/?$/i,
]

export function isCitationUrl(text: string): boolean {
  const t = text.trim()
  return CITE_RE.some(re => re.test(t))
}
```

- [ ] **Step 3: 写 `web/src/editor/CitationNode.tsx`**

```tsx
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import type { EditorView } from '@tiptap/pm/view'

export interface CiteResult {
  ok: boolean; title?: string | null; authors?: string | null
  year?: string | null; venue?: string | null
}

export const CitationNode = Node.create({
  name: 'citation',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      url: { default: '' }, status: { default: 'pending' },
      title: { default: null }, authors: { default: null },
      year: { default: null }, venue: { default: null },
    }
  },
  parseHTML() {
    return [{
      tag: 'div[data-citation]',
      getAttrs: el => {
        const d = (el as HTMLElement).dataset
        return { url: d.url ?? '', status: d.status ?? 'error', title: d.title ?? null,
          authors: d.authors ?? null, year: d.year ?? null, venue: d.venue ?? null }
      },
    }]
  },
  renderHTML({ node }) {
    const a = node.attrs
    return ['div', mergeAttributes({ 'data-citation': '', 'data-url': a.url, 'data-status': a.status,
      'data-title': a.title, 'data-authors': a.authors, 'data-year': a.year, 'data-venue': a.venue })]
  },
  addNodeView() { return ReactNodeViewRenderer(CitationView) },
})

// 按 url 找到 pending 的引用节点并写入抓取结果
export function applyCitationResult(view: EditorView, url: string, r: CiteResult) {
  const { doc, tr } = view.state
  doc.descendants((node, pos) => {
    if (node.type.name === 'citation' && node.attrs.url === url && node.attrs.status === 'pending') {
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        status: r.ok ? 'ok' : 'error',
        title: r.title ?? null, authors: r.authors ?? null,
        year: r.year ?? null, venue: r.venue ?? null,
      })
    }
  })
  if (tr.docChanged) view.dispatch(tr)
}

function CitationView({ node }: NodeViewProps) {
  const a = node.attrs
  if (a.status === 'ok') {
    return (
      <NodeViewWrapper as="div" className="cite-card" data-status="ok">
        <a href={a.url} target="_blank" rel="noreferrer" className="cite-title">{a.title}</a>
        <span className="cite-meta">
          {[a.authors, a.year, a.venue].filter(Boolean).join(' · ')}
        </span>
      </NodeViewWrapper>
    )
  }
  return (
    <NodeViewWrapper as="div" className="cite-card" data-status={a.status}>
      <a href={a.url} target="_blank" rel="noreferrer" className="cite-title plain">{a.url}</a>
      {a.status === 'pending' && <span className="cite-meta">抓取文献信息…</span>}
    </NodeViewWrapper>
  )
}
```

- [ ] **Step 4: `web/src/editor/pasteRules.ts` 加引用分支**

头部加：

```ts
import { api } from '../api'
import { isCitationUrl } from '../lib/citePatterns'
import { applyCitationResult, type CiteResult } from './CitationNode'
```

新增导出函数（`insertImages` 之后）：

```ts
export function insertCitation(view: EditorView, url: string) {
  const node = view.state.schema.nodes.citation.create({ url, status: 'pending' })
  view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
  api<CiteResult & { url: string }>('/api/cite', { method: 'POST', body: JSON.stringify({ url }) })
    .then(r => applyCitationResult(view, url, r))
    .catch(() => applyCitationResult(view, url, { ok: false }))
}
```

`handlePaste` 中图片分支之后、`return false` 之前加：

```ts
          const text = event.clipboardData?.getData('text/plain')?.trim() ?? ''
          if (text && isCitationUrl(text)) { insertCitation(view, text); return true }
```

- [ ] **Step 5: `web/src/editor/extensions.ts` 与插入条接入**

extensions.ts 头部加 `import { CitationNode } from './CitationNode'`，数组中 `ResizableImage,` 之前加 `CitationNode,`。
EntryCard 的 FloatingMenu「图片」按钮后加：

```tsx
          <button onClick={() => {
            const url = window.prompt('文献链接（DOI / arXiv / PubMed）')
            if (url) {
              import('../editor/pasteRules').then(({ insertCitation }) => insertCitation(editor.view, url.trim()))
            }
          }}>引用</button>
```

- [ ] **Step 6: `web/src/styles.css` 末尾追加引用卡片样式**

```css
/* ---------- 引用卡片 ---------- */
.cite-card {
  border: 1px solid var(--border); border-left: 3px solid var(--accent);
  border-radius: 8px; padding: 8px 14px; margin: 6px 0;
  display: flex; flex-direction: column; gap: 2px; background: var(--bg);
}
.cite-title { color: var(--fg); font-weight: 600; text-decoration: none; font-size: 14.5px; }
.cite-title.plain { font-weight: 400; color: var(--accent); word-break: break-all; }
.cite-title:hover { color: var(--accent); }
.cite-meta { color: var(--muted); font-size: 12.5px; }
```

- [ ] **Step 7: 全部测试 + 【人工验证】**

Run: `cd web && npx vitest run` → Expected: PASS。
浏览器：粘贴 `https://arxiv.org/abs/1706.03762` → 先出「抓取文献信息…」卡片，数秒内变成标题+作者+年份+venue 的卡片，点击新开原文；断网时粘贴 → 保持普通链接样式不阻塞；插入条「引用」按钮输入 DOI 同效；服务端重复粘贴同链接秒出（缓存）。

- [ ] **Step 8: 提交**

```bash
git add web/src web/test
git commit -m "feat(web): 学术链接粘贴自动升级为引用卡片，失败降级普通链接"
```

---

### Task 17: AI HTML 粘贴——智能分类 + 沙箱嵌入块

**Files:**
- Create: `web/src/editor/HtmlEmbed.tsx`, `web/src/components/Toast.tsx`
- Modify: `web/src/editor/pasteRules.ts`, `web/src/editor/extensions.ts`, `web/src/components/EntryCard.tsx`, `web/src/App.tsx`, `web/src/styles.css`
- Test: `web/test/classifyHtml.test.ts`

- [ ] **Step 1: 写失败测试 `web/test/classifyHtml.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { classifyHtml, looksLikeHtmlSource } from '../src/editor/pasteRules'

describe('classifyHtml', () => {
  const content: [string, string][] = [
    ['纯段落', '<p>你好<strong>世界</strong></p>'],
    ['gdocs 风格行内样式', '<span style="font-weight:700">加粗</span><p style="margin:0">正文</p>'],
    ['表格', '<table><tr><td>a</td><td>b</td></tr></table>'],
    ['标题列表', '<h2>题</h2><ul><li>一</li></ul>'],
  ]
  const embed: [string, string][] = [
    ['带 script 的 artifact', '<div id="app"></div><script>render()</script>'],
    ['带 style 块', '<style>.x{color:red}</style><div class="x">彩</div>'],
    ['canvas 图表', '<canvas id="chart"></canvas>'],
    ['iframe', '<iframe src="https://x"></iframe>'],
    ['内联事件', '<button onclick="go()">点</button>'],
    ['外链样式表', '<link rel="stylesheet" href="a.css"><div>x</div>'],
  ]
  for (const [name, html] of content) it(`内容型：${name}`, () => expect(classifyHtml(html)).toBe('content'))
  for (const [name, html] of embed) it(`嵌入型：${name}`, () => expect(classifyHtml(html)).toBe('embed'))
})

describe('looksLikeHtmlSource（纯文本粘贴的 HTML 源码识别）', () => {
  const yes = ['<!doctype html><html>…', '<div class="card">x</div>', '  <svg viewBox="0 0 1 1"></svg>']
  const no = ['a < b 且 c > d', '普通文字', '2 <3> 4']
  for (const s of yes) it(`✓ ${s.slice(0, 24)}`, () => expect(looksLikeHtmlSource(s)).toBe(true))
  for (const s of no) it(`✗ ${s}`, () => expect(looksLikeHtmlSource(s)).toBe(false))
})
```

Run: `cd web && npx vitest run test/classifyHtml.test.ts` → Expected: FAIL。

- [ ] **Step 2: `web/src/editor/pasteRules.ts` 加分类器与嵌入分支**

新增导出（文件任意顶层位置）：

```ts
// 含脚本/样式块/交互元素 → 保真嵌入；否则交给编辑器解析为可编辑正文。
// 已知取舍：Word 桌面版粘贴常带 <style> 块会被判为嵌入，可用嵌入块的「转纯文本」逃生。
const EMBED_RE = /<\s*(script|style|canvas|iframe|video|audio|form|object|embed|link)\b|\son\w+\s*=/i

export function classifyHtml(html: string): 'embed' | 'content' {
  return EMBED_RE.test(html) ? 'embed' : 'content'
}

export function looksLikeHtmlSource(text: string): boolean {
  return /^\s*<(!doctype|html|head|body|div|section|article|main|svg|style|script|table|figure|canvas)\b/i.test(text)
}

export function insertHtmlEmbed(view: EditorView, html: string) {
  const node = view.state.schema.nodes.htmlEmbed.create({ html })
  view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
}
```

`handlePaste` 改为完整分流（替换原函数体）：

```ts
        handlePaste: (view, event) => {
          const files = pickImageFiles(event.clipboardData?.files ?? [])
          if (files.length) { void insertImages(view, files); return true }
          const text = event.clipboardData?.getData('text/plain')?.trim() ?? ''
          if (text && isCitationUrl(text)) { insertCitation(view, text); return true }
          const html = event.clipboardData?.getData('text/html') ?? ''
          if (html && classifyHtml(html) === 'embed') { insertHtmlEmbed(view, html); return true }
          if (!html && looksLikeHtmlSource(text)) { insertHtmlEmbed(view, text); return true }
          if (html) {
            // 内容型：交给默认粘贴（可编辑），但给一个「改为嵌入块」的逃生口
            window.dispatchEvent(new CustomEvent('parchment:toast', {
              detail: {
                message: '已作为正文粘贴',
                actionLabel: '改为嵌入块',
                onAction: () => {
                  undo(view.state, view.dispatch)
                  insertHtmlEmbed(view, html)
                },
              },
            }))
          }
          return false
        },
```

头部加 `import { undo } from '@tiptap/pm/history'`。

- [ ] **Step 3: 写 `web/src/editor/HtmlEmbed.tsx`**

```tsx
import { Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useState } from 'react'

export const HtmlEmbed = Node.create({
  name: 'htmlEmbed',
  group: 'block',
  atom: true,
  addAttributes() {
    return { html: { default: '' }, height: { default: 320 }, collapsed: { default: false } }
  },
  parseHTML() {
    return [{
      tag: 'div[data-html-embed]',
      getAttrs: el => ({ html: (el as HTMLElement).dataset.html ?? '' }),
    }]
  },
  renderHTML({ node }) {
    return ['div', { 'data-html-embed': '', 'data-html': node.attrs.html }]
  },
  addNodeView() { return ReactNodeViewRenderer(EmbedView) },
})

function EmbedView({ node, updateAttributes, deleteNode, editor, getPos }: NodeViewProps) {
  const [showSource, setShowSource] = useState(false)
  const a = node.attrs

  function startHeightDrag(e: React.PointerEvent) {
    e.preventDefault()
    const startY = e.clientY, startH = a.height
    const move = (ev: PointerEvent) =>
      updateAttributes({ height: Math.max(80, startH + (ev.clientY - startY)) })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function toPlainText() {
    const doc = new DOMParser().parseFromString(a.html, 'text/html')
    const text = doc.body.textContent?.replace(/\n{3,}/g, '\n\n').trim() ?? ''
    const pos = typeof getPos === 'function' ? getPos() : null
    if (pos === null) return
    editor.chain().focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .insertContentAt(pos, text.split(/\n+/).map(t => ({
        type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] })))
      .run()
  }

  return (
    <NodeViewWrapper as="div" className="embed-block">
      <div className="embed-bar" contentEditable={false}>
        <span className="embed-tag">HTML</span>
        <span className="embed-actions">
          <button onClick={() => updateAttributes({ collapsed: !a.collapsed })}>{a.collapsed ? '展开' : '折叠'}</button>
          <button onClick={() => setShowSource(v => !v)}>{showSource ? '预览' : '源码'}</button>
          <button onClick={toPlainText}>转纯文本</button>
          <button onClick={() => deleteNode()}>删除</button>
        </span>
      </div>
      {!a.collapsed && (showSource ? (
        <textarea className="embed-source" value={a.html} rows={10}
          onChange={e => updateAttributes({ html: e.target.value })} />
      ) : (
        <>
          <iframe className="embed-frame" sandbox="allow-scripts" srcDoc={a.html}
            style={{ height: a.height }} title="嵌入内容" />
          <div className="embed-resize" onPointerDown={startHeightDrag} title="拖动调整高度" />
        </>
      ))}
    </NodeViewWrapper>
  )
}
```

- [ ] **Step 4: 写 `web/src/components/Toast.tsx` 并接入 App**

```tsx
import { useEffect, useRef, useState } from 'react'

interface ToastMsg { message: string; actionLabel?: string; onAction?: () => void }

export function Toast() {
  const [msg, setMsg] = useState<ToastMsg | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    const on = (e: Event) => {
      setMsg((e as CustomEvent<ToastMsg>).detail)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setMsg(null), 6000)
    }
    window.addEventListener('parchment:toast', on)
    return () => { window.removeEventListener('parchment:toast', on); clearTimeout(timer.current) }
  }, [])
  if (!msg) return null
  return (
    <div className="toast">
      <span>{msg.message}</span>
      {msg.actionLabel && (
        <button onClick={() => { msg.onAction?.(); setMsg(null) }}>{msg.actionLabel}</button>
      )}
    </div>
  )
}
```

`web/src/App.tsx`：import 加 `import { Toast } from './components/Toast'`；`<Lightbox />` 之后加 `<Toast />`。

- [ ] **Step 5: `web/src/editor/extensions.ts` 接入 + 插入条按钮**

extensions.ts 头部加 `import { HtmlEmbed } from './HtmlEmbed'`，数组 `PasteRules,` 之前加 `HtmlEmbed,`。
EntryCard FloatingMenu「引用」按钮后加：

```tsx
          <button onClick={() => {
            const html = window.prompt('粘贴 HTML 源码')
            if (html) {
              import('../editor/pasteRules').then(({ insertHtmlEmbed }) => insertHtmlEmbed(editor.view, html))
            }
          }}>嵌入</button>
```

- [ ] **Step 6: `web/src/styles.css` 末尾追加嵌入块与 toast 样式**

```css
/* ---------- HTML 嵌入块 ---------- */
.embed-block { border: 1px solid var(--border); border-radius: 10px; margin: 8px 0; overflow: hidden; }
.embed-bar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 4px 10px; background: var(--bg); border-bottom: 1px solid var(--border);
}
.embed-tag { font-size: 11px; color: var(--muted); font-family: var(--mono); letter-spacing: 0.5px; }
.embed-actions { display: flex; gap: 2px; }
.embed-actions button {
  border: none; background: none; color: var(--muted); font-size: 12px;
  cursor: pointer; padding: 3px 7px; border-radius: 6px;
}
.embed-actions button:hover { background: var(--border); color: var(--fg); }
.embed-frame { display: block; width: 100%; border: none; background: #fff; }
.embed-resize { height: 8px; cursor: ns-resize; background: var(--bg); }
.embed-resize:hover { background: var(--border); }
.embed-source {
  display: block; width: 100%; border: none; resize: vertical; padding: 10px 14px;
  font-family: var(--mono); font-size: 12.5px; background: var(--bg); color: var(--fg); outline: none;
}
.toast {
  position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 90;
  display: flex; gap: 12px; align-items: center;
  background: var(--fg); color: var(--bg); border-radius: 10px; padding: 9px 16px;
  font-size: 13.5px; box-shadow: 0 6px 24px rgba(0,0,0,0.25);
}
.toast button {
  border: none; background: none; color: inherit; font-weight: 600;
  cursor: pointer; font-size: 13.5px; text-decoration: underline;
}
```

- [ ] **Step 7: 全部测试 + 【人工验证】**

Run: `cd web && npx vitest run` → Expected: PASS。
浏览器：
1. 从任意 AI 对话复制一段带格式的回答粘贴 → 变可编辑正文（标题/列表保留），底部 toast「已作为正文粘贴 · 改为嵌入块」，点击后变嵌入块。
2. 复制一个完整 HTML artifact 源码（含 `<style>`/`<script>`）以纯文本粘贴 → 自动变嵌入块，脚本在沙箱里正常运行（能动），拖底边调高度，折叠/源码/删除可用。
3. 「转纯文本」把嵌入块降级为文字段落。
4. 嵌入块内脚本无法访问笔记页面（sandbox 无 same-origin）。

- [ ] **Step 8: 提交**

```bash
git add web/src web/test
git commit -m "feat(web): HTML 粘贴智能分类，交互内容进沙箱嵌入块（可调高/折叠/源码/转文本）"
```

---

### Task 18: Mermaid 流程图块（懒加载渲染）

**Files:**
- Create: `web/src/editor/MermaidBlock.tsx`
- Modify: `web/src/editor/extensions.ts`, `web/src/components/EntryCard.tsx`, `web/src/styles.css`
- Test: `web/test/mermaid.test.ts`

- [ ] **Step 1: 写失败测试 `web/test/mermaid.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/editor/extensions'
import { MERMAID_INPUT_RE } from '../src/editor/MermaidBlock'

describe('mermaid 块', () => {
  it('输入规则正则匹配 ```mermaid + 空白', () => {
    expect('```mermaid '.match(MERMAID_INPUT_RE)).toBeTruthy()
    expect('```python '.match(MERMAID_INPUT_RE)).toBeNull()
  })
  it('节点已注册且可带 code 属性插入', () => {
    const ed = new Editor({ extensions: buildExtensions({}), content: { type: 'doc', content: [] } })
    ed.commands.insertContent({ type: 'mermaidBlock', attrs: { code: 'graph TD; A-->B' } })
    expect(JSON.stringify(ed.getJSON())).toContain('A-->B')
    ed.destroy()
  })
})
```

Run: `cd web && npx vitest run test/mermaid.test.ts` → Expected: FAIL。

- [ ] **Step 2: 写 `web/src/editor/MermaidBlock.tsx`**

```tsx
import { InputRule, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'

export const MERMAID_INPUT_RE = /^```mermaid\s$/

let seq = 0

export const MermaidBlock = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,
  addAttributes() { return { code: { default: '' } } },
  parseHTML() {
    return [{ tag: 'pre[data-mermaid]', getAttrs: el => ({ code: (el as HTMLElement).textContent ?? '' }) }]
  },
  renderHTML({ node }) { return ['pre', { 'data-mermaid': '' }, node.attrs.code] },
  addInputRules() {
    return [new InputRule({
      find: MERMAID_INPUT_RE,
      handler: ({ range, chain }) => {
        chain().deleteRange(range).insertContent({ type: 'mermaidBlock', attrs: { code: '' } }).run()
      },
    })]
  },
  addNodeView() { return ReactNodeViewRenderer(MermaidView) },
})

function MermaidView({ node, updateAttributes }: NodeViewProps) {
  const code: string = node.attrs.code
  const [editing, setEditing] = useState(!code)
  const [draft, setDraft] = useState(code)
  const [svg, setSvg] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editing || !code) return
    let alive = true
    import('mermaid').then(async m => {
      try {
        m.default.initialize({ startOnLoad: false, securityLevel: 'strict',
          theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default' })
        const { svg } = await m.default.render(`pmmd-${++seq}`, code)
        if (alive) { setSvg(svg); setErr(null) }
      } catch (e) {
        if (alive) setErr(String(e))
      }
    })
    return () => { alive = false }
  }, [code, editing])

  if (editing) {
    return (
      <NodeViewWrapper as="div" className="mermaid-block editing" contentEditable={false}>
        <textarea autoFocus rows={6} value={draft} placeholder={'graph TD\n  想法 --> 实验\n  实验 --> 论文'}
          onChange={e => setDraft(e.target.value)} />
        <div className="mermaid-actions">
          <button onClick={() => { updateAttributes({ code: draft }); setEditing(false) }}>完成</button>
        </div>
      </NodeViewWrapper>
    )
  }
  return (
    <NodeViewWrapper as="div" className="mermaid-block" contentEditable={false}
      onDoubleClick={() => { setDraft(code); setEditing(true) }}>
      {err
        ? <div className="mermaid-err"><p>流程图语法错误（双击修改）</p><pre>{code}</pre></div>
        : <div ref={box} className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />}
    </NodeViewWrapper>
  )
}
```

- [ ] **Step 3: 接入 extensions 与插入条**

extensions.ts 头部加 `import { MermaidBlock } from './MermaidBlock'`，数组 `HtmlEmbed,` 之前加 `MermaidBlock,`。
EntryCard FloatingMenu「嵌入」按钮后加：

```tsx
          <button onClick={() => editor.chain().focus()
            .insertContent({ type: 'mermaidBlock', attrs: { code: '' } }).run()}>流程图</button>
```

- [ ] **Step 4: `web/src/styles.css` 末尾追加**

```css
/* ---------- Mermaid ---------- */
.mermaid-block { margin: 8px 0; border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; }
.mermaid-block.editing textarea {
  width: 100%; border: none; outline: none; resize: vertical;
  font-family: var(--mono); font-size: 13px; background: none; color: var(--fg);
}
.mermaid-actions { text-align: right; }
.mermaid-actions button {
  border: none; background: var(--accent); color: #fff; border-radius: 6px;
  padding: 4px 14px; cursor: pointer; font-size: 13px;
}
.mermaid-svg { display: flex; justify-content: center; overflow-x: auto; }
.mermaid-svg svg { max-width: 100%; height: auto; }
.mermaid-err { color: var(--danger); font-size: 13px; }
.mermaid-err pre { color: var(--muted); font-family: var(--mono); font-size: 12px; }
```

- [ ] **Step 5: 全部测试 + 【人工验证】**

Run: `cd web && npx vitest run` → Expected: PASS。
浏览器：空行敲 ```` ```mermaid ````（带尾随空格）→ 出编辑框，填 `graph TD; 想法-->实验; 实验-->论文` 点完成 → 渲染流程图；双击图 → 回到源码编辑；语法错误 → 显示错误与源码不吞内容；`$E=mc^2$` 与 `$$\int_0^1 x\,dx$$` 公式渲染正常（KaTeX，Task 10 已含）；暗色主题下 mermaid 用暗色配色。
网络面板确认：mermaid 的 JS chunk 只在页面出现第一个流程图时才加载（懒加载生效）。

- [ ] **Step 6: 提交**

```bash
git add web/src web/test
git commit -m "feat(web): Mermaid 流程图块，懒加载渲染，双击改源码"
```

---

### Task 19: 导出按钮 + 主题切换 + 微交互打磨 + 响应式

**Files:**
- Modify: `web/src/App.tsx`, `web/src/components/Timeline.tsx`, `web/src/styles.css`

- [ ] **Step 1: `web/src/App.tsx` 顶栏加导出与主题切换**

`topbar` 中搜索按钮之前加：

```tsx
        <a className="icon-btn" href="/api/export" title="导出全部（Markdown+图片）">⤓</a>
        <button className="icon-btn" title="切换主题" onClick={() => {
          const cur = document.documentElement.dataset.theme
          const next = cur === 'dark' ? 'light' : 'dark'
          document.documentElement.dataset.theme = next
          localStorage.setItem('theme', next)
        }}>◐</button>
```

- [ ] **Step 2: Timeline 加载骨架**

`Timeline.tsx` 返回体中 `{!t.hasOlder && ...}` 之前加：

```tsx
      {!t.ready && <div className="skeleton"><div /><div /><div /></div>}
```

- [ ] **Step 3: `web/src/styles.css` 末尾追加打磨与响应式**

```css
/* ---------- 打磨 ---------- */
.skeleton { max-width: 720px; margin: 20px auto; display: flex; flex-direction: column; gap: 12px; }
.skeleton div {
  height: 72px; border-radius: 12px;
  background: linear-gradient(100deg, var(--card) 40%, var(--border) 50%, var(--card) 60%);
  background-size: 200% 100%; animation: shimmer 1.2s infinite;
}
@keyframes shimmer { to { background-position: -200% 0; } }
html { scrollbar-color: var(--border) transparent; }
.timeline { scrollbar-width: thin; }
* { scrollbar-width: thin; }

@media (max-width: 700px) {
  .sidebar, .scrubber { display: none; }
  .timeline { padding: 0 10px 40px; }
  .entry-card { padding: 8px 12px 10px; }
  .back-today { right: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
```

- [ ] **Step 4: 全部测试 + 【人工验证】**

Run: `cd web && npx vitest run` → Expected: PASS。
浏览器：⤓ 下载 zip，解开检查 `notes/2026/…md` 可读、图片在 `images/`、嵌入块在 `embeds/`、图片相对路径能在本地 Markdown 预览器里显示；◐ 切换亮暗主题且刷新后保持；窄窗口（<700px）下边栏与时间条隐藏、卡片撑满；首次加载出现骨架屏后平滑落底。

- [ ] **Step 5: 提交**

```bash
git add web/src
git commit -m "feat(web): 导出入口、主题切换与加载骨架/响应式打磨"
```

---

### Task 20: 静态托管 + Docker + fly.io 部署 + 验收

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `fly.toml`, `README.md`
- Modify: `server/src/app.js`

- [ ] **Step 1: `server/src/app.js` 加生产静态托管**

`createApp` 内 `exportRoutes(...)` 之后、`return app` 之前加：

```js
  if (webDist) {
    const index = fs.readFileSync(path.join(webDist, 'index.html'), 'utf8')
    app.use('/assets/*', serveStatic({ root: path.relative(process.cwd(), webDist) || '.' }))
    app.get('*', c => c.html(index))
  }
```

头部加：

```js
import fs from 'node:fs'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
```

- [ ] **Step 2: 生产模式本地冒烟**

```bash
cd web && npm run build
cd ../server && NODE_ENV=production ACCESS_PASSWORD=dev WEB_DIST=../web/dist npm start
```

另一终端：`curl -s localhost:8787/ | head -3` → 应输出 index.html 开头；`curl -s localhost:8787/api/health` → `{"ok":true}`。浏览器开 `localhost:8787` 完整走一遍登录+写作。

- [ ] **Step 3: 写 `Dockerfile` 与 `.dockerignore`**

`Dockerfile`：

```dockerfile
FROM node:22-bookworm-slim AS webbuild
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web .
RUN npm run build

FROM node:22-bookworm-slim AS serverdeps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=serverdeps /app/server/node_modules server/node_modules
COPY server/package.json server/
COPY server/src server/src
COPY --from=webbuild /app/web/dist web/dist
ENV NODE_ENV=production DATA_DIR=/data WEB_DIST=/app/web/dist PORT=8787
EXPOSE 8787
CMD ["node", "server/src/index.js"]
```

`.dockerignore`：

```
node_modules
**/node_modules
data
**/dist
docs
.git
```

- [ ] **Step 4: 写 `fly.toml`**

```toml
# app 名由 `fly launch` 生成/确认，占位如下
app = "parchment"
primary_region = "nrt"

[env]
  PORT = "8787"

[mounts]
  source = "parchment_data"
  destination = "/data"

[http_service]
  internal_port = 8787
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

- [ ] **Step 5: 写 `README.md`**

内容包含（用简洁中文写全）：产品一句话简介与截图位、本地开发（两终端命令）、测试命令、部署四步：

```bash
fly launch --no-deploy        # 首次：确认 app 名与 region，沿用仓库 fly.toml
fly volumes create parchment_data --size 3
fly secrets set ACCESS_PASSWORD='你的访问密码'
fly deploy
```

以及：数据与备份（一切在 /data，`fly ssh sftp` 拉走即备份）、导出说明（页面 ⤓）、技术栈一览。

- [ ] **Step 6: 本地 Docker 冒烟（可选但推荐）**

```bash
docker build -t parchment . && docker run --rm -p 8787:8787 -e ACCESS_PASSWORD=dev -v /tmp/parchment-data:/data parchment
```

`curl localhost:8787/api/health` → `{"ok":true}`。

- [ ] **Step 7: 部署到用户的 fly.io**

按 README 四步执行（需要用户已 `fly auth login`）。部署后浏览器打开 app 域名，走一遍登录+写一条笔记+传一张图。

- [ ] **Step 8: 验收清单（规格第 11 节，逐项人工过）**

- [ ] 打开到能打字 ≤ 1 秒（温机）
- [ ] 粘贴内容型 AI HTML → 可编辑正文
- [ ] 粘贴带脚本 artifact → 沙箱嵌入块能动、可调高
- [ ] 粘 arXiv/DOI → 数秒出引用卡片；断网降级普通链接
- [ ] 图片 Ctrl+V 插入、拖角缩放、刷新保持、服务器按年月归档
- [ ] 断网打字不丢，恢复自动补存
- [ ] 中英文搜索都能命中
- [ ] `#标签` 打标 → 边栏点项目抽出项目时间线
- [ ] 一键导出 zip：Markdown 可读、图片齐全
- [ ] 时间条拖动跳日期流畅；⌘K 搜索/跳日期/切项目；「回到今天」正常

- [ ] **Step 9: 提交**

```bash
git add Dockerfile .dockerignore fly.toml README.md server/src/app.js
git commit -m "feat: 生产静态托管、Docker 镜像与 fly.io 部署配置"
```
