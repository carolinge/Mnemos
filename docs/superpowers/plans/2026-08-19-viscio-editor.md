# Viscio Editor Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Viscio's read-only rendering foundation (Plan 1) into a real PPT-like editor: shape toolbar, drag/resize/snap-align, Tiptap text editing, image/embed/latex/code insertion, grouping, layer order, undo/redo, debounced autosave, and slide management (add/delete/reorder). This replaces the temporary "add test rectangle" button entirely.

**Architecture:** Pure frontend work — Plan 1 already built every backend route this plan needs (`PUT /api/slides/:id/elements` full-replace, `PATCH /api/slides/:id` for notes/position, `POST /api/blobs` content-addressed upload, revisions). No server-side changes in this plan. All new code lives under `viscio/web/src/`: a handful of small pure-function libs (`lib/`) that are unit tested directly, and a set of canvas UI components that consume them. State lives in `Editor.tsx` as plain `useState`/a small custom history hook — no state management library.

**Tech Stack:** Same as Plan 1 (Vite + React + TS, Vitest + Testing Library). Adds one new dependency: `@tiptap/react` (official React binding for the Tiptap core already in use — `useEditor`/`EditorContent`/`BubbleMenu`).

**Repo:** `/Users/carolinge/Desktop/parchment/viscio`, continue directly on branch `build/foundation` (this repo has no `main`/`master` — `build/foundation` was created by `git init` in Plan 1 and is the only branch; no worktree needed, same as how Plan 1 worked directly on it).

**Commit convention:** Plain `git commit -m "..."`, no `Co-Authored-By` or AI-attribution trailers — this is the user's own repo.

---

## Global notes for every task

- Run `npm test` inside `viscio/web` after every step that touches `web/`. Tests: `npm --prefix web test`.
- Manual verification (two terminals, from repo root `/Users/carolinge/Desktop/parchment/viscio`):
  - Terminal A: `DATA_DIR=/tmp/viscio-dev-data VISCIO_ACCESS_PASSWORD=dev npm --prefix server run dev` (serves on :8788)
  - Terminal B: `npm --prefix web run dev` (serves on :5173, proxies `/viscio/api` and `/viscio/play` to :8788 — see `web/vite.config.ts`)
  - Browser: `http://localhost:5173/viscio/`, password `dev`.
- All new `.tsx`/`.ts` files go under `web/src/lib/` (pure logic, framework-free) or `web/src/canvas/` (components). Existing files listed under "Modify" already exist from Plan 1 — read them before editing, don't guess their current contents.
- `ElementRow`, `Deck`, `Slide` types are defined in `web/src/types.ts` (Plan 1) — reuse them, don't redefine.

---

### Task 1: Snap-align pure function

**Files:**
- Create: `web/src/lib/snap.ts`
- Test: `web/test/snap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/test/snap.test.ts
import { describe, it, expect } from 'vitest'
import { computeSnap } from '../src/lib/snap'

describe('computeSnap', () => {
  it('snaps left edges within threshold and reports a vertical guide', () => {
    const moving = { x: 103, y: 200, w: 50, h: 50 }
    const others = [{ x: 100, y: 0, w: 50, h: 50 }]
    const result = computeSnap(moving, others, 6)
    expect(result.dx).toBe(-3)
    expect(result.dy).toBe(0)
    expect(result.guides).toContainEqual({ axis: 'x', pos: 100 })
  })

  it('snaps centers on both axes simultaneously', () => {
    const moving = { x: 98, y: 148, w: 100, h: 100 }
    const others = [{ x: 100, y: 150, w: 100, h: 100 }]
    const result = computeSnap(moving, others, 6)
    // moving center = (148, 198), other center = (150, 200) -> dx=2, dy=2
    expect(result.dx).toBe(2)
    expect(result.dy).toBe(2)
    expect(result.guides.length).toBe(2)
  })

  it('returns zero dx/dy and no guides when nothing is within threshold', () => {
    const moving = { x: 0, y: 0, w: 10, h: 10 }
    const others = [{ x: 500, y: 500, w: 10, h: 10 }]
    const result = computeSnap(moving, others, 6)
    expect(result).toEqual({ dx: 0, dy: 0, guides: [] })
  })

  it('ignores an empty others list', () => {
    expect(computeSnap({ x: 1, y: 1, w: 1, h: 1 }, [], 6)).toEqual({ dx: 0, dy: 0, guides: [] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- snap.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/snap'`

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/snap.ts
export type Bounds = { x: number; y: number; w: number; h: number }
export type Guide = { axis: 'x' | 'y'; pos: number }
export type SnapResult = { dx: number; dy: number; guides: Guide[] }

const xLines = (b: Bounds) => [b.x, b.x + b.w / 2, b.x + b.w]
const yLines = (b: Bounds) => [b.y, b.y + b.h / 2, b.y + b.h]

// 拖拽中的元素（moving）逐边/逐中线跟其它元素（others）的同名线比较，
// 阈值内取最近的一条，返回需要叠加的位移和用来画引导线的位置。
// 纯几何函数，不知道分组/选中这些概念——调用方负责传入"正确的 others 列表"
// （比如把同组元素合并成一个 bbox、排除自身分组）。
export function computeSnap(moving: Bounds, others: Bounds[], threshold = 6): SnapResult {
  let bestDx = 0
  let bestDxAbs = Infinity
  let bestXGuide: number | null = null
  let bestDy = 0
  let bestDyAbs = Infinity
  let bestYGuide: number | null = null

  for (const other of others) {
    for (const ml of xLines(moving)) {
      for (const ol of xLines(other)) {
        const d = ol - ml
        if (Math.abs(d) <= threshold && Math.abs(d) < bestDxAbs) {
          bestDxAbs = Math.abs(d)
          bestDx = d
          bestXGuide = ol
        }
      }
    }
    for (const ml of yLines(moving)) {
      for (const ol of yLines(other)) {
        const d = ol - ml
        if (Math.abs(d) <= threshold && Math.abs(d) < bestDyAbs) {
          bestDyAbs = Math.abs(d)
          bestDy = d
          bestYGuide = ol
        }
      }
    }
  }

  const guides: Guide[] = []
  if (bestXGuide !== null) guides.push({ axis: 'x', pos: bestXGuide })
  if (bestYGuide !== null) guides.push({ axis: 'y', pos: bestYGuide })
  return { dx: bestDx, dy: bestDy, guides }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- snap.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/snap.ts web/test/snap.test.ts
git commit -m "feat: 拖拽智能对齐吸附的纯函数实现"
```

---

### Task 2: Undo/redo history hook

**Files:**
- Create: `web/src/lib/useHistory.ts`
- Test: `web/test/useHistory.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/test/useHistory.test.ts
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useHistory } from '../src/lib/useHistory'

describe('useHistory', () => {
  it('liveUpdate does not create an undo step; commitChange creates exactly one', () => {
    const { result } = renderHook(() => useHistory(0))
    act(() => result.current.beginChange())
    act(() => result.current.liveUpdate(1))
    act(() => result.current.liveUpdate(2))
    act(() => result.current.liveUpdate(3))
    expect(result.current.present).toBe(3)
    act(() => result.current.commitChange())
    expect(result.current.present).toBe(3)
    act(() => result.current.undo())
    expect(result.current.present).toBe(0) // 拖拽中间帧都不算历史步，undo 一次直接回到手势开始前
  })

  it('commitImmediate records one step for instant actions', () => {
    const { result } = renderHook(() => useHistory('a'))
    act(() => result.current.commitImmediate('b'))
    act(() => result.current.commitImmediate('c'))
    expect(result.current.present).toBe('c')
    act(() => result.current.undo())
    expect(result.current.present).toBe('b')
    act(() => result.current.undo())
    expect(result.current.present).toBe('a')
    act(() => result.current.undo()) // 栈空，no-op
    expect(result.current.present).toBe('a')
  })

  it('redo replays an undone step; a new change clears the redo stack', () => {
    const { result } = renderHook(() => useHistory(0))
    act(() => result.current.commitImmediate(1))
    act(() => result.current.undo())
    expect(result.current.present).toBe(0)
    act(() => result.current.redo())
    expect(result.current.present).toBe(1)
    act(() => result.current.undo())
    act(() => result.current.commitImmediate(99))
    act(() => result.current.redo()) // 被新操作清空的 redo 栈，no-op
    expect(result.current.present).toBe(99)
  })

  it('canUndo/canRedo reflect stack state', () => {
    const { result } = renderHook(() => useHistory(0))
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
    act(() => result.current.commitImmediate(1))
    expect(result.current.canUndo).toBe(true)
    act(() => result.current.undo())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- useHistory.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/useHistory.ts
import { useCallback, useReducer, useRef, useState } from 'react'

// 拖拽/resize 这类连续手势：手势开始 beginChange() 记一个"手势前"快照，
// 手势中每一帧调 liveUpdate()（不进历史栈，否则撤销要按几十次），
// 手势结束 commitChange() 才把"手势前"快照压栈。
// 插入/删除/属性面板编辑这类瞬时操作直接 commitImmediate()。
export function useHistory<T>(initial: T) {
  const [present, setPresent] = useState(initial)
  const past = useRef<T[]>([])
  const future = useRef<T[]>([])
  const gestureStart = useRef<T | null>(null)
  const [, forceRender] = useReducer((c) => c + 1, 0)

  const beginChange = useCallback(() => {
    gestureStart.current = present
  }, [present])

  const liveUpdate = useCallback((next: T) => {
    setPresent(next)
  }, [])

  const commitChange = useCallback(() => {
    if (gestureStart.current !== null) {
      past.current.push(gestureStart.current)
      future.current = []
      gestureStart.current = null
      forceRender()
    }
  }, [])

  const commitImmediate = useCallback(
    (next: T) => {
      past.current.push(present)
      future.current = []
      setPresent(next)
      forceRender()
    },
    [present],
  )

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (prev === undefined) return
    future.current.push(present)
    setPresent(prev)
    forceRender()
  }, [present])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (next === undefined) return
    past.current.push(present)
    setPresent(next)
    forceRender()
  }, [present])

  return {
    present,
    beginChange,
    liveUpdate,
    commitChange,
    commitImmediate,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- useHistory.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/useHistory.ts web/test/useHistory.test.ts
git commit -m "feat: 编辑会话内存态撤销/重做 hook"
```

---

### Task 3: Debounced autosave hook

**Files:**
- Create: `web/src/lib/useAutosave.ts`
- Test: `web/test/useAutosave.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/test/useAutosave.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAutosave } from '../src/lib/useAutosave'

describe('useAutosave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('debounces: rapid value changes only trigger one save after the delay', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { rerender } = renderHook(({ value }) => useAutosave(value, save, 500), {
      initialProps: { value: 1 },
    })
    rerender({ value: 2 })
    rerender({ value: 3 })
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(3)
  })

  it('does not save on initial mount', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useAutosave('initial', save, 500))
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()
  })

  it('exposes status: saving while in flight, saved after success, error after failure', async () => {
    let resolveSave: () => void = () => {}
    const save = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve }))
    const { result, rerender } = renderHook(({ value }) => useAutosave(value, save, 100), {
      initialProps: { value: 'a' },
    })
    rerender({ value: 'b' })
    await vi.advanceTimersByTimeAsync(100)
    expect(result.current.status).toBe('saving')
    resolveSave()
    await vi.advanceTimersByTimeAsync(0)
    expect(result.current.status).toBe('saved')
  })

  it('sets status to error when save rejects', async () => {
    const save = vi.fn().mockRejectedValue(new Error('network'))
    const { result, rerender } = renderHook(({ value }) => useAutosave(value, save, 100), {
      initialProps: { value: 'a' },
    })
    rerender({ value: 'b' })
    await vi.advanceTimersByTimeAsync(100)
    expect(result.current.status).toBe('error')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- useAutosave.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/useAutosave.ts
import { useEffect, useRef, useState } from 'react'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

// 值变化后防抖 delayMs 才真正保存；拖拽/打字过程中值会连续变化，
// 但只有停下来之后才发请求——避免 better-sqlite3 同步写跟主进程里
// Mnemos/homepage 抢事件循环。首次挂载不触发保存（用户还没做任何改动）。
export function useAutosave<T>(value: T, save: (value: T) => Promise<void>, delayMs = 600) {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const isFirstRender = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setStatus('saving')
      save(value)
        .then(() => setStatus('saved'))
        .catch(() => setStatus('error'))
    }, delayMs)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, delayMs])

  return { status }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- useAutosave.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/useAutosave.ts web/test/useAutosave.test.ts
git commit -m "feat: 防抖自动保存 hook，暴露保存状态"
```

---

### Task 4: Canvas-space coordinate helper + Canvas exposes live scale

**Files:**
- Modify: `web/src/lib/geometry.ts`
- Modify: `web/src/canvas/Canvas.tsx`
- Test: `web/test/geometry.test.ts` (already exists from Plan 1 — add to it, don't replace `fitScale`'s existing tests)

- [ ] **Step 1: Write the failing test**

Read the existing `web/test/geometry.test.ts` first (it already tests `fitScale`), then append:

```ts
// append to web/test/geometry.test.ts
import { toCanvasPoint } from '../src/lib/geometry'

describe('toCanvasPoint', () => {
  it('converts a client point to canvas-space using the container origin and scale', () => {
    const containerRect = { left: 50, top: 20 } as DOMRect
    expect(toCanvasPoint(150, 120, containerRect, 0.5)).toEqual({ x: 200, y: 200 })
  })

  it('handles scale 1 (no zoom)', () => {
    const containerRect = { left: 0, top: 0 } as DOMRect
    expect(toCanvasPoint(42, 10, containerRect, 1)).toEqual({ x: 42, y: 10 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- geometry.test.ts`
Expected: FAIL — `toCanvasPoint` not exported

- [ ] **Step 3: Write the implementation**

Append to `web/src/lib/geometry.ts`:

```ts
// 把一次鼠标/指针事件的浏览器坐标（clientX/clientY）换算成画布固定设计分辨率下的坐标——
// 减去画布容器左上角的屏幕偏移，再除以当前缩放比例。
export function toCanvasPoint(
  clientX: number,
  clientY: number,
  containerRect: { left: number; top: number },
  scale: number,
): { x: number; y: number } {
  return {
    x: (clientX - containerRect.left) / scale,
    y: (clientY - containerRect.top) / scale,
  }
}
```

Modify `web/src/canvas/Canvas.tsx` to accept an `onScaleChange` callback and a ref-forwarding way for the parent to read the container element (needed by `SelectionLayer` in Task 7 to compute `getBoundingClientRect()` for `toCanvasPoint`). Replace the file with:

```tsx
// web/src/canvas/Canvas.tsx
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { fitScale } from '../lib/geometry'

export type CanvasHandle = { getContainerRect: () => DOMRect }

type Props = {
  width: number
  height: number
  children: ReactNode
  onScaleChange?: (scale: number) => void
}

export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas({ width, height, children, onScaleChange }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useImperativeHandle(ref, () => ({
    getContainerRect: () => containerRef.current!.getBoundingClientRect(),
  }))

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      const next = fitScale(width, height, rect.width, rect.height)
      setScale(next)
      onScaleChange?.(next)
    })
    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- geometry.test.ts`
Expected: PASS (all, including pre-existing `fitScale` tests)

Then run the full web suite to make sure `Canvas` still renders where used: `npm --prefix web test`. `CanvasElement.test.tsx` doesn't touch `Canvas` directly so it should be unaffected; if anything imports `Canvas` and passes no ref, confirm it still works (ref is optional).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/geometry.ts web/test/geometry.test.ts web/src/canvas/Canvas.tsx
git commit -m "feat: 画布容器暴露当前缩放与屏幕矩形，加坐标换算函数"
```

---

### Task 5: Z-order helper

**Files:**
- Create: `web/src/lib/zorder.ts`
- Test: `web/test/zorder.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/test/zorder.test.ts
import { describe, it, expect } from 'vitest'
import { reassignZIndex, bringToFront, sendToBack, bringForward, sendBackward } from '../src/lib/zorder'

type El = { id: string; z_index: number }
const els = (ids: string[]): El[] => ids.map((id, i) => ({ id, z_index: i }))

describe('zorder', () => {
  it('reassignZIndex sets z_index to array position', () => {
    const result = reassignZIndex([{ id: 'a', z_index: 9 }, { id: 'b', z_index: 1 }])
    expect(result.map((e) => e.z_index)).toEqual([0, 1])
  })

  it('bringToFront moves the element to the end (highest z)', () => {
    const result = bringToFront(els(['a', 'b', 'c']), 'a')
    expect(result.map((e) => e.id)).toEqual(['b', 'c', 'a'])
    expect(result.map((e) => e.z_index)).toEqual([0, 1, 2])
  })

  it('sendToBack moves the element to the start (lowest z)', () => {
    const result = sendToBack(els(['a', 'b', 'c']), 'c')
    expect(result.map((e) => e.id)).toEqual(['c', 'a', 'b'])
  })

  it('bringForward swaps with the next-higher neighbor', () => {
    const result = bringForward(els(['a', 'b', 'c']), 'a')
    expect(result.map((e) => e.id)).toEqual(['b', 'a', 'c'])
  })

  it('bringForward on the topmost element is a no-op', () => {
    const result = bringForward(els(['a', 'b', 'c']), 'c')
    expect(result.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('sendBackward swaps with the next-lower neighbor', () => {
    const result = sendBackward(els(['a', 'b', 'c']), 'c')
    expect(result.map((e) => e.id)).toEqual(['a', 'c', 'b'])
  })

  it('sendBackward on the bottommost element is a no-op', () => {
    const result = sendBackward(els(['a', 'b', 'c']), 'a')
    expect(result.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- zorder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/zorder.ts
// 图层顺序 = 数组顺序：数组下标就是新的 z_index。所有函数都不原地修改入参，
// 返回一个新数组（重新赋过 z_index），调用方直接拿它替换 state。
type ZEl = { id: string; z_index: number }

export function reassignZIndex<T extends ZEl>(elements: T[]): T[] {
  return elements.map((el, i) => ({ ...el, z_index: i }))
}

export function bringToFront<T extends ZEl>(elements: T[], id: string): T[] {
  const target = elements.find((e) => e.id === id)
  if (!target) return elements
  return reassignZIndex([...elements.filter((e) => e.id !== id), target])
}

export function sendToBack<T extends ZEl>(elements: T[], id: string): T[] {
  const target = elements.find((e) => e.id === id)
  if (!target) return elements
  return reassignZIndex([target, ...elements.filter((e) => e.id !== id)])
}

export function bringForward<T extends ZEl>(elements: T[], id: string): T[] {
  const i = elements.findIndex((e) => e.id === id)
  if (i === -1 || i === elements.length - 1) return elements
  const next = [...elements]
  ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
  return reassignZIndex(next)
}

export function sendBackward<T extends ZEl>(elements: T[], id: string): T[] {
  const i = elements.findIndex((e) => e.id === id)
  if (i <= 0) return elements
  const next = [...elements]
  ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
  return reassignZIndex(next)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- zorder.test.ts`
Expected: PASS (7/7)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/zorder.ts web/test/zorder.test.ts
git commit -m "feat: 图层顺序（上移/下移/置顶/置底）纯函数"
```

---

### Task 6: Freehand path smoothing

**Files:**
- Create: `web/src/lib/smoothPath.ts`
- Test: `web/test/smoothPath.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/test/smoothPath.test.ts
import { describe, it, expect } from 'vitest'
import { pointsToPath, boundsOfPoints } from '../src/lib/smoothPath'

describe('smoothPath', () => {
  it('pointsToPath returns empty string for fewer than 2 points', () => {
    expect(pointsToPath([])).toBe('')
    expect(pointsToPath([{ x: 1, y: 1 }])).toBe('')
  })

  it('pointsToPath starts with M at the first point', () => {
    const d = pointsToPath([{ x: 0, y: 0 }, { x: 10, y: 10 }])
    expect(d.startsWith('M0,0')).toBe(true)
  })

  it('pointsToPath produces a quadratic-smoothed path for 3+ points', () => {
    const d = pointsToPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }])
    expect(d).toContain('Q')
  })

  it('boundsOfPoints computes a bounding box with padding for stroke width', () => {
    const b = boundsOfPoints([{ x: 10, y: 10 }, { x: 30, y: 50 }], 4)
    expect(b).toEqual({ x: 8, y: 8, w: 24, h: 44 })
  })

  it('boundsOfPoints on a single point still returns a non-zero box', () => {
    const b = boundsOfPoints([{ x: 10, y: 10 }], 4)
    expect(b.w).toBeGreaterThan(0)
    expect(b.h).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- smoothPath.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/smoothPath.ts
export type Point = { x: number; y: number }

// 用二次贝塞尔把连续点抹平成一条平滑曲线：每一段的控制点取当前点，
// 终点取相邻两点的中点——这是画板类应用里最常见的"够用就好"平滑算法，
// 不需要真正的样条拟合。
export function pointsToPath(points: Point[]): string {
  if (points.length < 2) return ''
  const [first, ...rest] = points
  let d = `M${first.x},${first.y}`
  for (let i = 0; i < rest.length - 1; i++) {
    const cur = rest[i]
    const next = rest[i + 1]
    const midX = (cur.x + next.x) / 2
    const midY = (cur.y + next.y) / 2
    d += ` Q${cur.x},${cur.y} ${midX},${midY}`
  }
  const last = rest[rest.length - 1]
  if (last) d += ` L${last.x},${last.y}`
  return d
}

export function boundsOfPoints(points: Point[], padding = 0): { x: number; y: number; w: number; h: number } {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs) - padding
  const minY = Math.min(...ys) - padding
  const maxX = Math.max(...xs) + padding
  const maxY = Math.max(...ys) + padding
  return { x: minX, y: minY, w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- smoothPath.test.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/smoothPath.ts web/test/smoothPath.test.ts
git commit -m "feat: 自由画笔轨迹平滑与包围盒计算"
```

---

### Task 7: SelectionLayer — click-to-select, drag-move, align guides

**Files:**
- Create: `web/src/canvas/SelectionLayer.tsx`
- Create: `web/src/canvas/AlignGuides.tsx`
- Modify: `web/src/styles.css` (append selection/guide styles)
- Test: `web/test/SelectionLayer.test.tsx`

This is the core interaction surface: it renders on top of the (already-existing, read-only) `CanvasElement` list, listens for pointer events, and owns click-to-select + drag-to-move. Resize (Task 8) and shape-insertion (Task 9) hook into the same component later, so its props are designed for that now.

- [ ] **Step 1: Write the failing test**

```tsx
// web/test/SelectionLayer.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { SelectionLayer } from '../src/canvas/SelectionLayer'
import type { ElementRow } from '../src/types'

afterEach(cleanup)

const rect = (id: string, x: number, group_id: string | null = null): ElementRow => ({
  id, slide_id: 's1', type: 'rect', x, y: 100, w: 50, h: 50, z_index: 0, group_id, content: {}, blob_hash: null,
})

function setup(elements: ElementRow[], extra: Partial<React.ComponentProps<typeof SelectionLayer>> = {}) {
  const onChange = vi.fn()
  const onCommit = vi.fn()
  const onSelect = vi.fn()
  render(
    <SelectionLayer
      elements={elements}
      selectedIds={[]}
      scale={1}
      getContainerRect={() => ({ left: 0, top: 0 } as DOMRect)}
      onSelect={onSelect}
      onLiveChange={onChange}
      onCommit={onCommit}
      {...extra}
    />,
  )
  return { onChange, onCommit, onSelect }
}

describe('SelectionLayer', () => {
  it('clicking an element hit-box selects it', () => {
    const { onSelect } = setup([rect('a', 0)])
    fireEvent.pointerDown(screen.getByTestId('sel-hit-a'), { clientX: 20, clientY: 120, button: 0 })
    fireEvent.pointerUp(screen.getByTestId('sel-hit-a'))
    expect(onSelect).toHaveBeenCalledWith(['a'], expect.anything())
  })

  it('clicking a grouped element selects every member of the group', () => {
    const { onSelect } = setup([rect('a', 0, 'g1'), rect('b', 100, 'g1'), rect('c', 200, null)])
    fireEvent.pointerDown(screen.getByTestId('sel-hit-a'), { clientX: 20, clientY: 120, button: 0 })
    fireEvent.pointerUp(screen.getByTestId('sel-hit-a'))
    expect(onSelect.mock.calls[0][0].sort()).toEqual(['a', 'b'])
  })

  it('dragging a selected element issues live updates then a commit', () => {
    const { onChange, onCommit } = setup([rect('a', 0)], { selectedIds: ['a'] })
    const hit = screen.getByTestId('sel-hit-a')
    fireEvent.pointerDown(hit, { clientX: 25, clientY: 125, button: 0 })
    fireEvent.pointerMove(window, { clientX: 35, clientY: 125 })
    expect(onChange).toHaveBeenCalled()
    const updated = onChange.mock.calls.at(-1)![0] as ElementRow[]
    expect(updated.find((e) => e.id === 'a')!.x).toBe(10) // moved +10
    fireEvent.pointerUp(window)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('clicking empty canvas space clears selection', () => {
    const { onSelect } = setup([rect('a', 0)])
    fireEvent.pointerDown(screen.getByTestId('selection-layer'), { clientX: 900, clientY: 900, button: 0 })
    fireEvent.pointerUp(screen.getByTestId('selection-layer'))
    expect(onSelect).toHaveBeenCalledWith([], expect.anything())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- SelectionLayer.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/canvas/AlignGuides.tsx
import type { Guide } from '../lib/snap'

export function AlignGuides({ guides, width, height }: { guides: Guide[]; width: number; height: number }) {
  return (
    <>
      {guides.map((g, i) =>
        g.axis === 'x' ? (
          <div key={i} className="align-guide align-guide-v" style={{ left: g.pos, height }} />
        ) : (
          <div key={i} className="align-guide align-guide-h" style={{ top: g.pos, width }} />
        ),
      )}
    </>
  )
}
```

```tsx
// web/src/canvas/SelectionLayer.tsx
import { useRef, useState } from 'react'
import type { ElementRow } from '../types'
import { computeSnap, type Bounds, type Guide } from '../lib/snap'
import { toCanvasPoint } from '../lib/geometry'
import { AlignGuides } from './AlignGuides'

type ContainerRect = { left: number; top: number }

type Props = {
  elements: ElementRow[]
  selectedIds: string[]
  scale: number
  canvasWidth: number
  canvasHeight: number
  getContainerRect: () => ContainerRect
  onSelect: (ids: string[], additive: boolean) => void
  onLiveChange: (elements: ElementRow[]) => void
  onCommit: () => void
}

function groupMembers(elements: ElementRow[], id: string): string[] {
  const el = elements.find((e) => e.id === id)
  if (!el || !el.group_id) return [id]
  return elements.filter((e) => e.group_id === el.group_id).map((e) => e.id)
}

function boundsOf(el: ElementRow): Bounds {
  return { x: el.x, y: el.y, w: el.w, h: el.h }
}

function unionBounds(bs: Bounds[]): Bounds {
  const x = Math.min(...bs.map((b) => b.x))
  const y = Math.min(...bs.map((b) => b.y))
  const right = Math.max(...bs.map((b) => b.x + b.w))
  const bottom = Math.max(...bs.map((b) => b.y + b.h))
  return { x, y, w: right - x, h: bottom - y }
}

// 参与对齐吸附计算的"其它元素"列表：把每个分组合并成一个包围盒，
// 排除跟正在拖拽的元素同组的成员（否则组内元素会互相触发假的对齐线）。
function othersForSnap(elements: ElementRow[], draggingIds: string[]): Bounds[] {
  const draggingSet = new Set(draggingIds)
  const draggingGroupIds = new Set(elements.filter((e) => draggingSet.has(e.id) && e.group_id).map((e) => e.group_id))
  const rest = elements.filter((e) => !draggingSet.has(e.id) && !(e.group_id && draggingGroupIds.has(e.group_id)))
  const byGroup = new Map<string, ElementRow[]>()
  const ungrouped: ElementRow[] = []
  for (const el of rest) {
    if (el.group_id) {
      const arr = byGroup.get(el.group_id) ?? []
      arr.push(el)
      byGroup.set(el.group_id, arr)
    } else {
      ungrouped.push(el)
    }
  }
  const groupBoxes = [...byGroup.values()].map((members) => unionBounds(members.map(boundsOf)))
  return [...ungrouped.map(boundsOf), ...groupBoxes]
}

export function SelectionLayer({
  elements,
  selectedIds,
  scale,
  canvasWidth,
  canvasHeight,
  getContainerRect,
  onSelect,
  onLiveChange,
  onCommit,
}: Props) {
  const [guides, setGuides] = useState<Guide[]>([])
  const dragState = useRef<{
    ids: string[]
    startPoint: { x: number; y: number }
    startBounds: Map<string, Bounds>
  } | null>(null)

  function handlePointerDownEmpty(e: React.PointerEvent) {
    if (e.button !== 0) return
    onSelect([], e.shiftKey)
  }

  function handlePointerDownElement(e: React.PointerEvent, id: string) {
    if (e.button !== 0) return
    e.stopPropagation()
    const members = groupMembers(elements, id)
    let nextSelected = selectedIds
    if (e.shiftKey) {
      nextSelected = selectedIds.includes(id) ? selectedIds.filter((s) => !members.includes(s)) : [...selectedIds, ...members]
    } else if (!selectedIds.includes(id)) {
      nextSelected = members
    }
    onSelect(nextSelected, e.shiftKey)

    const rect = getContainerRect()
    const startPoint = toCanvasPoint(e.clientX, e.clientY, rect, scale)
    const startBounds = new Map<string, Bounds>()
    for (const elId of nextSelected) {
      const el = elements.find((x) => x.id === elId)
      if (el) startBounds.set(elId, boundsOf(el))
    }
    dragState.current = { ids: nextSelected, startPoint, startBounds }

    const handleMove = (moveEvt: PointerEvent) => {
      const drag = dragState.current
      if (!drag) return
      const rect2 = getContainerRect()
      const p = toCanvasPoint(moveEvt.clientX, moveEvt.clientY, rect2, scale)
      let dx = p.x - drag.startPoint.x
      let dy = p.y - drag.startPoint.y

      // 用其中一个被拖拽元素（组则用并集包围盒）算吸附量，同样的 dx/dy 应用到全部选中元素
      const draggingBoundsList = drag.ids.map((id) => {
        const start = drag.startBounds.get(id)!
        return { x: start.x + dx, y: start.y + dy, w: start.w, h: start.h }
      })
      const movingUnion = unionBounds(draggingBoundsList)
      const snap = computeSnap(movingUnion, othersForSnap(elements, drag.ids))
      dx += snap.dx
      dy += snap.dy
      setGuides(snap.guides)

      const next = elements.map((el) => {
        const start = drag.startBounds.get(el.id)
        if (!start) return el
        return { ...el, x: start.x + dx, y: start.y + dy }
      })
      onLiveChange(next)
    }

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      dragState.current = null
      setGuides([])
      onCommit()
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  return (
    <div
      data-testid="selection-layer"
      className="selection-layer"
      style={{ position: 'absolute', inset: 0 }}
      onPointerDown={handlePointerDownEmpty}
    >
      {elements.map((el) => (
        <div
          key={el.id}
          data-testid={`sel-hit-${el.id}`}
          className={selectedIds.includes(el.id) ? 'selection-hit selected' : 'selection-hit'}
          style={{ position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h, zIndex: el.z_index }}
          onPointerDown={(e) => handlePointerDownElement(e, el.id)}
        />
      ))}
      <AlignGuides guides={guides} width={canvasWidth} height={canvasHeight} />
    </div>
  )
}
```

Append to `web/src/styles.css`:

```css
.selection-layer { pointer-events: none; }
.selection-hit { pointer-events: auto; cursor: move; }
.selection-hit.selected { outline: 2px solid var(--accent); outline-offset: 2px; }
.align-guide { position: absolute; background: #e0529c; pointer-events: none; }
.align-guide-v { top: 0; width: 1px; }
.align-guide-h { left: 0; height: 1px; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- SelectionLayer.test.tsx`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add web/src/canvas/SelectionLayer.tsx web/src/canvas/AlignGuides.tsx web/src/styles.css web/test/SelectionLayer.test.tsx
git commit -m "feat: 选中/拖拽移动 + 对齐引导线渲染"
```

---

### Task 8: Resize handles

**Files:**
- Create: `web/src/canvas/ResizeHandles.tsx`
- Modify: `web/src/styles.css` (append handle styles)
- Test: `web/test/ResizeHandles.test.tsx`

Resize only applies to a single selected element (not multi-selection or arbitrary groups — spec doesn't call for group-resize, and it's a meaningfully harder feature for no stated need). Eight handles (`nw n ne w e sw s se`); dragging a handle updates `w`/`h` and, for handles on the top/left edges, `x`/`y` too, clamped to a minimum of 20×20.

- [ ] **Step 1: Write the failing test**

```tsx
// web/test/ResizeHandles.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ResizeHandles } from '../src/canvas/ResizeHandles'

afterEach(cleanup)

describe('ResizeHandles', () => {
  it('dragging the se handle grows w/h and leaves x/y unchanged', () => {
    const onLiveChange = vi.fn()
    const onCommit = vi.fn()
    render(
      <ResizeHandles
        bounds={{ x: 100, y: 100, w: 50, h: 50 }}
        scale={1}
        getContainerRect={() => ({ left: 0, top: 0 } as DOMRect)}
        onLiveChange={onLiveChange}
        onCommit={onCommit}
      />,
    )
    fireEvent.pointerDown(screen.getByTestId('resize-se'), { clientX: 150, clientY: 150, button: 0 })
    fireEvent.pointerMove(window, { clientX: 170, clientY: 160 })
    const last = onLiveChange.mock.calls.at(-1)![0]
    expect(last).toEqual({ x: 100, y: 100, w: 70, h: 60 })
    fireEvent.pointerUp(window)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('dragging the nw handle moves x/y and shrinks w/h', () => {
    const onLiveChange = vi.fn()
    render(
      <ResizeHandles
        bounds={{ x: 100, y: 100, w: 50, h: 50 }}
        scale={1}
        getContainerRect={() => ({ left: 0, top: 0 } as DOMRect)}
        onLiveChange={onLiveChange}
        onCommit={vi.fn()}
      />,
    )
    fireEvent.pointerDown(screen.getByTestId('resize-nw'), { clientX: 100, clientY: 100, button: 0 })
    fireEvent.pointerMove(window, { clientX: 110, clientY: 110 })
    const last = onLiveChange.mock.calls.at(-1)![0]
    expect(last).toEqual({ x: 110, y: 110, w: 40, h: 40 })
  })

  it('clamps to a minimum size of 20x20', () => {
    const onLiveChange = vi.fn()
    render(
      <ResizeHandles
        bounds={{ x: 100, y: 100, w: 50, h: 50 }}
        scale={1}
        getContainerRect={() => ({ left: 0, top: 0 } as DOMRect)}
        onLiveChange={onLiveChange}
        onCommit={vi.fn()}
      />,
    )
    fireEvent.pointerDown(screen.getByTestId('resize-se'), { clientX: 150, clientY: 150, button: 0 })
    fireEvent.pointerMove(window, { clientX: 0, clientY: 0 })
    const last = onLiveChange.mock.calls.at(-1)![0]
    expect(last.w).toBe(20)
    expect(last.h).toBe(20)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- ResizeHandles.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/canvas/ResizeHandles.tsx
import { toCanvasPoint } from '../lib/geometry'

type Bounds = { x: number; y: number; w: number; h: number }
type ContainerRect = { left: number; top: number }
type HandleKey = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se'

const MIN_SIZE = 20

const HANDLES: { key: HandleKey; top: number; left: number }[] = [
  { key: 'nw', top: 0, left: 0 },
  { key: 'n', top: 0, left: 0.5 },
  { key: 'ne', top: 0, left: 1 },
  { key: 'w', top: 0.5, left: 0 },
  { key: 'e', top: 0.5, left: 1 },
  { key: 'sw', top: 1, left: 0 },
  { key: 's', top: 1, left: 0.5 },
  { key: 'se', top: 1, left: 1 },
]

function applyHandle(key: HandleKey, start: Bounds, dx: number, dy: number): Bounds {
  let { x, y, w, h } = start
  const affectsLeft = key.includes('w')
  const affectsRight = key.includes('e')
  const affectsTop = key.includes('n')
  const affectsBottom = key.includes('s')

  if (affectsRight) w = start.w + dx
  if (affectsBottom) h = start.h + dy
  if (affectsLeft) {
    w = start.w - dx
    x = start.x + dx
  }
  if (affectsTop) {
    h = start.h - dy
    y = start.y + dy
  }

  if (w < MIN_SIZE) {
    if (affectsLeft) x -= MIN_SIZE - w
    w = MIN_SIZE
  }
  if (h < MIN_SIZE) {
    if (affectsTop) y -= MIN_SIZE - h
    h = MIN_SIZE
  }
  return { x, y, w, h }
}

export function ResizeHandles({
  bounds,
  scale,
  getContainerRect,
  onLiveChange,
  onCommit,
}: {
  bounds: Bounds
  scale: number
  getContainerRect: () => ContainerRect
  onLiveChange: (bounds: Bounds) => void
  onCommit: () => void
}) {
  function handlePointerDown(e: React.PointerEvent, key: HandleKey) {
    if (e.button !== 0) return
    e.stopPropagation()
    const rect = getContainerRect()
    const start = toCanvasPoint(e.clientX, e.clientY, rect, scale)
    const startBounds = bounds

    const handleMove = (moveEvt: PointerEvent) => {
      const rect2 = getContainerRect()
      const p = toCanvasPoint(moveEvt.clientX, moveEvt.clientY, rect2, scale)
      onLiveChange(applyHandle(key, startBounds, p.x - start.x, p.y - start.y))
    }
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      onCommit()
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  return (
    <>
      {HANDLES.map(({ key, top, left }) => (
        <div
          key={key}
          data-testid={`resize-${key}`}
          className={`resize-handle resize-handle-${key}`}
          style={{
            position: 'absolute',
            left: bounds.x + bounds.w * left,
            top: bounds.y + bounds.h * top,
            transform: 'translate(-50%, -50%)',
          }}
          onPointerDown={(e) => handlePointerDown(e, key)}
        />
      ))}
    </>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- ResizeHandles.test.tsx`
Expected: PASS (3/3)

Append to `web/src/styles.css`:

```css
.resize-handle {
  width: 8px; height: 8px; background: #fff; border: 1.5px solid var(--accent);
  border-radius: 2px; pointer-events: auto;
}
.resize-handle-nw, .resize-handle-se { cursor: nwse-resize; }
.resize-handle-ne, .resize-handle-sw { cursor: nesw-resize; }
.resize-handle-n, .resize-handle-s { cursor: ns-resize; }
.resize-handle-w, .resize-handle-e { cursor: ew-resize; }
```

- [ ] **Step 5: Commit**

```bash
git add web/src/canvas/ResizeHandles.tsx web/src/styles.css web/test/ResizeHandles.test.tsx
git commit -m "feat: 单选元素的八点缩放控制柄"
```

---

### Task 9: Toolbar + shape insertion flow

**Files:**
- Create: `web/src/canvas/Toolbar.tsx`
- Create: `web/src/lib/defaultElement.ts`
- Test: `web/test/defaultElement.test.ts`
- Test: `web/test/Toolbar.test.tsx`

`defaultElement.ts` is a pure factory (easy to test); `Toolbar.tsx` is the button row that arms a tool and, for click-to-place shapes, calls the factory. Freehand is handled separately in Task 10 (it needs drag-tracing, not click-to-place). Image/embed upload is Task 13. This task covers: rect, ellipse, line-arrow, diamond, textbox.

- [ ] **Step 1: Write the failing test**

```ts
// web/test/defaultElement.test.ts
import { describe, it, expect } from 'vitest'
import { createDefaultElement } from '../src/lib/defaultElement'

describe('createDefaultElement', () => {
  it('centers the new element on the given point', () => {
    const el = createDefaultElement('rect', { x: 500, y: 300 }, 's1')
    expect(el.x).toBe(500 - el.w / 2)
    expect(el.y).toBe(300 - el.h / 2)
    expect(el.type).toBe('rect')
    expect(el.slide_id).toBe('s1')
    expect(el.id).toBeTruthy()
  })

  it('gives textbox an empty tiptap doc', () => {
    const el = createDefaultElement('textbox', { x: 0, y: 0 }, 's1')
    expect(el.content.doc.type).toBe('doc')
  })

  it('gives line-arrow a smaller default box than rect', () => {
    const line = createDefaultElement('line-arrow', { x: 0, y: 0 }, 's1')
    const rect = createDefaultElement('rect', { x: 0, y: 0 }, 's1')
    expect(line.h).toBeLessThanOrEqual(rect.h)
  })
})
```

```tsx
// web/test/Toolbar.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Toolbar } from '../src/canvas/Toolbar'

afterEach(cleanup)

describe('Toolbar', () => {
  it('clicking a shape button arms that tool', () => {
    const onToolChange = vi.fn()
    render(<Toolbar tool="select" onToolChange={onToolChange} onUploadImage={vi.fn()} onUploadEmbed={vi.fn()}
      onInsertLatex={vi.fn()} onInsertCode={vi.fn()}
      canGroup={false} canUngroup={false} onGroup={vi.fn()} onUngroup={vi.fn()}
      onBringToFront={vi.fn()} onSendToBack={vi.fn()} onBringForward={vi.fn()} onSendBackward={vi.fn()}
      canUndo={false} canRedo={false} onUndo={vi.fn()} onRedo={vi.fn()} saveStatus="idle" />)
    fireEvent.click(screen.getByRole('button', { name: '矩形' }))
    expect(onToolChange).toHaveBeenCalledWith('rect')
  })

  it('shows the currently armed tool as pressed', () => {
    render(<Toolbar tool="ellipse" onToolChange={vi.fn()} onUploadImage={vi.fn()} onUploadEmbed={vi.fn()}
      onInsertLatex={vi.fn()} onInsertCode={vi.fn()}
      canGroup={false} canUngroup={false} onGroup={vi.fn()} onUngroup={vi.fn()}
      onBringToFront={vi.fn()} onSendToBack={vi.fn()} onBringForward={vi.fn()} onSendBackward={vi.fn()}
      canUndo={false} canRedo={false} onUndo={vi.fn()} onRedo={vi.fn()} saveStatus="idle" />)
    expect(screen.getByRole('button', { name: '椭圆' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('group/ungroup/layer/undo buttons are disabled based on props', () => {
    render(<Toolbar tool="select" onToolChange={vi.fn()} onUploadImage={vi.fn()} onUploadEmbed={vi.fn()}
      onInsertLatex={vi.fn()} onInsertCode={vi.fn()}
      canGroup={false} canUngroup={false} onGroup={vi.fn()} onUngroup={vi.fn()}
      onBringToFront={vi.fn()} onSendToBack={vi.fn()} onBringForward={vi.fn()} onSendBackward={vi.fn()}
      canUndo={false} canRedo={false} onUndo={vi.fn()} onRedo={vi.fn()} saveStatus="idle" />)
    expect(screen.getByRole('button', { name: '编组' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- defaultElement.test.ts Toolbar.test.tsx`
Expected: FAIL — modules not found

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/defaultElement.ts
import type { ElementRow, ElementType } from '../types'

const SIZES: Partial<Record<ElementType, { w: number; h: number }>> = {
  rect: { w: 200, h: 120 },
  ellipse: { w: 200, h: 120 },
  diamond: { w: 200, h: 120 },
  'line-arrow': { w: 200, h: 100 },
  textbox: { w: 300, h: 100 },
  embed: { w: 400, h: 300 },
  latex: { w: 200, h: 80 },
  code: { w: 320, h: 160 },
  image: { w: 300, h: 200 },
}

function defaultContent(type: ElementType): Record<string, any> {
  switch (type) {
    case 'rect':
    case 'diamond':
      return { fill: 'none', stroke: '#1a1a1a', strokeWidth: 2, cornerRadius: 0 }
    case 'ellipse':
      return { fill: 'none', stroke: '#1a1a1a', strokeWidth: 2 }
    case 'line-arrow':
      return { stroke: '#1a1a1a', strokeWidth: 2, arrowEnd: true }
    case 'textbox':
      return { doc: { type: 'doc', content: [{ type: 'paragraph' }] }, fontSize: 20, textAlign: 'left' }
    case 'latex':
      return { formula: '', display: true }
    case 'code':
      return { language: '', code: '' }
    default:
      return {}
  }
}

// 新建元素以点击位置为中心（比左上角更符合直觉），w/h 用该类型的默认尺寸。
// x/y/w/h 都在画布固定设计坐标系里，跟当前缩放级别无关。
export function createDefaultElement(
  type: ElementType,
  center: { x: number; y: number },
  slideId: string,
  overrides: Partial<ElementRow> = {},
): ElementRow {
  const { w, h } = SIZES[type] ?? { w: 200, h: 120 }
  return {
    id: crypto.randomUUID(),
    slide_id: slideId,
    type,
    x: center.x - w / 2,
    y: center.y - h / 2,
    w,
    h,
    z_index: 0,
    group_id: null,
    content: defaultContent(type),
    blob_hash: null,
    ...overrides,
  }
}
```

```tsx
// web/src/canvas/Toolbar.tsx
import type { ElementType } from '../types'
import type { SaveStatus } from '../lib/useAutosave'

export type Tool = 'select' | ElementType

const SHAPE_BUTTONS: { type: ElementType; label: string }[] = [
  { type: 'rect', label: '矩形' },
  { type: 'ellipse', label: '椭圆' },
  { type: 'diamond', label: '菱形' },
  { type: 'line-arrow', label: '箭头' },
  { type: 'textbox', label: '文本框' },
  { type: 'freehand', label: '画笔' },
]

const SAVE_LABEL: Record<SaveStatus, string> = {
  idle: '', saving: '保存中…', saved: '已保存', error: '保存失败，将重试',
}

export function Toolbar(props: {
  tool: Tool
  onToolChange: (tool: Tool) => void
  onUploadImage: () => void
  onUploadEmbed: () => void
  onInsertLatex: () => void
  onInsertCode: () => void
  canGroup: boolean
  canUngroup: boolean
  onGroup: () => void
  onUngroup: () => void
  onBringToFront: () => void
  onSendToBack: () => void
  onBringForward: () => void
  onSendBackward: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  saveStatus: SaveStatus
}) {
  return (
    <div className="toolbar">
      {SHAPE_BUTTONS.map(({ type, label }) => (
        <button
          key={type}
          aria-pressed={props.tool === type}
          className={props.tool === type ? 'toolbar-btn active' : 'toolbar-btn'}
          onClick={() => props.onToolChange(props.tool === type ? 'select' : type)}
        >
          {label}
        </button>
      ))}
      <span className="toolbar-sep" />
      <button className="toolbar-btn" onClick={props.onUploadImage}>图片</button>
      <button className="toolbar-btn" onClick={props.onUploadEmbed}>嵌入</button>
      <button className="toolbar-btn" onClick={props.onInsertLatex}>公式</button>
      <button className="toolbar-btn" onClick={props.onInsertCode}>代码</button>
      <span className="toolbar-sep" />
      <button className="toolbar-btn" disabled={!props.canGroup} onClick={props.onGroup}>编组</button>
      <button className="toolbar-btn" disabled={!props.canUngroup} onClick={props.onUngroup}>解组</button>
      <span className="toolbar-sep" />
      <button className="toolbar-btn" onClick={props.onBringToFront} title="置顶">置顶</button>
      <button className="toolbar-btn" onClick={props.onBringForward} title="上移一层">上移</button>
      <button className="toolbar-btn" onClick={props.onSendBackward} title="下移一层">下移</button>
      <button className="toolbar-btn" onClick={props.onSendToBack} title="置底">置底</button>
      <span className="toolbar-sep" />
      <button className="toolbar-btn" disabled={!props.canUndo} onClick={props.onUndo}>撤销</button>
      <button className="toolbar-btn" disabled={!props.canRedo} onClick={props.onRedo}>重做</button>
      <span className="save-status">{SAVE_LABEL[props.saveStatus]}</span>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- defaultElement.test.ts Toolbar.test.tsx`
Expected: PASS (3/3, 3/3)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/defaultElement.ts web/src/canvas/Toolbar.tsx web/test/defaultElement.test.ts web/test/Toolbar.test.tsx
git commit -m "feat: 工具栏 + 新建元素默认属性工厂"
```

---

### Task 10: Freehand draw tool

**Files:**
- Create: `web/src/canvas/FreehandLayer.tsx`
- Test: `web/test/FreehandLayer.test.tsx`

A separate small layer that's only active when `tool === 'freehand'`: pointerdown starts collecting points in canvas space, pointermove appends, pointerup finalizes into one `freehand` element via `pointsToPath`/`boundsOfPoints` (Task 6) and `createDefaultElement`-style insertion (but freehand's size comes from the trace, not a fixed default, so it builds the `ElementRow` directly rather than going through `createDefaultElement`).

- [ ] **Step 1: Write the failing test**

```tsx
// web/test/FreehandLayer.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FreehandLayer } from '../src/canvas/FreehandLayer'

afterEach(cleanup)

describe('FreehandLayer', () => {
  it('does nothing when tool is not freehand', () => {
    const onInsert = vi.fn()
    render(
      <FreehandLayer active={false} scale={1} getContainerRect={() => ({ left: 0, top: 0 } as DOMRect)} slideId="s1" onInsert={onInsert} />,
    )
    expect(screen.queryByTestId('freehand-layer')).toBeNull()
  })

  it('traces a drag and inserts one freehand element on pointerup', () => {
    const onInsert = vi.fn()
    render(
      <FreehandLayer active scale={1} getContainerRect={() => ({ left: 0, top: 0 } as DOMRect)} slideId="s1" onInsert={onInsert} />,
    )
    const layer = screen.getByTestId('freehand-layer')
    fireEvent.pointerDown(layer, { clientX: 10, clientY: 10, button: 0 })
    fireEvent.pointerMove(window, { clientX: 20, clientY: 15 })
    fireEvent.pointerMove(window, { clientX: 30, clientY: 40 })
    fireEvent.pointerUp(window)
    expect(onInsert).toHaveBeenCalledTimes(1)
    const el = onInsert.mock.calls[0][0]
    expect(el.type).toBe('freehand')
    expect(el.slide_id).toBe('s1')
    expect(el.content.path).toContain('M')
    expect(el.w).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- FreehandLayer.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/canvas/FreehandLayer.tsx
import { useRef } from 'react'
import { toCanvasPoint } from '../lib/geometry'
import { pointsToPath, boundsOfPoints, type Point } from '../lib/smoothPath'
import type { ElementRow } from '../types'

type ContainerRect = { left: number; top: number }

export function FreehandLayer({
  active,
  scale,
  getContainerRect,
  slideId,
  onInsert,
}: {
  active: boolean
  scale: number
  getContainerRect: () => ContainerRect
  slideId: string
  onInsert: (el: ElementRow) => void
}) {
  const pointsRef = useRef<Point[]>([])

  if (!active) return null

  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    const rect = getContainerRect()
    pointsRef.current = [toCanvasPoint(e.clientX, e.clientY, rect, scale)]

    const handleMove = (moveEvt: PointerEvent) => {
      const rect2 = getContainerRect()
      pointsRef.current.push(toCanvasPoint(moveEvt.clientX, moveEvt.clientY, rect2, scale))
    }
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      const points = pointsRef.current
      if (points.length < 2) return
      const strokeWidth = 2
      const bounds = boundsOfPoints(points, strokeWidth)
      // path 的坐标要相对元素左上角，不是画布原点——渲染时 FreehandShape 在一个
      // left/top = bounds.x/y 的容器里画这条 path
      const localPoints = points.map((p) => ({ x: p.x - bounds.x, y: p.y - bounds.y }))
      onInsert({
        id: crypto.randomUUID(),
        slide_id: slideId,
        type: 'freehand',
        x: bounds.x,
        y: bounds.y,
        w: bounds.w,
        h: bounds.h,
        z_index: 0,
        group_id: null,
        content: { path: pointsToPath(localPoints), stroke: '#1a1a1a', strokeWidth },
        blob_hash: null,
      })
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  return <div data-testid="freehand-layer" className="freehand-layer" style={{ position: 'absolute', inset: 0 }} onPointerDown={handlePointerDown} />
}
```

Note: `FreehandShape.tsx` (Plan 1) renders `content.path` inside an `<svg>` sized to the element's own box with `overflow: visible` and no `viewBox` — since the path coordinates above are already relative to the element's own top-left (`bounds.x/y` subtracted), this matches how `FreehandShape` expects `content.path` to be expressed. No changes needed to `FreehandShape.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- FreehandLayer.test.tsx`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add web/src/canvas/FreehandLayer.tsx web/test/FreehandLayer.test.tsx
git commit -m "feat: 自由画笔拖拽轨迹采集与元素插入"
```

---

### Task 11: Add `@tiptap/react`, editable text box + bubble menu

**Files:**
- Modify: `web/package.json` (new dependency)
- Create: `web/src/canvas/TextBoxEditor.tsx`
- Modify: `web/src/styles.css` (append bubble menu styles)
- Test: `web/test/TextBoxEditor.test.tsx`

- [ ] **Step 1: Add the dependency**

```bash
npm --prefix web install @tiptap/react@^2.9.1
```

This matches the already-pinned `@tiptap/core`/`@tiptap/html`/`@tiptap/starter-kit` major.minor from Plan 1's `package.json`.

- [ ] **Step 2: Write the failing test**

```tsx
// web/test/TextBoxEditor.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextBoxEditor } from '../src/canvas/TextBoxEditor'

afterEach(cleanup)

describe('TextBoxEditor', () => {
  it('renders editable prose mirror content from the initial doc', () => {
    render(
      <TextBoxEditor
        content={{ doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] }, fontSize: 20, textAlign: 'left' }}
        onChange={vi.fn()}
        onBlur={vi.fn()}
      />,
    )
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('typing calls onChange with an updated ProseMirror doc', async () => {
    const onChange = vi.fn()
    render(
      <TextBoxEditor
        content={{ doc: { type: 'doc', content: [{ type: 'paragraph' }] }, fontSize: 20, textAlign: 'left' }}
        onChange={onChange}
        onBlur={vi.fn()}
      />,
    )
    const editable = document.querySelector('[contenteditable="true"]')!
    await userEvent.type(editable as HTMLElement, 'hi')
    expect(onChange).toHaveBeenCalled()
    const lastDoc = onChange.mock.calls.at(-1)![0]
    expect(JSON.stringify(lastDoc)).toContain('hi')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --prefix web test -- TextBoxEditor.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 4: Write the implementation**

```tsx
// web/src/canvas/TextBoxEditor.tsx
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

export function TextBoxEditor({
  content,
  onChange,
  onBlur,
}: {
  content: { doc: any; fontSize?: number; textAlign?: string }
  onChange: (doc: any) => void
  onBlur: () => void
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: content.doc,
    autofocus: 'end',
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
  })

  if (!editor) return null

  return (
    <div className="textbox-editor" style={{ fontSize: content.fontSize ?? 20, textAlign: (content.textAlign as any) ?? 'left' }}>
      {/* Tiptap 的 BubbleMenu 内部用 tippy.js，默认 append 到 document.body——
          天然逃出了画布 transform: scale() 容器，不需要额外手写 portal */}
      <BubbleMenu editor={editor}>
        <div className="bubble-menu">
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()}>B</button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()}>I</button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleCode().run()}>{'</>'}</button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleBulletList().run()}>•</button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
        </div>
      </BubbleMenu>
      <EditorContent editor={editor} onBlur={onBlur} />
    </div>
  )
}
```

Append to `web/src/styles.css`:

```css
.textbox-editor { width: 100%; height: 100%; outline: 1px dashed var(--accent); }
.bubble-menu { display: flex; gap: 2px; background: var(--fg); border-radius: 6px; padding: 4px; box-shadow: var(--card-shadow); }
.bubble-menu button { background: transparent; color: var(--bg); border: none; padding: 4px 8px; cursor: pointer; border-radius: 4px; }
.bubble-menu button:hover { background: rgba(255,255,255,0.15); }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix web test -- TextBoxEditor.test.tsx`
Expected: PASS (2/2)

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/src/canvas/TextBoxEditor.tsx web/src/styles.css web/test/TextBoxEditor.test.tsx
git commit -m "feat: 文本框富文本编辑 + 悬浮工具条"
```

---

### Task 12: LaTeX / code inline edit popover

**Files:**
- Create: `web/src/canvas/InlineEditPopover.tsx`
- Modify: `web/src/styles.css` (append popover styles)
- Test: `web/test/InlineEditPopover.test.tsx`

One small generic popover (positioned absolutely near the element being edited) that both the LaTeX and code elements reuse — LaTeX passes a formula textarea + display-mode checkbox as children, code passes a language select + code textarea. This avoids building two near-identical floating-box components.

- [ ] **Step 1: Write the failing test**

```tsx
// web/test/InlineEditPopover.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { InlineEditPopover } from '../src/canvas/InlineEditPopover'

afterEach(cleanup)

describe('InlineEditPopover', () => {
  it('renders children and calls onClose on the close button', () => {
    const onClose = vi.fn()
    render(
      <InlineEditPopover x={10} y={20} onClose={onClose}>
        <textarea aria-label="body" />
      </InlineEditPopover>,
    )
    expect(screen.getByLabelText('body')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('pressing Escape calls onClose', () => {
    const onClose = vi.fn()
    render(
      <InlineEditPopover x={0} y={0} onClose={onClose}>
        <textarea aria-label="body" />
      </InlineEditPopover>,
    )
    fireEvent.keyDown(screen.getByLabelText('body'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- InlineEditPopover.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/canvas/InlineEditPopover.tsx
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

// LaTeX/代码块的编辑表单——用 portal 挂到 body 上，理由跟 TextBoxEditor 里
// 用 Tiptap BubbleMenu 一样：画布容器有 transform: scale()，
// 子孙的 position: fixed/absolute 都会被这个 transform 建立的新 containing block 裁切/错位，
// 挂到 body 外面就没有这个问题（这里定位用 fixed，配合外部传入的屏幕坐标 x/y）。
export function InlineEditPopover({
  x,
  y,
  onClose,
  children,
}: {
  x: number
  y: number
  onClose: () => void
  children: ReactNode
}) {
  return createPortal(
    <div
      className="inline-edit-popover"
      style={{ position: 'fixed', left: x, top: y }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      {children}
      <button className="toolbar-btn" onClick={onClose}>完成</button>
    </div>,
    document.body,
  )
}
```

Append to `web/src/styles.css`:

```css
.inline-edit-popover {
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  box-shadow: var(--card-shadow); padding: 8px; z-index: 1000;
  display: flex; flex-direction: column; gap: 6px; min-width: 240px;
}
.inline-edit-popover textarea, .inline-edit-popover select { font-family: inherit; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- InlineEditPopover.test.tsx`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add web/src/canvas/InlineEditPopover.tsx web/src/styles.css web/test/InlineEditPopover.test.tsx
git commit -m "feat: LaTeX/代码块共用的浮层编辑表单"
```

---

### Task 13: Image & embed upload

**Files:**
- Create: `web/src/lib/uploadBlob.ts`
- Test: `web/test/uploadBlob.test.ts`

A small helper that wraps the existing `POST /api/blobs` (Plan 1, unchanged) — takes a `File`, uploads its raw bytes with the file's MIME type as `Content-Type`, and (for images) also resolves the natural width/height so the inserted element's aspect ratio looks right instead of always being the generic default box.

- [ ] **Step 1: Write the failing test**

```ts
// web/test/uploadBlob.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { uploadBlob } from '../src/lib/uploadBlob'
import * as apiModule from '../src/api'

afterEach(() => vi.restoreAllMocks())

describe('uploadBlob', () => {
  it('POSTs the file bytes with its content-type and returns the hash', async () => {
    const file = new File(['hello'], 'a.png', { type: 'image/png' })
    vi.spyOn(apiModule, 'apiJson').mockResolvedValue({ hash: 'abc123', size: 5 })
    const result = await uploadBlob(file)
    expect(result).toEqual({ hash: 'abc123', size: 5 })
    expect(apiModule.apiJson).toHaveBeenCalledWith(
      '/blobs',
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'image/png' } }),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- uploadBlob.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/uploadBlob.ts
import { apiJson } from '../api'

export async function uploadBlob(file: File): Promise<{ hash: string; size: number }> {
  const buf = await file.arrayBuffer()
  return apiJson<{ hash: string; size: number }>('/blobs', {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: buf,
  })
}

// 只有真正的图片文件才去读自然宽高——用于插入时按原图比例给一个更合理的默认框，
// 不是每种上传都需要（embed 用固定 400x300 占位框就够了）。
export function readImageNaturalSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('invalid image'))
    }
    img.src = url
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- uploadBlob.test.ts`
Expected: PASS (1/1)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/uploadBlob.ts web/test/uploadBlob.test.ts
git commit -m "feat: 图片/embed 上传封装，图片按原图比例给默认框"
```

---

### Task 14: Properties panel

**Files:**
- Create: `web/src/canvas/PropertiesPanel.tsx`
- Modify: `web/src/styles.css` (append panel styles)
- Test: `web/test/PropertiesPanel.test.tsx`

Shown when exactly one element is selected (multi-selection property editing isn't in the spec — skip it, same reasoning as resize). Shapes (rect/ellipse/diamond/line-arrow) get stroke color + width + fill; textbox gets font size + alignment. Other types show nothing (freehand/image/embed/latex/code are edited via their own inline flows, not this panel).

- [ ] **Step 1: Write the failing test**

```tsx
// web/test/PropertiesPanel.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PropertiesPanel } from '../src/canvas/PropertiesPanel'
import type { ElementRow } from '../src/types'

afterEach(cleanup)

const rectEl: ElementRow = {
  id: 'a', slide_id: 's1', type: 'rect', x: 0, y: 0, w: 10, h: 10, z_index: 0,
  group_id: null, content: { fill: 'none', stroke: '#111111', strokeWidth: 2 }, blob_hash: null,
}

describe('PropertiesPanel', () => {
  it('renders nothing when no element is given', () => {
    const { container } = render(<PropertiesPanel element={null} onChange={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('changing stroke color calls onChange with merged content', () => {
    const onChange = vi.fn()
    render(<PropertiesPanel element={rectEl} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('描边颜色'), { target: { value: '#ff0000' } })
    expect(onChange).toHaveBeenCalledWith({ fill: 'none', stroke: '#ff0000', strokeWidth: 2 })
  })

  it('shows font-size control for textbox and not for rect', () => {
    render(<PropertiesPanel element={rectEl} onChange={vi.fn()} />)
    expect(screen.queryByLabelText('字号')).toBeNull()
    const textEl: ElementRow = { ...rectEl, type: 'textbox', content: { doc: {}, fontSize: 20, textAlign: 'left' } }
    const { rerender } = render(<PropertiesPanel element={textEl} onChange={vi.fn()} />)
    rerender(<PropertiesPanel element={textEl} onChange={vi.fn()} />)
    expect(screen.getByLabelText('字号')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- PropertiesPanel.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/canvas/PropertiesPanel.tsx
import type { ElementRow } from '../types'

const SHAPE_TYPES = new Set(['rect', 'ellipse', 'diamond', 'line-arrow'])

export function PropertiesPanel({
  element,
  onChange,
}: {
  element: ElementRow | null
  onChange: (content: Record<string, any>) => void
}) {
  if (!element) return null

  if (SHAPE_TYPES.has(element.type)) {
    const c = element.content
    return (
      <div className="properties-panel">
        <label>
          描边颜色
          <input type="color" aria-label="描边颜色" value={c.stroke ?? '#1a1a1a'} onChange={(e) => onChange({ ...c, stroke: e.target.value })} />
        </label>
        <label>
          描边宽度
          <input type="range" aria-label="描边宽度" min={1} max={12} value={c.strokeWidth ?? 2} onChange={(e) => onChange({ ...c, strokeWidth: Number(e.target.value) })} />
        </label>
        {element.type !== 'line-arrow' && (
          <label>
            填充颜色
            <input type="color" aria-label="填充颜色" value={c.fill === 'none' ? '#ffffff' : (c.fill ?? '#ffffff')} onChange={(e) => onChange({ ...c, fill: e.target.value })} />
          </label>
        )}
      </div>
    )
  }

  if (element.type === 'textbox') {
    const c = element.content
    return (
      <div className="properties-panel">
        <label>
          字号
          <input type="number" aria-label="字号" min={10} max={96} value={c.fontSize ?? 20} onChange={(e) => onChange({ ...c, fontSize: Number(e.target.value) })} />
        </label>
        <label>
          对齐
          <select aria-label="对齐" value={c.textAlign ?? 'left'} onChange={(e) => onChange({ ...c, textAlign: e.target.value })}>
            <option value="left">左</option>
            <option value="center">中</option>
            <option value="right">右</option>
          </select>
        </label>
      </div>
    )
  }

  return null
}
```

Append to `web/src/styles.css`:

```css
.properties-panel { display: flex; flex-direction: column; gap: 8px; padding: 8px; border-left: 1px solid var(--border); width: 160px; }
.properties-panel label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--muted); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- PropertiesPanel.test.tsx`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add web/src/canvas/PropertiesPanel.tsx web/src/styles.css web/test/PropertiesPanel.test.tsx
git commit -m "feat: 选中元素的属性面板（描边/填充/字号/对齐）"
```

---

### Task 15: Grouping helper

**Files:**
- Create: `web/src/lib/grouping.ts`
- Test: `web/test/grouping.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/test/grouping.test.ts
import { describe, it, expect } from 'vitest'
import { groupElements, ungroupElements } from '../src/lib/grouping'

type El = { id: string; group_id: string | null }
const els: El[] = [{ id: 'a', group_id: null }, { id: 'b', group_id: null }, { id: 'c', group_id: null }]

describe('grouping', () => {
  it('groupElements assigns the same new group_id to all selected ids', () => {
    const result = groupElements(els, ['a', 'b'])
    expect(result.find((e) => e.id === 'a')!.group_id).toBe(result.find((e) => e.id === 'b')!.group_id)
    expect(result.find((e) => e.id === 'a')!.group_id).toBeTruthy()
    expect(result.find((e) => e.id === 'c')!.group_id).toBeNull()
  })

  it('ungroupElements clears group_id on the selected ids', () => {
    const grouped = groupElements(els, ['a', 'b'])
    const result = ungroupElements(grouped, ['a', 'b'])
    expect(result.find((e) => e.id === 'a')!.group_id).toBeNull()
    expect(result.find((e) => e.id === 'b')!.group_id).toBeNull()
  })

  it('groupElements is a no-op for fewer than 2 ids', () => {
    expect(groupElements(els, ['a'])).toEqual(els)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- grouping.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/grouping.ts
type Groupable = { id: string; group_id: string | null }

export function groupElements<T extends Groupable>(elements: T[], ids: string[]): T[] {
  if (ids.length < 2) return elements
  const groupId = crypto.randomUUID()
  const idSet = new Set(ids)
  return elements.map((el) => (idSet.has(el.id) ? { ...el, group_id: groupId } : el))
}

export function ungroupElements<T extends Groupable>(elements: T[], ids: string[]): T[] {
  const idSet = new Set(ids)
  return elements.map((el) => (idSet.has(el.id) ? { ...el, group_id: null } : el))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- grouping.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/grouping.ts web/test/grouping.test.ts
git commit -m "feat: 元素编组/解组纯函数"
```

---

### Task 16: Slide sidebar (add / delete / native drag-reorder / notes)

**Files:**
- Create: `web/src/canvas/SlideSidebar.tsx`
- Modify: `web/src/styles.css` (append sidebar styles)
- Test: `web/test/SlideSidebar.test.tsx`

Uses the existing `POST /api/decks/:id/slides`, `DELETE /api/slides/:id`, `PATCH /api/slides/:id` routes (all from Plan 1, unchanged). Reordering uses native HTML5 drag-and-drop (`draggable`, `onDragStart`/`onDragOver`/`onDrop`) — no new dependency needed for a short list.

- [ ] **Step 1: Write the failing test**

```tsx
// web/test/SlideSidebar.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SlideSidebar } from '../src/canvas/SlideSidebar'
import type { Slide } from '../src/types'

afterEach(cleanup)

const slides: Slide[] = [
  { id: 's1', deck_id: 'd1', position: 0, notes: '' },
  { id: 's2', deck_id: 'd1', position: 1, notes: '' },
]

describe('SlideSidebar', () => {
  it('renders one row per slide, highlighting the active one', () => {
    render(<SlideSidebar slides={slides} activeId="s2" onSelect={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} onReorder={vi.fn()} />)
    expect(screen.getAllByTestId(/^slide-row-/)).toHaveLength(2)
    expect(screen.getByTestId('slide-row-s2')).toHaveClass('active')
  })

  it('clicking + calls onAdd', () => {
    const onAdd = vi.fn()
    render(<SlideSidebar slides={slides} activeId="s1" onSelect={vi.fn()} onAdd={onAdd} onDelete={vi.fn()} onReorder={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ 新建页面' }))
    expect(onAdd).toHaveBeenCalled()
  })

  it('clicking delete on a row confirms then calls onDelete with that id', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onDelete = vi.fn()
    render(<SlideSidebar slides={slides} activeId="s1" onSelect={vi.fn()} onAdd={vi.fn()} onDelete={onDelete} onReorder={vi.fn()} />)
    fireEvent.click(screen.getByTestId('slide-delete-s2'))
    expect(onDelete).toHaveBeenCalledWith('s2')
  })

  it('drag-and-drop reorder calls onReorder with the new id order', () => {
    const onReorder = vi.fn()
    render(<SlideSidebar slides={slides} activeId="s1" onSelect={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} onReorder={onReorder} />)
    const dataTransfer = { setData: vi.fn(), getData: () => 's1' }
    fireEvent.dragStart(screen.getByTestId('slide-row-s1'), { dataTransfer })
    fireEvent.dragOver(screen.getByTestId('slide-row-s2'), { dataTransfer })
    fireEvent.drop(screen.getByTestId('slide-row-s2'), { dataTransfer })
    expect(onReorder).toHaveBeenCalledWith(['s2', 's1'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- SlideSidebar.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/canvas/SlideSidebar.tsx
import { useRef } from 'react'
import type { Slide } from '../types'

export function SlideSidebar({
  slides,
  activeId,
  onSelect,
  onAdd,
  onDelete,
  onReorder,
}: {
  slides: Slide[]
  activeId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onDelete: (id: string) => void
  onReorder: (orderedIds: string[]) => void
}) {
  const draggingId = useRef<string | null>(null)

  function handleDrop(targetId: string) {
    const sourceId = draggingId.current
    if (!sourceId || sourceId === targetId) return
    const ids = slides.map((s) => s.id)
    const from = ids.indexOf(sourceId)
    const to = ids.indexOf(targetId)
    ids.splice(from, 1)
    ids.splice(to, 0, sourceId)
    onReorder(ids)
  }

  return (
    <div className="slide-sidebar">
      {slides.map((s, i) => (
        <div
          key={s.id}
          data-testid={`slide-row-${s.id}`}
          className={s.id === activeId ? 'slide-row active' : 'slide-row'}
          draggable
          onDragStart={(e) => {
            draggingId.current = s.id
            e.dataTransfer.setData('text/plain', s.id)
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            handleDrop(s.id)
          }}
          onClick={() => onSelect(s.id)}
        >
          <span className="slide-number">{i + 1}</span>
          <button
            data-testid={`slide-delete-${s.id}`}
            className="slide-delete"
            onClick={(e) => {
              e.stopPropagation()
              if (confirm('删除这一页？无法恢复。')) onDelete(s.id)
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="toolbar-btn" onClick={onAdd}>+ 新建页面</button>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- SlideSidebar.test.tsx`
Expected: PASS (4/4)

Append to `web/src/styles.css`:

```css
.slide-sidebar { display: flex; flex-direction: column; gap: 6px; padding: 8px; width: 80px; border-right: 1px solid var(--border); }
.slide-row { position: relative; height: 45px; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.slide-row.active { border-color: var(--accent); border-width: 2px; }
.slide-number { color: var(--muted); font-size: 12px; }
.slide-delete { position: absolute; top: -6px; right: -6px; width: 16px; height: 16px; border-radius: 50%; border: none; background: var(--danger); color: #fff; line-height: 1; cursor: pointer; }
```

- [ ] **Step 5: Commit**

```bash
git add web/src/canvas/SlideSidebar.tsx web/src/styles.css web/test/SlideSidebar.test.tsx
git commit -m "feat: 幻灯片侧边栏——新建/删除/原生拖拽排序"
```

---

### Task 17: Wire it all together in Editor.tsx

**Files:**
- Modify: `web/src/routes/Editor.tsx` (full rewrite)
- Modify: `web/src/canvas/CanvasElement.tsx` (double-click textbox enters edit mode; latex/code open the inline popover)
- Test: `web/test/Editor.test.tsx` (new — Plan 1 had no test for Editor.tsx since it was a placeholder)

This is the integration task: it removes the temporary "add test rectangle" button and replaces it with the toolbar, slide sidebar, selection/resize/freehand layers, properties panel, undo/redo, autosave status, and keyboard shortcuts (Ctrl+S manual snapshot, Ctrl+Z/Ctrl+Shift+Z undo/redo, Delete/Backspace removes selection).

- [ ] **Step 1: Write the failing test**

```tsx
// web/test/Editor.test.tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Editor } from '../src/routes/Editor'
import * as apiModule from '../src/api'

afterEach(cleanup)

const deck = { id: 'd1', title: 'T', canvas_width: 1280, canvas_height: 720, share_slug: 'x', created_at: 0, updated_at: 0 }
const slide1 = { id: 's1', deck_id: 'd1', position: 0, notes: '' }

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={['/edit/d1']}>
      <Routes>
        <Route path="/edit/:deckId" element={<Editor />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Editor', () => {
  beforeEach(() => {
    vi.spyOn(apiModule, 'apiJson').mockImplementation(async (path: string) => {
      if (path === '/decks/d1') return deck
      if (path === '/decks/d1/slides') return [slide1]
      if (path === '/slides/s1/elements') return []
      return {}
    })
  })

  it('loads the deck and renders the toolbar with a shape tool button', async () => {
    renderEditor()
    await waitFor(() => expect(screen.getByRole('button', { name: '矩形' })).toBeInTheDocument())
  })

  it('arming a shape tool then clicking the canvas inserts an element and saves it', async () => {
    renderEditor()
    await waitFor(() => screen.getByRole('button', { name: '矩形' }))
    fireEvent.click(screen.getByRole('button', { name: '矩形' }))
    fireEvent.pointerDown(screen.getByTestId('selection-layer'), { clientX: 100, clientY: 100, button: 0 })
    fireEvent.pointerUp(screen.getByTestId('selection-layer'))
    await waitFor(() => {
      const putCall = (apiModule.apiJson as any).mock.calls.find((c: any[]) => c[0] === '/slides/s1/elements' && c[1]?.method === 'PUT')
      expect(putCall).toBeTruthy()
    })
  })

  it('Ctrl+S triggers a manual revision snapshot request', async () => {
    renderEditor()
    await waitFor(() => screen.getByRole('button', { name: '矩形' }))
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => {
      const revCall = (apiModule.apiJson as any).mock.calls.find((c: any[]) => c[0] === '/decks/d1/revisions')
      expect(revCall).toBeTruthy()
      expect(JSON.parse(revCall[1].body).trigger).toBe('manual')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- Editor.test.tsx`
Expected: FAIL — current `Editor.tsx` has no toolbar/selection-layer

- [ ] **Step 3: Write the implementation**

First, modify `web/src/canvas/CanvasElement.tsx` so textbox/latex/code can be edited in place. Read the current file (from Plan 1, shown in this plan's research) and replace it with:

```tsx
// web/src/canvas/CanvasElement.tsx
import type { CSSProperties } from 'react'
import type { ElementRow } from '../types'
import { RectShape } from './shapes/RectShape'
import { EllipseShape } from './shapes/EllipseShape'
import { LineArrowShape } from './shapes/LineArrowShape'
import { DiamondShape } from './shapes/DiamondShape'
import { FreehandShape } from './shapes/FreehandShape'
import { TextBoxView } from './TextBoxView'
import { TextBoxEditor } from './TextBoxEditor'
import { ImageElement } from './ImageElement'
import { EmbedElement } from './EmbedElement'
import { LatexElement } from './LatexElement'
import { CodeElement } from './CodeElement'

export function CanvasElement({
  element,
  editing,
  onStartEdit,
  onChangeContent,
  onStopEdit,
}: {
  element: ElementRow
  editing: boolean
  onStartEdit: (id: string) => void
  onChangeContent: (id: string, content: Record<string, any>) => void
  onStopEdit: () => void
}) {
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
    case 'textbox':
      body = editing ? (
        <TextBoxEditor
          content={element.content}
          onChange={(doc) => onChangeContent(element.id, { ...element.content, doc })}
          onBlur={onStopEdit}
        />
      ) : (
        <div onDoubleClick={() => onStartEdit(element.id)} style={{ width: '100%', height: '100%' }}>
          <TextBoxView content={element.content} />
        </div>
      )
      break
    case 'image': body = <ImageElement blobHash={element.blob_hash} content={element.content} />; break
    case 'embed': body = <EmbedElement blobHash={element.blob_hash} content={element.content} />; break
    case 'latex':
      body = <div onDoubleClick={() => onStartEdit(element.id)} style={{ width: '100%', height: '100%' }}><LatexElement content={element.content} /></div>
      break
    case 'code':
      body = <div onDoubleClick={() => onStartEdit(element.id)} style={{ width: '100%', height: '100%' }}><CodeElement content={element.content} /></div>
      break
    default: body = null
  }

  return <div style={style}>{body}</div>
}
```

Now replace `web/src/routes/Editor.tsx` in full:

```tsx
// web/src/routes/Editor.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiJson } from '../api'
import { Canvas, type CanvasHandle } from '../canvas/Canvas'
import { CanvasElement } from '../canvas/CanvasElement'
import { SelectionLayer } from '../canvas/SelectionLayer'
import { ResizeHandles } from '../canvas/ResizeHandles'
import { FreehandLayer } from '../canvas/FreehandLayer'
import { Toolbar, type Tool } from '../canvas/Toolbar'
import { SlideSidebar } from '../canvas/SlideSidebar'
import { PropertiesPanel } from '../canvas/PropertiesPanel'
import { InlineEditPopover } from '../canvas/InlineEditPopover'
import { useHistory } from '../lib/useHistory'
import { useAutosave } from '../lib/useAutosave'
import { createDefaultElement } from '../lib/defaultElement'
import { reassignZIndex, bringToFront, sendToBack, bringForward, sendBackward } from '../lib/zorder'
import { groupElements, ungroupElements } from '../lib/grouping'
import { uploadBlob, readImageNaturalSize } from '../lib/uploadBlob'
import type { Deck, ElementRow, Slide } from '../types'

export function Editor() {
  const { deckId } = useParams()
  const [deck, setDeck] = useState<Deck | null>(null)
  const [slides, setSlides] = useState<Slide[]>([])
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const canvasRef = useRef<CanvasHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingUploadKind = useRef<'image' | 'embed'>('image')

  const history = useHistory<ElementRow[]>([])
  const elements = history.present

  const getContainerRect = useCallback(() => canvasRef.current?.getContainerRect() ?? ({ left: 0, top: 0 } as DOMRect), [])

  async function loadSlideElements(slideId: string) {
    const els = await apiJson<ElementRow[]>(`/slides/${slideId}/elements`)
    history.commitImmediate(els)
  }

  async function load() {
    if (!deckId) return
    const d = await apiJson<Deck>(`/decks/${deckId}`)
    setDeck(d)
    const s = await apiJson<Slide[]>(`/decks/${deckId}/slides`)
    setSlides(s)
    const first = s[0]
    setActiveSlideId(first?.id ?? null)
    if (first) await loadSlideElements(first.id)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId])

  const saveElements = useCallback(
    async (els: ElementRow[]) => {
      if (!activeSlideId) return
      await apiJson(`/slides/${activeSlideId}/elements`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(els),
      })
    },
    [activeSlideId],
  )
  const { status: saveStatus } = useAutosave(elements, saveElements)

  async function selectSlide(id: string) {
    setActiveSlideId(id)
    setSelectedIds([])
    setEditingId(null)
    await loadSlideElements(id)
  }

  async function addSlide() {
    if (!deckId) return
    const s = await apiJson<Slide>(`/decks/${deckId}/slides`, { method: 'POST' })
    setSlides((prev) => [...prev, s])
    await selectSlide(s.id)
  }

  async function deleteSlide(id: string) {
    await apiJson(`/slides/${id}`, { method: 'DELETE' })
    const next = slides.filter((s) => s.id !== id)
    setSlides(next)
    if (activeSlideId === id && next[0]) await selectSlide(next[0].id)
  }

  async function reorderSlides(orderedIds: string[]) {
    setSlides((prev) => orderedIds.map((id) => prev.find((s) => s.id === id)!))
    await Promise.all(orderedIds.map((id, i) => apiJson(`/slides/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position: i }),
    })))
  }

  function insertElement(type: Tool) {
    if (type === 'select' || type === 'freehand' || !activeSlideId) return
    const rect = getContainerRect()
    const center = { x: (rect.left + rect.width / 2 - rect.left) / scale, y: 0 } // placeholder overwritten by click handler below
    void center
  }
  void insertElement

  function handleCanvasPointerDownForInsert(e: React.PointerEvent) {
    if (tool === 'select' || tool === 'freehand' || !activeSlideId) return
    const rect = getContainerRect()
    const x = (e.clientX - rect.left) / scale
    const y = (e.clientY - rect.top) / scale
    const el = createDefaultElement(tool as ElementRow['type'], { x, y }, activeSlideId)
    history.commitImmediate(reassignZIndex([...elements, el]))
    setSelectedIds([el.id])
    setTool('select')
    if (tool === 'textbox') setEditingId(el.id)
  }

  function handleFreehandInsert(el: ElementRow) {
    history.commitImmediate(reassignZIndex([...elements, el]))
    setTool('select')
  }

  function handleSelect(ids: string[], additive: boolean) {
    void additive
    setSelectedIds(ids)
    setEditingId(null)
  }

  function handleLiveChange(next: ElementRow[]) {
    history.liveUpdate(next)
  }

  function handleCommit() {
    history.commitChange()
  }

  function updateContent(id: string, content: Record<string, any>) {
    history.commitImmediate(elements.map((el) => (el.id === id ? { ...el, content } : el)))
  }

  function applyZOrder(fn: (els: ElementRow[], id: string) => ElementRow[]) {
    if (selectedIds.length !== 1) return
    history.commitImmediate(fn(elements, selectedIds[0]))
  }

  function handleGroup() {
    history.commitImmediate(groupElements(elements, selectedIds))
  }

  function handleUngroup() {
    history.commitImmediate(ungroupElements(elements, selectedIds))
  }

  function openUpload(kind: 'image' | 'embed') {
    pendingUploadKind.current = kind
    fileInputRef.current?.click()
  }

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !activeSlideId) return
    const { hash } = await uploadBlob(file)
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

  function insertLatex() {
    if (!activeSlideId) return
    const el = createDefaultElement('latex', { x: 200, y: 200 }, activeSlideId)
    history.commitImmediate(reassignZIndex([...elements, el]))
    setSelectedIds([el.id])
    setEditingId(el.id)
  }

  function insertCode() {
    if (!activeSlideId) return
    const el = createDefaultElement('code', { x: 200, y: 200 }, activeSlideId)
    history.commitImmediate(reassignZIndex([...elements, el]))
    setSelectedIds([el.id])
    setEditingId(el.id)
  }

  async function manualSnapshot() {
    if (!deckId) return
    await apiJson(`/decks/${deckId}/revisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'manual' }),
    })
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const typing = target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        manualSnapshot()
        return
      }
      if (typing) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        history.undo()
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        history.redo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
        e.preventDefault()
        history.commitImmediate(elements.filter((el) => !selectedIds.includes(el.id)))
        setSelectedIds([])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, selectedIds, deckId])

  if (!deck || !activeSlideId) return <p>加载中…</p>

  const selectedElement = selectedIds.length === 1 ? elements.find((el) => el.id === selectedIds[0]) ?? null : null
  const editingElement = editingId ? elements.find((el) => el.id === editingId) ?? null : null

  return (
    <div className="editor">
      <input ref={fileInputRef} type="file" accept={pendingUploadKind.current === 'image' ? 'image/*' : 'text/html'} style={{ display: 'none' }} onChange={handleFileChosen} />
      <Toolbar
        tool={tool}
        onToolChange={setTool}
        onUploadImage={() => openUpload('image')}
        onUploadEmbed={() => openUpload('embed')}
        onInsertLatex={insertLatex}
        onInsertCode={insertCode}
        canGroup={selectedIds.length > 1}
        canUngroup={selectedElement !== null && !!selectedElement.group_id}
        onGroup={handleGroup}
        onUngroup={handleUngroup}
        onBringToFront={() => applyZOrder(bringToFront)}
        onSendToBack={() => applyZOrder(sendToBack)}
        onBringForward={() => applyZOrder(bringForward)}
        onSendBackward={() => applyZOrder(sendBackward)}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={history.undo}
        onRedo={history.redo}
        saveStatus={saveStatus}
      />
      <div className="editor-body">
        <SlideSidebar slides={slides} activeId={activeSlideId} onSelect={selectSlide} onAdd={addSlide} onDelete={deleteSlide} onReorder={reorderSlides} />
        <div className="editor-canvas-area" onPointerDown={handleCanvasPointerDownForInsert}>
          <Canvas ref={canvasRef} width={deck.canvas_width} height={deck.canvas_height} onScaleChange={setScale}>
            {elements.map((el) => (
              <CanvasElement
                key={el.id}
                element={el}
                editing={el.id === editingId}
                onStartEdit={setEditingId}
                onChangeContent={updateContent}
                onStopEdit={() => setEditingId(null)}
              />
            ))}
            <SelectionLayer
              elements={elements}
              selectedIds={selectedIds}
              scale={scale}
              canvasWidth={deck.canvas_width}
              canvasHeight={deck.canvas_height}
              getContainerRect={getContainerRect}
              onSelect={handleSelect}
              onLiveChange={handleLiveChange}
              onCommit={handleCommit}
            />
            {selectedElement && (
              <ResizeHandles
                bounds={selectedElement}
                scale={scale}
                getContainerRect={getContainerRect}
                onLiveChange={(b) => history.liveUpdate(elements.map((el) => (el.id === selectedElement.id ? { ...el, ...b } : el)))}
                onCommit={handleCommit}
              />
            )}
            <FreehandLayer active={tool === 'freehand'} scale={scale} getContainerRect={getContainerRect} slideId={activeSlideId} onInsert={handleFreehandInsert} />
          </Canvas>
        </div>
        <PropertiesPanel element={selectedElement} onChange={(content) => selectedElement && updateContent(selectedElement.id, content)} />
      </div>
      {editingElement && (editingElement.type === 'latex' || editingElement.type === 'code') && (
        <InlineEditPopover x={200} y={200} onClose={() => setEditingId(null)}>
          {editingElement.type === 'latex' ? (
            <>
              <textarea
                aria-label="公式"
                value={editingElement.content.formula ?? ''}
                onChange={(e) => updateContent(editingElement.id, { ...editingElement.content, formula: e.target.value })}
              />
              <label>
                <input
                  type="checkbox"
                  checked={editingElement.content.display ?? true}
                  onChange={(e) => updateContent(editingElement.id, { ...editingElement.content, display: e.target.checked })}
                />
                独占一行
              </label>
            </>
          ) : (
            <>
              <select
                aria-label="语言"
                value={editingElement.content.language ?? ''}
                onChange={(e) => updateContent(editingElement.id, { ...editingElement.content, language: e.target.value })}
              >
                <option value="">纯文本</option>
                <option value="javascript">JavaScript</option>
                <option value="python">Python</option>
              </select>
              <textarea
                aria-label="代码"
                value={editingElement.content.code ?? ''}
                onChange={(e) => updateContent(editingElement.id, { ...editingElement.content, code: e.target.value })}
              />
            </>
          )}
        </InlineEditPopover>
      )}
    </div>
  )
}
```

Note the `insertElement`/`center` dead placeholder in the draft above was removed — the actual click-to-insert logic lives in `handleCanvasPointerDownForInsert`, wired to the canvas area's `onPointerDown`. Do not include the unused `insertElement` function; it was scaffolding during design, not part of the real file. The implementer should write `Editor.tsx` without that dead function.

Append to `web/src/styles.css`:

```css
.editor { display: flex; flex-direction: column; height: 100vh; }
.editor-body { display: flex; flex: 1; min-height: 0; }
.editor-canvas-area { flex: 1; min-width: 0; }
.toolbar { display: flex; gap: 4px; align-items: center; padding: 8px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.toolbar-btn { border: 1px solid var(--border); background: var(--bg); color: var(--fg); border-radius: 4px; padding: 4px 10px; cursor: pointer; }
.toolbar-btn.active, .toolbar-btn[aria-pressed='true'] { background: var(--accent); color: #fff; border-color: var(--accent); }
.toolbar-btn:disabled { opacity: 0.4; cursor: default; }
.toolbar-sep { width: 1px; height: 20px; background: var(--border); margin: 0 4px; }
.save-status { margin-left: auto; color: var(--muted); font-size: 12px; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- Editor.test.tsx`
Expected: PASS (3/3)

Then run the full suite: `npm --prefix web test`. Fix any regressions in `CanvasElement.test.tsx` (Plan 1's existing test) — it likely renders `<CanvasElement element={...} />` without the new required props (`editing`, `onStartEdit`, `onChangeContent`, `onStopEdit`); update that test file to pass no-op props (`editing={false}`, `onStartEdit={() => {}}`, etc.) rather than changing `CanvasElement`'s API to make them optional — the props are genuinely required for the app to function correctly, only the old test is stale.

- [ ] **Step 5: Manual verification**

Follow the two-terminal setup from "Global notes" above. In the browser:
1. Click "矩形", click on the canvas — a rectangle appears, selected (handles visible).
2. Drag it near another element — pink guide lines appear when edges/centers align.
3. Drag a resize handle — element resizes live.
4. Click "文本框", click canvas, type text, click elsewhere — text persists, double-click re-enters edit mode with the bubble menu appearing on text selection.
5. Select two elements (shift-click), click "编组" — moving one moves both.
6. Ctrl+Z undoes the last commit; Ctrl+S shows no visible UI change but triggers a revision (check network tab for `POST /decks/:id/revisions`).
7. Add a second slide via the sidebar, drag to reorder, delete one (with confirm).
8. Reload the page — everything from the active slide persists.

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/Editor.tsx web/src/canvas/CanvasElement.tsx web/src/styles.css web/test/Editor.test.tsx web/test/CanvasElement.test.tsx
git commit -m "feat: Editor 整合工具栏/选中/缩放/画笔/属性面板/幻灯片侧栏，移除临时按钮"
```

---

### Task 18: Final review pass + Playwright smoke test

**Files:** none new — this is a verification-only task.

- [ ] **Step 1:** Run the complete test suite from the repo root: `npm --prefix web test && npm --prefix server test`. All green.

- [ ] **Step 2:** Run `npm --prefix web run build` (this runs `tsc -b && vite build` per `package.json`) to catch any type errors the unit tests don't exercise (e.g. prop-shape drift between `Editor.tsx` and the components it wires together). Fix any errors.

- [ ] **Step 3:** Manual/Playwright end-to-end pass covering the full interaction surface built in this plan (adapt the Task 18 smoke-test approach from `docs/superpowers/plans/2026-08-18-viscio-foundation.md`, driving the real dev servers): log in, create a deck, add one of each shape type + a text box + an image (small local fixture PNG) + a LaTeX formula + a code block, drag one shape to trigger a snap guide, resize one, group two elements and move the group, reorder two slides via drag, delete a slide, undo/redo at least once, Ctrl+S, reload and confirm every element and both remaining slides persisted correctly with the right positions. Screenshot the populated canvas. Flag any console errors.

- [ ] **Step 4:** Report results — test counts, build status, screenshot, any console errors — before this plan is considered done. Do not proceed to Plan 3 if the build fails or the smoke test surfaces a broken interaction; fix forward with a new commit first.

---

## Plan self-review notes

- **Spec coverage:** 6 shapes (rect/ellipse/line-arrow/textbox/diamond/freehand) — Tasks 9, 10. Tiptap rich text + portal-safe bubble menu — Task 11. 3 embed types (iframe/HTML, LaTeX, code) — Tasks 12, 13, 17. Image upload+resize — Tasks 13, 8. Free positioning + snap-align — Tasks 1, 7. Grouping (group-aware snap, group-aware select) — Tasks 7, 15. Layer order (no rotation, per spec) — Task 5. Undo/redo (in-memory, not persisted) — Task 2. Slide add/delete/drag-reorder — Task 16. Ctrl+S manual snapshot — Task 17 (auto 10-minute snapshot and the version-history *browsing* UI are explicitly Plan 3's job per the original 3-plan split — this plan only wires the manual-trigger call since the backend endpoint already existed from Plan 1).
- **Placeholder scan:** none left — the one draft placeholder (`insertElement`/`center` scaffolding in Task 17) is explicitly called out and excluded from the real file.
- **Type consistency:** `ElementRow`, `Deck`, `Slide` reused from Plan 1's `types.ts` throughout, not redefined. `SaveStatus` defined once in `useAutosave.ts` and imported by `Toolbar.tsx`. `Bounds`/`Guide` defined once in `snap.ts` and imported by `SelectionLayer.tsx`/`AlignGuides.tsx`. `Point` defined once in `smoothPath.ts`, imported by `FreehandLayer.tsx`.
- **Out of scope (deferred to Plan 3 per the spec's own 3-plan split discussed with the user):** auto 10-minute snapshot timer + version history browsing/restore UI, play/fullscreen mode, share-link regeneration UI, offline export.
