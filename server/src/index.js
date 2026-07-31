import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { resolveTask } from './entries.js'
import { extractText } from './text.js'
import { seedWelcomeIfEmpty } from './welcome.js'
import { createDb } from './db.js'

const password = process.env.ACCESS_PASSWORD
if (!password) {
  console.error('缺少环境变量 ACCESS_PASSWORD')
  process.exit(1)
}
const dataDir = process.env.DATA_DIR || './data'
fs.mkdirSync(dataDir, { recursive: true })

const db = createDb(dataDir)
if (seedWelcomeIfEmpty(db, {
  resolveTask, extractText,
  randomUUID: () => crypto.randomUUID(),
  today: () => new Date().toISOString().slice(0, 10),
})) {
  console.log('首次启动：已写入使用说明卡片（可随时删除）')
}

const app = createApp({
  db,
  imagesDir: path.join(dataDir, 'images'),
  password,
  webDist: process.env.WEB_DIST || null,
})
const port = Number(process.env.PORT || 8787)
serve({ fetch: app.fetch, port })
console.log(`parchment server on :${port}`)
