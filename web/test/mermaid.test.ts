import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/editor/extensions'
import { MERMAID_INPUT_RE } from '../src/editor/MermaidBlock'

describe('mermaid 块', () => {
  it('输入规则正则匹配 ```mermaid + 空白', () => {
    expect('```mermaid '.match(MERMAID_INPUT_RE)).toBeTruthy()
    expect('```python '.match(MERMAID_INPUT_RE)).toBeNull()
  })
  it('节点已注册且可带 code 属性插入', () => {
    const ed = new Editor({ extensions: buildExtensions({}), content: { type: 'doc', content: [] } })
    ed.commands.insertContent({ type: 'mermaidBlock', attrs: { code: 'graph TD; A-->B' } })
    expect(JSON.stringify(ed.getJSON())).toContain('A-->B')
    ed.destroy()
  })
})
