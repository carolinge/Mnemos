import '@testing-library/jest-dom'

// jsdom 环境缺 localStorage 时补一个内存实现（仅测试用）
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>()
  const shim = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true })
  Object.defineProperty(globalThis.window ?? {}, 'localStorage', { value: shim, configurable: true })
}
