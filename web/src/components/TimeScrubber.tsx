import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { todayStr } from '../lib/groupDays'

const MS_DAY = 86400000
const toMs = (d: string) => new Date(d + 'T00:00:00Z').getTime()
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function fracToDay(frac: number, first: string, last: string): string {
  const a = toMs(first), b = toMs(last)
  const ms = a + Math.round(((b - a) * Math.min(Math.max(frac, 0), 1)) / MS_DAY) * MS_DAY
  return toDay(ms)
}

export function snapToNearest(day: string, days: string[]): string {
  if (!days.length) return day
  const t = toMs(day)
  let best = days[0], bestDist = Infinity
  for (const d of days) {
    const dist = Math.abs(toMs(d) - t)
    if (dist < bestDist) { best = d; bestDist = dist }
  }
  return best
}

export function monthTicks(first: string, last: string): { day: string; frac: number; label: string }[] {
  const a = toMs(first), b = toMs(last)
  if (b <= a) return []
  const out: { day: string; frac: number; label: string }[] = []
  const cur = new Date(a)
  cur.setUTCDate(1); cur.setUTCMonth(cur.getUTCMonth() + 1)
  while (cur.getTime() < b) {
    const day = toDay(cur.getTime())
    out.push({
      day,
      frac: (cur.getTime() - a) / (b - a),
      label: day.slice(5, 7) === '01' ? `${day.slice(0, 4)}年` : `${Number(day.slice(5, 7))}月`,
    })
    cur.setUTCMonth(cur.getUTCMonth() + 1)
  }
  return out
}

export function TimeScrubber({ onJump, refreshKey }: { onJump: (day: string) => void; refreshKey: number }) {
  const [days, setDays] = useState<string[]>([])
  const [drag, setDrag] = useState<{ frac: number; day: string } | null>(null)
  const railRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api<{ day: string; count: number }[]>('/api/days')
      .then(r => setDays(r.map(x => x.day))).catch(() => {})
  }, [refreshKey])

  if (days.length < 2) return null
  const first = days[0], last = todayStr()
  const ticks = monthTicks(first, last)
  const span = Math.max(toMs(last) - toMs(first), 1)

  function fracAt(clientY: number) {
    const rect = railRef.current!.getBoundingClientRect()
    return (clientY - rect.top) / rect.height
  }
  function update(clientY: number) {
    const frac = Math.min(Math.max(fracAt(clientY), 0), 1)
    setDrag({ frac, day: snapToNearest(fracToDay(frac, first, last), days) })
  }
  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId)
    update(e.clientY)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (drag) update(e.clientY)
  }
  function onPointerUp() {
    if (drag) onJump(drag.day)
    setDrag(null)
  }

  return (
    <div className="scrubber" ref={railRef}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div className="scrubber-rail" />
      {ticks.map(t => (
        <div key={t.day} className="scrubber-tick" style={{ top: `${t.frac * 100}%` }}>
          <span>{t.label}</span>
        </div>
      ))}
      {days.map(d => (
        <i key={d} className="scrubber-dot" style={{ top: `${((toMs(d) - toMs(first)) / span) * 100}%` }} />
      ))}
      {drag && (
        <div className="scrubber-thumb" style={{ top: `${drag.frac * 100}%` }}>
          <span className="scrubber-label">{drag.day}</span>
        </div>
      )}
    </div>
  )
}
