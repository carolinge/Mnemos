import { describe, it, expect } from 'vitest'
import { classifyHtml, looksLikeHtmlSource } from '../src/editor/pasteRules'

describe('classifyHtml', () => {
  const content: [string, string][] = [
    ['纯段落', '<p>你好<strong>世界</strong></p>'],
    ['gdocs 风格行内样式', '<span style="font-weight:700">加粗</span><p style="margin:0">正文</p>'],
    ['表格', '<table><tr><td>a</td><td>b</td></tr></table>'],
    ['标题列表', '<h2>题</h2><ul><li>一</li></ul>'],
  ]
  const embed: [string, string][] = [
    ['带 script 的 artifact', '<div id="app"></div><script>render()</script>'],
    ['带 style 块', '<style>.x{color:red}</style><div class="x">彩</div>'],
    ['canvas 图表', '<canvas id="chart"></canvas>'],
    ['iframe', '<iframe src="https://x"></iframe>'],
    ['内联事件', '<button onclick="go()">点</button>'],
    ['外链样式表', '<link rel="stylesheet" href="a.css"><div>x</div>'],
  ]
  for (const [name, html] of content) it(`内容型：${name}`, () => expect(classifyHtml(html)).toBe('content'))
  for (const [name, html] of embed) it(`嵌入型：${name}`, () => expect(classifyHtml(html)).toBe('embed'))
})

describe('looksLikeHtmlSource（纯文本粘贴的 HTML 源码识别）', () => {
  const yes = ['<!doctype html><html>…', '<div class="card">x</div>', '  <svg viewBox="0 0 1 1"></svg>']
  const no = ['a < b 且 c > d', '普通文字', '2 <3> 4']
  for (const s of yes) it(`✓ ${s.slice(0, 24)}`, () => expect(looksLikeHtmlSource(s)).toBe(true))
  for (const s of no) it(`✗ ${s}`, () => expect(looksLikeHtmlSource(s)).toBe(false))
})
