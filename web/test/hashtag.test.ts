import { describe, it, expect } from 'vitest'
import { TAG_RE, parseTag } from '../src/editor/Hashtag'

describe('hashtag 规则', () => {
  const hits: [string, string][] = [
    ['#钙钛矿 ', '钙钛矿'],
    ['前文 #graphene ', 'graphene'],
    ['#双-连_字.符 ', '双-连_字.符'],
  ]
  for (const [input, want] of hits) {
    it(`识别 "${input}" → ${want}`, () => {
      const m = input.match(TAG_RE)
      expect(m).toBeTruthy()
      expect(parseTag(m!)).toBe(want)
    })
  }
  const misses = ['# 空格开头 ', '无井号 ', '#还没敲空格']
  for (const s of misses) {
    it(`不识别 "${s}"`, () => expect(s.match(TAG_RE)).toBeNull())
  }
})
