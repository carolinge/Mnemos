# Viscio 地基与部署 实施计划（Plan 1 / 3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭出 Viscio 的地基：独立仓库 + 完整数据模型/API + 认证 + 部署桥接进 homepage，外加一个只读画布渲染，端到端验证「新建 deck → 存元素 → 在 `/viscio` 上正确渲染 → 跟 Mnemos 的登录状态互不影响」整条链路。

**Architecture:** 单容器内的第二个 Hono 子应用（跟 Mnemos 同款模式）：Hono(Node ESM) + better-sqlite3 后端，Vite+React+TS 前端，通过 `@hono/node-server` 的 `getRequestListener` 桥接进 homepage 现有的 Express 进程，挂在 `/viscio` 路径下，数据落在共享的 `merged_data` 卷。规格见 `docs/superpowers/specs/2026-08-18-viscio-design.md`（以下称「规格」）。

**Tech Stack:** Node 22 / Hono 4 / better-sqlite3 11 / @hono/node-server 1 / Vite 5 / React 18 / TypeScript / react-router-dom 6 / @tiptap/core+html 2（只读渲染用）/ katex / highlight.js / vitest

---

## 项目拆分说明

规格里 Viscio 的完整范围（画布编辑交互、放映模式、版本历史、离线导出）太大，不适合塞进一个计划文档。拆成三个顺序计划，每个都能独立产出可跑可测的东西：

- **Plan 1（本文档）**：仓库骨架、完整数据模型与 API、认证（含 cookie 隔离修复）、部署桥接、只读画布渲染。跑完这个计划，`/viscio` 已经在线，能新建 deck、通过 API 写入元素、在浏览器里看到渲染结果，且不影响 Mnemos 的登录状态。
- **Plan 2**：画布真正的编辑交互——六种形状工具、Tiptap 富文本文字框、embed/latex/code 插入、拖拽/缩放/智能对齐线、多选编组、图层顺序、撤销重做、幻灯片管理 UI、autosave。跑完这个计划，用户能真正用鼠标在浏览器里搭出一页幻灯片。
- **Plan 3**：放映模式（含翻页遥控器、页码、embed 重新挂载）、分享链接、版本历史 UI（Ctrl+S/10 分钟快照、恢复）、离线导出。跑完这个计划，用户能真正带着它去讲一次学术报告。

Plan 2、3 会在 Plan 1 验收通过后单独写。

## 全局执行说明

- `viscio` 是一个**新的独立 git 仓库**，路径 `/Users/carolinge/Desktop/parchment/viscio`，跟 `riffle/`、`homepage/` 平级（本仓库的 `.gitignore` 需要排除它，见 Task 17）。Task 1 会先 `git init`。
- 服务端为纯 ESM JavaScript（无构建步骤）；前端为 TypeScript。
- 测试命令：服务端 `cd viscio/server && npx vitest run`；前端 `cd viscio/web && npx vitest run`。
- 手动验证需要两个终端：`cd viscio/server && VISCIO_ACCESS_PASSWORD=dev DATA_DIR=./data npm run dev`（端口 8788）和 `cd viscio/web && npm run dev`（Vite 代理 `/viscio/api` 与 `/viscio/play` 到 8788，浏览器打开 `http://localhost:5173/viscio/`，注意路径里的 `/viscio/` 前缀不能省）。标记为【人工验证】的步骤在浏览器完成。
- **提交信息不加 `Co-Authored-By` 或任何 AI 生成标记**——这是仓库主人的明确要求（见根 `CLAUDE.md`），Viscio 是仓库主人自己的项目，同样适用。这一点跟本仓库更早那份 `2026-07-28-parchment.md` 计划里「加 Co-Authored-By 尾行」的说明不同，那是旧约定，Viscio 不沿用。
- 设计意图不明时，回读规格对应章节；规格是唯一权威。
- **一处相对 Mnemos 现有做法的刻意偏离**：Mnemos 的 Vite `base: '/mnemos/'` 只在生产构建生效，本地开发时是根路径；Viscio 的 `base: '/viscio/'` 在开发和生产**都**生效（Task 11）。原因：Viscio 的认证 cookie 显式 scope 到 `path: '/viscio'`（修复 Mnemos 那边 cookie 未限定 path 导致的撞车风险，见规格第 2 节），如果本地开发时前端跑在根路径、请求路径对不上 `/viscio` 前缀，登录后 cookie 就带不回来，本地开发会跟真实行为不一致。所以两边都固定用 `/viscio/` 前缀，简单也更少踩坑。
- **一处刻意简化，标了 ponytail 出处**：`PUT /api/slides/:id/elements` 是整批删除重插入，不做增量 diff（Task 6）。单张幻灯片撑死几十个元素，删除重插入的开销可以忽略；如果以后某张幻灯片元素多到构成瓶颈，再改成增量 upsert。

## 文件结构总览

```
viscio/                          # 新仓库根目录
  .gitignore
  server/
    package.json
    src/
      index.js       # 独立进程入口（仅供本地开发/测试用，生产环境由 homepage 直接 import app.js）
      app.js          # createApp({db, password, cookiePath, webDist}) 工厂，桥接进 homepage 时被直接调用
      db.js           # createDb(filePath)：建表 decks/slides/elements/blobs/revisions/sessions
      auth.js         # createAuth({db, password, cookiePath})：POST /api/auth + requireAuth 中间件
      decks.js        # decks CRUD + regenerate-slug + slides CRUD（含重排）
      elements.js     # GET/PUT /api/slides/:id/elements（整批替换）
      blobs.js        # 内容寻址：POST /api/blobs（受保护）+ GET /api/blobs/:hash（公开）
      revisions.js    # POST/GET /api/decks/:id/revisions + POST /api/revisions/:id/restore + FIFO 淘汰
      play.js         # GET /play/:slug（公开播放数据接口）
      serialize.js    # parseElement/serializeElement 共享工具（content JSON 序列化）
    test/*.test.js
  web/
    package.json  vite.config.ts  tsconfig.json  index.html
    src/
      main.tsx  App.tsx  api.ts  useAuth.ts  types.ts  styles.css
      routes/Login.tsx  routes/DeckList.tsx  routes/Editor.tsx
      canvas/Canvas.tsx  canvas/CanvasElement.tsx
      canvas/shapes/RectShape.tsx  EllipseShape.tsx  LineArrowShape.tsx  DiamondShape.tsx  FreehandShape.tsx
      canvas/TextBoxView.tsx  canvas/ImageElement.tsx  canvas/EmbedElement.tsx  canvas/LatexElement.tsx  canvas/CodeElement.tsx
      lib/geometry.ts
    test/*.test.ts(x)  test/setup.ts

homepage/                        # 已有仓库，本计划会修改
  scripts/sync-viscio-src.sh     # 新增，照抄 sync-mnemos-src.sh 的模式
  server/server.js               # 修改：新增 /viscio 桥接中间件
  Dockerfile                     # 修改：新增 viscio/web 构建阶段 + viscio/server 依赖安装
  .gitignore                     # 修改：新增 viscio-src/

parchment/（本仓库根目录）
  .gitignore                     # 修改：新增 viscio/ 排除
```

---

### Task 1: viscio 仓库脚手架 + server 健康检查

**Files:**
- Create: `/Users/carolinge/Desktop/parchment/viscio/.gitignore`, `viscio/server/package.json`, `viscio/server/src/app.js`, `viscio/server/test/health.test.js`

- [ ] **Step 1: 初始化仓库**

Run:
```bash
mkdir -p /Users/carolinge/Desktop/parchment/viscio
cd /Users/carolinge/Desktop/parchment/viscio
git init
```
Expected: `Initialized empty Git repository in .../viscio/.git/`

- [ ] **Step 2: 写 `.gitignore`**

```
node_modules/
dist/
data/
*.log
.DS_Store
```

- [ ] **Step 3: 写 `server/package.json`**

```json
{
  "name": "viscio-server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.7",
    "better-sqlite3": "^11.7.0",
    "hono": "^4.6.14"
  },
  "devDependencies": {
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 4: 安装依赖**

Run: `cd /Users/carolinge/Desktop/parchment/viscio/server && npm install`
Expected: 无报错，生成 `package-lock.json`（better-sqlite3 会编译原生模块，若报缺 python3/make/g++，参照根 README 装好本地构建工具链）。

- [ ] **Step 5: 写失败测试 `server/test/health.test.js`**

```js
import { describe, it, expect } from 'vitest'
import { createApp } from '../src/app.js'

describe('health', () => {
  it('GET /api/health 返回 ok 且无需认证', async () => {
    const app = createApp({ db: null, password: 'pw' })
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
```

Run: `cd /Users/carolinge/Desktop/parchment/viscio/server && npx vitest run`
Expected: FAIL（`../src/app.js` 不存在）。

- [ ] **Step 6: 写 `server/src/app.js` 最小实现**

```js
import { Hono } from 'hono'

export function createApp({ db, password, cookiePath = '/viscio', webDist } = {}) {
  const app = new Hono()
  app.get('/api/health', (c) => c.json({ ok: true }))
  return app
}
```

- [ ] **Step 7: 跑测试确认通过**

Run: `cd /Users/carolinge/Desktop/parchment/viscio/server && npx vitest run`
Expected: PASS（1 passed）。

- [ ] **Step 8: 提交**

```bash
cd /Users/carolinge/Desktop/parchment/viscio
git add .gitignore server/package.json server/package-lock.json server/src/app.js server/test/health.test.js
git commit -m "feat: 仓库骨架 + server 健康检查"
```

---

### Task 2: 数据表结构（db.js）

**Files:**
- Create: `viscio/server/src/db.js`, `viscio/server/test/db.test.js`

- [ ] **Step 1: 写失败测试 `server/test/db.test.js`**

```js
import { describe, it, expect } from 'vitest'
import { createDb } from '../src/db.js'

describe('createDb', () => {
  it('建出所有表，可以插入并查询一条 deck', () => {
    const db = createDb(':memory:')
    db.prepare(`INSERT INTO decks (id, title, canvas_width, canvas_height, share_slug, created_at, updated_at)
                VALUES ('d1', 'demo', 1280, 720, 'slug1', 1, 1)`).run()
    const row = db.prepare('SELECT * FROM decks WHERE id = ?').get('d1')
    expect(row.title).toBe('demo')
    expect(row.canvas_width).toBe(1280)
  })

  it('删除 deck 会级联删除它的 slides（外键 ON DELETE CASCADE 生效）', () => {
    const db = createDb(':memory:')
    db.prepare(`INSERT INTO decks (id, title, canvas_width, canvas_height, share_slug, created_at, updated_at)
                VALUES ('d1', 'demo', 1280, 720, 'slug1', 1, 1)`).run()
    db.prepare(`INSERT INTO slides (id, deck_id, position, notes) VALUES ('s1', 'd1', 0, '')`).run()
    db.prepare('DELETE FROM decks WHERE id = ?').run('d1')
    const row = db.prepare('SELECT * FROM slides WHERE id = ?').get('s1')
    expect(row).toBeUndefined()
  })
})
```

Run: `cd /Users/carolinge/Desktop/parchment/viscio/server && npx vitest run`
Expected: FAIL（`../src/db.js` 不存在）。

- [ ] **Step 2: 写 `server/src/db.js`**

```js
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  canvas_width INTEGER NOT NULL DEFAULT 1280,
  canvas_height INTEGER NOT NULL DEFAULT 720,
  share_slug TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS slides (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_slides_deck ON slides(deck_id, position);

CREATE TABLE IF NOT EXISTS elements (
  id TEXT PRIMARY KEY,
  slide_id TEXT NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  w REAL NOT NULL,
  h REAL NOT NULL,
  z_index INTEGER NOT NULL DEFAULT 0,
  group_id TEXT,
  content TEXT NOT NULL DEFAULT '{}',
  blob_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_elements_slide ON elements(slide_id);

CREATE TABLE IF NOT EXISTS blobs (
  hash TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data BLOB NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  snapshot TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revisions_deck ON revisions(deck_id, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
`

export function createDb(filePath) {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
  }
  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}
```

- [ ] **Step 3: 跑测试确认通过**

Run: `cd /Users/carolinge/Desktop/parchment/viscio/server && npx vitest run`
Expected: PASS（3 passed，含 Task 1 的健康检查）。

- [ ] **Step 4: 提交**

```bash
cd /Users/carolinge/Desktop/parchment/viscio
git add server/src/db.js server/test/db.test.js
git commit -m "feat: 数据表结构（decks/slides/elements/blobs/revisions/sessions）"
```

---

### Task 3: 认证（独立 cookie 名 + path 作用域）

**Files:**
- Create: `viscio/server/src/auth.js`, `viscio/server/test/auth.test.js`
- Modify: `viscio/server/src/app.js`

- [ ] **Step 1: 写失败测试 `server/test/auth.test.js`**

```js
import { describe, it, expect } from 'vitest'
import { createApp } from '../src/app.js'
import { createDb } from '../src/db.js'

function freshApp() {
  return createApp({ db: createDb(':memory:'), password: 'secret' })
}

describe('auth', () => {
  it('密码错误返回 401', async () => {
    const app = freshApp()
    const res = await app.request('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    })
    expect(res.status).toBe(401)
  })

  it('密码正确返回 200，并设置名为 viscio_session、path=/viscio 的 cookie（不是 Mnemos 用的 session/path=/，避免撞车）', async () => {
    const app = freshApp()
    const res = await app.request('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'secret' }),
    })
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toMatch(/^viscio_session=/)
    expect(setCookie).toMatch(/Path=\/viscio/)
    expect(setCookie).not.toMatch(/^session=/)
  })

  it('没有 cookie 访问受保护接口返回 401', async () => {
    const app = freshApp()
    const res = await app.request('/api/decks')
    expect(res.status).toBe(401)
  })

  it('带上登录拿到的 cookie 可以访问受保护接口', async () => {
    const app = freshApp()
    const login = await app.request('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'secret' }),
    })
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const res = await app.request('/api/decks', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
  })
})
```

Run: `cd /Users/carolinge/Desktop/parchment/viscio/server && npx vitest run`
Expected: FAIL（`../src/auth.js` 不存在，且 `/api/decks` 路由还不存在）。

- [ ] **Step 2: 写 `server/src/auth.js`**

```js
import { getCookie, setCookie } from 'hono/cookie'
import crypto from 'node:crypto'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 天

export function createAuth({ db, password, cookiePath = '/viscio' }) {
  async function login(c) {
    const body = await c.req.json().catch(() => ({}))
    if (body.password !== password) return c.json({ error: 'invalid password' }, 401)

    const token = crypto.randomUUID()
    const now = Date.now()
    db.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)')
      .run(token, now, now + SESSION_TTL_MS)

    // cookie 名和 path 都跟 Mnemos（session, path=/）不同，两边同域名下不会互相顶掉登录状态
    setCookie(c, 'viscio_session', token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: process.env.NODE_ENV === 'production',
      path: cookiePath,
      maxAge: SESSION_TTL_MS / 1000,
    })
    return c.json({ ok: true })
  }

  async function requireAuth(c, next) {
    const token = getCookie(c, 'viscio_session')
    if (!token) return c.json({ error: 'unauthorized' }, 401)
    const row = db.prepare('SELECT token FROM sessions WHERE token = ? AND expires_at > ?').get(token, Date.now())
    if (!row) return c.json({ error: 'unauthorized' }, 401)
    await next()
  }

  return { login, requireAuth }
}
```

- [ ] **Step 3: 在 `server/src/app.js` 里接上认证与一个受保护的占位路由**

```js
import { Hono } from 'hono'
import { createAuth } from './auth.js'

export function createApp({ db, password, cookiePath = '/viscio', webDist } = {}) {
  const app = new Hono()
  const { login, requireAuth } = createAuth({ db, password, cookiePath })

  app.get('/api/health', (c) => c.json({ ok: true }))
  app.post('/api/auth', login)

  app.use('/api/decks', requireAuth)
  app.use('/api/decks/*', requireAuth)
  app.get('/api/decks', (c) => c.json([])) // Task 4 会换成真实实现

  return app
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/carolinge/Desktop/parchment/viscio/server && npx vitest run`
Expected: PASS（7 passed）。

- [ ] **Step 5: 提交**

```bash
cd /Users/carolinge/Desktop/parchment/viscio
git add server/src/auth.js server/src/app.js server/test/auth.test.js
git commit -m "feat: 认证——独立 viscio_session cookie，path 限定 /viscio"
```

---

### Task 4: decks CRUD + regenerate-slug

**Files:**
- Create: `viscio/server/src/decks.js`, `viscio/server/test/decks.test.js`
- Modify: `viscio/server/src/app.js`

- [ ] **Step 1: 写失败测试 `server/test/decks.test.js`**

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { createApp } from '../src/app.js'
import { createDb } from '../src/db.js'

let app, cookie

beforeEach(async () => {
  app = createApp({ db: createDb(':memory:'), password: 'secret' })
  const login = await app.request('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'secret' }),
  })
  cookie = login.headers.get('set-cookie').split(';')[0]
})

function authed(path, init = {}) {
  return app.request(path, { ...init, headers: { ...init.headers, Cookie: cookie } })
}

describe('decks', () => {
  it('新建 deck 会返回默认标题、1280x720 画布、唯一分享 slug，并自动带一张第一页 slide', async () => {
    const res = await authed('/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(201)
    const deck = await res.json()
    expect(deck.title).toBe('未命名演示')
    expect(deck.canvas_width).toBe(1280)
    expect(deck.canvas_height).toBe(720)
    expect(deck.share_slug).toBeTruthy()

    const slides = await (await authed(`/api/decks/${deck.id}/slides`)).json()
    expect(slides).toHaveLength(1)
    expect(slides[0].position).toBe(0)
  })

  it('GET /api/decks 按更新时间倒序列出', async () => {
    await authed('/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'A' }) })
    await authed('/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'B' }) })
    const list = await (await authed('/api/decks')).json()
    expect(list.map((d) => d.title)).toEqual(['B', 'A'])
  })

  it('PATCH 改标题', async () => {
    const created = await (await authed('/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
    const res = await authed(`/api/decks/${created.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '新标题' }),
    })
    expect((await res.json()).title).toBe('新标题')
  })

  it('DELETE 删除 deck', async () => {
    const created = await (await authed('/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
    await authed(`/api/decks/${created.id}`, { method: 'DELETE' })
    const res = await authed(`/api/decks/${created.id}`)
    expect(res.status).toBe(404)
  })

  it('regenerate-slug 换掉分享链接，旧 slug 失效', async () => {
    const created = await (await authed('/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
    const res = await authed(`/api/decks/${created.id}/regenerate-slug`, { method: 'POST' })
    const updated = await res.json()
    expect(updated.share_slug).not.toBe(created.share_slug)
  })
})
```

Run: `cd /Users/carolinge/Desktop/parchment/viscio/server && npx vitest run`
Expected: FAIL（`../src/decks.js` 不存在，`/api/decks` 目前只是占位）。

- [ ] **Step 2: 写 `server/src/decks.js`**

```js
import crypto from 'node:crypto'

function newSlug() {
  return crypto.randomBytes(9).toString('base64url')
}

function getDeck(db, id) {
  return db.prepare('SELECT * FROM decks WHERE id = ?').get(id) || null
}

export function registerDeckRoutes(app, { db }) {
  app.post('/api/decks', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const id = crypto.randomUUID()
    const now = Date.now()
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : '未命名演示'

    db.prepare(`INSERT INTO decks (id, title, canvas_width, canvas_height, share_slug, created_at, updated_at)
                VALUES (?, ?, 1280, 720, ?, ?, ?)`)
      .run(id, title, newSlug(), now, now)

    const slideId = crypto.randomUUID()
    db.prepare('INSERT INTO slides (id, deck_id, position, notes) VALUES (?, ?, 0, ?)').run(slideId, id, '')

    return c.json(getDeck(db, id), 201)
  })

  // 次级排序键 rowid：updated_at 精度只有 1ms，两次写入撞在同一毫秒时
  // SQLite 对并列行的顺序不确定，加 rowid 兜底成确定顺序（按写入先后）。
  app.get('/api/decks', (c) => c.json(db.prepare('SELECT * FROM decks ORDER BY updated_at DESC, rowid DESC').all()))

  app.get('/api/decks/:id', (c) => {
    const deck = getDeck(db, c.req.param('id'))
    if (!deck) return c.json({ error: 'not found' }, 404)
    return c.json(deck)
  })

  app.patch('/api/decks/:id', async (c) => {
    const id = c.req.param('id')
    const deck = getDeck(db, id)
    if (!deck) return c.json({ error: 'not found' }, 404)
    const body = await c.req.json().catch(() => ({}))
    const title = typeof body.title === 'string' ? body.title : deck.title
    db.prepare('UPDATE decks SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), id)
    return c.json(getDeck(db, id))
  })

  app.delete('/api/decks/:id', (c) => {
    db.prepare('DELETE FROM decks WHERE id = ?').run(c.req.param('id'))
    return c.json({ ok: true })
  })

  app.post('/api/decks/:id/regenerate-slug', (c) => {
    const id = c.req.param('id')
    if (!getDeck(db, id)) return c.json({ error: 'not found' }, 404)
    db.prepare('UPDATE decks SET share_slug = ?, updated_at = ? WHERE id = ?').run(newSlug(), Date.now(), id)
    return c.json(getDeck(db, id))
  })
}

export { getDeck }
```

- [ ] **Step 3: 在 `server/src/app.js` 里接上（替掉 Task 3 留的占位路由）**

```js
import { Hono } from 'hono'
import { createAuth } from './auth.js'
import { registerDeckRoutes } from './decks.js'

export function createApp({ db, password, cookiePath = '/viscio', webDist } = {}) {
  const app = new Hono()
  const { login, requireAuth } = createAuth({ db, password, cookiePath })

  app.get('/api/health', (c) => c.json({ ok: true }))
  app.post('/api/auth', login)

  app.use('/api/decks', requireAuth)
  app.use('/api/decks/*', requireAuth)
  registerDeckRoutes(app, { db })

  return app
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/carolinge/Desktop/parchment/viscio/server && npx vitest run`
Expected: FAIL——`slides` 路由还没实现，第一条测试里 `GET /api/decks/${deck.id}/slides` 会 404。继续下一步再补上。

- [ ] **Step 5: 提交（先提交 decks 部分，slides 在 Task 5 里补全再一起跑绿）**

```bash
cd /Users/carolinge/Desktop/parchment/viscio
git add server/src/decks.js server/src/app.js server/test/decks.test.js
git commit -m "feat: decks CRUD + regenerate-slug（slides 路由下一步补上）"
```

---

### Task 5: slides CRUD（含重排）

**Files:**
- Modify: `viscio/server/src/decks.js`, `viscio/server/test/decks.test.js`

- [ ] **Step 1: 在 `server/src/decks.js` 追加 `registerSlideRoutes`**

```js
export function registerSlideRoutes(app, { db }) {
  app.get('/api/decks/:id/slides', (c) =>
    c.json(db.prepare('SELECT * FROM slides WHERE deck_id = ? ORDER BY position').all(c.req.param('id')))
  )

  app.post('/api/decks/:id/slides', (c) => {
    const deckId = c.req.param('id')
    const max = db.prepare('SELECT MAX(position) AS m FROM slides WHERE deck_id = ?').get(deckId)
    const position = (max.m ?? -1) + 1
    const id = crypto.randomUUID()
    db.prepare('INSERT INTO slides (id, deck_id, position, notes) VALUES (?, ?, ?, ?)').run(id, deckId, position, '')
    db.prepare('UPDATE decks SET updated_at = ? WHERE id = ?').run(Date.now(), deckId)
    return c.json(db.prepare('SELECT * FROM slides WHERE id = ?').get(id), 201)
  })

  app.patch('/api/slides/:id', async (c) => {
    const id = c.req.param('id')
    const slide = db.prepare('SELECT * FROM slides WHERE id = ?').get(id)
    if (!slide) return c.json({ error: 'not found' }, 404)
    const body = await c.req.json().catch(() => ({}))
    const notes = typeof body.notes === 'string' ? body.notes : slide.notes
    const position = typeof body.position === 'number' ? body.position : slide.position
    db.prepare('UPDATE slides SET notes = ?, position = ? WHERE id = ?').run(notes, position, id)
    return c.json(db.prepare('SELECT * FROM slides WHERE id = ?').get(id))
  })

  app.delete('/api/slides/:id', (c) => {
    const id = c.req.param('id')
    const slide = db.prepare('SELECT * FROM slides WHERE id = ?').get(id)
    if (slide) {
      db.prepare('DELETE FROM slides WHERE id = ?').run(id)
      // 删除后重新编号，保持 position 连续——单用户小规模场景，全量重排足够简单也够快
      const rest = db.prepare('SELECT id FROM slides WHERE deck_id = ? ORDER BY position').all(slide.deck_id)
      const renumber = db.prepare('UPDATE slides SET position = ? WHERE id = ?')
      rest.forEach((s, i) => renumber.run(i, s.id))
    }
    return c.json({ ok: true })
  })
}
```

别忘了在文件顶部加 `import crypto from 'node:crypto'`（如果 Task 4 还没加的话）。

- [ ] **Step 2: 在 `server/src/app.js` 里注册 slides 路由**

```js
import { registerDeckRoutes, registerSlideRoutes } from './decks.js'
// ...
app.use('/api/slides/*', requireAuth)
registerDeckRoutes(app, { db })
registerSlideRoutes(app, { db })
```

- [ ] **Step 3: 追加测试到 `server/test/decks.test.js`**

```js
describe('slides', () => {
  it('新建的第二张 slide position 接在已有的后面', async () => {
    const deck = await (await authed('/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
    const res = await authed(`/api/decks/${deck.id}/slides`, { method: 'POST' })
    expect((await res.json()).position).toBe(1) // deck 自带的第一张是 position 0
  })

  it('删除中间一张 slide 后，剩下的会重新编号成连续 position', async () => {
    const deck = await (await authed('/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
    const s2 = await (await authed(`/api/decks/${deck.id}/slides`, { method: 'POST' })).json()
    await authed(`/api/decks/${deck.id}/slides`, { method: 'POST' }) // s3, position 2
    await authed(`/api/slides/${s2.id}`, { method: 'DELETE' })
    const slides = await (await authed(`/api/decks/${deck.id}/slides`)).json()
    expect(slides.map((s) => s.position)).toEqual([0, 1])
  })
})
```

- [ ] **Step 4: 跑全部测试确认通过**

Run: `cd /Users/carolinge/Desktop/parchment/viscio/server && npx vitest run`
Expected: PASS（全部通过，含 Task 4 里那条曾经失败的 slides 断言）。

- [ ] **Step 5: 提交**

```bash
cd /Users/carolinge/Desktop/parchment/viscio
git add server/src/decks.js server/src/app.js server/test/decks.test.js
git commit -m "feat: slides CRUD，删除后重新编号"
```

---

### Task 6: elements 批量替换

**Files:**
- Create: `viscio/server/src/serialize.js`, `viscio/server/src/elements.js`, `viscio/server/test/elements.test.js`
- Modify: `viscio/server/src/app.js`

- [ ] **Step 1: 写 `server/src/serialize.js`（decks.js/elements.js/revisions.js 共用，避免重复）**

```js
export function parseElement(row) {
  return { ...row, content: JSON.parse(row.content) }
}

export function elementInsertParams(el, slideId) {
  return [
    el.id,
    slideId,
    el.type,
    el.x, el.y, el.w, el.h,
    el.z_index ?? 0,
    el.group_id ?? null,
    JSON.stringify(el.content ?? {}),
    el.blob_hash ?? null,
  ]
}
```

- [ ] **Step 2: 写失败测试 `server/test/elements.test.js`**

```js
import { describe, it, expect, beforeEach } from 'vitest'
import crypto from 'node:crypto'
import { createApp } from '../src/app.js'
import { createDb } from '../src/db.js'

let app, cookie, deckId, slideId

beforeEach(async () => {
  app = createApp({ db: createDb(':memory:'), password: 'secret' })
  const login = await app.request('/api/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret' }),
  })
  cookie = login.headers.get('set-cookie').split(';')[0]
  const deck = await (await authed('/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
  deckId = deck.id
  const slides = await (await authed(`/api/decks/${deckId}/slides`)).json()
  slideId = slides[0].id
})

function authed(path, init = {}) {
  return app.request(path, { ...init, headers: { ...init.headers, Cookie: cookie } })
}

describe('elements', () => {
  it('PUT 整批写入，GET 按 z_index 顺序取回，content 已解析成对象', async () => {
    const els = [
      { id: crypto.randomUUID(), type: 'rect', x: 0, y: 0, w: 100, h: 50, z_index: 0, content: { stroke: '#000' } },
      { id: crypto.randomUUID(), type: 'textbox', x: 10, y: 10, w: 200, h: 60, z_index: 1, content: { doc: { type: 'doc', content: [] } } },
    ]
    await authed(`/api/slides/${slideId}/elements`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(els),
    })
    const got = await (await authed(`/api/slides/${slideId}/elements`)).json()
    expect(got).toHaveLength(2)
    expect(got[0].content).toEqual({ stroke: '#000' })
    expect(got[1].type).toBe('textbox')
  })

  it('第二次 PUT 完全替换第一次的内容（整批替换，不是追加）', async () => {
    const first = [{ id: crypto.randomUUID(), type: 'rect', x: 0, y: 0, w: 10, h: 10, z_index: 0, content: {} }]
    await authed(`/api/slides/${slideId}/elements`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(first) })
    await authed(`/api/slides/${slideId}/elements`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '[]' })
    const got = await (await authed(`/api/slides/${slideId}/elements`)).json()
    expect(got).toHaveLength(0)
  })

  it('PUT 非数组返回 400', async () => {
    const res = await authed(`/api/slides/${slideId}/elements`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    expect(res.status).toBe(400)
  })
})
```

Run: `cd /Users/carolinge/Desktop/parchment/viscio/server && npx vitest run`
Expected: FAIL（`../src/elements.js` 不存在）。

- [ ] **Step 3: 写 `server/src/elements.js`**

```js
import crypto from 'node:crypto'
import { parseElement, elementInsertParams } from './serialize.js'

export function registerElementRoutes(app, { db }) {
  app.get('/api/slides/:id/elements', (c) => {
    const rows = db.prepare('SELECT * FROM elements WHERE slide_id = ? ORDER BY z_index, rowid').all(c.req.param('id'))
    return c.json(rows.map(parseElement))
  })

  app.put('/api/slides/:id/elements', async (c) => {
    const slideId = c.req.param('id')
    const slide = db.prepare('SELECT id FROM slides WHERE id = ?').get(slideId)
    if (!slide) return c.json({ error: 'not found' }, 404)

    const body = await c.req.json().catch(() => null)
    if (!Array.isArray(body)) return c.json({ error: 'expected array' }, 400)

    // ponytail: 整批删除重插入，不做增量 diff。单张幻灯片元素数量小，
    // 这个开销可忽略；哪张幻灯片元素多到构成瓶颈了，再改成增量 upsert。
    const insert = db.prepare(`INSERT INTO elements (id, slide_id, type, x, y, w, h, z_index, group_id, content, blob_hash)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const tx = db.transaction((elements) => {
      db.prepare('DELETE FROM elements WHERE slide_id = ?').run(slideId)
      for (const el of elements) {
        insert.run(...elementInsertParams({ ...el, id: el.id || crypto.randomUUID() }, slideId))
      }
    })
    tx(body)
    return c.json({ ok: true })
  })
}
```

- [ ] **Step 4: 在 `server/src/app.js` 里注册**

```js
import { registerElementRoutes } from './elements.js'
// ...
registerElementRoutes(app, { db })
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd /Users/carolinge/Desktop/parchment/viscio/server && npx vitest run`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
cd /Users/carolinge/Desktop/parchment/viscio
git add server/src/serialize.js server/src/elements.js server/src/app.js server/test/elements.test.js
git commit -m "feat: elements 批量替换接口"
```

---

### Task 7: 内容寻址 blob 存储

**Files:**
- Create: `viscio/server/src/blobs.js`, `viscio/server/test/blobs.test.js`
- Modify: `viscio/server/src/app.js`

- [ ] **Step 1: 写失败测试 `server/test/blobs.test.js`**

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { createApp } from '../src/app.js'
import { createDb } from '../src/db.js'

let app, cookie

beforeEach(async () => {
  app = createApp({ db: createDb(':memory:'), password: 'secret' })
  const login = await app.request('/api/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret' }),
  })
  cookie = login.headers.get('set-cookie').split(';')[0]
})

function authed(path, init = {}) {
  return app.request(path, { ...init, headers: { ...init.headers, Cookie: cookie } })
}

describe('blobs', () => {
  it('上传需要登录', async () => {
    const res = await app.request('/api/blobs', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hello' })
    expect(res.status).toBe(401)
  })

  it('上传后返回内容 hash，同样内容再传一次拿到同一个 hash（去重）', async () => {
    const first = await authed('/api/blobs', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hello world' })
    const second = await authed('/api/blobs', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hello world' })
    const h1 = (await first.json()).hash
    const h2 = (await second.json()).hash
    expect(h1).toBe(h2)
  })

  it('GET /api/blobs/:hash 不需要登录也能读（分享链接里的图片/embed 要能公开访问）', async () => {
    const uploaded = await authed('/api/blobs', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'public content' })
    const { hash } = await uploaded.json()
    const res = await app.request(`/api/blobs/${hash}`) // 不带 cookie
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('public content')
    expect(res.headers.get('content-type')).toBe('text/plain')
  })

  it('不存在的 hash 返回 404', async () => {
    const res = await app.request('/api/blobs/deadbeef')
    expect(res.status).toBe(404)
  })
})
```

Run: `cd /Users/carolinge/Desktop/parchment/viscio/server && npx vitest run`
Expected: FAIL（`../src/blobs.js` 不存在）。

- [ ] **Step 2: 写 `server/src/blobs.js`**

```js
import crypto from 'node:crypto'

// GET 公开、POST 受保护——分享链接免密访问时，deck 里引用的图片/embed
// 也得能直接加载，内容寻址的 hash 本身够随机，公开读取风险很低。
export function registerBlobPublicRoutes(app, { db }) {
  app.get('/api/blobs/:hash', (c) => {
    const row = db.prepare('SELECT type, data FROM blobs WHERE hash = ?').get(c.req.param('hash'))
    if (!row) return c.json({ error: 'not found' }, 404)
    return c.body(row.data, 200, {
      'Content-Type': row.type,
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
  })
}

export function registerBlobUploadRoute(app, { db }, requireAuth) {
  app.post('/api/blobs', requireAuth, async (c) => {
    const buf = Buffer.from(await c.req.arrayBuffer())
    const type = c.req.header('content-type') || 'application/octet-stream'
    const hash = crypto.createHash('sha256').update(buf).digest('hex')

    const existing = db.prepare('SELECT hash FROM blobs WHERE hash = ?').get(hash)
    if (!existing) {
      db.prepare('INSERT INTO blobs (hash, type, data, size, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(hash, type, buf, buf.length, Date.now())
    }
    return c.json({ hash, size: buf.length })
  })
}
```

- [ ] **Step 3: 在 `server/src/app.js` 里接上**

`registerBlobPublicRoutes` 要注册在 `requireAuth` 中间件之前（它本来就没被 `/api/decks/*` 这类保护挡住，但显式放前面更清楚）；`registerBlobUploadRoute` 把 `requireAuth` 当参数传进去，单独套在这一条路由上：

```js
import { registerBlobPublicRoutes, registerBlobUploadRoute } from './blobs.js'
// ...
registerBlobPublicRoutes(app, { db })
// ... (decks/slides/elements 路由和它们的 requireAuth 中间件)
registerBlobUploadRoute(app, { db }, requireAuth)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/carolinge/Desktop/parchment/viscio/server && npx vitest run`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
cd /Users/carolinge/Desktop/parchment/viscio
git add server/src/blobs.js server/src/app.js server/test/blobs.test.js
git commit -m "feat: 内容寻址 blob 存储，GET 公开 POST 受保护"
```

---

### Task 8: 版本历史（快照 + FIFO 淘汰 + 恢复）

**Files:**
- Create: `viscio/server/src/revisions.js`, `viscio/server/test/revisions.test.js`
- Modify: `viscio/server/src/app.js`

- [ ] **Step 1: 写失败测试 `server/test/revisions.test.js`**

```js
import { describe, it, expect, beforeEach } from 'vitest'
import crypto from 'node:crypto'
import { createApp } from '../src/app.js'
import { createDb } from '../src/db.js'

let app, cookie, deckId, slideId

beforeEach(async () => {
  app = createApp({ db: createDb(':memory:'), password: 'secret' })
  const login = await app.request('/api/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret' }),
  })
  cookie = login.headers.get('set-cookie').split(';')[0]
  const deck = await (await authed('/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
  deckId = deck.id
  slideId = (await (await authed(`/api/decks/${deckId}/slides`)).json())[0].id
})

function authed(path, init = {}) {
  return app.request(path, { ...init, headers: { ...init.headers, Cookie: cookie } })
}

describe('revisions', () => {
  it('创建快照会带上当前的 slides/elements', async () => {
    await authed(`/api/slides/${slideId}/elements`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ id: crypto.randomUUID(), type: 'rect', x: 0, y: 0, w: 10, h: 10, z_index: 0, content: {} }]),
    })
    const res = await authed(`/api/decks/${deckId}/revisions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trigger: 'manual' }),
    })
    expect(res.status).toBe(201)
    const list = await (await authed(`/api/decks/${deckId}/revisions`)).json()
    expect(list).toHaveLength(1)
    expect(list[0].trigger).toBe('manual')
  })

  it('超过 10 条快照后，最旧的被淘汰', async () => {
    for (let i = 0; i < 11; i++) {
      await authed(`/api/decks/${deckId}/revisions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trigger: 'auto' }),
      })
    }
    const list = await (await authed(`/api/decks/${deckId}/revisions`)).json()
    expect(list).toHaveLength(10)
  })

  it('恢复快照会把元素还原回快照当时的状态', async () => {
    await authed(`/api/slides/${slideId}/elements`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ id: crypto.randomUUID(), type: 'rect', x: 1, y: 1, w: 1, h: 1, z_index: 0, content: { tag: 'v1' } }]),
    })
    const rev = await (await authed(`/api/decks/${deckId}/revisions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trigger: 'manual' }),
    })).json()

    await authed(`/api/slides/${slideId}/elements`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ id: crypto.randomUUID(), type: 'rect', x: 9, y: 9, w: 9, h: 9, z_index: 0, content: { tag: 'v2' } }]),
    })

    await authed(`/api/revisions/${rev.id}/restore`, { method: 'POST' })
    const els = await (await authed(`/api/slides/${slideId}/elements`)).json()
    expect(els).toHaveLength(1)
    expect(els[0].content.tag).toBe('v1')
  })
})
```

Run: `cd /Users/carolinge/Desktop/parchment/viscio/server && npx vitest run`
Expected: FAIL（`../src/revisions.js` 不存在）。

- [ ] **Step 2: 写 `server/src/revisions.js`**

```js
import crypto from 'node:crypto'
import { parseElement, elementInsertParams } from './serialize.js'

const MAX_REVISIONS = 10

export function registerRevisionRoutes(app, { db }) {
  app.post('/api/decks/:id/revisions', async (c) => {
    const deckId = c.req.param('id')
    if (!db.prepare('SELECT id FROM decks WHERE id = ?').get(deckId)) return c.json({ error: 'not found' }, 404)

    const body = await c.req.json().catch(() => ({}))
    const trigger = body.trigger === 'manual' ? 'manual' : 'auto'

    const slides = db.prepare('SELECT * FROM slides WHERE deck_id = ? ORDER BY position').all(deckId)
    const elementsBySlide = {}
    for (const s of slides) {
      elementsBySlide[s.id] = db.prepare('SELECT * FROM elements WHERE slide_id = ? ORDER BY z_index, rowid').all(s.id).map(parseElement)
    }

    const id = crypto.randomUUID()
    const createdAt = Date.now()
    db.prepare('INSERT INTO revisions (id, deck_id, created_at, trigger, snapshot) VALUES (?, ?, ?, ?, ?)')
      .run(id, deckId, createdAt, trigger, JSON.stringify({ slides, elementsBySlide }))

    // FIFO 淘汰：只留最新 10 条
    // 次级排序键 rowid：created_at 精度只有 1ms，写快照写得快时容易撞在同一毫秒，
    // 不加 rowid 兜底的话并列行谁先谁后不确定，FIFO 淘汰就可能删错（比如淘汰到
    // 刚存的这条而不是真正最旧的）。
    const old = db.prepare('SELECT id FROM revisions WHERE deck_id = ? ORDER BY created_at DESC, rowid DESC').all(deckId)
    if (old.length > MAX_REVISIONS) {
      const del = db.prepare('DELETE FROM revisions WHERE id = ?')
      old.slice(MAX_REVISIONS).forEach((r) => del.run(r.id))
    }

    return c.json({ id, created_at: createdAt, trigger }, 201)
  })

  app.get('/api/decks/:id/revisions', (c) =>
    c.json(db.prepare('SELECT id, created_at, trigger FROM revisions WHERE deck_id = ? ORDER BY created_at DESC, rowid DESC').all(c.req.param('id')))
  )

  app.post('/api/revisions/:id/restore', (c) => {
    const rev = db.prepare('SELECT * FROM revisions WHERE id = ?').get(c.req.param('id'))
    if (!rev) return c.json({ error: 'not found' }, 404)
    const { slides, elementsBySlide } = JSON.parse(rev.snapshot)

    const insertSlide = db.prepare('INSERT INTO slides (id, deck_id, position, notes) VALUES (?, ?, ?, ?)')
    const insertEl = db.prepare(`INSERT INTO elements (id, slide_id, type, x, y, w, h, z_index, group_id, content, blob_hash)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM slides WHERE deck_id = ?').run(rev.deck_id) // 级联删除 elements
      for (const s of slides) {
        insertSlide.run(s.id, rev.deck_id, s.position, s.notes)
        for (const el of elementsBySlide[s.id] || []) {
          insertEl.run(...elementInsertParams(el, s.id))
        }
      }
      db.prepare('UPDATE decks SET updated_at = ? WHERE id = ?').run(Date.now(), rev.deck_id)
    })
    tx()
    return c.json({ ok: true })
  })
}
```

- [ ] **Step 3: 在 `server/src/app.js` 里注册（记得给 `/api/revisions/*` 也套上 requireAuth）**

```js
import { registerRevisionRoutes } from './revisions.js'
// ...
app.use('/api/revisions/*', requireAuth)
registerRevisionRoutes(app, { db })
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/carolinge/Desktop/parchment/viscio/server && npx vitest run`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
cd /Users/carolinge/Desktop/parchment/viscio
git add server/src/revisions.js server/src/app.js server/test/revisions.test.js
git commit -m "feat: 版本历史——快照/恢复/FIFO 淘汰"
```

---

### Task 9: 公开播放数据接口

**Files:**
- Create: `viscio/server/src/play.js`, `viscio/server/test/play.test.js`
- Modify: `viscio/server/src/app.js`

- [ ] **Step 1: 写失败测试 `server/test/play.test.js`**

```js
import { describe, it, expect, beforeEach } from 'vitest'
import crypto from 'node:crypto'
import { createApp } from '../src/app.js'
import { createDb } from '../src/db.js'

let app, cookie, deck

beforeEach(async () => {
  app = createApp({ db: createDb(':memory:'), password: 'secret' })
  const login = await app.request('/api/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret' }),
  })
  cookie = login.headers.get('set-cookie').split(';')[0]
  deck = await (await authed('/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
  const slideId = (await (await authed(`/api/decks/${deck.id}/slides`)).json())[0].id
  await authed(`/api/slides/${slideId}/elements`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ id: crypto.randomUUID(), type: 'rect', x: 0, y: 0, w: 10, h: 10, z_index: 0, content: {} }]),
  })
})

function authed(path, init = {}) {
  return app.request(path, { ...init, headers: { ...init.headers, Cookie: cookie } })
}

describe('play', () => {
  it('不带 cookie 也能通过分享 slug 拿到完整的 slides+elements', async () => {
    const res = await app.request(`/play/${deck.share_slug}`) // 不带 cookie
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.deck.title).toBe('未命名演示')
    expect(data.slides).toHaveLength(1)
    expect(data.slides[0].elements).toHaveLength(1)
  })

  it('不存在的 slug 返回 404', async () => {
    const res = await app.request('/play/does-not-exist')
    expect(res.status).toBe(404)
  })
})
```

Run: `cd /Users/carolinge/Desktop/parchment/viscio/server && npx vitest run`
Expected: FAIL（`../src/play.js` 不存在）。

- [ ] **Step 2: 写 `server/src/play.js`**

```js
import { parseElement } from './serialize.js'

export function registerPlayRoutes(app, { db }) {
  app.get('/play/:slug', (c) => {
    const deck = db.prepare('SELECT * FROM decks WHERE share_slug = ?').get(c.req.param('slug'))
    if (!deck) return c.json({ error: 'not found' }, 404)

    const slides = db.prepare('SELECT * FROM slides WHERE deck_id = ? ORDER BY position').all(deck.id).map((s) => ({
      ...s,
      elements: db.prepare('SELECT * FROM elements WHERE slide_id = ? ORDER BY z_index, rowid').all(s.id).map(parseElement),
    }))

    return c.json({
      deck: { id: deck.id, title: deck.title, canvas_width: deck.canvas_width, canvas_height: deck.canvas_height },
      slides,
    })
  })
}
```

- [ ] **Step 3: 在 `server/src/app.js` 里注册（放在 requireAuth 中间件之前，它本来就是公开路由）**

```js
import { registerPlayRoutes } from './play.js'
// ... 紧跟在 registerBlobPublicRoutes 后面
registerPlayRoutes(app, { db })
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/carolinge/Desktop/parchment/viscio/server && npx vitest run`
Expected: PASS（全部 server 测试通过）。

- [ ] **Step 5: 提交**

```bash
cd /Users/carolinge/Desktop/parchment/viscio
git add server/src/play.js server/src/app.js server/test/play.test.js
git commit -m "feat: 公开播放数据接口 GET /play/:slug"
```

---

### Task 10: app.js 静态托管收尾 + index.js 独立进程入口

**Files:**
- Modify: `viscio/server/src/app.js`
- Create: `viscio/server/src/index.js`

- [ ] **Step 1: 在 `server/src/app.js` 末尾加上静态托管（webDist 存在时）**

在 `return app` 之前插入：

```js
  if (webDist) {
    app.use('/*', serveStatic({ root: webDist }))
    app.get('*', serveStatic({ path: `${webDist}/index.html` })) // SPA fallback：/edit/:id 这类前端路由也要能直接刷新
  }
```

文件顶部加：
```js
import { serveStatic } from '@hono/node-server/serve-static'
```

- [ ] **Step 2: 写 `server/src/index.js`**

只在本地独立开发/测试时用；生产环境里 homepage 会直接 `import('../viscio-src/server/src/app.js')` 调用 `createApp`，不会跑这个文件。

```js
import path from 'node:path'
import { serve } from '@hono/node-server'
import { createDb } from './db.js'
import { createApp } from './app.js'

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const PASSWORD = process.env.VISCIO_ACCESS_PASSWORD || process.env.ACCESS_PASSWORD || 'dev'
const PORT = Number(process.env.PORT) || 8788

const db = createDb(path.join(DATA_DIR, 'viscio.db'))
const app = createApp({ db, password: PASSWORD, webDist: path.resolve(process.cwd(), '../web/dist') })

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`viscio server listening on :${info.port}`)
})
```

- [ ] **Step 3: 跑全部测试确认没有破坏任何东西**

Run: `cd /Users/carolinge/Desktop/parchment/viscio/server && npx vitest run`
Expected: PASS（`createApp` 在测试里都没传 `webDist`，静态托管分支不会被走到，不影响已有测试）。

- [ ] **Step 4: 提交**

```bash
cd /Users/carolinge/Desktop/parchment/viscio
git add server/src/app.js server/src/index.js
git commit -m "feat: 静态托管收尾 + 独立进程入口（本地开发用）"
```

---

### Task 11: viscio/web 脚手架

**Files:**
- Create: `viscio/web/package.json`, `viscio/web/vite.config.ts`, `viscio/web/tsconfig.json`, `viscio/web/index.html`, `viscio/web/src/main.tsx`, `viscio/web/src/App.tsx`, `viscio/web/src/api.ts`, `viscio/web/src/types.ts`, `viscio/web/src/styles.css`

- [ ] **Step 1: 写 `web/package.json`**

```json
{
  "name": "viscio-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@tiptap/core": "^2.9.1",
    "@tiptap/html": "^2.9.1",
    "@tiptap/starter-kit": "^2.9.1",
    "highlight.js": "^11.10.0",
    "katex": "^0.16.11",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.3",
    "vite": "^5.4.10",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: 安装依赖**

Run: `cd /Users/carolinge/Desktop/parchment/viscio/web && npm install`
Expected: 无报错。

- [ ] **Step 3: 写 `web/vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 开发和生产都固定用 /viscio/ 前缀（跟 Mnemos 只在生产用不同）：
  // viscio_session cookie 显式 scope 到 path=/viscio，本地开发如果请求路径
  // 对不上这个前缀，登录后 cookie 就带不回来，行为会跟生产环境不一致。
  base: '/viscio/',
  server: {
    proxy: {
      '^/viscio/(api|play)': {
        target: 'http://localhost:8788',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/viscio/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
})
```

- [ ] **Step 4: 写 `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
```

- [ ] **Step 5: 写 `web/index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Viscio</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/viscio/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: 写 `web/src/types.ts`**

```ts
export type ElementType =
  | 'rect' | 'ellipse' | 'line-arrow' | 'textbox' | 'diamond' | 'freehand'
  | 'image' | 'embed' | 'latex' | 'code'

export type ElementRow = {
  id: string
  slide_id: string
  type: ElementType
  x: number
  y: number
  w: number
  h: number
  z_index: number
  group_id: string | null
  content: Record<string, any>
  blob_hash: string | null
}

export type Deck = {
  id: string
  title: string
  canvas_width: number
  canvas_height: number
  share_slug: string
  created_at: number
  updated_at: number
}

export type Slide = {
  id: string
  deck_id: string
  position: number
  notes: string
}
```

- [ ] **Step 7: 写 `web/src/api.ts`**

```ts
const BASE = import.meta.env.BASE_URL // '/viscio/'

type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | null = null
export function setUnauthorizedHandler(fn: UnauthorizedHandler) {
  onUnauthorized = fn
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Fly.io 闲置会把机器睡掉，冷启动大约 7 秒；请求失败时递增退避重试，
// 而不是直接把错误抛给用户看——跟 Mnemos 的 api.ts 是同一个模式。
export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${BASE}api${path}`
  let lastErr: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { credentials: 'include', ...init })
      if (res.status === 401) {
        onUnauthorized?.()
        return res
      }
      if (res.ok || attempt === 3) return res
    } catch (err) {
      lastErr = err
    }
    await sleep(1500 * (attempt + 1))
  }
  throw lastErr ?? new Error('request failed')
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await api(path, init)
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}
```

- [ ] **Step 8: 写最小 `web/src/App.tsx` 和 `web/src/main.tsx`（先占位，Task 12/13 会填内容）**

```tsx
// web/src/App.tsx
export function App() {
  return <div>Viscio</div>
}
```

```tsx
// web/src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

- [ ] **Step 9: 写 `web/src/styles.css`（照抄 Mnemos 的主题变量骨架，浅色/深色两套都定义）**

```css
:root {
  --bg: #faf9f6;
  --fg: #1e1a0f;
  --muted: #8a8377;
  --accent: #4a7dbd;
  --danger: #b3452e;
  --border: #e5e1d8;
  --card-shadow: 0 1px 3px rgba(30, 25, 10, 0.06);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --bg: #1c1a16;
    --fg: #ece8de;
    --muted: #948d7d;
    --accent: #6c9bd6;
    --danger: #d97a63;
    --border: #38352c;
    --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }
}

:root[data-theme='dark'] {
  --bg: #1c1a16;
  --fg: #ece8de;
  --muted: #948d7d;
  --accent: #6c9bd6;
  --danger: #d97a63;
  --border: #38352c;
  --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
```

- [ ] **Step 10: 手动确认能跑起来【人工验证】**

Run: `cd /Users/carolinge/Desktop/parchment/viscio/web && npm run dev`
在浏览器打开 `http://localhost:5173/viscio/`，应该看到页面显示「Viscio」，控制台无报错。

- [ ] **Step 11: 提交**

```bash
cd /Users/carolinge/Desktop/parchment/viscio
git add web/package.json web/package-lock.json web/vite.config.ts web/tsconfig.json web/index.html web/src
git commit -m "feat: viscio/web 脚手架"
```

---

### Task 12: 登录页 + 认证路由保护

**Files:**
- Create: `viscio/web/src/useAuth.ts`, `viscio/web/src/routes/Login.tsx`
- Modify: `viscio/web/src/App.tsx`
- Test: `viscio/web/test/setup.ts`, `viscio/web/test/Login.test.tsx`

- [ ] **Step 1: 写 `web/test/setup.ts`（vitest + jsdom + testing-library 的全局配置）**

```ts
import '@testing-library/jest-dom/vitest'
```

在 `web/package.json` 的 devDependencies 里补一个 `@testing-library/jest-dom`：

```json
"@testing-library/jest-dom": "^6.6.3",
```

并在 `vite.config.ts` 的 `test` 字段里加：
```ts
test: {
  environment: 'jsdom',
  setupFiles: ['./test/setup.ts'],
},
```

Run: `cd /Users/carolinge/Desktop/parchment/viscio/web && npm install`

- [ ] **Step 2: 写失败测试 `web/test/Login.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Login } from '../src/routes/Login'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('Login', () => {
  it('密码错误时显示错误提示，不跳转', async () => {
    ;(fetch as any).mockResolvedValue(new Response(JSON.stringify({ error: 'invalid password' }), { status: 401 }))
    render(<MemoryRouter><Login /></MemoryRouter>)
    fireEvent.change(screen.getByPlaceholderText('访问密码'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByText('进入'))
    await waitFor(() => expect(screen.getByText('密码不对')).toBeInTheDocument())
  })
})
```

Run: `cd /Users/carolinge/Desktop/parchment/viscio/web && npx vitest run`
Expected: FAIL（`../src/routes/Login` 不存在）。

- [ ] **Step 3: 写 `web/src/routes/Login.tsx`**

```tsx
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

export function Login() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const res = await api('/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) navigate('/')
    else setError('密码不对')
  }

  return (
    <form onSubmit={submit} className="login">
      <h1>Viscio</h1>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="访问密码"
        autoFocus
      />
      <button type="submit">进入</button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/carolinge/Desktop/parchment/viscio/web && npx vitest run`
Expected: PASS。

- [ ] **Step 5: 写 `web/src/useAuth.ts`**

```ts
import { useEffect, useState } from 'react'
import { api } from './api'

export function useAuth() {
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false
    api('/decks').then((res) => {
      if (!cancelled) {
        setAuthed(res.status !== 401)
        setChecking(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  return { authed, checking }
}
```

- [ ] **Step 6: 改 `web/src/App.tsx` 接上路由与保护**

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Login } from './routes/Login'
import { useAuth } from './useAuth'

function RequireAuth({ children }: { children: ReactNode }) {
  const { authed, checking } = useAuth()
  if (checking) return null
  if (!authed) return <Navigate to="/login" replace />
  return <>{children}</>
}

export function App() {
  return (
    <BrowserRouter basename="/viscio">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><div>deck 列表占位，Task 13 会填上</div></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
```

- [ ] **Step 7: 手动确认整条登录流程【人工验证】**

两个终端：
```bash
cd /Users/carolinge/Desktop/parchment/viscio/server && VISCIO_ACCESS_PASSWORD=dev DATA_DIR=./data npm run dev
cd /Users/carolinge/Desktop/parchment/viscio/web && npm run dev
```
浏览器打开 `http://localhost:5173/viscio/`，应该自动跳到 `/viscio/login`；输错密码看到「密码不对」；输入 `dev` 后跳回首页，看到占位文字。打开 DevTools → Application → Cookies，确认有一条 `viscio_session`，Path 是 `/viscio`。

- [ ] **Step 8: 提交**

```bash
cd /Users/carolinge/Desktop/parchment/viscio
git add web/package.json web/package-lock.json web/vite.config.ts web/test web/src
git commit -m "feat: 登录页 + 认证路由保护"
```

---

### Task 13: DeckList 页面

**Files:**
- Create: `viscio/web/src/routes/DeckList.tsx`, `viscio/web/test/DeckList.test.tsx`
- Modify: `viscio/web/src/App.tsx`

- [ ] **Step 1: 写失败测试 `web/test/DeckList.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DeckList } from '../src/routes/DeckList'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('DeckList', () => {
  it('加载后展示已有 deck 的标题', async () => {
    ;(fetch as any).mockResolvedValue(
      new Response(JSON.stringify([{ id: 'd1', title: '我的第一个报告', updated_at: 1 }]), { status: 200 })
    )
    render(<MemoryRouter><DeckList /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('我的第一个报告')).toBeInTheDocument())
  })
})
```

Run: `cd /Users/carolinge/Desktop/parchment/viscio/web && npx vitest run`
Expected: FAIL（`../src/routes/DeckList` 不存在）。

- [ ] **Step 2: 写 `web/src/routes/DeckList.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiJson } from '../api'
import type { Deck } from '../types'

export function DeckList() {
  const [decks, setDecks] = useState<Deck[]>([])
  const navigate = useNavigate()

  async function load() {
    setDecks(await apiJson<Deck[]>('/decks'))
  }

  useEffect(() => {
    load()
  }, [])

  async function createDeck() {
    const deck = await apiJson<Deck>('/decks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    navigate(`/edit/${deck.id}`)
  }

  async function removeDeck(id: string) {
    await apiJson(`/decks/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="deck-list">
      <h1>Viscio</h1>
      <button onClick={createDeck}>+ 新建演示</button>
      <ul>
        {decks.map((d) => (
          <li key={d.id}>
            <a onClick={() => navigate(`/edit/${d.id}`)}>{d.title}</a>
            <button onClick={() => removeDeck(d.id)}>删除</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: 跑测试确认通过**

Run: `cd /Users/carolinge/Desktop/parchment/viscio/web && npx vitest run`
Expected: PASS。

- [ ] **Step 4: 在 `web/src/App.tsx` 里换掉占位**

```tsx
import { DeckList } from './routes/DeckList'
// ...
<Route path="/" element={<RequireAuth><DeckList /></RequireAuth>} />
```

- [ ] **Step 5: 提交**

```bash
cd /Users/carolinge/Desktop/parchment/viscio
git add web/src/routes/DeckList.tsx web/src/App.tsx web/test/DeckList.test.tsx
git commit -m "feat: DeckList 页面——新建/列出/删除 deck"
```

---

### Task 14: 画布坐标系（固定分辨率 + 整体缩放）

**Files:**
- Create: `viscio/web/src/lib/geometry.ts`, `viscio/web/src/canvas/Canvas.tsx`, `viscio/web/test/geometry.test.ts`

这是规格里点名的架构关键项：元素的 x/y/w/h 永远基于一个固定的设计分辨率，编辑器和以后的放映页都靠整体 `transform: scale()` 去适配真实窗口——换电脑、缩放浏览器都不会让画布错位。

- [ ] **Step 1: 写失败测试 `web/test/geometry.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { fitScale } from '../src/lib/geometry'

describe('fitScale', () => {
  it('容器比画布更宽时，缩放比例由高度决定', () => {
    expect(fitScale(1280, 720, 2560, 900)).toBeCloseTo(900 / 720)
  })

  it('容器比画布更窄时，缩放比例由宽度决定', () => {
    expect(fitScale(1280, 720, 640, 900)).toBeCloseTo(640 / 1280)
  })

  it('画布和容器完全同比例时，缩放比例是两者宽度之比', () => {
    expect(fitScale(1280, 720, 640, 360)).toBeCloseTo(0.5)
  })
})
```

Run: `cd /Users/carolinge/Desktop/parchment/viscio/web && npx vitest run`
Expected: FAIL（`../src/lib/geometry` 不存在）。

- [ ] **Step 2: 写 `web/src/lib/geometry.ts`**

```ts
// 把固定分辨率的画布（canvasW x canvasH）整体缩放，使其完整装进容器（containerW x containerH），
// 取更小的那个缩放比例（"contain" 语义，不裁切）。
export function fitScale(canvasW: number, canvasH: number, containerW: number, containerH: number): number {
  if (canvasW <= 0 || canvasH <= 0 || containerW <= 0 || containerH <= 0) return 1
  return Math.min(containerW / canvasW, containerH / canvasH)
}
```

- [ ] **Step 3: 跑测试确认通过**

Run: `cd /Users/carolinge/Desktop/parchment/viscio/web && npx vitest run`
Expected: PASS。

- [ ] **Step 4: 写 `web/src/canvas/Canvas.tsx`（不写测试——纯布局组件，靠 Task 16 的手动验证覆盖）**

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { fitScale } from '../lib/geometry'

export function Canvas({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      setScale(fitScale(width, height, rect.width, rect.height))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [width, height])

  return (
    <div ref={containerRef} className="canvas-viewport">
      <div
        className="canvas-surface"
        style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'relative' }}
      >
        {children}
      </div>
    </div>
  )
}
```

在 `web/src/styles.css` 追加：

```css
.canvas-viewport {
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
}
.canvas-surface {
  background: #fff;
  box-shadow: var(--card-shadow);
  flex-shrink: 0;
}
```

- [ ] **Step 5: 提交**

```bash
cd /Users/carolinge/Desktop/parchment/viscio
git add web/src/lib/geometry.ts web/src/canvas/Canvas.tsx web/src/styles.css web/test/geometry.test.ts
git commit -m "feat: 固定分辨率画布坐标系 + 整体缩放容器"
```

---

### Task 15: 只读图形元素渲染

**Files:**
- Create:
  - `viscio/web/src/canvas/shapes/RectShape.tsx`
  - `viscio/web/src/canvas/shapes/EllipseShape.tsx`
  - `viscio/web/src/canvas/shapes/LineArrowShape.tsx`
  - `viscio/web/src/canvas/shapes/DiamondShape.tsx`
  - `viscio/web/src/canvas/shapes/FreehandShape.tsx`
  - `viscio/web/src/canvas/TextBoxView.tsx`
  - `viscio/web/src/canvas/ImageElement.tsx`
  - `viscio/web/src/canvas/EmbedElement.tsx`
  - `viscio/web/src/canvas/LatexElement.tsx`
  - `viscio/web/src/canvas/CodeElement.tsx`
  - `viscio/web/src/canvas/CanvasElement.tsx`
  - `viscio/web/test/CanvasElement.test.tsx`

这一批都是只读渲染（Plan 2 才会加拖拽/编辑交互），六种形状 + 四种嵌入块，覆盖规格第 3.2 节列出的全部元素类型。

- [ ] **Step 1: 写六种形状组件（简单内联 SVG，用 0-100 的归一化 viewBox + `vector-effect="non-scaling-stroke"`，边框粗细不随元素拉伸变形）**

`web/src/canvas/shapes/RectShape.tsx`:
```tsx
export function RectShape({ content }: { content: any }) {
  const { fill = 'none', stroke = '#1a1a1a', strokeWidth = 2, cornerRadius = 0 } = content
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
      <rect x="1" y="1" width="98" height="98" rx={cornerRadius} fill={fill} stroke={stroke}
        strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
```

`web/src/canvas/shapes/EllipseShape.tsx`:
```tsx
export function EllipseShape({ content }: { content: any }) {
  const { fill = 'none', stroke = '#1a1a1a', strokeWidth = 2 } = content
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
      <ellipse cx="50" cy="50" rx="48" ry="48" fill={fill} stroke={stroke}
        strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
```

`web/src/canvas/shapes/DiamondShape.tsx`:
```tsx
export function DiamondShape({ content }: { content: any }) {
  const { fill = 'none', stroke = '#1a1a1a', strokeWidth = 2 } = content
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polygon points="50,2 98,50 50,98 2,50" fill={fill} stroke={stroke}
        strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
```

`web/src/canvas/shapes/LineArrowShape.tsx`:
```tsx
export function LineArrowShape({ content }: { content: any }) {
  const { stroke = '#1a1a1a', strokeWidth = 2, arrowEnd = true } = content
  const markerId = 'arrowhead'
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <marker id={markerId} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill={stroke} />
        </marker>
      </defs>
      <line x1="2" y1="98" x2="98" y2="2" stroke={stroke} strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke" markerEnd={arrowEnd ? `url(#${markerId})` : undefined} />
    </svg>
  )
}
```

`web/src/canvas/shapes/FreehandShape.tsx`:
```tsx
export function FreehandShape({ content }: { content: any }) {
  const { path = '', stroke = '#1a1a1a', strokeWidth = 2 } = content
  return (
    <svg width="100%" height="100%" style={{ overflow: 'visible' }}>
      <path d={path} fill="none" stroke={stroke} strokeWidth={strokeWidth}
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
```

- [ ] **Step 2: 写 `web/src/canvas/TextBoxView.tsx`（只读富文本——用 Tiptap 的 generateHTML 静态渲染，不挂实时编辑器）**

```tsx
import { generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'

const EXTENSIONS = [StarterKit]

export function TextBoxView({ content }: { content: any }) {
  const html = content?.doc ? generateHTML(content.doc, EXTENSIONS) : ''
  return (
    <div
      className="textbox-view"
      style={{ fontSize: content?.fontSize ?? 20, textAlign: content?.textAlign ?? 'left' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
```

- [ ] **Step 3: 写图片/嵌入/公式/代码四个组件**

`web/src/canvas/ImageElement.tsx`:
```tsx
export function ImageElement({ blobHash, content }: { blobHash: string | null; content: any }) {
  if (!blobHash) return null
  return (
    <img
      src={`${import.meta.env.BASE_URL}api/blobs/${blobHash}`}
      alt={content?.alt ?? ''}
      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
    />
  )
}
```

`web/src/canvas/EmbedElement.tsx`:
```tsx
export function EmbedElement({ blobHash, content }: { blobHash: string | null; content: any }) {
  const src = blobHash ? `${import.meta.env.BASE_URL}api/blobs/${blobHash}` : content?.src
  if (!src) return null
  return (
    <iframe
      src={src}
      sandbox="allow-scripts allow-same-origin"
      style={{ width: '100%', height: '100%', border: 'none' }}
      title="embed"
    />
  )
}
```

`web/src/canvas/LatexElement.tsx`:
```tsx
import katex from 'katex'
import 'katex/dist/katex.min.css'

export function LatexElement({ content }: { content: any }) {
  const html = katex.renderToString(content?.formula ?? '', {
    throwOnError: false,
    displayMode: content?.display ?? true,
  })
  return <div className="latex-element" dangerouslySetInnerHTML={{ __html: html }} />
}
```

`web/src/canvas/CodeElement.tsx`:
```tsx
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import python from 'highlight.js/lib/languages/python'
import 'highlight.js/styles/github.css'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('python', python)

export function CodeElement({ content }: { content: any }) {
  const language = content?.language ?? ''
  const code = content?.code ?? ''
  const html = hljs.getLanguage(language) ? hljs.highlight(code, { language }).value : code
  return (
    <pre className="code-element">
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  )
}
```

- [ ] **Step 4: 写失败测试 `web/test/CanvasElement.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { CanvasElement } from '../src/canvas/CanvasElement'
import type { ElementRow } from '../src/types'

function el(overrides: Partial<ElementRow>): ElementRow {
  return {
    id: '1', slide_id: 's1', type: 'rect', x: 0, y: 0, w: 100, h: 100,
    z_index: 0, group_id: null, content: {}, blob_hash: null, ...overrides,
  }
}

describe('CanvasElement', () => {
  it('rect 类型渲染出一个 svg', () => {
    const { container } = render(<CanvasElement element={el({ type: 'rect' })} />)
    expect(container.querySelector('svg rect')).toBeTruthy()
  })

  it('latex 类型渲染出 katex 输出', () => {
    const { container } = render(<CanvasElement element={el({ type: 'latex', content: { formula: 'x^2' } })} />)
    expect(container.querySelector('.katex')).toBeTruthy()
  })

  it('未知类型不报错，渲染为空', () => {
    const { container } = render(<CanvasElement element={el({ type: 'unknown' as any })} />)
    expect(container.textContent).toBe('')
  })
})
```

Run: `cd /Users/carolinge/Desktop/parchment/viscio/web && npx vitest run`
Expected: FAIL（`../src/canvas/CanvasElement` 不存在）。

- [ ] **Step 5: 写 `web/src/canvas/CanvasElement.tsx`**

```tsx
import type { CSSProperties } from 'react'
import type { ElementRow } from '../types'
import { RectShape } from './shapes/RectShape'
import { EllipseShape } from './shapes/EllipseShape'
import { LineArrowShape } from './shapes/LineArrowShape'
import { DiamondShape } from './shapes/DiamondShape'
import { FreehandShape } from './shapes/FreehandShape'
import { TextBoxView } from './TextBoxView'
import { ImageElement } from './ImageElement'
import { EmbedElement } from './EmbedElement'
import { LatexElement } from './LatexElement'
import { CodeElement } from './CodeElement'

export function CanvasElement({ element }: { element: ElementRow }) {
  const style: CSSProperties = {
    position: 'absolute',
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    zIndex: element.z_index,
  }

  let body: React.ReactNode = null
  switch (element.type) {
    case 'rect': body = <RectShape content={element.content} />; break
    case 'ellipse': body = <EllipseShape content={element.content} />; break
    case 'line-arrow': body = <LineArrowShape content={element.content} />; break
    case 'diamond': body = <DiamondShape content={element.content} />; break
    case 'freehand': body = <FreehandShape content={element.content} />; break
    case 'textbox': body = <TextBoxView content={element.content} />; break
    case 'image': body = <ImageElement blobHash={element.blob_hash} content={element.content} />; break
    case 'embed': body = <EmbedElement blobHash={element.blob_hash} content={element.content} />; break
    case 'latex': body = <LatexElement content={element.content} />; break
    case 'code': body = <CodeElement content={element.content} />; break
    default: body = null
  }

  return <div style={style}>{body}</div>
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd /Users/carolinge/Desktop/parchment/viscio/web && npx vitest run`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
cd /Users/carolinge/Desktop/parchment/viscio
git add web/src/canvas web/test/CanvasElement.test.tsx
git commit -m "feat: 十种元素类型的只读渲染"
```

---

### Task 16: Editor 页面骨架（打通读写渲染整条链路）

**Files:**
- Create: `viscio/web/src/routes/Editor.tsx`
- Modify: `viscio/web/src/App.tsx`

这一步的按钮是临时的——Plan 2 会换成真正的工具栏（点工具、在画布上拖拽创建）。这里只是要证明「新建元素 → PUT 保存 → GET 取回 → 画布正确渲染」这条链路是通的，这是 Plan 1 最终要验收的东西。

- [ ] **Step 1: 写 `web/src/routes/Editor.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiJson } from '../api'
import { Canvas } from '../canvas/Canvas'
import { CanvasElement } from '../canvas/CanvasElement'
import type { Deck, ElementRow, Slide } from '../types'

export function Editor() {
  const { deckId } = useParams()
  const [deck, setDeck] = useState<Deck | null>(null)
  const [slide, setSlide] = useState<Slide | null>(null)
  const [elements, setElements] = useState<ElementRow[]>([])

  async function load() {
    if (!deckId) return
    const d = await apiJson<Deck>(`/decks/${deckId}`)
    setDeck(d)
    const slides = await apiJson<Slide[]>(`/decks/${deckId}/slides`)
    const first = slides[0]
    setSlide(first ?? null)
    if (first) setElements(await apiJson<ElementRow[]>(`/slides/${first.id}/elements`))
  }

  useEffect(() => {
    load()
  }, [deckId])

  async function addTestRect() {
    if (!slide) return
    const next: ElementRow[] = [
      ...elements,
      {
        id: crypto.randomUUID(),
        slide_id: slide.id,
        type: 'rect',
        x: 100 + elements.length * 20,
        y: 100 + elements.length * 20,
        w: 200,
        h: 120,
        z_index: elements.length,
        group_id: null,
        content: { stroke: '#4a7dbd', strokeWidth: 2 },
        blob_hash: null,
      },
    ]
    await apiJson(`/slides/${slide.id}/elements`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    })
    setElements(next)
  }

  if (!deck || !slide) return <p>加载中…</p>

  return (
    <div className="editor">
      <h1>{deck.title}</h1>
      <button onClick={addTestRect}>+ 添加测试矩形（临时按钮，Plan 2 会换成正式工具栏）</button>
      <Canvas width={deck.canvas_width} height={deck.canvas_height}>
        {elements.map((el) => (
          <CanvasElement key={el.id} element={el} />
        ))}
      </Canvas>
    </div>
  )
}
```

- [ ] **Step 2: 在 `web/src/App.tsx` 里加路由**

```tsx
import { Editor } from './routes/Editor'
// ...
<Route path="/edit/:deckId" element={<RequireAuth><Editor /></RequireAuth>} />
```

- [ ] **Step 3: 手动验证整条链路【人工验证】**

两个终端跑起来（同 Task 12 Step 7），浏览器登录后点「新建演示」，进入编辑页，点几次「添加测试矩形」，应该在画布上看到矩形依次出现、错开摆放。刷新页面，矩形应该还在（证明确实存进了数据库，不是纯前端状态）。

- [ ] **Step 4: 提交**

```bash
cd /Users/carolinge/Desktop/parchment/viscio
git add web/src/routes/Editor.tsx web/src/App.tsx
git commit -m "feat: Editor 页面骨架，打通新建/保存/渲染链路"
```

---

### Task 17: 部署接入 homepage

**Files:**
- Create: `homepage/scripts/sync-viscio-src.sh`
- Modify: `homepage/server/server.js`, `homepage/Dockerfile`, `homepage/.gitignore`, `/Users/carolinge/Desktop/parchment/.gitignore`

- [ ] **Step 1: 写 `homepage/scripts/sync-viscio-src.sh`（照抄 `sync-mnemos-src.sh` 的模式）**

```bash
#!/bin/bash
# Viscio 和主站是两个独立的 git 仓库；合并成一个 fly app 需要它俩的代码在同一次
# Docker 构建里。这个脚本把 Viscio 的 server/web 源码复制进来（不含 node_modules、
# 不含 .git），构建/部署前跑一次即可。目标目录被 .gitignore 排除，不进版本控制。
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(cd .. && pwd)"

if [ ! -d "$ROOT/viscio/server/src" ] || [ ! -d "$ROOT/viscio/web/src" ]; then
  echo "找不到 $ROOT/viscio/server 或 $ROOT/viscio/web，确认 viscio/ 仓库存在且和 homepage/ 平级" >&2
  exit 1
fi

rm -rf viscio-src
mkdir -p viscio-src
cp -R "$ROOT/viscio/server" viscio-src/server
cp -R "$ROOT/viscio/web" viscio-src/web
rm -rf viscio-src/server/node_modules viscio-src/server/test \
       viscio-src/web/node_modules viscio-src/web/test viscio-src/web/dist

echo "synced viscio-src/ from $ROOT/viscio"
```

Run: `chmod +x /Users/carolinge/Desktop/parchment/homepage/scripts/sync-viscio-src.sh`

- [ ] **Step 2: 跑一次同步脚本，确认能正常复制【人工验证】**

Run: `cd /Users/carolinge/Desktop/parchment/homepage && bash scripts/sync-viscio-src.sh`
Expected: 输出 `synced viscio-src/ from .../viscio`，`homepage/viscio-src/{server,web}` 目录出现，且不含 `node_modules`/`test`/`dist`。

- [ ] **Step 3: 在 `homepage/server/server.js` 里加 `/viscio` 桥接中间件**

紧跟在现有 `/mnemos` 桥接代码块（大约在文件第 12-65 行）后面、`// Middleware` 注释之前插入：

```js
// ── Viscio 幻灯片编辑器挂载 ────────────────────────────────
// 跟 Mnemos 同样的模式：独立仓库、纯 ESM、跑在 Hono 上，用 getRequestListener
// 包成 Node (req,res) 处理函数挂到 /viscio 下。必须放在 body-parser 之前。
let viscioListenerPromise = null;
function getViscioListener() {
  if (!viscioListenerPromise) {
    viscioListenerPromise = (async () => {
      const [{ createApp }, { createDb }, { getRequestListener }] = await Promise.all([
        import('../viscio-src/server/src/app.js'),
        import('../viscio-src/server/src/db.js'),
        import('@hono/node-server'),
      ]);
      const viscioDataDir = path.join(DATA_DIR, 'viscio');
      const viscioApp = createApp({
        db: createDb(path.join(viscioDataDir, 'viscio.db')),
        password: process.env.VISCIO_ACCESS_PASSWORD || process.env.ACCESS_PASSWORD || '',
        webDist: path.join(__dirname, '../viscio-src/web/dist'),
      });
      return getRequestListener(viscioApp.fetch);
    })().catch(err => {
      // 跟 Mnemos 那边一样：第一次失败不该永久焊死，清掉缓存的失败 promise，
      // 下一个请求进来时重新试一次（常见诱因：部署时机跟同步脚本撞了）。
      viscioListenerPromise = null;
      throw err;
    });
  }
  return viscioListenerPromise;
}

app.use((req, res, next) => {
  const p = req.path;
  const isViscio = p === '/viscio' || p.startsWith('/viscio/');
  if (!isViscio) return next();

  getViscioListener().then(listener => {
    let rest = req.url.slice('/viscio'.length);
    if (!rest.startsWith('/')) rest = '/' + rest;
    req.url = rest;
    return listener(req, res);
  }).catch(err => {
    console.error('Viscio bridge error:', err);
    if (!res.headersSent) res.status(502).json({ message: 'Viscio 暂时不可用' });
  });
});
```

注意：这段引用了 `DATA_DIR` 和 `__dirname`，跟 Mnemos 的桥接块一样，`DATA_DIR` 在文件里稍后才 `const` 声明（大约第 74 行）——没关系，`getViscioListener` 只是个函数定义，真正执行要等第一个 `/viscio` 请求进来，那时候整个模块早就跑完初始化了。

- [ ] **Step 4: 在 `homepage/.gitignore` 里加一行**

```
node_modules/
client/node_modules/
server/node_modules/
client/build/
.env
*.log
.claude/settings.local.json
parchment/
mnemos-src/
viscio-src/
```

- [ ] **Step 5: 改 `homepage/Dockerfile`，加一个 `viscioweb` 构建阶段 + `viscio/server` 依赖安装 + 最终镜像里的拷贝**

完整替换后的 Dockerfile：

```dockerfile
FROM node:22-bookworm-slim AS mnemosweb
WORKDIR /app/mnemos-src/web
COPY mnemos-src/web/package*.json ./
RUN npm ci
COPY mnemos-src/web .
RUN npm run build

FROM node:22-bookworm-slim AS viscioweb
WORKDIR /app/viscio-src/web
COPY viscio-src/web/package*.json ./
RUN npm ci
COPY viscio-src/web .
RUN npm run build

FROM node:22-bookworm-slim AS serverdeps
# better-sqlite3（Mnemos 和 Viscio 都用）需要编译原生模块
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev
WORKDIR /app/mnemos-src/server
COPY mnemos-src/server/package*.json ./
RUN npm ci --omit=dev
WORKDIR /app/viscio-src/server
COPY viscio-src/server/package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS clientbuild
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install --legacy-peer-deps
COPY client/ .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app

COPY --from=serverdeps /app/server/node_modules server/node_modules
COPY server/ ./server/
COPY --from=clientbuild /app/client/build client/build

COPY --from=serverdeps /app/mnemos-src/server/node_modules mnemos-src/server/node_modules
COPY mnemos-src/server/package.json mnemos-src/server/
COPY mnemos-src/server/src mnemos-src/server/src
COPY --from=mnemosweb /app/mnemos-src/web/dist mnemos-src/web/dist

COPY --from=serverdeps /app/viscio-src/server/node_modules viscio-src/server/node_modules
COPY viscio-src/server/package.json viscio-src/server/
COPY viscio-src/server/src viscio-src/server/src
COPY --from=viscioweb /app/viscio-src/web/dist viscio-src/web/dist

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server/server.js"]
```

（`@hono/node-server` 已经在 `homepage/server/package.json` 的 dependencies 里了，Mnemos 挂载时已经加过，不用重复加。）

- [ ] **Step 6: 在本仓库根 `.gitignore` 里加一行，排除新的 `viscio/` 独立仓库**

```
node_modules/
dist/
data/
*.log
.DS_Store
.superpowers/

# 用户的独立项目，不属于本仓库
riffle/
homepage/
viscio/

# 明文密钥交接包 —— 本仓库是公开的，这些绝不能进版本控制
deploy-handoff/
SECRETS.md
*_token.txt
.env
.env.*
```

- [ ] **Step 7: 提交 homepage 仓库的改动**

```bash
cd /Users/carolinge/Desktop/parchment/homepage
git add scripts/sync-viscio-src.sh server/server.js Dockerfile .gitignore
git commit -m "feat: 挂载 Viscio 到 /viscio，跟 /mnemos 同样的桥接模式"
```

- [ ] **Step 8: 提交本仓库（parchment/Mnemos）根 .gitignore 的改动**

```bash
cd /Users/carolinge/Desktop/parchment
git add .gitignore
git commit -m "chore: .gitignore 排除新的 viscio/ 独立仓库"
```

---

### Task 18: 部署与验收【人工验证，需要用户自己确认基础设施相关步骤】

这一步涉及真实的 Fly.io 部署，属于会影响线上服务的操作——照 Plan 1 的 Goal 走完，但实际执行 `flyctl deploy` 前请自己确认好時机（比如别在改动了一半时部署）。

**Files:** 无代码改动，纯验证步骤。

- [ ] **Step 1: 本地起两个服务，冒烟测试【人工验证】**

```bash
cd /Users/carolinge/Desktop/parchment/viscio/server && VISCIO_ACCESS_PASSWORD=dev DATA_DIR=./data npm run dev
cd /Users/carolinge/Desktop/parchment/viscio/web && npm run dev
```
走一遍：登录 → 新建 deck → 加两个测试矩形 → 刷新页面确认还在 → 删除 deck → 确认列表里消失。

- [ ] **Step 2: 跑全部自动化测试确认没有遗漏**

```bash
cd /Users/carolinge/Desktop/parchment/viscio/server && npx vitest run
cd /Users/carolinge/Desktop/parchment/viscio/web && npx vitest run
```
Expected: 两边全部 PASS。

- [ ] **Step 3: 部署前跑一次同步脚本【人工验证】**

```bash
cd /Users/carolinge/Desktop/parchment/homepage && bash scripts/sync-viscio-src.sh
```

- [ ] **Step 4: 部署【人工验证——需要用户自己执行，涉及线上服务，不要自动化跑】**

```bash
cd /Users/carolinge/Desktop/parchment/homepage
export PATH="$HOME/.fly/bin:$PATH"
flyctl deploy --remote-only --app carolinge-homepage
```

- [ ] **Step 5: 部署后核对构建产物哈希，确认服务端真的换成了新代码【人工验证】**

参照 `deploy-handoff/PROJECT-HANDBOOK.md` 里记录的做法：对比构建产物文件名里的 hash（`homepage/client/build/static/js/main.*.js`、`homepage/viscio-src/web/dist/assets/index-*.js`）跟 `curl https://linge.li/viscio/assets/` 之类拿到的线上文件名是否一致——服务端进程可能在内存里缓存了旧的 `index.html`，光看部署命令跑完不代表真的生效。

- [ ] **Step 6: 验收标准逐条核对【人工验证】**

- [ ] 打开 `https://linge.li/viscio`，看到登录页，输密码后进 deck 列表
- [ ] 新建一个 deck，加几个测试矩形，刷新页面还在——确认数据落在 `/data/viscio/*`（不是新卷，是 `merged_data` 卷下的子目录）
- [ ] 同时在另一个浏览器/隐私窗口登录 `https://linge.li/mnemos`，回到 Viscio 标签页刷新，确认 Viscio 的登录状态没有被顶掉（这是规格里点名要验证的 cookie 隔离）
- [ ] `https://linge.li/mnemos` 依旧正常工作，没有因为这次改动出问题

- [ ] **Step 7: 全部核对通过后，视为 Plan 1 验收完成**

不需要提交代码（Task 17 已经提交过所有改动）；如果第 5、6 步发现问题，回到对应 Task 修代码，重新走一遍 Step 3-6。

---

## Plan 1 完成后

Plan 1 验收通过、`/viscio` 稳定在线之后，回到规格文档，我会继续写 **Plan 2（编辑器交互）**：把 Task 16 里那个临时的「添加测试矩形」按钮，换成真正的工具栏——六种形状工具、Tiptap 富文本文字框（含悬浮菜单用 React portal 挂到画布缩放容器外面，规格第 2 节点名的坑）、embed/latex/code 插入、拖拽移动/缩放、智能对齐吸附线、多选编组、图层顺序、撤销重做、幻灯片管理 UI、autosave。
