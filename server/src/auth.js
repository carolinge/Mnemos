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
