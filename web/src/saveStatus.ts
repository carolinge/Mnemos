import { useSyncExternalStore } from 'react'

export type SaveState = 'saved' | 'saving' | 'offline' | 'conflict'
const RANK: SaveState[] = ['saved', 'saving', 'offline', 'conflict']

const statuses = new Map<string, SaveState>()
const subs = new Set<() => void>()

export function setSaveStatus(id: string, s: SaveState | null) {
  if (s === null) statuses.delete(id)
  else statuses.set(id, s)
  subs.forEach(f => f())
}

export function worstStatus(): SaveState {
  let worst: SaveState = 'saved'
  for (const s of statuses.values()) {
    if (RANK.indexOf(s) > RANK.indexOf(worst)) worst = s
  }
  return worst
}

export function useGlobalSaveStatus(): SaveState {
  return useSyncExternalStore(
    cb => { subs.add(cb); return () => subs.delete(cb) },
    worstStatus,
  )
}
