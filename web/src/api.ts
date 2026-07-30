export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`api ${status}`)
  }
}

export const onUnauthorized = new Set<() => void>()

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
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
  const res = await fetch('/api/images', { method: 'POST', body: fd })
  if (res.status === 401) { onUnauthorized.forEach(f => f()); throw new ApiError(401, null) }
  if (!res.ok) throw new ApiError(res.status, null)
  return (await res.json()).url
}
