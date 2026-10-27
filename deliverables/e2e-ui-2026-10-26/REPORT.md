# NavHub 4.0 全站人工模拟端到端测试报告

测试日期：2026-10-26 19:00–22:40（本地）
被测构建：`apps/web`（NavSphere 镜像，`next build` + `next start`，`NEXT_DIST_DIR=.next-audit-prod`）+ `apps/api` 中枢
执行方式：真实 Chrome（Playwright 1.64.1）全自动逐控件点击 + 主流程走查 + 边界场景 + 性能取样
产物目录：[deliverables/e2e-ui-2026-10-26](file:///C:/Users/许进龙/Desktop/web/deliverables/e2e-ui-2026-10-26)

---

## 0. 一页结论

| 维度 | 结果 |
|---|---|
| 路由可达性 | **67/67 路由 200**（含 20 个后台页、9 个 /me 子页、动态详情页）；无横向溢出 |
| 控件点击 | 首轮 599 个（440 有响应）+ 复扫 415 个（独立浏览器上下文）+ 8 轮专用探针复核 |
| 主流程 | 12 步核心流程 + 21 步前台交互 + 7 步补测：**全部走通**（5 个初判 FAIL 均查明为测试脚本入口标签错误） |
| 边界/异常 | 14 步全过（空表校验、非法 URL、超长输入、404 兜底、断网提示、并发、XSS 探针） |
| 确认缺陷 | **P0×1，P1×3，P2×8，P3×6** |
| 安全 | 1 条致命：**匿名访客可对中枢全量读写**（含 API Token 名册、类目增删、VACUUM、474KB 全库导出） |
| 性能 | 首屏中位数普遍 <700ms，API p50 ≤116ms；瓶颈集中在 **首页 LCP 3.3s/HTML 3.4MB**、**/admin/sitelist CLS 0.63 + 28.7k DOM**、**水合窗口 1.5–5.2s** |

**一句话**：功能面基本是好的——绝大多数按钮真的能用，此前一轮巡检报出的大片「无响应」经复核多为检测器盲区；真正的问题集中在**中枢鉴权默认关闭**、**类目停用的一砍全砍**、**视频中心是演示数据**、以及**首屏体量与水合延迟**。

---

## 1. 测试方法：为什么「点了没反应」要分三类

自动点击最容易犯的错，是把「我的探针看不见」当成「功能坏了」。本轮对每个初判「无响应」的控件都做了二次取证，判定链是：

1. **检测器盲区** —— 探针只比 `innerText` 长度、`[role=dialog]` 数量，会漏掉：SVG 图谱重绘、卡片换序（字数不变）、Radix 常驻隐藏 portal（基线 dialog 数就是 1）、`data-state` 开合、localStorage 写入但不改当前画布。
   → 复核手段：文本 FNV-1a 指纹、`svgSig`、`popupChanged`、布局串长度、标题集合比对、可见层尺寸判定（[harness.mjs:204](file:///C:/Users/许进龙/Desktop/web/deliverables/e2e-ui-2026-10-26/harness.mjs)）。
2. **自污染** —— 同一页面复用会被上一次点击改写的状态干扰（侧边栏折叠态写进 localStorage，重载也回不去）。
   → 复核手段：每路由一个全新浏览器上下文重扫（[03c-admin-resweep.mjs](file:///C:/Users/许进龙/Desktop/web/deliverables/e2e-ui-2026-10-26/03c-admin-resweep.mjs)）。
3. **水合延迟** —— DOM 就绪 ≠ 可点。定量方法：DOM ready 后每 500ms 重复点同一控件，直到出现预期信号（[11-interactive.mjs](file:///C:/Users/许进龙/Desktop/web/deliverables/e2e-ui-2026-10-26/11-interactive.mjs)）。

只有三类都排除后，才记为缺陷。第 6 节列出本轮**撤回的 13 条误报**。

覆盖范围（路由清单见 [routes.mjs](file:///C:/Users/许进龙/Desktop/web/deliverables/e2e-ui-2026-10-26/routes.mjs)）：

| 组 | 路由 | 点击控件 | 有响应 | 备注 |
|---|---|---|---|---|
| 前台公开 | 17 | 163 | 138 | 首页/目录/标签/专题/热榜/视频/图谱/算法/市场/DIY/偏好/投稿/导入/我的/收藏/离线 |
| 动态详情 | 16 | 101 | 98 | 站点详情、分类页（含翻页）、标签页、专题页、插件详情 |
| 登录态 | 14 | 47 | 35 | /me 全 9 子页、收藏、市场已安装/我的/发布/导入 |
| 管理后台 | 20 | 288 | 169 | 复扫 285/179；14 个改数据类按钮按风险策略跳过未点 |
| 链接校验 | — | 2085 条 | — | 内部死链 1 条，其余为外部站点（受本机出网限制不可判定） |

---

## 2. 按功能模块的测试结果

### M1 首页与全局工具栏 —— 通过

| 控件 | 结果 | 证据 |
|---|---|---|
| 主题切换 | 可用，但**首次点击需等 5.2s** | [11-interactive.json](file:///C:/Users/许进龙/Desktop/web/deliverables/e2e-ui-2026-10-26/results/11-interactive.json) |
| 微工具箱（T） | **可用**：弹出 768×537 面板，含 JSON/Base64/UUID | [24-home-dialogs.mjs](file:///C:/Users/许进龙/Desktop/web/deliverables/e2e-ui-2026-10-26/24-home-dialogs.mjs) |
| 快捷键指南（?） | **可用**：512×534 弹层，分组文案完整 | 同上 |
| 全局搜索 `/` 与 `Ctrl+K` | **均可用**：672×351 面板，含最近搜索与功能直达 | 同上 |
| Spotlight 打开延迟 | 面板唤出首次生效 4893ms（DOM ready 2927ms），长任务 8 个/1931ms，INP 336ms | [11-interactive.json](file:///C:/Users/许进龙/Desktop/web/deliverables/e2e-ui-2026-10-26/results/11-interactive.json) |
| 分类导航切换 | 可用（首页切「AI 编程助手」等） | 02-public 18 步 PASS |
| 站点卡片 | 444 张卡片全部是 `<a target="_blank">` 外链，**没有任何一张链向站内详情页** | 02-public 走查 |

首页 444 张卡片零站内链接意味着 `/site/<id>` 详情页只能从 `/sites`（60 条链接）进入。这是信息架构选择，不是坏链，但详情页的可达性与 SEO 内链明显偏弱。

### M2 站点目录与详情（/sites、/site/[id]） —— 通过

- 收藏 → 收藏页出现 → 取消收藏：闭环通过（主流程 3）。
- 详情页 收藏 / 复制链接 / 访问外链 / 相关站点：通过；剪贴板在无头环境不可读，按钮本身有 toast。
- 目录页 60 条 `/site/` 链接全部 200。

### M3 分类 · 标签 · 专题（/category、/tags、/collections） —— 有缺陷

| 项 | 结果 |
|---|---|
| /category 分类展开 | **可用**：`<details>` 逐个展开，1→2 展开数变化确认 |
| 分类页翻页 | **可用**：`/category/ai-tools` → `/category/ai-tools/p/2`，URL 与标题集合都变 |
| 标签页 | 可用；1120KB HTML / 8581 DOM 节点，偏重 |
| 停用类目连带 | **P1-2**：根类目 `AI 工具` 一旦被停用，其整棵子树的 `/category/<slug>` 全部变 404（A/B 取证见第 3 节） |
| 薄类目死链 | **P2-5**：`/category/bi-and-reporting`、`/category/k12-and-enrollment`（含 /p/2）稳定 404，中枢 `by-slug` 却能正常返回该类目 |

### M4 热榜 · 图谱 · 算法 · 视频（/hot、/graph、/algorithms、/videos） —— 视频有缺陷

- `/hot` 页签（访问量榜 / 最新入库榜）：**可用**，`aria-selected` 翻转 + 行集合变化 + `?tab=new` 落 URL（[14-final.mjs](file:///C:/Users/许进龙/Desktop/web/deliverables/e2e-ui-2026-10-26/14-final.mjs)）。
- `/graph` 力导图分类过滤：**可用**，节点数变化 −75 / −6，SVG transform 不变属正常（重排而非平移）。
- `/videos`：**P2-6**。页头文案写「按分类浏览视频与教程」，但 `精选视频 / 语文 / 七年级` 三个胶囊**根本不是交互控件**——它们是静态分类标题（DOM 探测：`main a,main button` 里匹配不到），`video-content.tsx` 只有侧栏开关与搜索框两个状态。加上数据本身是演示种子（3 个视频源，唯一条目是 bilibili 上的《唐伯虎点秋香》修复版，分类叫「语文/七年级」），这一页对用户等于空壳。

### M5 插件市场（/marketplace*） —— 通过，一处状态歧义

- 搜索 → 详情 → 安装 → 已安装 → 卸载：全闭环通过（`POST /api/hub/plugins/nordic-glacier/install` + toast + 已安装页命中 + 「全部 (1)」）。
- 7 个专题胶囊：**6 个生效**（卡片集合 60→20→28→30→10→60 全变），只有「🔥 飙升榜」点下去无变化——而它无变化是**正确行为**（默认态就是 `sort=trending && !kind && !q`，与它等价）。
- **P3-2**：默认态与点「全部插件」后，「全部插件」和「🔥 飙升榜」**两个胶囊同时高亮**（`isTopicActive` 两个分支同时为真，见 [plugin-market-board.tsx:377-396](file:///C:/Users/许进龙/Desktop/web/apps/web-overlay/src/components/plugin-market-board.tsx#L377-L396)），用户无法判断当前在看哪个榜。

### M6 DIY 工作台 + 偏好设置 —— DIY 通过，偏好有缺陷

- `/custom`：进入「自定义排版」= 编辑态（按钮 18→52）→「添加模块」弹库 → 点添加 → 画布模块 0→7 → 撤销可用。**模版胶囊/背景画布全部生效**（布局串长度 1633→1631→1635→1637，画布文本指纹同步变化）。首轮误判「模版按钮无反应」的原因是点的正是**当前已激活**的那个模版。
- 模块库弹窗 `Esc` **能关**（`[role=dialog]` 节点直接消失）；上一轮判「关不掉」是多弹窗叠加时取错了节点。
- 分享链接入口不在 `/custom`：`#diy=` 的入口是首页 DIY 工具栏那个**只有图标、title=「导出 / 导入配置 JSON」** 的按钮（[home-diy-toolbar.tsx:521-529](file:///C:/Users/许进龙/Desktop/web/apps/web-overlay/src/components/home-diy-toolbar.tsx#L521-L529)），且它和「添加模块」一样只在编辑态渲染——非编辑态下首页工具栏能取到的 title 只有「多选模式：批量导出 / 复制 / 置顶」。本轮未能稳定进入首页 DIY 编辑态，**分享闭环记为未定论**，不算缺陷也不给通过。
- **P2-1 偏好设置不持久化**：`/preferences` 唯一开关「深度思考 (Thinking)」，点下去 DOM `checked` true→false，**没有发出任何写请求**（只见 `GET hub/user/ai/config` 等读请求），`localStorage` 无变化，刷新后回到 true。页面上也没有「保存」按钮——用户改完就丢。

### M7 投稿与导入（/submit、/import） —— 通过

- 空表必填校验、非法 URL 拒绝、成功提交 toast：全过（3.4s 落库）。
- 书签导入：文件控件可见 → 本地解析 3.7s → 预览命中 → 确认导入文案正常。
- `/submit` 页面体量异常：246 个 DOM 节点却发 515KB HTML（见第 4 节）。

### M8 个人中心 / 收藏 / 离线（/me*、/favorites、/offline） —— 通过

- 9 个 /me 子页全部 200 且控件可点；`authed` 组 8 个 disabled 控件均为「无数据时正确置灰」。
- 匿名身份与登录身份切换后数据不串（`x-navhub-anon-id` cookie 绑定生效）。

### M9 管理后台（20 页） —— 功能可用，可访问性与反馈偏弱

| 项 | 结果 |
|---|---|
| 侧边栏分组折叠 | **可用**：链接 16→19（新增 分类管理/分类治理/站点管理），箭头 rotate 0→1，延迟 57–102ms |
| 分组按钮可访问性 | **P2-2/P2-3**：`aria-expanded` 全程缺失（`btnExpanded=null`），读屏无法知道展开/折叠 |
| 5 个页面无 `<h1>` | **P2-2**：/admin/navigation、/resources、/site、/sitelist、/videos 只有 h2「管理菜单」 |
| 刷新/重试图标按钮 | **P2-4**：网络请求正确发出，但界面**零反馈**（无 spinner、无 toast、无时间戳更新） |
| /admin/tags 首个标签按钮 | **P2-7**：`clickMs=1422ms` 且探针判无响应；该页 19276 DOM / 2365KB HTML |
| /admin/plugin-health | **P2-6**：`GET /api/hub/plugins/url-health/summary` → **404**（在被测构建里该中枢路由不存在；工作区已有未提交的实现） |
| 新建类目按钮 | 正常护栏：名称为空时 `disabled=true`，填入后解禁 → `POST categories` **201**，列表命中（此前判「新建入口不存在」是我按「新建分类/新增」找，真实文案是「新建类目」） |
| 名称视觉宽度守卫 | 超限时中枢正确返回 400（「类目标题…视觉宽度 11.5，超过 7 个单位」），但 **UI 不显示这条原因**，用户只看到点了没反应（P3-4） |
| 危险操作 | 14 个改数据按钮（删除/清空/重建/恢复等）按策略**未点**，只做了 DOM 与非破坏性探针 |

### M10 认证与身份 —— 页面层正常，代理层是 P0

- 登录（本地管理员快捷通道）940ms 落地 `/admin`；session 带 `role=admin`。
- 退出登录入口在侧边栏「本地管理员」下拉里，**可用**；落地 URL 变成 `http://localhost:3400/`（用 127.0.0.1 访问却被改写为 localhost，跨源回跳在 IP 访问场景会掉 cookie，P3-5）。
- 退出后再访 `/admin/tokens` → **正确回弹 `/auth/signin`**（页面层守卫有效）。
- 非白名单账号访问后台：AccessDenied 页如实渲染「该账号不在管理员白名单 (NAVHUB_ADMIN_IDS) 中…」，**不是缺陷**（此前判「未提示」是我的正则漏了）。

### M11 BFF 代理与中枢 API —— **P0**

匿名（无 session、无 Authorization）从公网 web 端口：

```
GET  /api/hub/api/tokens        -> 200  28 条 Token（含 name/scopes/ownerIdentity/tokenPrefix）
POST /api/hub/api/categories    -> 201  建出「巡检夹具乙」
DELETE /api/categories/<id>     -> 204  删除
PATCH /api/categories/reg-ai-tools {enabled:true} -> 200（本轮用于恢复被改坏的数据）
GET  /api/hub/plugins/url-health/summary -> 404（说明这条口子真的在中枢上开着，只是路由缺）
```

对照实验：同一中枢把 `NAVHUB_AUTH_REQUIRED=1` 起来后，匿名 `GET /api/stats` → **401**，匿名 `POST /api/admin/maintenance/vacuum` → **401**（[hub8903.log](file:///C:/Users/许进龙/Desktop/web/deliverables/e2e-ui-2026-10-26/hub8903.log)）。

代码根因两条：

1. 中枢默认开放：[apps/api/src/config.ts:474](file:///C:/Users/许进龙/Desktop/web/apps/api/src/config.ts#L474) `authRequired: bool("NAVHUB_AUTH_REQUIRED", false)`，`.env.example:89` 也是 `false`；匿名身份自带读写管理域。
2. BFF 无路径白名单：[apps/web/src/app/api/hub/[...path]/route.ts](file:///C:/Users/许进龙/Desktop/web/apps/web/src/app/api/hub/%5B...path%5D/route.ts) 把 `/api/hub/*` 原样转发到中枢任意 `/api/*`；身份裁决只收敛了「自称身份」（非 `anon-` 前缀 → 403），但**匿名身份本身在中枢是有管理权限的**，403 拦不住。
3. 兜底层也不存在：`apps/web/src/app/middleware.ts` 是个位置错误的空壳（Next 只认 `middleware.ts` 或 `src/middleware.ts`），函数体整段是 `// TODO: 添加身份验证逻辑` 并 `return NextResponse.next()`；审计构建产物里**连 middleware-manifest.json 都没有**，即注册数为 0。

---

## 3. P1-2 的 A/B 取证（同时也是本轮的方法学坦白）

`/category/<slug>` 一度全线 404。逐层定位：

| 观测 | 隔离副本 :8900 | 未触碰的开发栈 :8787 |
|---|---|---|
| `/api/categories` 总数 | 234 | 234 |
| `reg-ai-tools.enabled` | **false** | **true** |
| 其余 233 条全字段 | 完全一致 | — |

结论：本轮**后台控件巡检把「启用/停用」当成普通按钮点了**（风险正则只跳 `删除` 类，`启用|停用` 归在 mutate 未跳），把根类目 `AI 工具` 停用了；而 `/category/[slug]/page.tsx:75-77` 对隐藏/不合格类目直接 `notFound()`，于是一停全停、整棵子树变 404。

数据已恢复（`PATCH {enabled:true}` → 200，`/category/frontend-development` 回到 200；`ai-tools` 仍 404 是 Next 缓存住了那次 notFound，等 TTL 或再访问触发重校验）。

这条**同时是产品缺陷**（记 P1-2）：一个根类目的「停用」按钮**没有二次确认、没有影响面提示**，点下去会把整棵子树的对外页面全变 404；巡检框架的教训也已回写（mutate 类按钮在后台页须跳过或加确认）。

---

## 4. 性能与流畅度

### 4.1 首屏（重复 3 次取中位，单位 ms/KB）

| 路由 | wall | TTFB | LCP | CLS | 长任务 | DOM | HTML |
|---|---|---|---|---|---|---|---|
| / | **1243** | 67 | 700 | 0.078 | **488** | **13219** | **2875KB** |
| /tags | 1309 | 21 | 568 | 0 | 0 | 8569 | 1119KB |
| /marketplace | **1564** | **235** | 820 | 0 | 53 | 5342 | 799KB |
| /sites | 607 | 14 | 192 | 0 | 0 | 594 | 153KB |
| /category | 510 | 12 | 108 | 0 | 0 | 336 | 76KB |
| /hot | 606 | 11 | 224 | 0 | 171 | 874 | 198KB |
| /videos | 527 | 30 | 240 | 0 | 54 | 344 | 80KB |
| /custom | 498 | 8 | 76 | 0.007 | 0 | 524 | 86KB |
| /preferences | 515 | 10 | 128 | 0.062 | 0 | 326 | 62KB |
| /admin | 541 | 52 | 236 | 0.002 | 109 | 1417 | 177KB |
| /admin/sitelist | **1183** | 143 | 804 | **0.631** | **764** | **28682** | **3770KB** |
| /admin/tags | 849 | 42 | 452 | 0.018 | 117 | 19276 | 2365KB |
| /admin/stats | 563 | 68 | 180 | **0.473** | 0 | 816 | 114KB |
| /admin/categories | 730 | 126 | 320 | 0.019 | 0 | 5308 | 756KB |

冷启动首采（每路由新页面，含 JS 传输）最差项：`/` wall 3642ms / LCP **3328ms** / 876KB 传输 / 15702 DOM；`/admin/resources` 3379ms；`/admin/stats` 3175ms；`/admin/taxonomy` 2898ms。
最差 TTFB：`/admin/videos` 564ms、`/admin/site` 514ms、`/admin/plugin-health` 335ms、`/marketplace/*` 240–272ms。
移动端 390×844：`/` 2418ms、`/marketplace` 2364ms、`/tags` 1512ms，**无横向溢出，CLS 全 0**。
API 直连最快也最慢的一项：`/api/plugins?limit=60` p50 **116ms**/max 199ms/103KB；`/api/sites?limit=200` p50 75ms/145KB；其余 p50 ≤41ms。
交互延迟（点击→两帧）：Spotlight 20ms、热度密度 49ms、台账搜索输入 30ms、偏好开关 85ms —— 都健康；`/admin/tags` 首个标签按钮 1422ms 无反馈是唯一异常项。

> 说明：`06-perf` 的 `jsKB=0` 是同一上下文复测命中 HTTP 缓存导致 `transferSize=0`，不是项目问题；JS 体量以首采 `01-crawl` 为准（`/` = 556KB）。

### 4.2 针对性优化建议（按收益排序）

1. **首页瘦身（最高收益）**：`/` 冷采 LCP 3328ms、HTML 3438KB、DOM 15702、JS 556KB、长任务 644ms。444 张卡片一次性 SSR 全量吐进 HTML。
   → 首屏只渲染可见 1–2 屏（约 60–80 张），其余走 `/api/sites?limit=&offset=` 增量 + `content-visibility:auto`；卡片 HTML 模板压掉重复属性（当前每卡 ≈7.7KB）。目标：HTML <900KB、DOM <6000、LCP <2.0s。
2. **/admin/sitelist 与 /admin/tags**：CLS 0.63 / DOM 28682 / 长任务 764ms、2365KB HTML。整表一次性渲染。
   → 虚拟列表（`@tanstack/react-virtual`）+ 服务端分页；表格列宽固定 + 表头/行预留骨架高度，CLS 直接归零；搜索输入加 200ms 防抖（当前 clickMs 918ms）。
3. **压缩水合窗口（交互「点了没反应」的真凶）**：`/admin/stats` DOM ready 337ms 但首次生效 1475ms；`/` 主题切换 5217ms、Spotlight 4893ms；长任务 1931ms 集中在水合期。
   → 把工具栏/搜索/主题这些**首屏可见的小交互**从大组件里拆出来，单独早水合（`use client` 边界最小化 + `priority` 预加载其 chunk）；图谱/统计图表等重模块继续懒加载但配 skeleton 点击态；长任务用 `startTransition` 切片。
4. **/marketplace TTFB 235ms + 103KB 响应**：`/api/plugins?limit=60` p50 116ms 是全库最慢。
   → 列表接口做投影裁剪（返回卡片所需字段，去掉 README/截图数组），加 `ETag` + 60s `max-age`（已有 cache 配置则确认是否被 `no-store` 覆盖）；首屏 24 条分页而非 60。
5. **/submit 515KB HTML / 246 DOM**：单表单页面却发出全站最大的 HTML/DOM 比。
   → 检查该页是否把全站类目树 + 插件列表 + SEO 预取一起内联；把可选类目改为异步 combobox。
6. **消除 prefetch 噪声**：47 条路由都有对 `/me`、`/marketplace` 的 RSC 预取失败记录（`GET /me?_rsc=… undefined`）。
   → 给这些 `<Link>` 加 `prefetch={false}`（或只对视口内预取），减少 dev/prod 日志噪声与流量浪费。
7. **后台页 TTFB >500ms 的三项**（/admin/videos 564、/admin/site 514、/admin/plugin-health 335）：
   → 页面组件里把多个中枢串行读改为 `Promise.all` + 局部 Suspense；`plugin-health` 顺带补上缺失的 `url-health/summary`。

---

## 5. 主流程与边界场景

**核心流程（12 步 + 7 步补测）全部通过**：登录 → 账号信息 → 收藏闭环 → 投稿（校验/非法 URL/成功）→ 书签导入 → 市场搜索/详情/安装 → 卸载 → DIY 添加模块/移动/保存/撤销 → 模版对话框 → 偏好开关 → 后台新建类目 → 退出登录回弹。

初判 5 个 FAIL 的真实原因（都已在第 3 轮按源码条件重跑通过）：

| 初判 | 真相 |
|---|---|
| 「未找到添加模块入口」 | 该按钮只在 `isEditing` 时渲染，入口是「自定义排版」（[modular-canvas.tsx:470-545](file:///C:/Users/许进龙/Desktop/web/apps/web-overlay/src/components/modular/modular-canvas.tsx#L470-L545)） |
| 「DIY 分享链接 Execution context destroyed」 | 脚本被上一步导航打断；分享入口在首页 DIY 工具栏图标按钮，不在 /custom |
| 「偏好/后台两步 FAIL」 | 是导航级联打断，不是页面问题；重跑后偏好页正常渲染（但暴露 P2-1） |
| 「未找到退出登录入口」 | 藏在侧边栏「本地管理员」下拉里，两步点开正常 |

**边界/异常 14 步全过**，其中值得记的：

- XSS 探针（`AUDITMARK9137` + `<img onerror>`）注入分类名：`badEls=0`、`inlineWithMark=0`、标记只出现在 input 的 `.value` 里 → **未见注入执行面**。
- 404 路由：`/404-probe-not-exist` 正常出兜底页，但控制台有 **React #418 hydration 报错**（P3-1）。
- 中枢不可用：BFF 正确返回 502 + `retryable`；上游卡死返回 504 并把等待秒数写进文案。
- 外链重试对照：`podcastle.ai`、`copy.ai`、`x.ai` 等首轮 403/timeout、二轮 200 → 本机出网抖动，**外部坏链统计不可作为结论**。

---

## 6. 撤回的误报（13 条）

本轮把下面这些「看着像缺陷」的判据逐条复核后撤回，留档以免下次再被同样的假象带走：

1. 首页「微工具箱 / 快捷键指南」点了没开 → 实测 768×537、512×534 弹层正常打开；误判源于基线 dialog 计数已是 1。
2. `/marketplace` 页签全死 → 6/7 生效，「飙升榜」等价于默认态。
3. `/hot` 榜单切换死 → 页签工作正常，是我按「30天/新品」正则找错了名字（真实是 访问量榜/最新入库榜）。
4. `/category` 下一页死 → 正常，URL 与标题集合都变。
5. `/custom` 模版按钮无反应 → 点的是当前已激活项。
6. 模块库弹窗 Esc 关不掉 → 能关，多弹窗叠加取错节点。
7. 后台侧边栏分组不导航 → 折叠展开有效（16→19 链接）；真缺陷只是缺 `aria-expanded`。
8. 「插件安装不持久」→ 安装写请求 + toast + 已安装计数都对。
9. 「AccessDenied 不提示」→ 页面如实打印白名单原因。
10. 「分类注入风险」→ 探针未见注入执行面。
11. 「middleware 会 401 一切」→ 该文件根本没被注册（不是 401，是没有守卫）。
12. 「新建类目入口不存在/按钮坏了」→ 文案是「新建类目」，且 disabled 是空名称护栏。
13. 「/videos 筛选控件失效」→ 更准确的说法是**这一页没有筛选控件**（P2-6），而不是控件坏了。

---

## 7. 问题清单（分级）

| 级别 | 编号 | 标题 | 证据 | 建议 |
|---|---|---|---|---|
| **P0** | P0-1 | 匿名可对中枢全量读写（Token 名册 / 类目增删 / VACUUM / 全库导出） | `GET /api/hub/api/tokens`→200×28；`POST/DELETE categories`→201/204；`NAVHUB_AUTH_REQUIRED=1` 对照 401 | 生产 compose 与 `.env` 默认改 `true`；`/api/hub` 加**路径白名单 + 方法门禁**（`admin/*`、`tokens`、`backup/*`、`trash` 仅会话域）；匿名域只放开读公开面 |
| **P1** | P1-1 | 无任何 Next 中间件；`src/app/middleware.ts` 是位置错误的 TODO 空壳 | 构建产物无 `middleware-manifest.json`；文件第 6 行 `// TODO: 添加身份验证逻辑` | 移到 `src/middleware.ts` 并实现会话校验，或明确放弃中间件层、把守卫坐实在 BFF |
| | P1-2 | 停用根类目 → 整棵子树 `/category/*` 全 404；无二次确认、无影响面提示 | 副本 vs 开发库 234 条逐字段对比，仅 `reg-ai-tools.enabled` 不同 | `停用` 加确认 + 「将同时下线 N 个子类目页」提示；类目页 404 前先看父链 |
| | P1-3 | `/videos` 承诺「按分类浏览」但无筛选控件，数据为演示内容 | DOM 探测胶囊非交互；`video-content.tsx` 只有侧栏/搜索两个 state；条目是《唐伯虎点秋香》 | 接上分类筛选（锚点或状态过滤 + `aria-pressed`）；替换种子数据 |
| **P2** | P2-1 | 偏好「深度思考」开关不持久化（无写请求、无保存按钮、刷新回落） | `checked true→false→true`，网络只见 GET | 切换即 `PATCH hub/user/ai/config`，失败回滚 + toast |
| | P2-2 | 5 个后台页无 `<h1>` | /admin/navigation、/resources、/site、/sitelist、/videos 只有 h2「管理菜单」 | 补页面级 h1 |
| | P2-3 | 侧边栏分组按钮缺 `aria-expanded` | `btnExpanded=null`，展开仅靠箭头旋转 | 加 `aria-expanded` + `aria-controls` |
| | P2-4 | 刷新/重试图标按钮零反馈 | 请求正确发出，UI 无 spinner/toast/时间戳 | 统一 loading 态 + 完成 toast |
| | P2-5 | 薄类目页稳定 404 但中枢 by-slug 正常 | `/category/bi-and-reporting`、`/category/k12-and-enrollment`（+ /p/2）404 | 列表/导航不要链未达标类目，或降级为「内容整理中」页 |
| | P2-6 | `/admin/plugin-health` 依赖的中枢路由在**被测构建**里不存在 | `GET /api/hub/plugins/url-health/summary` → 404（直连 :8900 同样 404）。注意：`/api/plugins/url-health/summary` 已存在于**未提交的工作区**（[apps/api/src/routes/plugin-audit.ts:456](file:///C:/Users/许进龙/Desktop/web/apps/api/src/routes/plugin-audit.ts#L456)，并行会话 +1009 行改动），只是没进本轮所测的构建 | 随并行改动一起发布即可关闭；发布后需回归该面板 |
| | P2-7 | `/admin/tags` 首个标签按钮 1422ms 无反馈 | `06-perf` 交互项 | 见 §4.2-2/3 |
| | P2-8 | 首页 444 卡片零站内详情链接，`/site/[id]` 只能从 /sites 进 | 02-public 走查 | 卡片标题或菜单里给一条站内详情入口 |
| **P3** | P3-1 | 404 页触发 React #418 hydration 报错 | `01-crawl` pageErrors | 404 边界补 `suppressHydrationWarning` 或修日期/随机文案 |
| | P3-2 | 市场专题胶囊双高亮（全部插件 + 飙升榜同时 active） | `18-mkt2.json` `chipActive=["全部插件","🔥 飙升榜"]` | `all` 与 `trending` 判定互斥 |
| | P3-3 | 47 条路由的 RSC prefetch 失败噪声（/me、/marketplace） | `01-crawl.withFailedRequest` | `prefetch={false}` |
| | P3-4 | 类目名视觉宽度守卫拒绝时 UI 不显示原因 | `POST categories` 400，界面静默 | 把 `guardMessage` 打到表单错误位 |
| | P3-5 | 退出登录把 127.0.0.1 改写成 localhost 回跳 | `21-flows3` 落地 URL | 用同源相对回跳或校正 `AUTH_TRUST_HOST` |
| | P3-6 | DIY 分享入口是纯图标按钮（`title=导出 / 导入配置 JSON`），只在首页 DIY 编辑态渲染，可发现性差 | `22-focus2` a 段：非编辑态只能取到「多选模式」一个 title | 图标按钮加可见文案或收进「…」菜单 |

---

## 8. 复现、产物与环境说明

```bash
cd deliverables/e2e-ui-2026-10-26
node 01-crawl.mjs        # 67 路由可达性 + 性能普查
node 03-sweep.mjs <组>   # 逐控件点击（public/dyn/authed/admin）
node 03c-admin-resweep.mjs   # 每路由独立上下文复扫（判定以此为准）
node 02-public.mjs; node 04-flows.mjs; node 21-flows3.mjs; node 23-cat.mjs
node 05-edge.mjs; node 06-perf.mjs
node 10-focus.mjs; node 11-interactive.mjs; node 14-final.mjs
node 15-mkt-sidebar.mjs; node 16-custom.mjs; node 17-custom2.mjs; node 18-mkt2.mjs
node 22-focus2.mjs; node 24-home-dialogs.mjs
node 08-aggregate.mjs    # 汇总 -> results/08-raw-summary.md
```

隔离措施：中枢 `:8900`（副本库 `data/e2e/navhub-ui-audit.db`，由 better-sqlite3 `backup()` 生成）、Web `:3400`（`NEXT_DIST_DIR=.next-audit-prod`）；全程未触碰并行会话的 `:8787`/`:3200` 与共享开发库；只读对照查询外，未对并行栈做任何写操作。

数据回写：巡检中被误停的 `reg-ai-tools` 已恢复 `enabled=true`；巡检夹具站点与「巡检夹具乙」类目均已删除（类目总数回到 234）；回收站内留有夹具记录（副本库，不影响真实数据）。

本轮**未做任何代码改动，也未提交/推送**——所有写入都是测试夹具与恢复操作。
