# Viscio 设计文档

日期：2026-08-18
状态：已与用户确认通过（含一轮全栈+科研双视角 review，评审意见已全部吸收）
项目名：Viscio

## 1. 产品定位

为学术报告场景做的轻量网页幻灯片编辑器，用来替代 PowerPoint：保留 PPT 的核心手感（画布上自由摆形状/图片/文字），但能嵌入真交互内容（可旋转缩放的三维图等），内容渲染能力对齐 Quarto（公式、代码高亮、可交互嵌入）。单用户，挂在现有个人网站（linge.li）下的一个页面，不单独部署、不占新的 Fly 卷。

产品原则：

1. **轻量优先，但不是绝对上限** —— 默认倾向精简，但用户会为具体能力主动选重的方案（自由画笔、智能对齐线、元素分组、版本历史都是这样被保留下来的，见第 2 节）。
2. **复用现成的** —— 能用 Mnemos 已有的依赖/模式（Tiptap、KaTeX、Mermaid、认证机制、autosave 唤醒重试）就不重新发明。
3. **不做 Quarto 本体、不做任何服务端 Python** —— 三维图的交互性由用户自己的 Python 代码从 matplotlib 换成 Plotly、导出自包含 html 文件解决；这部分在此前对话中已定案，不属于 Viscio 的范围。

## 2. 已确认的关键决策

| 决策点 | 结论 | 理由 |
| --- | --- | --- |
| 创作方式 | 网页画布编辑器，不是 markdown 渲染器 | 用户要的是形状/字体/对齐这些 PPT 手感，不是纯文本流排版 |
| 画布渲染技术 | DOM + CSS 绝对定位（非整张 SVG，非 canvas 像素画布） | 文本框需要富文本编辑（Tiptap），SVG 的 `foreignObject`、canvas 的手写文字输入都不适合；Quarto/reveal.js 本身也是纯 DOM 技术 |
| 源码位置 | 新开独立 git 仓库 `viscio`，与 riffle / homepage / Mnemos 平级 | 当前仓库是 Mnemos 专用仓库，不应该塞进无关应用 |
| 部署挂载方式 | 照抄 `/mnemos` 的 bridge 中间件模式挂到 `/viscio`，复用 `carolinge-homepage` 这一个 Fly app | 用户明确提到 Mnemos 曾经新旧两个卷都挂过、是走过的弯路，Viscio 不能重犯，只做"homepage 下的一个页面" |
| 钢笔工具 | 最终定为「自由画笔」（拖拽轨迹自动平滑成 SVG path），**不做**可拖控制柄的贝塞尔编辑 | 用户一度选择了贝塞尔控制柄方案，但在讨论"AI 时代是否还需要手动调曲率"后主动同意降级；流程图关系已交给 Mermaid 覆盖，精确曲率编辑用不上，轻量优先 |
| 对齐方式 | 拖拽时智能吸附对齐线（PPT 式粉色引导线） | 用户在"按钮对齐 vs 拖拽吸附线"之间显式选择了更重的后者 |
| 旋转 | 不做 | 会和对齐线系统的复杂度叠加，用户主动同意砍掉 |
| 版本历史 / 元素分组 | 都保留 | 用户否决了砍掉这两项的建议 |
| 认证 | 沿用 Mnemos 的共享密码 + cookie session 模式，但用独立 cookie 名与独立 path 作用域 | review 中读了 Mnemos 现有 `auth.js` 代码，确认若照搬会共用同一个 cookie 槽位，登录会互相顶掉 |
| 编辑页 vs 播放页权限 | 编辑需要登录；播放页走公开分享链接，免密码 | 方便直接把链接发给同事/听众看 |
| 离线兜底 | 需要"导出为自包含离线 html"，用只读渲染 + 单文件打包，而非直接序列化活 DOM | 讲台可能没网；序列化活 DOM 在 `file://` 协议下会因为模块脚本分包被浏览器拦截，导出的文件线下打不开 |

## 3. 产品形态

### 3.1 整体结构：多稿管理

- 首页是 deck 列表：新建 / 打开 / 删除。
- 每个 deck 下若干张 slide，可增删、拖拽排序（简单整数 `position` 字段，重排时整体重新编号；明确不引入分片/字典序索引，这是单用户小规模场景，没有并发写入需要规避）。

### 3.2 编辑器画布

- **固定设计分辨率**（16:9，如 1280×720）：所有元素的 x/y/w/h 都基于这个坐标空间，编辑器和播放页都通过 `transform: scale()` 整体缩放去适配真实窗口/投影仪分辨率——换电脑、缩放浏览器窗口都不会让画布错位。对齐吸附的阈值判定也在这个设计坐标系里计算，不受编辑器当前缩放级别影响。
- **六种形状**：矩形/圆角矩形、椭圆、直线+箭头、文本框、菱形、自由画笔（拖拽轨迹自动平滑成一条 SVG path，不提供逐点可拖的曲率控制柄）。
- **文本框**：内嵌一个 Tiptap 富文本实例——标题级别、行内代码、加粗、列表，支持 `## ` 这类 Typora 式 markdown 快捷输入，直接复用 Mnemos 现有的 Tiptap 扩展配置。
- **三种嵌入块**（均复用 Mnemos 现有依赖）：iframe / 自定义 HTML（放 Plotly 导出的自包含图表文件）、LaTeX 公式（KaTeX）、代码块（lowlight 语法高亮）。
- **图片**：上传、拖拽调整大小。
- **拖拽交互**：自由定位 + 缩放（粗糙摆放没问题，不要求像素级精确）；拖拽时显示智能对齐吸附线。多选元素可编组，编组作为一个整体参与对齐线计算，且不对自己的子元素触发虚假对齐线（组内元素互相看不见彼此）。
- **图层顺序**：上移一层 / 下移一层 / 置顶 / 置底；不支持旋转。
- **撤销/重做**：编辑会话内的内存态操作栈，不落盘。
- Tiptap 的悬浮工具条、建议弹层等浮层组件通过 React portal 挂载到画布缩放容器**外部**渲染（画布上的 `transform` 会给内部元素建立新的 containing block，`position: fixed` 的浮层挂在容器内部会被裁切或错位）。

### 3.3 版本历史

- **触发时机**：用户按 Ctrl+S 立即存一个快照；此外每 10 分钟自动存一个快照（若这期间有改动才存，无改动不存空快照）。
- **上限**：每个 deck 最多保留 10 个快照，超过后从最旧的开始淘汰（先进先出）。
- **去重**：快照内容做内容寻址存储——图片、embed HTML 这类大体积内容按内容 hash 存进独立的 `blobs` 表，快照本身只存 hash 引用，不会每存一次快照就把几 MB 的 Plotly 导出文件重复拷贝一份，避免版本历史迅速吃满共享数据卷。
- 可浏览历史列表（按时间倒序），一键恢复到某个快照。

### 3.4 放映模式

- 独立全屏路由；方向键、空格、**以及 PageUp/PageDown** 均可翻页（讲台遥控器/翻页笔常发送的是 PageUp/PageDown 而非方向键，两套都要绑定）；Esc 退出。
- 左下角显示当前页码（Q&A 环节听众常说"回到第 X 页"）。
- 每张 slide 进入播放时**全新挂载**，离开即卸载——三维图 iframe 每次被重新看到都会重置到默认视角，不会把上一次转到的角度带到下一次跳转，行为可预期，也避免多个 Plotly 实例同时挂载占内存。

### 3.5 分享与访问

- 每个 deck 有一个公开分享 slug：`/viscio/play/:slug` 播放页免密码访问；`/viscio/edit/:id` 编辑页需要登录。
- 可以一键重新生成 slug，使已发出去的旧链接失效。

### 3.6 离线导出

- deck 编辑页有「导出离线 html」按钮。
- 实现方式：Viscio 自己的构建产物里预先打包好一份**只读播放器单文件 bundle**（用 `vite-plugin-singlefile` 之类的方案产出，零外部 `<script src>` 引用）。导出时后端 `GET /api/decks/:id/export` 把这份预构建模板 + 该 deck 的完整数据（文本内容走 Tiptap 的 `generateHTML` 静态渲染成 html 字符串，图片/embed 等 blob 引用替换成 base64 内联）拼接成一个完整 html 文件返回，前端触发下载。不做"直接把活 DOM 序列化出来"这种看似简单但在 `file://` 协议下会失败的方案。
- 已知取舍：多个 Plotly 嵌入各自独立打包了完整 plotly.js（每份约 3-4MB），一个有三张交互图的 deck 导出文件可能到十几 MB——纯本地静态文件，现代浏览器打开无压力，v1 不做跨 embed 的 plotly.js 去重合并。

## 4. 数据模型（SQLite，better-sqlite3）

- **decks**：`id, title, canvas_width, canvas_height, share_slug, created_at, updated_at`
- **slides**：`id, deck_id, position(int), notes(text，演讲备注，编辑时可见)`
- **elements**：`id, slide_id, type(rect/ellipse/line-arrow/textbox/diamond/freehand/image/embed/latex/code), x, y, w, h, z_index, group_id(nullable), content(json), blob_hash(nullable)` —— `content` 对文本框存 Tiptap ProseMirror JSON，对形状存样式属性，对图片/embed 存 `blob_hash` 引用
- **blobs**：`hash(pk), type(image/embed_html), data, size, created_at` —— 内容寻址存储，`elements` 与 `revisions` 都通过 hash 引用，不重复存大文件
- **revisions**：`id, deck_id, created_at, trigger(manual/auto), snapshot(json)` —— snapshot 是 slides+elements 的完整结构，其中大文件字段仍只存 `blob_hash` 引用
- **sessions**：认证 session，cookie 名固定为 `viscio_session`，与 Mnemos 的 `session` 相互独立

## 5. 后端 API（Hono）

- `POST /api/auth` —— 登录，写入独立 cookie（名称、path 与 Mnemos 隔离）
- `GET/POST/DELETE /api/decks`, `/api/decks/:id`
- `GET/POST/PATCH/DELETE /api/decks/:id/slides`, `/api/slides/:id`
- `GET/PUT /api/slides/:id/elements` —— 整批替换该 slide 的元素集合，autosave 用
- `POST /api/decks/:id/revisions`（携带 `trigger`）, `GET /api/decks/:id/revisions`, `POST /api/revisions/:id/restore`
- `POST /api/blobs`（按内容 hash 去重上传）, `GET /api/blobs/:hash`
- `POST /api/decks/:id/regenerate-slug`
- `GET /api/decks/:id/export` —— 服务端拼出离线 html（见 3.6）
- `GET /play/:slug` —— 免密公开播放页数据

## 6. 部署

- 新仓库 `viscio`：`web/`（Vite + React + TS）+ `server/`（Hono + better-sqlite3），与 riffle / homepage / Mnemos 平级，独立 git 仓库。
- `homepage/scripts/sync-viscio-src.sh`（照抄 `sync-mnemos-src.sh`）在构建前把 `viscio/{web,server}` 同步进 `homepage/viscio-src/`（gitignore，非源码真源）。
- `homepage/server/server.js` 新增中间件：拦截路径为 `/viscio` 或 `/viscio/*` 的请求，动态 import 编译好的 Viscio Hono app，用 `@hono/node-server` 的 `getRequestListener` 桥接进 Express 的 `(req,res)` 签名，转发前剥掉 `/viscio` 前缀——必须注册在 Express 的 body-parser 之前（Hono 自己读原始 body），完全照抄 `/mnemos` 现有写法。
- Dockerfile 增加一段 `viscio/web` 的 Vite build 构建阶段。
- 数据落在现有 `merged_data` 卷下的 `/data/viscio/*`，不新开 Fly app、不新开 Fly 卷。
- Autosave 复用 Mnemos 同款"唤醒重试"模式（Fly 冷启动约 7 秒，请求失败时自动重试并给出等待提示），但触发时机是交互结束后防抖（拖拽 `mouseup`、输入停顿），不是连续高频请求——因为 better-sqlite3 是同步写入，Express/Mnemos/Viscio 三个应用共享一个 Node 事件循环，高频大写入会拖慢同进程里的其它请求；配合第 4 节的 blob 去重，单次写入体积也保持很小。

## 7. 错误处理原则

- 自动保存失败：本地状态不丢失，界面提示"未保存"，随下次自动重试恢复；Ctrl+S 手动保存失败必须有明确的失败提示（不能静默失败——它同时是一次版本快照的触发点）。
- 图片/embed 上传失败：保留本地预览，允许重试，不阻塞其他编辑操作。
- 离线导出：导出前校验没有未保存的改动，若有则提示先保存再导出。

## 8. 测试策略

- 数据层：blob 去重、revisions 超过 10 条后的 FIFO 淘汰、slides 重排，用最小单元测试覆盖。
- 离线导出：至少一条端到端验证——导出的文件在断网、`file://` 协议下能正常打开并播放，三维图仍可交互（这是 review 中发现的真实风险点，必须有可跑的验证，不能只靠人工偶尔看一眼）。
- 认证隔离：验证同时登录 Mnemos 与 Viscio，两边登录状态互不覆盖（cookie 隔离回归测试）。

## 9. 明确不做（v1 范围外）

- 旋转元素
- 双屏演讲者视图（用每页备注框代替）
- 多人协作/并发编辑
- Quarto CLI / Pyodide / 任何服务端 Python
- 激光笔/画笔标注模式（放映时鼠标本身已经是可见指示器）
- 导出文件里多个 Plotly embed 的 plotly.js 去重合并

## 10. 验收标准

- 能新建一个 deck，画布上摆好形状、图片、文本框、一个 Plotly iframe 嵌入，全屏放映模式下能用键盘方向键/空格和翻页遥控器（PageUp/PageDown）翻页。
- 断网状态下，导出的离线 html 双击可以直接打开播放，三维图仍可交互。
- 连续编辑超过 10 分钟，版本历史里能看到自动快照；手动 Ctrl+S 也能立刻多一条；超过 10 条后最旧的被淘汰。
- 同时登录 Mnemos 和 Viscio 两边，互不顶掉对方的登录状态。
- 换一台电脑打开、或缩放浏览器窗口，同一个 deck 画布元素的相对位置不变形。
