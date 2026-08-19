# Viscio Play Mode, Version History UI & Offline Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Viscio's v1 scope (Plan 3 of 3): a public fullscreen play mode with keyboard navigation, a version-history browsing/restore panel, share-link controls, and offline export to a self-contained HTML file — per design spec sections 3.3–3.6.

**Architecture:** Builds on Plan 1 (data model + all CRUD routes, including the full revisions API) and Plan 2 (the editor: `Editor.tsx`, `CanvasElement.tsx`, toolbar). Reuses `CanvasElement` and its shape/text/embed renderers for BOTH the live public play route and the offline export bundle via one shared `Player` component — the only reason they can differ is where blob (image/embed) URLs resolve from, so that's the one seam this plan introduces (`BlobUrlContext`). Offline export is a second, separate Vite build (`vite-plugin-singlefile`) producing one self-contained "player" HTML template; the backend stitches deck data (with images/embeds inlined as base64) into that template on request — not a live-DOM serialization, which would break under `file://`.

**Tech Stack:** Same as Plan 1/2. Adds `vite-plugin-singlefile` (web devDependency) for the offline player bundle.

**Repo:** `/Users/carolinge/Desktop/parchment/viscio`, continue on branch `build/foundation` (no worktree, same as Plan 1/2). Task 10 also touches the separate `homepage` repo (Dockerfile only) — same repo Plan 1's Task 17 touched.

**Commit convention:** Plain `git commit -m "..."`, no `Co-Authored-By`/AI-attribution trailers.

**Precondition:** Plan 2 (`docs/superpowers/plans/2026-08-19-viscio-editor.md`) is fully implemented and committed before starting this plan — several tasks below modify `Editor.tsx` and `CanvasElement.tsx` as Plan 2 left them. Read those files fresh (Read tool) before editing; don't assume the exact plan-2 snippets are byte-for-byte what's on disk (an implementer may have fixed a small bug along the way).

---

## Global notes for every task

- Run `npm --prefix viscio/web test` / `npm --prefix viscio/server test` after every step that touches that side.
- Manual verification: same two-terminal setup as Plan 1/2 (see that plan's "Global notes" — Terminal A runs `server`, Terminal B runs `web`, browser at `http://localhost:5173/viscio/`, password `dev`).
- `ElementRow`, `Deck`, `Slide` types live in `web/src/types.ts` — reuse them.

---

### Task 1: `BlobUrlContext` — decouple image/embed URL resolution from the live API

**Files:**
- Create: `web/src/lib/BlobUrlContext.tsx`
- Modify: `web/src/canvas/ImageElement.tsx`
- Modify: `web/src/canvas/EmbedElement.tsx`
- Test: `web/test/BlobUrlContext.test.tsx`

Both the live editor/play route and the offline export bundle render the same `ImageElement`/`EmbedElement` components, but they need blob URLs to resolve differently: live → `/viscio/api/blobs/:hash`, offline → an inlined `data:` URI. A React context with a resolver function is the smallest way to make that swappable without duplicating the components.

- [ ] **Step 1: Write the failing test**

```tsx
// web/test/BlobUrlContext.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { BlobUrlContext } from '../src/lib/BlobUrlContext'
import { ImageElement } from '../src/canvas/ImageElement'

afterEach(cleanup)

describe('BlobUrlContext', () => {
  it('ImageElement uses the default resolver (live /api/blobs path) with no provider', () => {
    const { container } = render(<ImageElement blobHash="abc" content={{}} />)
    const img = container.querySelector('img')!
    expect(img.src).toContain('/api/blobs/abc')
  })

  it('ImageElement uses a provided resolver when wrapped in BlobUrlContext.Provider', () => {
    const { container } = render(
      <BlobUrlContext.Provider value={(hash) => `data:image/png;base64,FAKE_${hash}`}>
        <ImageElement blobHash="abc" content={{}} />
      </BlobUrlContext.Provider>,
    )
    const img = container.querySelector('img')!
    expect(img.src).toBe('data:image/png;base64,FAKE_abc')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- BlobUrlContext.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/lib/BlobUrlContext.tsx
import { createContext, useContext } from 'react'

const BASE = import.meta.env.BASE_URL

const defaultResolver = (hash: string) => `${BASE}api/blobs/${hash}`

// 图片/embed 元素不关心自己在"在线编辑器/播放页"还是"离线导出的单文件"里渲染——
// 唯一的区别是 blob hash 该解析成一个活的 API 地址还是一段内嵌的 data: URI，
// 这层区别用 context 隔开，两处渲染代码（ImageElement/EmbedElement）完全复用。
export const BlobUrlContext = createContext<(hash: string) => string>(defaultResolver)

export function useBlobUrl() {
  return useContext(BlobUrlContext)
}
```

Modify `web/src/canvas/ImageElement.tsx`:

```tsx
import { useBlobUrl } from '../lib/BlobUrlContext'

export function ImageElement({ blobHash, content }: { blobHash: string | null; content: any }) {
  const resolve = useBlobUrl()
  if (!blobHash) return null
  return (
    <img
      src={resolve(blobHash)}
      alt={content?.alt ?? ''}
      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
    />
  )
}
```

Modify `web/src/canvas/EmbedElement.tsx`:

```tsx
import { useBlobUrl } from '../lib/BlobUrlContext'

export function EmbedElement({ blobHash, content }: { blobHash: string | null; content: any }) {
  const resolve = useBlobUrl()
  const src = blobHash ? resolve(blobHash) : content?.src
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- BlobUrlContext.test.tsx`
Expected: PASS (2/2). Also run the full suite to confirm `CanvasElement.test.tsx`/`Editor.test.tsx` from Plan 1/2 still pass unchanged (this task doesn't change either component's public props).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/BlobUrlContext.tsx web/src/canvas/ImageElement.tsx web/src/canvas/EmbedElement.tsx web/test/BlobUrlContext.test.tsx
git commit -m "feat: blob URL 解析改走 context，为离线导出复用渲染组件做准备"
```

---

### Task 2: `Player` component — fullscreen slide renderer with keyboard nav

**Files:**
- Create: `web/src/player/Player.tsx`
- Modify: `web/src/styles.css` (append player styles)
- Test: `web/test/Player.test.tsx`

This is the shared core for both the public play route (Task 3) and the offline export bundle (Task 8) — it takes plain `{deck, slides}` data (already the exact shape `GET /play/:slug` returns) and doesn't know or care where that data came from.

- [ ] **Step 1: Write the failing test**

```tsx
// web/test/Player.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Player } from '../src/player/Player'
import type { ElementRow } from '../src/types'

afterEach(cleanup)

const rect = (id: string): ElementRow => ({
  id, slide_id: 's', type: 'rect', x: 0, y: 0, w: 10, h: 10, z_index: 0, group_id: null, content: {}, blob_hash: null,
})

const deck = { id: 'd1', title: 'T', canvas_width: 1280, canvas_height: 720 }
const slides = [
  { id: 's1', position: 0, elements: [rect('a')] },
  { id: 's2', position: 1, elements: [rect('b')] },
]

describe('Player', () => {
  it('renders slide 1 first with a 1-based page indicator', () => {
    render(<Player deck={deck} slides={slides} />)
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('ArrowRight/space/PageDown advance; ArrowLeft/PageUp go back; clamped at both ends', () => {
    render(<Player deck={deck} slides={slides} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowRight' }) // already last, no-op
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'PageDown' })
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: ' ' })
    expect(screen.getByText('2 / 2')).toBeInTheDocument() // clamped, already last
    fireEvent.keyDown(window, { key: 'PageUp' })
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('renders an empty deck (0 slides) without crashing', () => {
    render(<Player deck={deck} slides={[]} />)
    expect(screen.queryByText(/\//)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- Player.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/player/Player.tsx
import { useEffect, useState } from 'react'
import { Canvas } from '../canvas/Canvas'
import { CanvasElement } from '../canvas/CanvasElement'
import type { ElementRow } from '../types'

export type PlaySlide = { id: string; position: number; elements: ElementRow[] }
export type PlayDeck = { id: string; title: string; canvas_width: number; canvas_height: number }

const NOOP = () => {}

export function Player({ deck, slides }: { deck: PlayDeck; slides: PlaySlide[] }) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault()
        setIndex((i) => Math.min(i + 1, slides.length - 1))
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        setIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Escape' && document.fullscreenElement) {
        document.exitFullscreen()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [slides.length])

  const slide = slides[index]
  if (!slide) return null

  return (
    <div className="player-root">
      {/* key=slide.id 强制每次翻页整棵子树重新挂载——嵌入的三维图 iframe 每次
          进入都是全新实例，不会带着上一次转到的视角跳到下一页，也避免多个
          Plotly 实例同时占内存（design spec 3.4） */}
      <Canvas key={slide.id} width={deck.canvas_width} height={deck.canvas_height}>
        {slide.elements.map((el) => (
          <CanvasElement key={el.id} element={el} editing={false} onStartEdit={NOOP} onChangeContent={NOOP} onStopEdit={NOOP} />
        ))}
      </Canvas>
      <div className="player-page-indicator">{index + 1} / {slides.length}</div>
    </div>
  )
}
```

Append to `web/src/styles.css`:

```css
.player-root { width: 100vw; height: 100vh; background: #000; display: flex; align-items: center; justify-content: center; position: relative; }
.player-page-indicator { position: fixed; left: 12px; bottom: 12px; color: #fff; font-size: 14px; opacity: 0.6; font-family: monospace; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- Player.test.tsx`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add web/src/player/Player.tsx web/src/styles.css web/test/Player.test.tsx
git commit -m "feat: 全屏播放组件——键盘翻页 + 页码，播放页/离线导出共用"
```

---

### Task 3: Public `/play/:slug` route

**Files:**
- Modify: `web/src/api.ts` (extract a reusable retry-fetch helper)
- Create: `web/src/routes/Play.tsx`
- Modify: `web/src/App.tsx` (register the route, outside `RequireAuth`)
- Test: `web/test/Play.test.tsx`

`GET /play/:slug` (Plan 1, unchanged) is public — no cookie, no auth guard. It can still hit a cold Fly machine, so this reuses the same wake-retry backoff `api.ts` already has for authenticated calls, factored out so both can share it.

- [ ] **Step 1: Write the failing test**

```tsx
// web/test/Play.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Play } from '../src/routes/Play'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function renderAt(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/play/${slug}`]}>
      <Routes><Route path="/play/:slug" element={<Play />} /></Routes>
    </MemoryRouter>,
  )
}

describe('Play', () => {
  it('fetches /play/:slug and renders the page indicator once loaded', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ deck: { id: 'd1', title: 'T', canvas_width: 1280, canvas_height: 720 }, slides: [{ id: 's1', position: 0, elements: [] }] }),
    } as Response)
    renderAt('abc')
    await waitFor(() => expect(screen.getByText('1 / 1')).toBeInTheDocument())
  })

  it('shows an error message for an unknown slug', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as Response)
    renderAt('nope')
    await waitFor(() => expect(screen.getByText('找不到这个分享链接。')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- Play.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Read the current `web/src/api.ts` (Plan 1) first, then refactor it to extract the retry loop so `Play.tsx` can reuse it for the unauthenticated `/play/:slug` endpoint:

```ts
// web/src/api.ts
const BASE = import.meta.env.BASE_URL // '/viscio/'

type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | null = null
export function setUnauthorizedHandler(fn: UnauthorizedHandler) {
  onUnauthorized = fn
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Fly.io 闲置会把机器睡掉，冷启动大约 7 秒；请求失败时递增退避重试，而不是直接把
// 错误抛给用户看。/play/:slug 是公开路由不带 cookie，跟带 cookie 的 /api/* 请求
// 共享同一套重试逻辑——冷启动这件事跟认没认证无关。
async function fetchWithRetry(url: string, init: RequestInit = {}): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, init)
      if (res.ok || attempt === 3 || res.status === 401) return res
    } catch (err) {
      lastErr = err
    }
    await sleep(1500 * (attempt + 1))
  }
  throw lastErr ?? new Error('request failed')
}

export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetchWithRetry(`${BASE}api${path}`, { credentials: 'include', ...init })
  if (res.status === 401) onUnauthorized?.()
  return res
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await api(path, init)
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export async function fetchPublicJson<T>(path: string): Promise<T> {
  const res = await fetchWithRetry(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json() as Promise<T>
}
```

```tsx
// web/src/routes/Play.tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchPublicJson } from '../api'
import { Player, type PlayDeck, type PlaySlide } from '../player/Player'

export function Play() {
  const { slug } = useParams()
  const [data, setData] = useState<{ deck: PlayDeck; slides: PlaySlide[] } | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchPublicJson<{ deck: PlayDeck; slides: PlaySlide[] }>(`play/${slug}`)
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [slug])

  if (error) return <p className="play-error">找不到这个分享链接。</p>
  if (!data) return null
  return <Player deck={data.deck} slides={data.slides} />
}
```

Modify `web/src/App.tsx` to add the route OUTSIDE `RequireAuth` (public):

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Login } from './routes/Login'
import { DeckList } from './routes/DeckList'
import { Editor } from './routes/Editor'
import { Play } from './routes/Play'
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
        <Route path="/play/:slug" element={<Play />} />
        <Route path="/" element={<RequireAuth><DeckList /></RequireAuth>} />
        <Route path="/edit/:deckId" element={<RequireAuth><Editor /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- Play.test.tsx`
Expected: PASS (2/2). Then run the full suite — `api.test.ts` doesn't exist yet in this codebase so there's nothing to break there, but double check nothing else imports internals of `api.ts` that got renamed (only `sleep`/the retry loop were internal already).

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/routes/Play.tsx web/src/App.tsx web/test/Play.test.tsx
git commit -m "feat: 公开放映页 /play/:slug，免密访问"
```

---

### Task 4: Auto 10-minute snapshot

**Files:**
- Create: `web/src/lib/useAutoSnapshot.ts`
- Modify: `web/src/routes/Editor.tsx`
- Test: `web/test/useAutoSnapshot.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/test/useAutoSnapshot.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutoSnapshot } from '../src/lib/useAutoSnapshot'

describe('useAutoSnapshot', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not snapshot after 10 minutes if the value never changed', async () => {
    const snapshot = vi.fn().mockResolvedValue(undefined)
    renderHook(({ value }) => useAutoSnapshot(value, snapshot), { initialProps: { value: 'a' } })
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(snapshot).not.toHaveBeenCalled()
  })

  it('snapshots once at the 10-minute mark if the value changed, then resets dirtiness', async () => {
    const snapshot = vi.fn().mockResolvedValue(undefined)
    const { rerender } = renderHook(({ value }) => useAutoSnapshot(value, snapshot), { initialProps: { value: 'a' } })
    rerender({ value: 'b' })
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(snapshot).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000) // no further change, no second snapshot
    expect(snapshot).toHaveBeenCalledTimes(1)
  })

  it('markDirty() forces the next interval to snapshot even if the tracked value did not change', async () => {
    const snapshot = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(({ value }) => useAutoSnapshot(value, snapshot), { initialProps: { value: 'a' } })
    act(() => result.current.markDirty())
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(snapshot).toHaveBeenCalledTimes(1)
  })

  it('a failed snapshot stays dirty and retries on the next interval', async () => {
    const snapshot = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined)
    const { rerender } = renderHook(({ value }) => useAutoSnapshot(value, snapshot), { initialProps: { value: 'a' } })
    rerender({ value: 'b' })
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(snapshot).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(snapshot).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- useAutoSnapshot.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/useAutoSnapshot.ts
import { useEffect, useRef } from 'react'

const INTERVAL_MS = 10 * 60 * 1000

// 每 10 分钟检查一次：只有距上次快照（手动或自动）之后真的有改动才存一个 auto
// 快照，没有改动不存空快照（design spec 3.3）。value 的变化能自动标脏；有些改动
// 不体现在 value 上（比如 Editor 里切页/增删页不改变当前页 elements 的引用），
// 这类场景由调用方显式调 markDirty() 补上。
export function useAutoSnapshot<T>(value: T, snapshot: () => Promise<void>) {
  const dirtyRef = useRef(false)
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    dirtyRef.current = true
  }, [value])

  useEffect(() => {
    const timer = setInterval(() => {
      if (!dirtyRef.current) return
      dirtyRef.current = false
      snapshot().catch(() => {
        dirtyRef.current = true
      })
    }, INTERVAL_MS)
    return () => clearInterval(timer)
  }, [snapshot])

  return { markDirty: () => { dirtyRef.current = true } }
}
```

Modify `web/src/routes/Editor.tsx`: read the current file first (Plan 2 left it fully wired), then add the auto-snapshot hook and call `markDirty()` from the slide-mutating handlers that don't otherwise change the tracked `elements` reference. Add near the other hooks (after the `useAutosave` call):

```tsx
import { useAutoSnapshot } from '../lib/useAutoSnapshot'
// ...
async function autoSnapshot() {
  if (!deckId) return
  await apiJson(`/decks/${deckId}/revisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trigger: 'auto' }),
  })
}
const { markDirty } = useAutoSnapshot(elements, autoSnapshot)
```

Then call `markDirty()` at the end of `addSlide`, `deleteSlide`, and `reorderSlides` (these mutate deck-level state that a snapshot should capture but don't change the `elements` reference `useAutoSnapshot` is watching).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- useAutoSnapshot.test.ts`, then the full `npm --prefix web test` to confirm `Editor.test.tsx` (Plan 2) still passes — it doesn't assert anything about the 10-minute timer, so it should be unaffected, but confirm no new console errors/warnings from the added hook.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/useAutoSnapshot.ts web/src/routes/Editor.tsx web/test/useAutoSnapshot.test.ts
git commit -m "feat: 每 10 分钟自动快照（有改动才存）"
```

---

### Task 5: Revision history panel + manual-save failure feedback

**Files:**
- Create: `web/src/canvas/RevisionPanel.tsx`
- Modify: `web/src/routes/Editor.tsx`
- Test: `web/test/RevisionPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/test/RevisionPanel.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { RevisionPanel } from '../src/canvas/RevisionPanel'
import * as apiModule from '../src/api'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('RevisionPanel', () => {
  it('lists revisions fetched for the deck, newest first as returned by the API', async () => {
    vi.spyOn(apiModule, 'apiJson').mockImplementation(async (path: string) => {
      if (path === '/decks/d1/revisions') return [{ id: 'r2', created_at: 200, trigger: 'auto' }, { id: 'r1', created_at: 100, trigger: 'manual' }]
      return {}
    })
    render(<RevisionPanel deckId="d1" onRestore={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByText(/手动|自动/)).toHaveLength(2))
  })

  it('shows an empty state with zero revisions', async () => {
    vi.spyOn(apiModule, 'apiJson').mockResolvedValue([])
    render(<RevisionPanel deckId="d1" onRestore={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('还没有版本快照')).toBeInTheDocument())
  })

  it('restoring a revision confirms, POSTs restore, and calls onRestore', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onRestore = vi.fn()
    const apiJsonSpy = vi.spyOn(apiModule, 'apiJson').mockImplementation(async (path: string) => {
      if (path === '/decks/d1/revisions') return [{ id: 'r1', created_at: 100, trigger: 'manual' }]
      return { ok: true }
    })
    render(<RevisionPanel deckId="d1" onRestore={onRestore} onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('恢复'))
    fireEvent.click(screen.getByText('恢复'))
    await waitFor(() => expect(onRestore).toHaveBeenCalled())
    expect(apiJsonSpy).toHaveBeenCalledWith('/revisions/r1/restore', { method: 'POST' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- RevisionPanel.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/canvas/RevisionPanel.tsx
import { useEffect, useState } from 'react'
import { apiJson } from '../api'

type RevisionMeta = { id: string; created_at: number; trigger: 'manual' | 'auto' }

export function RevisionPanel({ deckId, onRestore, onClose }: { deckId: string; onRestore: () => void; onClose: () => void }) {
  const [revisions, setRevisions] = useState<RevisionMeta[]>([])

  useEffect(() => {
    apiJson<RevisionMeta[]>(`/decks/${deckId}/revisions`).then(setRevisions)
  }, [deckId])

  async function restore(id: string) {
    if (!confirm('恢复到这个版本？当前未保存的改动会被覆盖。')) return
    await apiJson(`/revisions/${id}/restore`, { method: 'POST' })
    onRestore()
  }

  return (
    <div className="revision-panel">
      <div className="revision-panel-header">
        <h3>版本历史</h3>
        <button className="toolbar-btn" onClick={onClose}>关闭</button>
      </div>
      <ul>
        {revisions.map((r) => (
          <li key={r.id}>
            <span>{new Date(r.created_at).toLocaleString()}</span>
            <span className="revision-trigger">{r.trigger === 'manual' ? '手动' : '自动'}</span>
            <button className="toolbar-btn" onClick={() => restore(r.id)}>恢复</button>
          </li>
        ))}
        {revisions.length === 0 && <li className="revision-empty">还没有版本快照</li>}
      </ul>
    </div>
  )
}
```

Modify `web/src/routes/Editor.tsx`:
1. Import `RevisionPanel`, add `const [showRevisions, setShowRevisions] = useState(false)`.
2. Add a toolbar button "版本历史" (next to the existing undo/redo/save-status area — add it as an extra prop on `Toolbar` called `onToggleRevisions`, or simplest: render a standalone button in `editor` next to `Toolbar` rather than growing `Toolbar`'s prop list further — pick whichever keeps `Toolbar.tsx` from Plan 2 unmodified: add a small `<button className="toolbar-btn" onClick={() => setShowRevisions(true)}>版本历史</button>` rendered immediately after `<Toolbar .../>` in the JSX, no changes to `Toolbar.tsx` itself).
3. Render `{showRevisions && <RevisionPanel deckId={deckId!} onRestore={async () => { setShowRevisions(false); await load() }} onClose={() => setShowRevisions(false)} />}` — reusing the existing `load()` function (it already re-fetches deck+slides+first slide's elements, which is exactly what's needed after a restore since restore can change the slide list).
4. Make the existing `manualSnapshot` function surface failures instead of swallowing them (spec 7: "Ctrl+S 手动保存失败必须有明确的失败提示（不能静默失败）"):

```tsx
async function manualSnapshot() {
  if (!deckId) return
  try {
    await apiJson(`/decks/${deckId}/revisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'manual' }),
    })
  } catch {
    alert('保存失败，请检查网络后重试（Ctrl+S 再存一次）。')
  }
}
```

(A plain `alert()` is a deliberate simplification — it satisfies "not silent" with zero new UI, upgradeable to a toast component later if it ever feels intrusive.)

Append to `web/src/styles.css`:

```css
.revision-panel { position: fixed; right: 12px; top: 60px; width: 280px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--card-shadow); padding: 8px; z-index: 900; }
.revision-panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.revision-panel ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.revision-panel li { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 12px; }
.revision-trigger { color: var(--muted); }
.revision-empty { color: var(--muted); justify-content: center; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- RevisionPanel.test.tsx`, then the full suite.

- [ ] **Step 5: Commit**

```bash
git add web/src/canvas/RevisionPanel.tsx web/src/routes/Editor.tsx web/src/styles.css web/test/RevisionPanel.test.tsx
git commit -m "feat: 版本历史面板（浏览/恢复）+ Ctrl+S 失败明确提示"
```

---

### Task 6: Share-link controls

**Files:**
- Create: `web/src/canvas/ShareControl.tsx`
- Modify: `web/src/routes/Editor.tsx`
- Test: `web/test/ShareControl.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/test/ShareControl.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { ShareControl } from '../src/canvas/ShareControl'
import * as apiModule from '../src/api'
import type { Deck } from '../src/types'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const deck: Deck = { id: 'd1', title: 'T', canvas_width: 1280, canvas_height: 720, share_slug: 'abc123', created_at: 0, updated_at: 0 }

describe('ShareControl', () => {
  it('shows a share URL built from the slug', () => {
    render(<ShareControl deck={deck} onRegenerate={vi.fn()} />)
    const input = screen.getByLabelText('分享链接') as HTMLInputElement
    expect(input.value).toContain('/play/abc123')
  })

  it('copy button writes the share URL to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<ShareControl deck={deck} onRegenerate={vi.fn()} />)
    fireEvent.click(screen.getByText('复制链接'))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
  })

  it('regenerate confirms, POSTs regenerate-slug, and calls onRegenerate with the new deck', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const nextDeck = { ...deck, share_slug: 'xyz789' }
    vi.spyOn(apiModule, 'apiJson').mockResolvedValue(nextDeck)
    const onRegenerate = vi.fn()
    render(<ShareControl deck={deck} onRegenerate={onRegenerate} />)
    fireEvent.click(screen.getByText('重新生成'))
    await waitFor(() => expect(onRegenerate).toHaveBeenCalledWith(nextDeck))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- ShareControl.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/canvas/ShareControl.tsx
import { useState } from 'react'
import { apiJson } from '../api'
import type { Deck } from '../types'

export function ShareControl({ deck, onRegenerate }: { deck: Deck; onRegenerate: (deck: Deck) => void }) {
  const [copied, setCopied] = useState(false)
  const shareUrl = `${window.location.origin}${import.meta.env.BASE_URL}play/${deck.share_slug}`

  async function regenerate() {
    if (!confirm('重新生成分享链接？旧链接会立刻失效。')) return
    const next = await apiJson<Deck>(`/decks/${deck.id}/regenerate-slug`, { method: 'POST' })
    onRegenerate(next)
  }

  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="share-control">
      <input readOnly aria-label="分享链接" value={shareUrl} onFocus={(e) => e.target.select()} />
      <button className="toolbar-btn" onClick={copyLink}>{copied ? '已复制' : '复制链接'}</button>
      <button className="toolbar-btn" onClick={regenerate}>重新生成</button>
    </div>
  )
}
```

Modify `web/src/routes/Editor.tsx`: render `<ShareControl deck={deck} onRegenerate={setDeck} />` next to the "版本历史" button added in Task 5 (both belong in the same header row).

Append to `web/src/styles.css`:

```css
.share-control { display: flex; gap: 4px; align-items: center; }
.share-control input { width: 220px; font-size: 12px; border: 1px solid var(--border); border-radius: 4px; padding: 4px 6px; background: var(--bg); color: var(--muted); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- ShareControl.test.tsx`, then the full suite.

- [ ] **Step 5: Commit**

```bash
git add web/src/canvas/ShareControl.tsx web/src/routes/Editor.tsx web/src/styles.css web/test/ShareControl.test.tsx
git commit -m "feat: 分享链接控件——复制/一键重新生成"
```

---

### Task 7: Server — shared snapshot helper + blob-inlining for export

**Files:**
- Create: `server/src/snapshot.js`
- Modify: `server/src/revisions.js` (reuse the extracted helper instead of its inline duplicate)
- Create: `server/src/export.js`
- Test: `server/test/export.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/test/export.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { createApp } from '../src/app.js'
import { createDb } from '../src/db.js'

let app, cookie, deckId

const FAKE_TEMPLATE = '<html><body><script>window.__VISCIO_EXPORT_DATA__ = "__VISCIO_EXPORT_DATA__"</script></body></html>'

beforeEach(async () => {
  app = createApp({ db: createDb(':memory:'), password: 'secret', playerTemplate: FAKE_TEMPLATE })
  const login = await app.request('/api/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret' }),
  })
  cookie = login.headers.get('set-cookie').split(';')[0]
  const deck = await (await authed('/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
  deckId = deck.id
})

function authed(path, init = {}) {
  return app.request(path, { ...init, headers: { ...init.headers, Cookie: cookie } })
}

describe('export', () => {
  it('returns 401 without a session', async () => {
    const res = await app.request(`/api/decks/${deckId}/export`)
    expect(res.status).toBe(401)
  })

  it('returns 404 for an unknown deck', async () => {
    const res = await authed('/api/decks/does-not-exist/export')
    expect(res.status).toBe(404)
  })

  it('returns 503 when no player template was configured', async () => {
    const bareApp = createApp({ db: createDb(':memory:'), password: 'secret' })
    const login = await bareApp.request('/api/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret' }),
    })
    const c = login.headers.get('set-cookie').split(';')[0]
    const deck = await (await bareApp.request('/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: c }, body: '{}' })).json()
    const res = await bareApp.request(`/api/decks/${deck.id}/export`, { headers: { Cookie: c } })
    expect(res.status).toBe(503)
  })

  it('inlines an uploaded image as a data: URI and injects deck data into the template', async () => {
    const slideId = (await (await authed(`/api/decks/${deckId}/slides`)).json())[0].id
    const upload = await authed('/api/blobs', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array([1, 2, 3]) })
    const { hash } = await upload.json()
    await authed(`/api/slides/${slideId}/elements`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ id: 'e1', type: 'image', x: 0, y: 0, w: 10, h: 10, z_index: 0, content: {}, blob_hash: hash }]),
    })

    const res = await authed(`/api/decks/${deckId}/export`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('attachment')
    const html = await res.text()
    expect(html).not.toContain('__VISCIO_EXPORT_DATA__') // placeholder got replaced
    const match = html.match(/window\.__VISCIO_EXPORT_DATA__ = (\{.*\})<\/script>/)
    expect(match).toBeTruthy()
    const payload = JSON.parse(match[1])
    expect(payload.deck.id).toBe(deckId)
    expect(payload.slides[0].elements[0].blob_hash).toBe(hash)
    expect(payload.dataUris[hash]).toMatch(/^data:image\/png;base64,/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- export.test.js`
Expected: FAIL — module not found / route doesn't exist

- [ ] **Step 3: Write the implementation**

```js
// server/src/snapshot.js
import { parseElement } from './serialize.js'

// slides + 按 slide 分组的 elements——revisions.js（存快照）和 export.js（拼离线导出）
// 都需要同一份"这个 deck 现在长什么样"的数据，抽出来避免两处重复写同一段查询。
export function fetchDeckSnapshot(db, deckId) {
  const slides = db.prepare('SELECT * FROM slides WHERE deck_id = ? ORDER BY position').all(deckId)
  const elementsBySlide = {}
  for (const s of slides) {
    elementsBySlide[s.id] = db.prepare('SELECT * FROM elements WHERE slide_id = ? ORDER BY z_index, rowid').all(s.id).map(parseElement)
  }
  return { slides, elementsBySlide }
}
```

Modify `server/src/revisions.js`: replace its inline slides/elementsBySlide-gathering block with the extracted helper. Read the current file first (Plan 1), then change:

```js
import crypto from 'node:crypto'
import { parseElement, elementInsertParams, INSERT_ELEMENT_SQL } from './serialize.js'
import { fetchDeckSnapshot } from './snapshot.js'

const MAX_REVISIONS = 10

export function registerRevisionRoutes(app, { db }) {
  app.post('/api/decks/:id/revisions', async (c) => {
    const deckId = c.req.param('id')
    if (!db.prepare('SELECT id FROM decks WHERE id = ?').get(deckId)) return c.json({ error: 'not found' }, 404)

    const body = await c.req.json().catch(() => ({}))
    const trigger = body.trigger === 'manual' ? 'manual' : 'auto'

    const { slides, elementsBySlide } = fetchDeckSnapshot(db, deckId)

    const id = crypto.randomUUID()
    const createdAt = Date.now()
    db.prepare('INSERT INTO revisions (id, deck_id, created_at, trigger, snapshot) VALUES (?, ?, ?, ?, ?)')
      .run(id, deckId, createdAt, trigger, JSON.stringify({ slides, elementsBySlide }))

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
    const insertEl = db.prepare(INSERT_ELEMENT_SQL)
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM slides WHERE deck_id = ?').run(rev.deck_id)
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

```js
// server/src/export.js
import { fetchDeckSnapshot } from './snapshot.js'

function inlineBlobs(db, elementsBySlide) {
  const hashes = new Set()
  for (const els of Object.values(elementsBySlide)) {
    for (const el of els) if (el.blob_hash) hashes.add(el.blob_hash)
  }
  const dataUris = {}
  const stmt = db.prepare('SELECT type, data FROM blobs WHERE hash = ?')
  for (const hash of hashes) {
    const row = stmt.get(hash)
    if (row) dataUris[hash] = `data:${row.type};base64,${row.data.toString('base64')}`
  }
  return dataUris
}

// 往 <script> 标签里塞 JSON 前得挡住 "</script>" 子串——否则浏览器解析 HTML 时
// 会把它当成脚本结束标签，JSON 剩下的部分就变成裸文本渲染出来了。
function safeJsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

export function registerExportRoute(app, { db, playerTemplate }, requireAuth) {
  app.get('/api/decks/:id/export', requireAuth, (c) => {
    if (!playerTemplate) return c.json({ error: 'export not available' }, 503)
    const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(c.req.param('id'))
    if (!deck) return c.json({ error: 'not found' }, 404)

    const { slides, elementsBySlide } = fetchDeckSnapshot(db, deck.id)
    const dataUris = inlineBlobs(db, elementsBySlide)

    const payload = {
      deck: { id: deck.id, title: deck.title, canvas_width: deck.canvas_width, canvas_height: deck.canvas_height },
      slides: slides.map((s) => ({ id: s.id, position: s.position, elements: elementsBySlide[s.id] || [] })),
      dataUris,
    }

    const html = playerTemplate.replace('"__VISCIO_EXPORT_DATA__"', safeJsonForScript(payload))
    const filename = `${(deck.title || 'viscio-deck').replace(/[/\\?%*:|"<>]/g, '_')}.html`
    return c.body(html, 200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    })
  })
}
```

Modify `server/src/app.js` to wire it in (read the current file first — Plan 1/2 left it as shown in this plan's research above):

```js
import { registerExportRoute } from './export.js'
// ...
export function createApp({ db, password, cookiePath = '/viscio', webDist, playerTemplate } = {}) {
  const app = new Hono()
  const { login, requireAuth } = createAuth({ db, password, cookiePath })

  app.get('/api/health', (c) => c.json({ ok: true }))
  app.post('/api/auth', login)
  registerBlobPublicRoutes(app, { db })
  registerPlayRoutes(app, { db })

  app.use('/api/decks', requireAuth)
  app.use('/api/decks/*', requireAuth)
  app.use('/api/slides/*', requireAuth)
  app.use('/api/revisions/*', requireAuth)
  registerDeckRoutes(app, { db })
  registerSlideRoutes(app, { db })
  registerElementRoutes(app, { db })
  registerBlobUploadRoute(app, { db }, requireAuth)
  registerRevisionRoutes(app, { db })
  registerExportRoute(app, { db, playerTemplate }, requireAuth)

  if (webDist) {
    app.use('/*', serveStatic({ root: webDist }))
    app.get('*', serveStatic({ path: `${webDist}/index.html` }))
  }

  return app
}
```

Note: `/api/decks/:id/export` already falls under the `app.use('/api/decks/*', requireAuth)` wildcard registered above it, so passing `requireAuth` again into `registerExportRoute` as route-level middleware is redundant but harmless (matches the existing double-guard already present for `registerBlobUploadRoute`, which takes `requireAuth` explicitly because blobs' own prefix isn't under the `/api/decks/*`/`/api/slides/*` wildcards) — keep it for the export test's `401`-without-session assertion to hold even if someone later reorganizes the wildcard registrations.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix server test -- export.test.js`, then `npm --prefix server test` (full suite — confirms the `revisions.js` refactor didn't change behavior, its existing tests should still pass unchanged).

- [ ] **Step 5: Commit**

```bash
git add server/src/snapshot.js server/src/revisions.js server/src/export.js server/src/app.js server/test/export.test.js
git commit -m "feat: 离线导出接口——blob 转 base64 内联拼进预构建播放器模板"
```

---

### Task 8: Offline player build (vite-plugin-singlefile) + wire template into the server entrypoint

**Files:**
- Modify: `web/package.json` (new devDependency + npm scripts)
- Create: `web/vite.player.config.ts`
- Create: `web/player.html`
- Create: `web/src/player-main.tsx`
- Modify: `server/src/index.js`
- Test: manual (build output is generated HTML, not something to unit-test — verified in Task 12's end-to-end pass)

- [ ] **Step 1: Add the dependency**

```bash
npm --prefix web install -D vite-plugin-singlefile@^2.0.3
```

- [ ] **Step 2: Create the player build entry**

```html
<!-- web/player.html -->
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Viscio</title>
</head>
<body style="margin:0">
  <div id="player-root"></div>
  <script>window.__VISCIO_EXPORT_DATA__ = "__VISCIO_EXPORT_DATA__"</script>
  <script type="module" src="/src/player-main.tsx"></script>
</body>
</html>
```

```tsx
// web/src/player-main.tsx
import { createRoot } from 'react-dom/client'
import { Player, type PlayDeck, type PlaySlide } from './player/Player'
import { BlobUrlContext } from './lib/BlobUrlContext'
import './styles.css'

declare global {
  interface Window {
    __VISCIO_EXPORT_DATA__?: { deck: PlayDeck; slides: PlaySlide[]; dataUris: Record<string, string> }
  }
}

const data = window.__VISCIO_EXPORT_DATA__

const root = createRoot(document.getElementById('player-root')!)
if (!data || !data.deck) {
  root.render(<p style={{ color: '#fff', fontFamily: 'sans-serif', padding: 20 }}>导出数据缺失，这个文件可能损坏。</p>)
} else {
  root.render(
    <BlobUrlContext.Provider value={(hash) => data.dataUris[hash] ?? ''}>
      <Player deck={data.deck} slides={data.slides} />
    </BlobUrlContext.Provider>,
  )
}
```

```ts
// web/vite.player.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// 离线播放器单独一个 build——跟主 web app 用同一份源码（Player/CanvasElement/
// 各种 shape 渲染组件全部复用），只是换一个入口 + 用 vite-plugin-singlefile
// 把所有 JS/CSS 都内联进这一个 html，零外部 <script src>，file:// 协议下也能打开。
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist-player',
    rollupOptions: { input: 'player.html' },
  },
})
```

Modify `web/package.json` scripts (read the current file first — Plan 1/2 established it):

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build && npm run build:player",
    "build:player": "vite build --config vite.player.config.ts",
    "test": "vitest run"
  }
}
```

- [ ] **Step 3: Wire the built template into the server**

Modify `server/src/index.js` (read the current file first — shown in this plan's research above):

```js
// server/src/index.js
import fs from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createDb } from './db.js'
import { createApp } from './app.js'

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const PASSWORD = process.env.VISCIO_ACCESS_PASSWORD || process.env.ACCESS_PASSWORD || 'dev'
const PORT = Number(process.env.PORT) || 8788

const db = createDb(path.join(DATA_DIR, 'viscio.db'))

const playerTemplatePath = path.resolve(process.cwd(), '../web/dist-player/player.html')
const playerTemplate = fs.existsSync(playerTemplatePath) ? fs.readFileSync(playerTemplatePath, 'utf-8') : null
if (!playerTemplate) {
  console.warn(`viscio: 没找到离线播放器模板（${playerTemplatePath}），/api/decks/:id/export 会返回 503。跑一次 "npm --prefix ../web run build:player" 生成它。`)
}

const app = createApp({
  db,
  password: PASSWORD,
  webDist: path.resolve(process.cwd(), '../web/dist'),
  playerTemplate,
})

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`viscio server listening on :${info.port}`)
})
```

- [ ] **Step 4: Verify the build produces a working single file**

```bash
npm --prefix web run build
ls web/dist-player/player.html   # should exist
grep -c "__VISCIO_EXPORT_DATA__" web/dist-player/player.html  # should be >= 1 (the placeholder is still there pre-export)
grep -c '<script src=' web/dist-player/player.html  # should be 0 — everything inlined, no external script refs
```

Run `npm --prefix server test` (the export test from Task 7 doesn't depend on this real build — it passes a `FAKE_TEMPLATE` string directly — but confirm nothing broke).

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/vite.player.config.ts web/player.html web/src/player-main.tsx server/src/index.js
git commit -m "feat: 离线播放器单文件构建 + 接入服务端导出接口"
```

---

### Task 9: Export button in the editor

**Files:**
- Modify: `web/src/routes/Editor.tsx`
- Test: `web/test/Editor.test.tsx` (extend the existing suite from Plan 2)

- [ ] **Step 1: Write the failing test**

Append to `web/test/Editor.test.tsx` (read the current file first — Plan 2 already has a `describe('Editor', ...)` block with a `beforeEach` mocking `apiJson`; add these `it`s inside that same block, and extend the `beforeEach`'s `apiJson` mock or add a separate `api` mock as needed):

```tsx
import { api } from '../src/api'
// ...inside the existing describe('Editor', ...) block:

it('clicking 导出离线 HTML while nothing is saving downloads a file', async () => {
  const fakeBlob = new Blob(['<html></html>'], { type: 'text/html' })
  vi.spyOn(apiModule, 'api').mockResolvedValue({ ok: true, blob: async () => fakeBlob } as unknown as Response)
  const clickSpy = vi.fn()
  const originalCreateElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = originalCreateElement(tag)
    if (tag === 'a') el.click = clickSpy
    return el
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

  renderEditor()
  await waitFor(() => screen.getByRole('button', { name: '导出离线 HTML' }))
  fireEvent.click(screen.getByRole('button', { name: '导出离线 HTML' }))
  await waitFor(() => expect(clickSpy).toHaveBeenCalled())
  expect(apiModule.api).toHaveBeenCalledWith('/decks/d1/export')
})

it('blocks export with an alert while a save is in flight', async () => {
  let resolveSave: () => void = () => {}
  vi.spyOn(apiModule, 'apiJson').mockImplementation(async (path: string, init?: any) => {
    if (path === '/decks/d1') return deck
    if (path === '/decks/d1/slides') return [slide1]
    if (path === '/slides/s1/elements' && init?.method === 'PUT') return new Promise((resolve) => { resolveSave = () => resolve({ ok: true }) })
    if (path === '/slides/s1/elements') return []
    return {}
  })
  const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
  renderEditor()
  await waitFor(() => screen.getByRole('button', { name: '矩形' }))
  fireEvent.click(screen.getByRole('button', { name: '矩形' }))
  fireEvent.pointerDown(screen.getByTestId('selection-layer'), { clientX: 50, clientY: 50, button: 0 })
  fireEvent.pointerUp(screen.getByTestId('selection-layer'))
  await waitFor(() => screen.getByText('保存中…'))
  fireEvent.click(screen.getByRole('button', { name: '导出离线 HTML' }))
  expect(alertSpy).toHaveBeenCalledWith('还有改动正在保存，请稍等几秒再导出。')
  resolveSave()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- Editor.test.tsx`
Expected: FAIL — no "导出离线 HTML" button exists yet

- [ ] **Step 3: Write the implementation**

Modify `web/src/routes/Editor.tsx`: import `api` alongside the existing `apiJson` import, and add the export handler + button next to the "版本历史"/`ShareControl` row added in Tasks 5–6:

```tsx
import { api, apiJson } from '../api'
// ...
async function exportOffline() {
  if (saveStatus === 'saving') {
    alert('还有改动正在保存，请稍等几秒再导出。')
    return
  }
  const res = await api(`/decks/${deckId}/export`)
  if (!res.ok) {
    alert('导出失败，请重试。')
    return
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${deck.title || 'viscio-deck'}.html`
  a.click()
  URL.revokeObjectURL(url)
}
```

```tsx
<button className="toolbar-btn" onClick={exportOffline}>导出离线 HTML</button>
```

placed in the same header row as the Task 5/6 additions.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- Editor.test.tsx`, then the full suite.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/Editor.tsx web/test/Editor.test.tsx
git commit -m "feat: 编辑页导出离线 HTML 按钮，保存中先拦一下"
```

---

### Task 10: Homepage Dockerfile — build and ship the player bundle

**Files:**
- Modify: `homepage/Dockerfile`

This is the same kind of change as Plan 1's Task 17 (which first wired `/viscio` into `homepage`) — a small, mechanical addition to an existing multi-stage Dockerfile in the sibling `homepage` repo, not the `viscio` repo. `homepage`'s own git state (branch, ahead-of-origin commits) is unrelated to Viscio's work; follow the same care Plan 1's Task 17 used (small diff, own commit, don't touch unrelated Dockerfile stages).

- [ ] **Step 1: Modify the Dockerfile**

Read `homepage/Dockerfile` first (shown in this plan's research above — the `viscioweb` stage at lines 8–13 runs `npm run build`, and the final stage's line 50 copies `viscio-src/web/dist`). Change the `viscioweb` stage to also build the player bundle, and add a copy line for it:

```dockerfile
FROM node:22-bookworm-slim AS viscioweb
WORKDIR /app/viscio-src/web
COPY viscio-src/web/package*.json ./
RUN npm ci
COPY viscio-src/web .
RUN npm run build
RUN npm run build:player
```

(`npm run build` already runs `build:player` as its last step per Task 8's `package.json` change — the explicit `RUN npm run build:player` line above is redundant given that and should be REMOVED; just keep `RUN npm run build` alone, since `build:player` is now part of it. Do not add a second explicit line — the implementer should double check `web/package.json`'s `build` script from Task 8 already chains `build:player` and leave the Dockerfile's `viscioweb` stage exactly as it was, since no change is needed there at all.)

Add one line to the final stage, right after the existing `viscio-src/web/dist` copy (around line 50):

```dockerfile
COPY --from=viscioweb /app/viscio-src/web/dist viscio-src/web/dist
COPY --from=viscioweb /app/viscio-src/web/dist-player viscio-src/web/dist-player
```

- [ ] **Step 2: Manual verification**

This can't be meaningfully unit-tested (it's a Dockerfile) — the implementer should at minimum sanity-check the diff is exactly these lines (no accidental changes to the `mnemosweb`/`serverdeps`/`clientbuild` stages) and note in their summary that a real `docker build`/`flyctl deploy` verification is a human step, same as Plan 1's Task 18 — do not attempt to run `docker build` or any `flyctl` command; those touch the shared production app and need the repo owner's own hands, per this project's established convention from Plan 1.

- [ ] **Step 3: Commit**

In the `homepage` repo (not `viscio`):

```bash
cd /Users/carolinge/Desktop/parchment/homepage
git add Dockerfile
git commit -m "feat: 打包并携带 Viscio 离线播放器单文件产物"
```

---

### Task 11: Upload failure handling

**Files:**
- Modify: `web/src/routes/Editor.tsx`
- Test: `web/test/Editor.test.tsx` (extend)

Per design spec section 7: "图片/embed 上传失败：保留本地预览，允许重试，不阻塞其他编辑操作." Task 13 of Plan 2 built the upload flow (`handleFileChosen` in `Editor.tsx`, calling `uploadBlob`) without failure handling — a rejected `uploadBlob` call currently throws unhandled. Add a try/catch that surfaces the failure without blocking anything else in the editor (no element gets inserted on failure, since without a `blob_hash` there'd be nothing to render — "local preview" here means the user's file selection isn't silently lost, they just get told to retry the same upload button, which still has their file dialog available immediately).

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('Editor', ...)` block in `web/test/Editor.test.tsx`:

```tsx
it('a failed image upload alerts and does not insert an element', async () => {
  vi.spyOn(apiModule, 'apiJson').mockImplementation(async (path: string) => {
    if (path === '/decks/d1') return deck
    if (path === '/decks/d1/slides') return [slide1]
    if (path === '/slides/s1/elements') return []
    if (path === '/blobs') throw new Error('network')
    return {}
  })
  const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
  renderEditor()
  await waitFor(() => screen.getByRole('button', { name: '图片' }))
  fireEvent.click(screen.getByRole('button', { name: '图片' }))
  const file = new File(['x'], 'a.png', { type: 'image/png' })
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
  await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('图片上传失败，请重试。'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- Editor.test.tsx`
Expected: FAIL — unhandled rejection instead of the expected alert

- [ ] **Step 3: Write the implementation**

Modify `handleFileChosen` in `web/src/routes/Editor.tsx` (from Plan 2's Task 13) to wrap the upload in try/catch:

```tsx
async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file || !activeSlideId) return

  let hash: string
  try {
    ;({ hash } = await uploadBlob(file))
  } catch {
    alert(`${pendingUploadKind.current === 'image' ? '图片' : '嵌入内容'}上传失败，请重试。`)
    return
  }

  let w = 300
  let h = 200
  if (pendingUploadKind.current === 'image') {
    try {
      const natural = await readImageNaturalSize(file)
      const maxW = 400
      w = Math.min(natural.width, maxW)
      h = (natural.height / natural.width) * w
    } catch {
      // 读不出原图尺寸就退回默认框，不阻塞插入
    }
  }
  const rect = getContainerRect()
  const center = { x: (rect.left + rect.width / 2 - rect.left) / scale + 150, y: 150 }
  const el = createDefaultElement(pendingUploadKind.current === 'image' ? 'image' : 'embed', center, activeSlideId, {
    blob_hash: hash,
    w,
    h,
  })
  history.commitImmediate(reassignZIndex([...elements, el]))
  setSelectedIds([el.id])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- Editor.test.tsx`, then the full suite.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/Editor.tsx web/test/Editor.test.tsx
git commit -m "fix: 图片/embed 上传失败给出明确提示，不静默丢失"
```

---

### Task 12: Final review pass + end-to-end smoke test (including real offline `file://` verification)

**Files:** none new — verification-only task.

- [ ] **Step 1:** Run the complete test suite from the repo root: `npm --prefix web test && npm --prefix server test`. All green.

- [ ] **Step 2:** Run `npm --prefix web run build` (now also produces `web/dist-player/player.html` per Task 8). Confirm zero type errors and that `dist-player/player.html` exists.

- [ ] **Step 3:** Manual/Playwright end-to-end pass driving the real dev servers (adapt the approach from Plan 1/2's own Task 18/17 smoke tests): log in, create a deck with a couple of shapes/text/one image, get its share slug, open `/viscio/play/:slug` in a fresh (unauthenticated) browser context and confirm it renders and arrow-key/space/PageUp/PageDown navigation works with no login prompt. Open the version-history panel, confirm the manual snapshot from Ctrl+S appears; restore it and confirm the canvas reflects the restored content. Regenerate the share slug and confirm the OLD slug's `/play/` URL now 404s and the new one works.

- [ ] **Step 4: The critical offline check (design spec section 8 explicitly calls this out as needing a real, runnable verification, not a visual spot-check).** With both dev servers still running, click "导出离线 HTML" in the editor and save the downloaded file to a local path (e.g. via the Playwright download API, or manually). Then:
   - Stop both dev servers (or at minimum disconnect network / use browser devtools' offline mode) to prove there's no live dependency.
   - Open the downloaded HTML file directly via a `file://` URL in a real browser (Playwright's `page.goto('file:///path/to/file.html')` works for this).
   - Confirm the deck renders, page-indicator shows, and arrow-key navigation moves between slides.
   - If the deck included an embed (a small self-contained interactive HTML/Plotly-style iframe fixture is fine for this test — doesn't need to be a real Plotly export), confirm it still renders inside its iframe under `file://` (sandboxed iframes with `srcdoc`/`data:` sources work under `file://`; if the embed element's `content.src` was itself a live URL rather than an uploaded blob, note that as an inherent limitation — only blob-uploaded embeds get inlined by this plan's export, which matches the spec's design).
   - Check the browser console for errors during this offline load specifically — a script trying to hit a relative `/api/...` URL under `file://` would be a real regression (there shouldn't be any such calls left in the player bundle — `Player`/`CanvasElement` don't fetch anything themselves, they only read the embedded `window.__VISCIO_EXPORT_DATA__`).

- [ ] **Step 5:** Report results — test counts, build status, the offline-check outcome specifically, any console errors — before this plan (and the full 3-plan Viscio v1 scope) is considered done. Do not report the overall project complete if the offline export doesn't actually open under `file://` — that was the single riskiest item called out in the original design review.

---

## Plan self-review notes

- **Spec coverage:** Play mode (3.4) — Tasks 2, 3. Version history browsing/restore (3.3; the *trigger* logic for manual/auto snapshots was Plan 2's job, this plan is the browsing/restore UI plus the actual 10-minute timer) — Tasks 4, 5. Share/slug regeneration (3.5) — Task 6. Offline export (3.6) — Tasks 7, 8, 9, 10, and the critical verification in Task 12. Error handling (section 7: autosave/manual-save/upload failure UX, export pre-check) — Tasks 5, 9, 11. Testing strategy's explicit callout for offline export needing a real runnable check (section 8) — Task 12 Step 4.
- **Placeholder scan:** none left.
- **Type consistency:** `PlayDeck`/`PlaySlide` defined once in `player/Player.tsx`, reused by `Play.tsx` and `player-main.tsx`. `BlobUrlContext` defined once, consumed by `ImageElement`/`EmbedElement` (Task 1) and provided by both `Play`-mode's default (implicit, no provider = live API) and `player-main.tsx`'s explicit data-URI provider (Task 8). `fetchDeckSnapshot` defined once in `server/src/snapshot.js`, used by both `revisions.js` and `export.js` (Task 7) — no duplicated query logic.
- **Out of scope (per the design spec's explicit "明确不做" section, unchanged from the original 3-plan split):** rotation, dual-screen presenter view, multi-user collab, Quarto CLI/Pyodide, laser pointer, cross-embed plotly.js dedup in exported files.
- **This completes Viscio v1** (Plans 1–3) against the design spec's section 10 acceptance criteria — Task 12 is the final gate for all three plans, not just this one.
