import { describe, it, expect } from 'vitest'
import { pickImageFiles } from '../src/editor/pasteRules'

function fakeFile(type: string, name = 'f') { return new File([new Uint8Array([1])], name, { type }) }

describe('pickImageFiles', () => {
  it('过滤出图片文件', () => {
    const files = [fakeFile('image/png'), fakeFile('text/plain'), fakeFile('image/jpeg')]
    expect(pickImageFiles(files).map(f => f.type)).toEqual(['image/png', 'image/jpeg'])
  })
  it('无图片返回空数组', () => {
    expect(pickImageFiles([fakeFile('application/pdf')])).toEqual([])
  })
})

import { choosePaste } from '../src/editor/pasteRules'

describe('粘贴走哪条路', () => {
  const DOC = '<!DOCTYPE html><html><body><canvas id="c"></canvas><script>draw()</script></body></html>'

  it('整份 HTML 文档优先按源码嵌入，即使剪贴板同时带 text/html', () => {
    // 从代码视图复制时，浏览器往往两种格式都给；带高亮的那份不能当正文粘
    const styled = '<pre><code><span style="color:#a11">&lt;!DOCTYPE html&gt;</span></code></pre>'
    expect(choosePaste(DOC, styled)).toBe('embed-source')
    expect(choosePaste(DOC, '')).toBe('embed-source')
  })

  it('渲染出来的交互内容仍按 html 嵌入', () => {
    expect(choosePaste('some text', '<div><script>go()</script></div>')).toBe('embed-html')
  })

  it('普通带格式的文字照旧走可编辑正文', () => {
    expect(choosePaste('hello', '<p>hello <b>world</b></p>')).toBe('default')
  })

  it('文献链接优先于一切', () => {
    expect(choosePaste('https://doi.org/10.1038/s41586-024-07123-7', '<p>x</p>')).toBe('citation')
  })
})
