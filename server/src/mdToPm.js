// Markdown → ProseMirror JSON（编辑器的文档格式）。
//
// 只处理旧笔记里实际出现过的语法；遇到不认识的内容一律降级为纯文本，绝不丢字。
// 与 export.js 的 pmToMarkdown 互为逆操作，两者由 test/mdToPm.test.js 的往返用例约束。

const TASK_ITEM_RE = /^[-*]\s+\[([ xX])\]\s+(.*)$/
const BULLET_RE = /^[-*]\s+(.*)$/
const ORDERED_RE = /^(\d+)[.)]\s+(.*)$/
const HEADING_RE = /^(#{1,6})\s+(.*)$/
const FENCE_RE = /^```(\S*)\s*$/
const HR_RE = /^(-{3,}|\*{3,}|_{3,})$/
const TABLE_SEP_RE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/

const text = t => ({ type: 'text', text: t })
const para = content => ({ type: 'paragraph', ...(content.length ? { content } : {}) })

// 缩进宽度：Tab 记 4 空格
function indentOf(line) {
  const m = line.match(/^[ \t]*/)[0]
  return m.replace(/\t/g, '    ').length
}

export function mdToPm(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n')
  return { type: 'doc', content: parseBlocks(lines) }
}

function parseBlocks(lines) {
  const out = []
  let i = 0

  while (i < lines.length) {
    const raw = lines[i]
    const line = raw.trim()

    if (!line) { i++; continue }

    // 代码块（含 mermaid）
    const fence = line.match(FENCE_RE)
    if (fence) {
      const lang = fence[1]
      const body = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        body.push(lines[i])
        i++
      }
      i++   // 跳过收尾的 ```
      const codeText = body.join('\n').replace(/\s+$/, '')
      if (lang === 'mermaid') {
        out.push({ type: 'mermaidBlock', attrs: { code: codeText } })
      } else {
        out.push({
          type: 'codeBlock',
          attrs: { language: lang || null },
          ...(codeText ? { content: [text(codeText)] } : {}),
        })
      }
      continue
    }

    if (HR_RE.test(line)) { out.push({ type: 'horizontalRule' }); i++; continue }

    const heading = line.match(HEADING_RE)
    if (heading) {
      out.push({
        type: 'heading',
        attrs: { level: Math.min(heading[1].length, 3) },
        content: parseInline(heading[2]),
      })
      i++
      continue
    }

    // 引用块：收集连续的 > 行，去掉标记后递归解析
    if (line.startsWith('>')) {
      const inner = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        inner.push(lines[i].trim().replace(/^>\s?/, ''))
        i++
      }
      out.push({ type: 'blockquote', content: parseBlocks(inner) })
      continue
    }

    // 表格：当前行是 | 开头且下一行是分隔行
    if (line.startsWith('|') && TABLE_SEP_RE.test((lines[i + 1] ?? '').trim())) {
      const rows = []
      const header = splitRow(line)
      i += 2   // 跳过表头与分隔行
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i].trim()))
        i++
      }
      out.push(buildTable(header, rows))
      continue
    }

    // 列表：收集同一块内所有列表行（含更深缩进的续行）
    if (TASK_ITEM_RE.test(line) || BULLET_RE.test(line) || ORDERED_RE.test(line)) {
      const block = []
      const baseIndent = indentOf(raw)
      while (i < lines.length) {
        const cur = lines[i]
        const t = cur.trim()
        if (!t) {
          // 空行：后面缩进更深就并入（不管是不是列表行——列表项内的第二段
          // 普通段落，跟嵌套列表一样，都比 baseIndent 深）；缩进相同则只有
          // 还是列表行（兄弟项）才并入；否则结束。
          const next = lines[i + 1]
          const nextIndent = next ? indentOf(next) : -1
          const nextIsItem = next && (TASK_ITEM_RE.test(next.trim()) || BULLET_RE.test(next.trim()) || ORDERED_RE.test(next.trim()))
          if (next && next.trim() && (nextIndent > baseIndent || (nextIndent === baseIndent && nextIsItem))) {
            i++
            continue
          }
          break
        }
        const isItem = TASK_ITEM_RE.test(t) || BULLET_RE.test(t) || ORDERED_RE.test(t)
        if (indentOf(cur) < baseIndent) break
        if (indentOf(cur) === baseIndent && !isItem) break
        block.push(cur)
        i++
      }
      out.push(parseList(block))
      continue
    }

    // 普通段落：连续非空行合并
    const buf = []
    while (i < lines.length) {
      const t = lines[i].trim()
      if (!t) break
      if (HEADING_RE.test(t) || t.startsWith('>') || FENCE_RE.test(t) || HR_RE.test(t) ||
          TASK_ITEM_RE.test(t) || BULLET_RE.test(t) || ORDERED_RE.test(t)) break
      buf.push(t)
      i++
    }
    if (buf.length) out.push(para(parseInline(buf.join(' '))))
  }

  return out
}

function splitRow(line) {
  return line.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
}

function buildTable(header, rows) {
  const cell = (t, type) => ({ type, content: [para(parseInline(t))] })
  const content = [{ type: 'tableRow', content: header.map(h => cell(h, 'tableHeader')) }]
  for (const r of rows) {
    content.push({ type: 'tableRow', content: r.map(c => cell(c, 'tableCell')) })
  }
  return { type: 'table', content }
}

// 一组列表行 → 列表节点（按缩进递归嵌套）
function parseList(lines) {
  if (!lines.length) return para([])
  const baseIndent = indentOf(lines[0])

  // 切分出每个条目：条目行 + 其后更深缩进的续行
  const items = []
  let cur = null
  for (const line of lines) {
    const t = line.trim()
    const isItem = indentOf(line) <= baseIndent &&
      (TASK_ITEM_RE.test(t) || BULLET_RE.test(t) || ORDERED_RE.test(t))
    if (isItem) {
      if (cur) items.push(cur)
      cur = { head: t, rest: [] }
    } else if (cur) {
      cur.rest.push(line)
    }
  }
  if (cur) items.push(cur)

  const firstHead = items[0]?.head ?? ''
  const isTask = TASK_ITEM_RE.test(firstHead)
  const isOrdered = !isTask && ORDERED_RE.test(firstHead)

  const listItems = items.map(it => {
    const taskM = it.head.match(TASK_ITEM_RE)
    const ordM = it.head.match(ORDERED_RE)
    const bulM = it.head.match(BULLET_RE)
    const inlineText = taskM ? taskM[2] : ordM ? ordM[2] : bulM ? bulM[1] : it.head

    const content = [para(parseInline(inlineText))]
    if (it.rest.length) {
      // 续行去掉一层缩进后递归（可能是嵌套列表，也可能是段落）
      const dedented = dedent(it.rest)
      content.push(...parseBlocks(dedented))
    }

    if (isTask) {
      return { type: 'taskItem', attrs: { checked: taskM ? /[xX]/.test(taskM[1]) : false }, content }
    }
    return { type: 'listItem', content }
  })

  if (isTask) return { type: 'taskList', content: listItems }
  return { type: isOrdered ? 'orderedList' : 'bulletList', content: listItems }
}

function dedent(lines) {
  const min = Math.min(...lines.filter(l => l.trim()).map(indentOf))
  return lines.map(l => {
    let removed = 0, idx = 0
    while (idx < l.length && removed < min) {
      if (l[idx] === ' ') { removed += 1; idx++ }
      else if (l[idx] === '\t') { removed += 4; idx++ }
      else break
    }
    return l.slice(idx)
  })
}

// ---------- 行内 ----------

// 先剥掉残留的行内 HTML（<sup>th</sup>、<span id=…>），保留其中的文字
function stripInlineHtml(s) {
  return s.replace(/<\/?[a-zA-Z][^>]*>/g, '')
}

const INLINE_PATTERNS = [
  { re: /`([^`]+)`/, mark: 'code' },                       // 行内代码优先，内部不再解析
  { re: /\*\*([^*]+)\*\*/, mark: 'bold' },
  { re: /__([^_]+)__/, mark: 'bold' },
  { re: /(?<![*\w])\*([^*\s][^*]*?)\*(?![*\w])/, mark: 'italic' },
  { re: /~~([^~]+)~~/, mark: 'strike' },
  { re: /==([^=]+)==/, mark: 'highlight' },
]

const LINK_RE = /\[([^\]]*)\]\(([^)\s]+)\)/
// Third group is the optional title slot pmToMarkdown stashes width in
// (`![alt](src "w40")`) — standard Markdown syntax, just repurposed.
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/
const BARE_URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?]/
// 块级 $$…$$ 必须先于行内 $…$ 匹配，否则会被从中间切开
const MATH_RE = /\$\$[^\n]*?\$\$|\$[^$\n]+\$/

export function parseInline(src) {
  const s = stripInlineHtml(String(src ?? ''))
  return inlineNodes(s, [])
}

function inlineNodes(s, marks) {
  if (!s) return []

  // 图片先于链接（语法只差一个 !）
  const img = s.match(IMAGE_RE)
  if (img && img.index !== undefined) {
    const width = img[3]?.match(/^w(\d+)$/)?.[1]
    const attrs = { src: img[2], alt: img[1] || null, ...(width ? { width: Number(width) } : {}) }
    return [
      ...inlineNodes(s.slice(0, img.index), marks),
      { type: 'image', attrs },
      ...inlineNodes(s.slice(img.index + img[0].length), marks),
    ]
  }

  const link = s.match(LINK_RE)
  if (link && link.index !== undefined) {
    const linkMarks = [...marks, { type: 'link', attrs: { href: link[2] } }]
    return [
      ...inlineNodes(s.slice(0, link.index), marks),
      ...inlineNodes(link[1], linkMarks),
      ...inlineNodes(s.slice(link.index + link[0].length), marks),
    ]
  }

  // 行内公式：整体保留原文，交给编辑器的数学扩展渲染
  const math = s.match(MATH_RE)
  if (math && math.index !== undefined) {
    return [
      ...inlineNodes(s.slice(0, math.index), marks),
      withMarks(math[0], marks),
      ...inlineNodes(s.slice(math.index + math[0].length), marks),
    ].filter(Boolean)
  }

  for (const { re, mark } of INLINE_PATTERNS) {
    const m = s.match(re)
    if (m && m.index !== undefined) {
      const inner = mark === 'code'
        ? [withMarks(m[1], [...marks, { type: 'code' }])]     // 代码内部不再解析
        : inlineNodes(m[1], [...marks, { type: mark }])
      return [
        ...inlineNodes(s.slice(0, m.index), marks),
        ...inner,
        ...inlineNodes(s.slice(m.index + m[0].length), marks),
      ].filter(Boolean)
    }
  }

  const bare = s.match(BARE_URL_RE)
  if (bare && bare.index !== undefined) {
    return [
      ...inlineNodes(s.slice(0, bare.index), marks),
      withMarks(bare[0], [...marks, { type: 'link', attrs: { href: bare[0] } }]),
      ...inlineNodes(s.slice(bare.index + bare[0].length), marks),
    ].filter(Boolean)
  }

  const node = withMarks(s, marks)
  return node ? [node] : []
}

function withMarks(t, marks) {
  if (!t) return null
  return marks.length ? { type: 'text', text: t, marks } : text(t)
}
