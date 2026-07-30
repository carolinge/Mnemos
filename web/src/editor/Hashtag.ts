import { Extension, InputRule } from '@tiptap/core'

// 行内敲 `#标签名 `（以空格收尾）→ 文本被移除、回调打标
export const TAG_RE = /(?:^|\s)#([^\s#]{1,32})\s$/

export function parseTag(m: RegExpMatchArray): string {
  return m[1]
}

export function Hashtag(onTag: (name: string) => void) {
  return Extension.create({
    name: 'hashtagCapture',
    addInputRules() {
      return [new InputRule({
        find: TAG_RE,
        handler: ({ range, match, commands }) => {
          const full = match[0]
          const hashIdx = full.indexOf('#')
          commands.deleteRange({ from: range.from + hashIdx, to: range.to })
          onTag(parseTag(match))
        },
      })]
    },
  })
}
