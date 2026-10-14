# 03 · apps/web —— Next.js 前端

> package 名 `navsphere`（**不是** `@navhub/web`），Next.js 15 App Router + React 18.2 + Tailwind CSS 4。
> 派生自 [NavSphere](https://github.com/tianyaxiang/NavSphere)（MIT），通过 **vendoring + overlay** 机制跟进上游。

## 1. 与 NavHub 的关系：一条接缝、两个函数

```
NavSphere 前端（69 处调用点，零改动）
   │
   ├── getFileContent(path)  ─┐
   └── commitFile(path, ...) ─┤   [github.ts 门面，签名不变]
                              ▼
                    StorageAdapter（storage-adapter.ts）
                              │  STORAGE_ADAPTER 决定后端
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
           github            http（默认）      sqlite
      GitHub Contents API   /api/storage    同进程直连（Web 端已禁用）
```

**核心思想**：NavSphere 全站持久化只经过两个函数，因此只要替换实现、不改调用点，整个后台（增删改查、拖拽排序、投稿审核、导入导出）就整体切换到了真实数据库。

### 1.1 `storage-adapter.ts` —— 前端持久化唯一接缝

[storage-adapter.ts](file:///c:/Users/许进龙/Desktop/web/apps/web/src/lib/storage-adapter.ts)：

```ts
export type StorageAdapterKind = "github" | "http" | "sqlite";

export interface StorageAdapter {
  readonly kind: StorageAdapterKind;
  read(path: string): Promise<unknown>;
  write(path: string, content: string, message: string): Promise<{ ok: true; note?: string }>;
}
```

| 导出 | 说明 |
| --- | --- |
| `resolveAdapterKind(env)` | 解析 `STORAGE_ADAPTER`，非法值抛 `StorageError`（默认 `"http"`） |
| `createHttpAdapter(opts)` | `GET/PUT {base}/api/storage`，15s 超时（AbortController），可带 Bearer token |
| `createGithubAdapter(opts)` | GitHub Contents API；**404 返回空结构而非抛错**；写入先取最新 sha，sha 冲突**有限重试 3 次**（500ms 退避） |
| `createSqliteAdapter(load)` | 惰性 `import()` `@navhub/api` 的 `readStoragePath/writeStoragePath` |
| `createStorageAdapter(config)` | 工厂，按 `kind` 分发并校验配置齐全 |
| `StorageError` | 携带可选 `status`；**刻意用显式字段声明而非构造函数参数属性**——`--experimental-strip-types` 不支持会生成运行时代码的语法 |

### 1.2 `github.ts` —— 保持原签名的门面

[github.ts](file:///c:/Users/许进龙/Desktop/web/apps/web/src/lib/github.ts)：

- **惰性单例** `getAdapter()`：避免每个请求重建适配器（重复读环境变量与构造闭包）
- `getFileContent<T>(path)`：签名与原版完全一致 → 69 处调用点无需修改
- **三级兜底策略**：

| 情况 | 行为 | 是否告警 |
| --- | --- | --- |
| 中枢返回 `null`（文件从未写入） | **静默**回退到构建期基线 | 否——正常状态；否则 `videos.json` 这类文件每个请求刷日志，淹没真问题 |
| 中枢返回数据但内容为空 | 告警后回退 | 是 |
| 读取失败（中枢不可达/报错） | 告警后回退 | 是 |

基线数据（构建期内联）：`@/navsphere/content/{navigation,site,videos}.json`——**内容兜底**而非配置兜底，保证「中枢没起来」「库是空的」两种情况仍呈现可用导航页而非白屏。

- **`STORAGE_ADAPTER=sqlite` 在 Web 端被显式拒绝**：直连要把 `@navhub/api` 打进前端产物，构建期 `Module not found`；正确做法是中枢与前端同机 + `http` 指向 `127.0.0.1`。
- `STORAGE_ADAPTER=github` 必须配 `GITHUB_OWNER` + `GITHUB_REPO`，写 token 从 `auth()` 会话优先、回退 `GITHUB_PAT`。

## 2. `/api/hub/*` 运行时代理

[route.ts](file:///c:/Users/许进龙/Desktop/web/apps/web/src/app/api/hub/[...path]/route.ts)：

```ts
const HUB_BASE = (process.env.NAVHUB_STORAGE_BASE_URL
               ?? process.env.NEXT_PUBLIC_API_URL
               ?? 'http://localhost:8787').replace(/\/$/, '')
```

**为什么用路由而不是 `next.config.js` 的 rewrite**：rewrite 目标在**构建期**求值固化，改中枢地址必须重新构建；本路由在**运行时**读环境变量，换地址只需重启前端进程。

| 关注点 | 处理 |
| --- | --- |
| CORS | 与浏览器同源相对路径通信，**无 CORS 问题** |
| Docker 内部主机名 | `api:8787` 浏览器解析不了，但服务端能 |
| 透传头 | `content-type` / `accept` / `authorization` |
| **透传 `X-Forwarded-For`** | 中枢限流按 `req.ip` 分桶；不传则所有访客共享一个桶（投稿第 6 位就被 429）。Next 15 已移除 `NextRequest.ip`，无 XFF 时只能退回对端地址 |
| 空响应体 | 给 `{}`，避免前端 `JSON.parse` 炸裂 |
| 中枢不可达 | 返回 **502** `{error: "NavHub 中枢不可用"}` |
| 方法 | GET / POST / PUT / PATCH / DELETE 全转发 |

> `next.config.js` 的 `rewrites()` 只保留 `/api/auth/*` 与 `/auth/*` 两条。

### 2.1 路径归一化（历史 BUG 教训）

[navhub-api.ts](file:///c:/Users/许进龙/Desktop/web/apps/web/src/lib/navhub-api.ts#L16-L32)：

```ts
const BASE = '/api/hub'
function hubUrl(path: string): string {
  const normalized = path.replace(/^\/api(\/hub)?(?=\/)/, '')
  return BASE + normalized
}
```

**BUG 教训**：`getJson` 已拼 `BASE`，调用方又传 `/api/...`，产生 `/api/hub/api/search` 双重前缀 → 中枢 404 → 搜索/标签/榜单/详情数据**全部静默变空**。现统一兼容 `'/api/search'`、`'/search'`、`'/api/hub/search'` 三种写法（`hubUrl` 已导出供测试）。

### 2.2 读写双路径分工

| 数据 | 路径 | 时机 |
| --- | --- | --- |
| 首页导航数据（navigation.json） | 服务端 `getFileContent` | **SSR，零延迟** |
| 搜索 / 收藏 / 标签 / 榜单 / 事件 | `navhub-api.ts` REST 客户端 | **CSR，按需加载** |

**降级原则（与中枢一致）**：任何网络失败都返回可用的空结果并标 `degraded`，**绝不把异常抛给 UI**——导航站首屏体验不能依赖中枢可用性。

`navhub-api.ts` 导出：`searchSites`、`reportClick`（fire-and-forget）、`fetchTags`、`fetchTrending`、`fetchNewSites`、`fetchSite`、`fetchSimilar`、`listFavorites/addFavorite/removeFavorite`、`fetchSearchHistory`、`hubGet/hubSend`。

## 3. 路由地图

### 3.1 页面（`src/app/**/page.tsx`）

| 路由 | 功能 |
| --- | --- |
| `/` | 首页导航（SSR 读中枢） |
| `/site/[id]` | 站点详情 |
| `/tags`、`/tags/[slug]` | 标签云 / 标签结果页 |
| `/hot` | 热度榜 |
| `/favorites` | 我的收藏（localStorage 优先 + 登录后云端合并） |
| `/preferences` | **我的偏好**（个性化画像可见性与重置：展示 `topCategories`/`topTags`/`visitedSiteIds`/`searchCount`，「重置画像」调 `DELETE /api/profile` 并明示收藏与搜索历史不受影响） |
| `/submit` | 投稿 |
| `/import` | 导入 |
| `/custom` | 自定义 |
| `/graph` | 生态关系图 |
| `/algorithms` | 算法实验室（LinUCB / 双曲等） |
| `/videos`、`/videos/player` | 视频导航 |
| `/auth/signin`、`/auth/error` | 登录（next-auth） |
| **`/admin`** | 管理后台 |

### 3.2 管理后台（`/admin/*`）

| 路由 | 功能 |
| --- | --- |
| `/admin` | 仪表盘 |
| `/admin/navigation`、`/admin/navigation/[id]`、`.../items`、`.../categories`、`.../categories/[categoryId]/items`、`.../subcategory/[subId]` | 导航树管理（类目/子类目/条目） |
| `/admin/sitelist` | 站点列表（删除走软删除，对话框与提示文案已改为「移入回收站，可恢复」语义） |
| `/admin/trash` | **回收站**：列软删站点（标题/描述/网址/标签/时间），逐行「恢复」（遇 409 URL 冲突给出可操作提示）与「彻底删除」（`window.confirm` 后调 `DELETE /api/trash/:id`） |
| `/admin/site` | 站点配置 |
| `/admin/submissions` | 投稿审核队列 |
| `/admin/jobs` | **任务面板**（JobRunner） |
| `/admin/audit` | **审计日志**：时间/执行者（token 名或 api）/动作/目标/diff 摘要，点击行展开完整 diff；支持 `action`/`actor` 过滤与分页加载 |
| `/admin/stats` | **运营看板**（热门搜索 / 零结果搜索 / 热度榜） |
| `/admin/resources`、`/admin/resources/download` | 资源管理 |
| `/admin/data` | 数据管理（导入导出） |
| `/admin/videos` + 嵌套 | 视频导航管理 |

### 3.3 Next.js API 路由（`src/app/api/**/route.ts`）

| 分组 | 路由 | 说明 |
| --- | --- | --- |
| **中枢代理** | `/api/hub/[...path]` | ★ 转发到 NavHub 中枢（见 §2） |
| 认证 | `/api/auth/[...nextauth]` | next-auth v5 |
| NavSphere 业务 | `/api/navigation*`（含 `reorder` / `restore` / `check-default` / `[id]` / `[id]/items` / `[id]/categories`）、`/api/site`、`/api/site-config`、`/api/home/*`、`/api/videos*`、`/api/resource*`、`/api/extension/[id]` | 走 `getFileContent/commitFile` → StorageAdapter |
| 工具 | `/api/favicon`、`/api/favicon-im`、`/api/website-metadata`、`/api/health`、`/api/search`、`/api/submissions` | |

> **注意**：这些路由是 NavSphere 原有结构（16 个 route 文件），它们内部都只调用那两个存储函数——所以才「零改动切换」。

## 4. 关键组件（`src/components/`）

### 4.1 `SearchPalette` —— 接入混合检索的命令面板

[search-palette.tsx](file:///c:/Users/许进龙/Desktop/web/apps/web/src/components/search-palette.tsx)（`'use client'`）

与上游 `search-bar` 的区别：上游只在客户端对 `navigation.json` 做 `includes()` 过滤，**拼音/语义/BM25/个性化全部闲置**；本组件把同一个 ⌘K 面板接到 `/api/search`。

| 工程要点 | 实现 |
| --- | --- |
| 防抖 | **200ms** `setTimeout` |
| 取消在途请求 | `AbortController`，每次新输入先 `abort()`（快打字不抖动、不竞态） |
| 通道徽标 | `CHANNEL_LABELS = { exact:'精确', fts:'全文', pinyin:'拼音', semantic:'语义', personal:'个性化' }` |
| 降级提示 | `degraded` 明示中枢不可用，**不假装「没有结果」**；`semanticAvailable` 提示语义可用性 |
| 空查询 | 展示服务端最近搜索（匿名 `anonId` 也可用） |
| 快捷键 | `⌘K / Ctrl+K` 聚焦，`Esc` 关闭，点击外部关闭 |
| **零结果兜底** | 空态渲染 `suggestions`（推荐搜索词胶囊）与 `popular`（热门搜索胶囊），点击直接填入查询框；`fallback` 命中时显示琥珀色横幅「已放宽到全库匹配 / 放宽匹配后的结果」——诚实提示而非假装精确 |
| **分页** | 首页 `limit=12`；`hasMore` 时渲染「加载更多（已显示 N 条）」，点击 `loadMore()` 追加下一页。`offsetRef` 用 **ref 而非 state**——避免其变化误触发第一页重查（第一页 effect 的依赖不含 offset）；新查询/清空时归零 |
| 智能卡片 | `parseSpeculativeIntent`（推断意图）、`parseTechComparisonQuery`（技术栈对比）、`findMatchingArchitectureRecipe`（架构配方）——对应 core 的三个模块 |
| 点击 | `reportClick(site.id, identity)` 上报事件（联动热度与画像） |
| **关键词高亮** | 结果行的标题与描述走 [lib/highlight.ts](file:///c:/Users/许进龙/Desktop/web/apps/web/src/lib/highlight.ts) 的 `highlightParts(text, query)` → `Highlighted` 组件（命中片段加 `text-primary bg-primary/10`）。与上游 `search-bar` 的 `highlightText` 的区别：上游把 query **原样**塞进 `new RegExp(query)`——含 `+` `(` `.` 等元字符会抛异常或误匹配；这里逐 token 转义、长 token 优先、支持多词查询（任一命中即高亮）。拼音/语义召回无字面命中，不高亮是正确行为 |

### 4.2 其他组件

| 组件 | 用途 |
| --- | --- |
| `navigation-content.tsx` / `navigation-card.tsx` / `NavigationSidebar.tsx` 等 | 导航树渲染（上游体系） |
| `favorite-button.tsx` + `hooks/useFavorites.ts` | 收藏（localStorage 优先，登录后云端同步，JSON 导入导出） |
| `bookmark-importer.tsx` | 书签导入（直接 `POST /api/hub/sites`） |
| `submission-form.tsx` | 投稿表单 |
| `search-bar.tsx` | 上游原生搜索条（客户端过滤） |
| `speculative-intent-card.tsx` / `tech-comparison-card.tsx` / `architecture-recipe-card.tsx` | 智能结果卡片 |
| `ecosystem-graph.tsx` | 生态关系图 |
| `algorithm-lab.tsx` | 算法实验 UI |
| `site-favicon.tsx` / `site-peek-dialog.tsx` | 图标 / 悬停预览 |
| `pwa-register.tsx` / `offline-banner.tsx` | PWA 注册 + 离线提示 |
| `predictive-prefetch-provider.tsx` | 预测性预连接（对应 core 的 `prefetch.ts`） |
| `theme-provider.tsx` / `mode-toggle.tsx` / `providers.tsx` | 主题与全局 Provider |

### 4.3 `src/lib/` 其他

`auth.ts` / `auth.config.ts`（next-auth）、`session.ts`、`identity.ts`（anonId 生成）、`api.ts`、`data-loader.ts`、`navigation-tree.ts`、`icons.ts`、`utils.ts`、`prefetch.ts`、`speculative.ts`、`comparison.ts`、`architecture-recipe.ts`、`vault.ts`、`buffer-utils.ts`、`polyfills.ts`、`highlight.ts`（搜索高亮纯函数，见 §4.1）、`export-formats.ts`（导出格式纯函数，见 §4.4）。

> `lib/{speculative,comparison,architecture-recipe,vault,prefetch}.ts` 是 core 同名算法的**前端包装**（浏览器侧不带 `@navhub/*` 依赖，走 HTTP 或内联）。

### 4.4 导出格式（`lib/export-formats.ts`）

数据管理页（`/admin/data`）在 JSON 之外补两种可迁移格式（纯函数、可测）：

| 格式 | 函数 | 用途与要点 |
| --- | --- | --- |
| Chrome 书签 HTML | `toBookmarksHtml(data, now?)` | Netscape Bookmark File Format，浏览器「导入书签」原生识别。`<!DOCTYPE NETSCAPE-Bookmark-file-1>` **大小写必须原样**（浏览器按字面量识别）；标题/描述做 HTML 转义（`& < > "`），否则破坏标签结构 |
| CSV | `toCsv(data)` | 列：`分类,子分类,标题,网址,描述`。**两层转义**：含 `"` `,` 换行 → 双引号包裹 + `"` 加倍；以 `= + - @` 开头加前导 `'`——**CSV 注入防护**（站点标题/描述来自投稿，Excel 会把 `=...` 当公式执行） |

入口：`/admin/data` 操作面板的「导出书签 HTML」「导出 CSV」按钮；JSON 非法时提示而不静默导出空文件。
MCP 侧另有 `export_sites` 工具（read scope，json/csv，见 [07-mcp.md §3](./07-mcp.md)）。

## 5. PWA

| 部分 | 位置 | 说明 |
| --- | --- | --- |
| Manifest | [manifest.ts](file:///c:/Users/许进龙/Desktop/web/apps/web/src/app/manifest.ts) | **静态值**（不走中枢配置）——manifest 被浏览器缓存且参与安装提示，动态化收益低、风险高（中枢不可用时安装元信息会丢）。`standalone` + 主题色 `#378ADD` + 快捷方式（热度榜/标签云/我的收藏） |
| Service Worker | `public/sw.js` | 导航 **network-first** 离线回退；**API 不走缓存**；静态资源 SWR |
| **更新提示** | [pwa-register.tsx](file:///c:/Users/许进龙/Desktop/web/apps/web/src/components/pwa-register.tsx) | 监听 `updatefound` → `installed` 且**当前页已被旧 SW 控制**（`navigator.serviceWorker.controller` 存在）才提示「有新版本可用」（刷新/稍后浮条）——首次安装时 `controller` 为 null，**不提示**（首次访问不该被要求刷新）。点「刷新」→ `location.reload()`；`controllerchange` 自动刷新用 `updatePromptedRef` + `sessionStorage('pwa-reloaded')` 双闸门，**避免首次 `clients.claim()` 误触发刷新**与多标签页重复刷新 |
| 图标 | `scripts/gen-pwa-icons.mjs` | 从 SVG 栅格化生成 192 / 512 / maskable / apple-touch-icon |

## 6. 上游 vendoring 与 overlay 机制

### 6.1 目录关系

```
apps/web            ← 实际运行的前端（上游 + 自研覆盖）
apps/web-overlay    ← NavHub 自有文件的唯一事实源（自研部分）
```

[UPSTREAM.md](file:///c:/Users/许进龙/Desktop/web/apps/web-overlay/UPSTREAM.md)：

- 上游 ref `main`，commit `6ba74fab9f86aa6ba4e276c002128a8f5a0acc0a`，vendored at `2026-10-12T15:50:42.169Z`
- **Re-vendor**：`node scripts/vendor-web.mjs`
- NavHub 自有文件（不得被上游覆盖）：`src/lib/storage-adapter.ts`（存储接缝）

### 6.2 三个脚本

| 脚本 | 作用 |
| --- | --- |
| `scripts/vendor-web.mjs` | 下载上游 NavSphere → 覆盖 `apps/web` → 用 overlay 恢复自研文件 |
| `scripts/sync-web-overlay.mjs` | **反向**：下载上游 tarball 逐文件 diff，把「与上游不同或上游没有」的文件精确同步进 overlay。规则：本地有/上游没有→新增；内容不同→更新；**内容一致→从 overlay 删除**（不再是自研文件）。排除 `node_modules`/`.next*`/logos/fonts/生成物 |
| `scripts/check-web-overlay.mjs` | 校验 overlay 与 `apps/web` 一致性 |

**为什么需要**：多会话并行开发都直接改 `apps/web`，手工挑文件同步 overlay 必然漏——这正是 vendor-web / Docker 构建需要恢复的完整集合。

### 6.3 `next.config.js` 要点

| 配置 | 值 | 原因 |
| --- | --- | --- |
| `distDir` | `NEXT_DIST_DIR` 可覆盖 | CI 验证构建不动现有产物 |
| `output: standalone` | 仅 `NAVHUB_WEB_STANDALONE=1` | Windows 未开「开发者模式」时符号链接 EPERM |
| `typescript.ignoreBuildErrors` | **true** | vendored 表单组件与本仓严格类型不兼容（`@hookform/resolvers@3.9.1` + zod 泛型不匹配，属上游依赖组合问题）；`packages/*` 与 `apps/api` 仍由 `tsc --noEmit` 严格检查 |
| `eslint.ignoreDuringBuilds` | true | 上游设定 |
| `images.remotePatterns` | `https` + `**` | |

## 7. 依赖概览

**运行时**：`next 15.5.21`、`react 18.2.0`、Radix UI 全家桶（25+ 包）、`@tanstack/react-query` + `react-table`、`@hello-pangea/dnd`、`next-auth 5.0.0-beta.32` + `iron-session`、`swr`、`react-hook-form` + `@hookform/resolvers`、`zod 3.25.76`、`recharts`、`lucide-react`、`cmdk`、`monaco-editor`、`@octokit/rest`、`tailwindcss 4.1.12`。

**不依赖** `@navhub/*` —— 通过 HTTP 解耦（唯一例外是 sqlite 直连模式，已被显式拒绝，见 §1.2）。
