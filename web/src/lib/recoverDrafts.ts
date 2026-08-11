// 断网时写在「还没保存过的新卡片」里的字，会以 draft:new:<uuid> 留在 localStorage。
// 这些键只活在当时那个页面的内存里，刷新之后没有任何组件会再去读它们——内容还在，
// 但永远看不见。启动时把它们直接补传成正式条目，是最短的一条修复路径：
// 不用重建撰写中卡片，也就不牵扯时间流的分页游标、滚动位置和 StrictMode 双跑。

const PREFIX = 'draft:new:'

export interface OrphanDraft {
  key: string
  day: string
  content: unknown
  task?: string | null
}

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

const dayFromTimestamp = (at: unknown): string => {
  const d = new Date(typeof at === 'number' ? at : Date.now())
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 正文是不是真的有字。空文档不值得补传，否则每次启动都会冒出空卡片。
export function hasText(content: unknown): boolean {
  const walk = (n: any): boolean => {
    if (!n || typeof n !== 'object') return false
    if (typeof n.text === 'string' && n.text.trim()) return true
    if (n.type === 'image' || n.type === 'citation' || n.type === 'htmlEmbed') return true
    if (n.type === 'mermaidBlock' && String(n.attrs?.code ?? '').trim()) return true
    return Array.isArray(n.content) && n.content.some(walk)
  }
  return walk(content)
}

export function listOrphanDrafts(store: Storage = localStorage): OrphanDraft[] {
  const out: OrphanDraft[] = []
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (!key?.startsWith(PREFIX)) continue
    try {
      const rec = JSON.parse(store.getItem(key) || '')
      const content = rec?.payload?.content
      if (!hasText(content)) continue
      out.push({
        key,
        // 老草稿没记日期，退而用最后一次打字的时间。可能落在今天而不是原本那一天，
        // 但内容不丢，日期标头点一下就能改。
        day: isDay(rec?.day) ? rec.day : dayFromTimestamp(rec?.at),
        content,
        task: rec?.payload?.task ?? null,
      })
    } catch { /* 草稿损坏就跳过，绝不因为解析失败而删掉它 */ }
  }
  return out
}

// 逐条补传。成功才删草稿；失败原样留着，下次启动或恢复联网时再试。
export async function recoverDrafts(
  post: (body: { day: string; content: unknown; task?: string | null }) => Promise<unknown>,
  store: Storage = localStorage,
): Promise<{ recovered: number; days: string[]; failed: number }> {
  const drafts = listOrphanDrafts(store)
  const days = new Set<string>()
  let recovered = 0
  let failed = 0

  for (const d of drafts) {
    try {
      await post({ day: d.day, content: d.content, task: d.task })
      store.removeItem(d.key)
      days.add(d.day)
      recovered++
    } catch {
      failed++
    }
  }
  return { recovered, days: [...days].sort(), failed }
}
