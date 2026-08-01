import fs from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { authRoutes, requireAuth } from './auth.js'
import { entriesRoutes } from './entries.js'
import { imagesRoutes } from './images.js'
import { citeRoutes } from './cite.js'
import { exportRoutes, convertRoutes } from './export.js'

export function createApp({ db, imagesDir, password, fetchImpl = fetch, webDist = null }) {
  const app = new Hono()
  app.get('/api/health', c => c.json({ ok: true }))
  authRoutes(app, db, password)
  app.use('/api/*', requireAuth(db))
  app.use('/images/*', requireAuth(db))
  entriesRoutes(app, db)
  imagesRoutes(app, imagesDir)
  citeRoutes(app, db, fetchImpl)
  exportRoutes(app, db, imagesDir)
  convertRoutes(app)

  // 生产模式：由本进程静态托管前端构建产物，单容器部署
  if (webDist) {
    const index = fs.readFileSync(path.join(webDist, 'index.html'), 'utf8')
    app.use('/assets/*', serveStatic({ root: path.relative(process.cwd(), webDist) || '.' }))
    app.get('*', c => c.html(index))
  }
  return app
}
