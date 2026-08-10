import { useRef, useState } from 'react'

// 圆形调色盘：色相绕一圈，越靠圆心越淡。亮度用下面的细长条，也可以直接输 #rrggbb。
// 盘面是两层 CSS 渐变叠出来的，取色靠极坐标算，不需要 canvas 或额外依赖。

// h 0–360, s 与 l 都是百分数。注意 l 必须先归一到 0–1 再参与 min(l, 1-l)，
// 否则 min(85, -84) 会让整个算式变负，输出 '#-130d...' 这种非法颜色。
export function hslToHex(h: number, s: number, lPct: number) {
  const l = lPct / 100
  const a = (s * Math.min(l, 1 - l)) / 100
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

export function ColorWheel({ value, onPick, onClose }: {
  value: string
  onPick: (hex: string) => void
  onClose: () => void
}) {
  const [light, setLight] = useState(50)
  const [hex, setHex] = useState(value)
  const wheel = useRef<HTMLDivElement>(null)

  function pickAt(e: React.PointerEvent) {
    const r = wheel.current!.getBoundingClientRect()
    const x = e.clientX - r.left - r.width / 2
    const y = e.clientY - r.top - r.height / 2
    const radius = r.width / 2
    const dist = Math.min(Math.hypot(x, y) / radius, 1)
    const hue = (Math.atan2(y, x) * 180) / Math.PI + 90
    const c = hslToHex((hue + 360) % 360, Math.round(dist * 100), light)
    setHex(c)
    onPick(c)
  }

  return (
    <div className="wheel-pop" onMouseLeave={onClose}>
      <div className="wheel" ref={wheel}
        onPointerDown={pickAt}
        onPointerMove={e => { if (e.buttons) pickAt(e) }}
        style={{ filter: `brightness(${(light / 50).toFixed(2)})` }} />

      <input className="wheel-light" type="range" min={15} max={85} value={light}
        title="Lightness"
        onChange={e => {
          const l = Number(e.target.value)
          setLight(l)
          // 保持当前色相与饱和度，只改亮度
          const m = hex.match(/^#(\w{2})(\w{2})(\w{2})$/)
          if (!m) return
          const [r, g, b] = m.slice(1).map(v => parseInt(v, 16) / 255)
          const max = Math.max(r, g, b), min = Math.min(r, g, b)
          const d = max - min
          let h = 0
          if (d) {
            h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
            h *= 60
          }
          const s = d ? Math.round((d / (1 - Math.abs(max + min - 1))) * 100) : 0
          const c = hslToHex((h + 360) % 360, s, l)
          setHex(c)
          onPick(c)
        }} />

      <div className="wheel-preview">
        <i style={{ background: /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : 'transparent' }} />
        <span>{hex}</span>
      </div>

      <input className="wheel-hex" value={hex} spellCheck={false} aria-label="Hex colour"
        onChange={e => {
          const v = e.target.value.trim()
          setHex(v)
          if (/^#[0-9a-fA-F]{6}$/.test(v)) onPick(v)
        }} />
    </div>
  )
}
