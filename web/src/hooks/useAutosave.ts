import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { setSaveStatus, type SaveState } from '../saveStatus'

export interface EntryData {
  id: string; day: string; position: number; version: number
  content: unknown; created_at: string; updated_at: string
  text?: string
  tags: { id: string; name: string; color: string }[]
}

interface Opts {
  entryId: string | null
  day: string
  version: number
  draftKey: string
  getPayload: () => { content?: unknown; tags?: string[] }
  onCreated?: (e: EntryData) => void
  onSaved?: (e: EntryData) => void
}

const DEBOUNCE_MS = 1000
const RETRY_BASE_MS = 2000
const RETRY_MAX_MS = 30000

export function useAutosave(opts: Opts) {
  const idRef = useRef(opts.entryId)
  const versionRef = useRef(opts.version)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const retryMs = useRef(RETRY_BASE_MS)
  const creating = useRef(false)
  const again = useRef(false)
  const [status, setLocal] = useState<SaveState>('saved')
  const optsRef = useRef(opts)
  optsRef.current = opts

  const key = `draft:${opts.draftKey}`

  function setStatus(s: SaveState) {
    setLocal(s)
    setSaveStatus(optsRef.current.draftKey, s === 'saved' ? null : s)
  }

  async function save() {
    const payload = optsRef.current.getPayload()
    if (!idRef.current) {
      if (creating.current) { again.current = true; return }
      creating.current = true
      try {
        const e = await api<EntryData>('/api/entries', {
          method: 'POST',
          body: JSON.stringify({ day: optsRef.current.day, ...payload }),
        })
        idRef.current = e.id
        versionRef.current = e.version
        localStorage.removeItem(key)
        retryMs.current = RETRY_BASE_MS
        setStatus('saved')
        optsRef.current.onCreated?.(e)
        if (again.current) { again.current = false; void save() }
      } catch (err) {
        handleErr(err)
      } finally {
        creating.current = false
      }
      return
    }
    try {
      const e = await api<EntryData>(`/api/entries/${idRef.current}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...payload, version: versionRef.current }),
      })
      versionRef.current = e.version
      localStorage.removeItem(key)
      retryMs.current = RETRY_BASE_MS
      setStatus('saved')
      optsRef.current.onSaved?.(e)
    } catch (err) {
      handleErr(err)
    }
  }

  function handleErr(err: unknown) {
    if (err instanceof ApiError && err.status === 409) {
      setStatus('conflict')   // 停止重试，等用户刷新
      return
    }
    setStatus('offline')
    clearTimeout(timer.current)
    timer.current = setTimeout(save, retryMs.current)
    retryMs.current = Math.min(retryMs.current * 2, RETRY_MAX_MS)
  }

  function schedule() {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), payload: optsRef.current.getPayload() }))
    setStatus('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(save, DEBOUNCE_MS)
  }

  useEffect(() => {
    if (localStorage.getItem(key)) schedule()   // 上次断网留下的草稿，补发
    return () => {
      clearTimeout(timer.current)
      setSaveStatus(optsRef.current.draftKey, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { status, schedule, flush: save, entryIdRef: idRef }
}
