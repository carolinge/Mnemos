// 解析旧 Typora 日记 Markdown → 结构化条目。
//
// 识别的结构（源自用户五年来的书写习惯）：
//   # 2026                                    → 年份标头（可折叠一整年）
//   ##### <span id="260312">Mar 12th</span>   → 日期标头，span id 为 YYMMDD
//   紧跟日期的散文行                            → 当天的碎碎念（aside）
//   <font color=#3388dd>PH</font>              → 任务代号，其后内容归属该任务
//   其余块级内容                                → 该任务卡片的正文
//
// 不做的事：不改写正文 Markdown（原样保留，交给编辑器解析），不猜测缺失信息。

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

const YEAR_RE = /^#\s+(\d{4})\s*$/
const DAY_RE = /^#{2,6}\s+(.+?)\s*$/
const SPAN_ID_RE = /<span\s+id="(\d{6})"/
const TASK_RE = /^<font\s+color=(#[0-9a-fA-F]{6})>\s*(.*?)\s*<\/font>(.*)$/
// 无任务卡片的边界标记（导出端写的是同一个常量）
const UNTASKED_RE = /^<!--\s*card\s*-->(.*)$/

// "Mar 12<sup>th</sup>" / "July 2nd" / "May 16th" → {month, day}
function parseMonthDay(text) {
  const clean = text.replace(/<[^>]+>/g, ' ')
  const m = clean.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})/)
  if (!m) return null
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()]
  if (!month) return null
  return { month, day: Number(m[2]) }
}

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

// 任务代号归一化：Daosim / DaOSim / DAOSIM 视为同一任务，保留首次出现的写法
function normalizeTaskKey(name) {
  return name.trim().toLowerCase()
}

// opts.defaultYear: 文件既无 H1 年份、日期也无 span id 时使用的年份。
// 无 span id 且月份相对上一天倒退时，视为跨年（12月→1月），年份 +1。
export function parseNotesMarkdown(text, opts = {}) {
  const defaultYear = opts.defaultYear ?? new Date().getFullYear()
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let lastMonth = null       // 上一个日期的月份，用于跨年推断
  let inferredYear = null    // 无 span id 时推进的年份

  const entries = []
  const taskNames = new Map()   // 归一化 key → 首次出现的原始写法
  const warnings = []

  let year = null
  let day = null            // 当前日期 ISO
  let aside = []            // 当天碎碎念
  let card = null           // 当前卡片 {task, color, lines}
  let position = 0
  const asides = new Map()  // day → 当天碎碎念

  function flushCard() {
    if (!card) return
    const body = card.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    if (body || card.task) {
      entries.push({ day: card.day, task: card.task, color: card.color, position: card.position, markdown: body })
    }
    card = null
  }

  // 碎碎念挂在「天」上，不属于任何卡片
  function flushAside() {
    if (day) {
      const text = aside.join('\n').trim()
      if (text) asides.set(day, text)
    }
    aside = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    const yearMatch = line.match(YEAR_RE)
    if (yearMatch) {
      flushCard(); flushAside()
      year = Number(yearMatch[1])
      day = null
      continue
    }

    const dayMatch = line.match(DAY_RE)
    if (dayMatch && !line.startsWith('# ')) {
      const heading = dayMatch[1]
      const md = parseMonthDay(heading)
      if (md) {
        flushCard(); flushAside()
        const spanId = heading.match(SPAN_ID_RE)
        let y
        if (spanId) {
          y = 2000 + Number(spanId[1].slice(0, 2))
          if (year && y !== year) {
            warnings.push(`「${heading}」：span id 年份 ${y} 与 H1 年份 ${year} 不一致，采用 span id`)
          }
        } else {
          // 无 span id：沿用 H1 年份，或延续上一天推断出的年份
          y = inferredYear ?? year ?? defaultYear
          if (lastMonth !== null && md.month < lastMonth) {
            y += 1   // 月份倒退 → 跨年
            warnings.push(`「${heading}」无 span id，月份自 ${lastMonth} 退至 ${md.month}，判定为跨年 → ${y}`)
          }
        }
        inferredYear = y
        lastMonth = md.month
        day = iso(y, md.month, md.day)
        position = 0
        continue
      }
      // 不是日期的标题（如正文里的小标题）→ 落进当前卡片正文
    }

    // 无任务卡片：只起一张新卡片，不建任务
    const untasked = line.match(UNTASKED_RE)
    if (untasked && day) {
      flushCard()
      card = { day, task: null, color: null, position: position++, lines: untasked[1].trim() ? [untasked[1].trim()] : [] }
      continue
    }

    const taskMatch = line.match(TASK_RE)
    if (taskMatch && day) {
      flushCard()
      const [, color, rawName, trailing] = taskMatch
      const name = rawName.trim()
      if (!name) {
        warnings.push(`${day}: 空的任务标记，已跳过`)
        continue
      }
      const key = normalizeTaskKey(name)
      if (!taskNames.has(key)) taskNames.set(key, { name, color })
      card = {
        day, task: taskNames.get(key).name, color,
        position: position++, lines: trailing.trim() ? [trailing.trim()] : [],
      }
      continue
    }

    if (card) {
      card.lines.push(line)
    } else if (day) {
      aside.push(line)          // 日期之后、首个任务之前 → 碎碎念
    } else if (line.trim()) {
      warnings.push(`文件开头的游离内容已忽略：${line.slice(0, 40)}`)
    }
  }
  flushCard(); flushAside()

  return {
    entries,
    asides: [...asides.entries()].map(([day, text]) => ({ day, text })),
    tasks: [...taskNames.values()],
    warnings,
  }
}
