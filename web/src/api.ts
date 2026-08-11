export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`api ${status}`)
  }
}

export const onUnauthorized = new Set<() => void>()

// 服务器闲置时会休眠，第一次请求要等它冷启动（实测约 7 秒）。
// 期间 fetch 就那么挂着，界面上什么都没有，按钮看起来像坏了——
// 所以超过这个时间就明确告诉用户「正在唤醒」，并且失败自动重试，
// 不必手动刷新页面。
const WAKING_AFTER_MS = 1200
const RETRIES = 2

let inFlight = 0
function setWaking(on: boolean) {
  window.dispatchEvent(new CustomEvent('parchment:waking', { detail: on }))
}

// 生产环境挂在主站的 /mnemos 下（见 vite.config.ts 的 base），本地开发仍在根路径——
// import.meta.env.BASE_URL 会跟着 base 一起变。fetch() 走这里统一加前缀；
// 导出菜单那几个裸 <a href> 不经过 fetch，得自己 import 这个常量来拼。
export const API_PREFIX = import.meta.env.BASE_URL.replace(/\/$/, '')

async function fetchWithWake(path: string, init?: RequestInit): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    inFlight++
    const slow = setTimeout(() => setWaking(true), WAKING_AFTER_MS)
    try {
      return await fetch(API_PREFIX + path, init)
    } catch (e) {
      lastErr = e                     // 网络层失败：机器可能正在起来，缓一下重试
      if (attempt < RETRIES) await new Promise(r => setTimeout(r, 800 * (attempt + 1)))
    } finally {
      clearTimeout(slow)
      if (--inFlight === 0) setWaking(false)
    }
  }
  throw lastErr
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithWake(path, {
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
  const res = await fetchWithWake('/api/images', { method: 'POST', body: fd })
  if (res.status === 401) { onUnauthorized.forEach(f => f()); throw new ApiError(401, null) }
  if (!res.ok) throw new ApiError(res.status, null)
  return (await res.json()).url
}
