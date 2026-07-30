import { Hono } from 'hono'
import { authRoutes, requireAuth } from './auth.js'
import { entriesRoutes } from './entries.js'
import { imagesRoutes } from './images.js'
import { citeRoutes } from './cite.js'
import { exportRoutes } from './export.js'

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
  return app
}
