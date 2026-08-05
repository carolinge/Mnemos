// 首次启动（库里一条笔记都没有）时写入的欢迎卡片。
// 这些卡片本身就是使用说明：读完就知道怎么用，删掉也不影响任何功能。

const p = text => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const h2 = text => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
const code = text => ({ type: 'text', marks: [{ type: 'code' }], text })
const bold = text => ({ type: 'text', marks: [{ type: 'bold' }], text })
const plain = text => ({ type: 'text', text })
const line = (...nodes) => ({ type: 'paragraph', content: nodes })
const bullets = (...items) => ({
  type: 'bulletList',
  content: items.map(i => ({ type: 'listItem', content: [Array.isArray(i) ? line(...i) : p(i)] })),
})
const doc = (...content) => ({ type: 'doc', content })

export const WELCOME_TASK = 'Getting started'

export const WELCOME_CARDS = [
  doc(
    h2('Welcome — this is a card'),
    p('Every card belongs to one task (the chip in the top-left corner). Click it to switch tasks, search, or type a new name to create one.'),
    p('A single day can hold as many cards as you like, each under its own task. Click a task in the left sidebar to pull out everything you ever wrote under it, across all dates.'),
    line(plain('You can delete these help cards any time — hover a card and use the '), code('×'), plain(' in its corner.')),
  ),
  doc(
    h2('Writing: it behaves like Typora'),
    p('Type these at the start of a line and they turn into formatting as you go:'),
    bullets(
      [code('# '), plain(' heading 1, '), code('## '), plain(' heading 2 (up to 6)')],
      [code('- '), plain(' bullet list, '), code('1. '), plain(' numbered list, '), code('[] '), plain(' checkbox')],
      [code('> '), plain(' quote, '), code('```'), plain(' code block, '), code('---'), plain(' divider')],
      [code('$E=mc^2$'), plain(' inline maths, '), code('$$'), plain(' display maths')],
      [code('```mermaid'), plain(' flowchart (add a space to trigger it)')],
    ),
    p('Select text and a formatting bar appears (bold, italic, inline code, highlight, link). On an empty line an insert bar appears (table, code, todo, image, citation, embed, diagram).'),
    line(plain('Prefer raw Markdown? Hover a card and hit '), code('</> Source'), plain(' in the bottom-left to edit — or paste — the Markdown behind it.')),
  ),
  doc(
    h2('Keyboard shortcuts'),
    p('These follow Typora\u2019s official key map, so your muscle memory carries over.'),
    bullets(
      [code('Cmd/Ctrl + 1…6'), plain('  heading level, '), code('Cmd/Ctrl + 0'), plain('  back to body text')],
      [code('Cmd/Ctrl + +'), plain(' / '), code('-'), plain('  promote / demote the heading')],
      [code('Cmd/Ctrl + K'), plain('  insert link')],
      [code('Cmd/Ctrl + Shift + K'), plain('  code block  ·  '), code('Cmd/Ctrl + Shift + `'), plain('  inline code')],
      [code('Cmd/Ctrl + Shift + [ / ]'), plain('  numbered / bullet list')],
      [code('Cmd/Ctrl + Shift + Q'), plain('  quote  ·  '), code('Cmd/Ctrl + T'), plain('  table')],
      [code('Cmd/Ctrl + Shift + I'), plain('  image  ·  '), code('Cmd/Ctrl + Shift + M'), plain('  maths block')],
      [code('Tab'), plain(' / '), code('Shift + Tab'), plain('  indent / outdent inside a list')],
      [code('Cmd/Ctrl + P'), plain('  command palette: search text, jump to a date, filter by task')],
    ),
  ),
  doc(
    h2('Images, references and AI output'),
    bullets(
      'Paste a screenshot with Ctrl+V and it uploads itself. Images sit inline, so several fit on one line and wrap when they run out of room. Hover one to drag it elsewhere, resize it, or remove it; click it for the full-size view.',
      'Paste a DOI / arXiv / PubMed link and the title, authors, year and journal are fetched into a compact citation card. If the lookup fails it stays an ordinary link — it never blocks your typing.',
      'Copy a formatted answer out of an AI chat and it becomes editable text. Paste a full HTML artifact with <script> in it and it becomes a sandboxed embed instead: charts still animate, and you can resize, collapse or inspect the source.',
    ),
  ),
  doc(
    h2('Days and years'),
    bullets(
      'You land on today with the cursor ready. Stop typing for a second and it saves itself (the dot in the toolbar turns green).',
      'Backfilling an old note: click the date heading and pick another date, or use “＋ New day” under any day.',
      'Next to each date is a “＋ Note” button for a one-line (or many-line) note about the day itself. The 💭 button in the toolbar hides or shows all of them at once.',
      'Years are collapsible headings — click one to fold a whole year away.',
      'The thin rail on the right edge is a scrubber: drag it to fly to any month. Days with notes show a blue dot and the scrubber snaps to them.',
    ),
  ),
  doc(
    h2('Your data'),
    p('Every note lives in one SQLite file with the images in a folder beside it. Copy that folder and you have a complete backup.'),
    line(plain('The '), bold('⤓'), plain(' button exports three ways: one single Markdown file (Typora opens it as-is), one file per month, or a print-ready page you can save as PDF.')),
    p('Exported Markdown can be imported straight back in — your notes are never locked inside this app.'),
  ),
]

// 库里完全没有笔记时才写入，避免覆盖用户内容
// 几天示例笔记，让「同一天并行推进好几个课题」在首次打开时就看得见。
// [往前推几天, 任务名, 卡片内容]
export const SAMPLE_CARDS = [
  [2, 'Perovskite', doc(
    p('Spin-coating series done. Anti-solvent dripped at 8 s gives the flattest film so far.'),
    bullets('120 °C anneal, 10 min', 'PL peak 780 nm', 'Rerun with 6 s and 10 s to bracket it'),
  )],
  [2, 'Graphene', doc(
    p('Transfer keeps tearing at the corners. Suspect the PMMA is too thin.'),
  )],
  [1, 'Perovskite', doc(
    p('6 s is worse, 10 s is the same as 8 s. Keeping 8 s.'),
    { type: 'blockquote', content: [p('Humidity has to stay under 30% or none of this reproduces.')] },
  )],
  [1, 'Simulation', doc(
    p('Coarse-grained run finished overnight.'),
    { type: 'codeBlock', attrs: { language: 'python' },
      content: [{ type: 'text', text: 'rg = md.compute_rg(traj)\nprint(rg.mean(), rg.std())' }] },
  )],
  [1, 'Group meeting', doc(
    p('Talk: condensate ageing. Stickers cross-link, diffusion slows — worth reading up on.'),
  )],
  [0, 'Simulation', doc(
    p('Comparing against experiment today. Numbers are in the same ballpark, writing it up.'),
  )],
  [0, 'Graphene', doc(
    p('Thicker PMMA fixed the tearing. Two clean transfers in a row.'),
  )],
]

const SAMPLE_NOTES = [
  [1, 'Three things running at once today — the trick is keeping them apart.'],
]

const shiftDay = (day, back) => {
  const d = new Date(day + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

export function seedWelcomeIfEmpty(db, deps) {
  const { resolveTask, extractText, randomUUID, today } = deps
  const count = db.prepare('SELECT COUNT(*) AS n FROM entries').get().n
  if (count > 0) return false

  const day = today()
  const insert = db.prepare(
    `INSERT INTO entries(id, day, position, content, text, task_id) VALUES (?, ?, ?, ?, ?, ?)`)

  const help = resolveTask(db, WELCOME_TASK)
  WELCOME_CARDS.forEach((content, i) => {
    insert.run(randomUUID(), day, i, JSON.stringify(content), extractText(content), help.id)
  })

  // 今天已经放了说明卡，示例卡要从它们后面接着排，否则位置号相撞、顺序不定
  const posByDay = { [day]: WELCOME_CARDS.length - 1 }
  for (const [back, taskName, content] of SAMPLE_CARDS) {
    const d = shiftDay(day, back)
    posByDay[d] = (posByDay[d] ?? -1) + 1
    insert.run(randomUUID(), d, posByDay[d], JSON.stringify(content),
               extractText(content), resolveTask(db, taskName).id)
  }
  const note = db.prepare('INSERT INTO day_notes(day, text) VALUES (?, ?)')
  for (const [back, text] of SAMPLE_NOTES) note.run(shiftDay(day, back), text)

  return true
}
