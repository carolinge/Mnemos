# Parchment

给科研工作者的极简网页笔记本。打开就是今天，往下写；写完的东西按日期成流、按项目成线。

为什么不是 Markdown 编辑器：科研笔记里塞的不只是文字——截图要能随手贴、图要能拖着改大小、文献只想丢个链接进去、AI 生成的图表和网页要能原样嵌进来。Parchment 把这些都当一等公民，而不是附件。

## 它能做什么

- **时间流写作**：打开落在今天，光标就位。向上滚动加载历史，日期标头吸顶。
- **项目标签**：正文里敲 `#钙钛矿 ` 即建即打标。点左侧项目名，抽出这个项目跨越所有日期的完整时间线。
- **Typora 手感**：`## ` 变标题、`- ` 变列表、`**粗**` 变粗体、` ``` ` 开代码块、`$E=mc^2$` 渲染公式。选中文字浮出格式条，空行浮出插入条。
- **图片自由**：截图 Ctrl+V 直接插入并上传，拖右下角改大小（存百分比，刷新保持），点击全屏看原图。服务器按 `年/月` 归档、按内容去重。
- **文献引用**：粘 DOI / arXiv / PubMed 链接，自动抓标题、作者、年份、期刊，变成一张紧凑卡片。抓不到就老实保持普通链接，绝不卡住你写字。
- **AI 内容直接粘**：粘贴带格式的 AI 回答 → 变成可继续编辑的正文；粘贴带脚本的交互式 artifact → 进沙箱 iframe 原样渲染（图表能动），可调高度、折叠、看源码、转纯文本。
- **流程图与公式**：` ```mermaid ` 画流程图（懒加载，不拖慢首屏），KaTeX 渲染行内与块级公式。
- **找得回来**：⌘K/Ctrl+K 呼出命令面板——搜正文（中英文都行）、输 `3月12` 跳日期、输项目名切视图。右缘时间条可拖动，吸附到有记录的日子。
- **断网不丢字**：每次输入先写本地草稿，网络恢复自动补传。右上角圆点显示保存状态。
- **数据是你的**：一键导出全部笔记为 Markdown + 图片文件夹（zip）。所有数据在一个目录里，拷走就是备份。

## 本地开发

需要 Node 22+。两个终端：

```bash
# 终端 1：后端（端口 8787）
cd server && npm install && ACCESS_PASSWORD=dev npm run dev

# 终端 2：前端（Vite 开发服务器，自动代理 /api 与 /images）
cd web && npm install && npm run dev
```

浏览器打开 Vite 给出的地址，密码填 `dev`。

跑测试：

```bash
cd server && npx vitest run   # 后端 41 项
cd web && npx vitest run      # 前端 61 项
```

## 部署到 fly.io

单容器，SQLite + 图片都在挂载卷 `/data` 里。

```bash
fly launch --no-deploy                      # 确认 app 名与区域，沿用仓库里的 fly.toml
fly volumes create parchment_data --size 3  # 3 GB 起步，之后可扩
fly secrets set ACCESS_PASSWORD='你的访问密码'
fly deploy
```

部署完打开 `https://<你的-app>.fly.dev`，输密码即可用。

`auto_stop_machines` 已开启：没人访问时机器会停，产生的费用极低；再次访问自动唤醒（首次冷启动约 1-2 秒）。

### 本地 Docker 试跑

```bash
docker build -t parchment .
docker run --rm -p 8787:8787 -e ACCESS_PASSWORD=dev -v $PWD/.data:/data parchment
```

## 数据与备份

一切都在 `/data` 下：`parchment.db`（SQLite，含笔记、项目、引用缓存）和 `images/年/月/`（原图，不压缩）。

```bash
fly ssh sftp get /data/parchment.db ./backup/parchment.db   # 拉数据库
```

或者直接用页面右上角的 ⤓ 导出完整 zip（Markdown + 图片 + 嵌入的 HTML），任何 Markdown 编辑器都能打开——不锁定你的内容。

## 技术栈

后端 Hono + better-sqlite3（FTS5 trigram 全文索引，中英文都能搜），前端 Vite + React + TipTap(ProseMirror)，KaTeX 与 Mermaid 按需懒加载。单用户单密码，session 存 HttpOnly cookie。

## 许可

MIT
