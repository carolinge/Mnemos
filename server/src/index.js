import path from 'node:path'
import fs from 'node:fs'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { createDb } from './db.js'

const password = process.env.ACCESS_PASSWORD
if (!password) {
  console.error('缺少环境变量 ACCESS_PASSWORD')
  process.exit(1)
}
const dataDir = process.env.DATA_DIR || './data'
fs.mkdirSync(dataDir, { recursive: true })

const app = createApp({
  db: createDb(dataDir),
  imagesDir: path.join(dataDir, 'images'),
  password,
  webDist: process.env.WEB_DIST || null,
})
const port = Number(process.env.PORT || 8787)
serve({ fetch: app.fetch, port })
console.log(`parchment server on :${port}`)
