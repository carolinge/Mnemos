import { describe, it, expect } from 'vitest'
import { hslToHex } from '../src/components/ColorWheel'

describe('hslToHex', () => {
  it('永远输出合法的 #rrggbb', () => {
    for (let h = 0; h < 360; h += 7) {
      for (const s of [0, 33, 66, 100]) {
        for (const l of [15, 30, 50, 70, 85]) {
          expect(hslToHex(h, s, l)).toMatch(/^#[0-9a-f]{6}$/)
        }
      }
    }
  })

  it('已知色值', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000')
    expect(hslToHex(120, 100, 50)).toBe('#00ff00')
    expect(hslToHex(0, 0, 100)).toBe('#ffffff')
    expect(hslToHex(0, 0, 0)).toBe('#000000')
  })

  // 之前 l 没归一，高亮度会算出负数，写进库里就是坏颜色
  it('高亮度不再产生负数分量', () => {
    expect(hslToHex(200, 100, 85)).toMatch(/^#[0-9a-f]{6}$/)
    expect(hslToHex(40, 90, 85)).not.toContain('-')
  })
})
