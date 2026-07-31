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

export const WELCOME_TASK = '使用说明'

export const WELCOME_CARDS = [
  doc(
    h2('欢迎 —— 这是一张卡片'),
    p('每张卡片属于一个任务（左上角那个标签）。点它可以换任务、搜任务、或者直接输名字新建一个。'),
    p('一天里可以有任意多张卡片，各归各的任务，互不干扰。点左侧边栏的任务名，就能把这个任务跨越所有日期的记录抽出来单独看。'),
    line(plain('这些说明卡片你随时可以删掉——鼠标移到卡片上，右上角有 '), code('×'), plain('。')),
  ),
  doc(
    h2('写字：和 Typora 一样'),
    p('行首输入这些符号会即时变成对应格式：'),
    bullets(
      [code('# '), plain(' 一级标题，'), code('## '), plain(' 二级标题')],
      [code('- '), plain(' 无序列表，'), code('1. '), plain(' 有序列表，'), code('[] '), plain(' 待办')],
      [code('> '), plain(' 引用，'), code('```'), plain(' 代码块，'), code('---'), plain(' 分割线')],
      [code('$E=mc^2$'), plain(' 行内公式，'), code('$$'), plain(' 独立公式块')],
      [code('```mermaid'), plain(' 流程图（加空格触发）')],
    ),
    p('选中文字会浮出格式条（粗体/斜体/行内代码/高亮/链接）；空行上会浮出插入条（表格、代码、待办、图片、引用、嵌入、流程图）。'),
  ),
  doc(
    h2('快捷键'),
    bullets(
      [code('Ctrl/Cmd + +'), plain(' 或 '), code('='), plain('　标题升一级（正文 → H1）')],
      [code('Ctrl/Cmd + -'), plain('　标题降一级（H1 → H2 → H3 → 正文）')],
      [code('Tab'), plain(' / '), code('Shift + Tab'), plain('　列表内缩进 / 反缩进')],
      [code('Ctrl/Cmd + Shift + ['), plain('　切换有序列表')],
      [code('Ctrl/Cmd + Shift + ]'), plain('　切换无序列表')],
      [code('Ctrl/Cmd + K'), plain('　命令面板：搜正文、输日期跳转、输任务名切视图')],
    ),
  ),
  doc(
    h2('图片、文献、AI 生成的内容'),
    bullets(
      '截图直接 Ctrl+V 粘进来就会上传；拖动图片右下角的圆点改大小，点图片全屏看原图。',
      '粘贴 DOI / arXiv / PubMed 链接，会自动抓标题作者年份，变成一张引用卡片。抓不到就保持普通链接，不会卡住你写字。',
      '从 AI 对话里复制带格式的回答粘进来 → 变成可继续编辑的正文；粘贴带 <script> 的完整 HTML → 变成沙箱里的嵌入块，图表能动，可调高度、折叠、看源码。',
    ),
  ),
  doc(
    h2('日期与年份'),
    bullets(
      '打开就落在今天，光标就位，直接打字。停笔一秒自动保存（右上角圆点变绿）。',
      '补以前的笔记：点日期标头，选一个过去的日期，这一天的卡片就整体搬过去。',
      '双击日期标头，可以给这一天写一句碎碎念（小字、默认隐藏，只有你双击才看得到）。',
      '年份是可折叠的大标题，点一下收起一整年。',
      '右边缘那条细轨可以拖动，快速跳到任意月份；有记录的日子上有小蓝点，会自动吸附。',
    ),
  ),
  doc(
    h2('你的数据'),
    p('所有笔记在一个 SQLite 文件里，图片在旁边的文件夹里，拷走就是完整备份。'),
    line(plain('顶栏的 '), bold('⤓'), plain(' 可以导出：一整份 Markdown（和 Typora 格式一致，能直接打开）、按月拆分的多个文件、或者可打印成 PDF 的页面。')),
    p('导出的 Markdown 能被原样导回来 —— 数据永远是你的，不锁在这个软件里。'),
  ),
]

// 库里完全没有笔记时才写入，避免覆盖用户内容
export function seedWelcomeIfEmpty(db, deps) {
  const { resolveTask, extractText, randomUUID, today } = deps
  const count = db.prepare('SELECT COUNT(*) AS n FROM entries').get().n
  if (count > 0) return false

  const task = resolveTask(db, WELCOME_TASK)
  const day = today()
  const insert = db.prepare(
    `INSERT INTO entries(id, day, position, content, text, task_id) VALUES (?, ?, ?, ?, ?, ?)`)
  WELCOME_CARDS.forEach((content, i) => {
    insert.run(randomUUID(), day, i, JSON.stringify(content), extractText(content), task.id)
  })
  return true
}
