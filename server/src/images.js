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
