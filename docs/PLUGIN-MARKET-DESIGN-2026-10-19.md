# NavHub 插件市场：深度研究报告与实施方案

> 定位：把路线图 P3-3（`docs/UPGRADE-PROPOSAL-V2-2026-10-18.md:83,244`「主题 / 插件市场」）正式立项并给出可执行设计。
> 依据：对仓库 778 个代码/配置文件的全量尽调（三个子系统深潜：存储层 / 前端复用层 / API 鉴权与测试惯例），本文所有行号与结论均为 2026-10-19 当日实测。
> 核心判断一句话：**在「单租户 + 默认开放鉴权 + 无沙箱设施」的现状下，最强大的插件市场 = 声明式插件（零任意代码执行）+ 双通道分发（本机注册表社区页 + 可移植文件跨部署互传）。**

---

## 一、任务与定位

**用户诉求**：开发最强大的插件市场，让用户互相共享「网址相关信息」与「功能」。

**拆解为两个共享维度**：

| 维度 | 共享物 | 对应插件形态 |
| :--- | :--- | :--- |
| 网址相关信息 | 站点集合 + 分类 + 标签 + 描述 | `site-pack`（网站包） |
| 功能 | 工作台布局（Bento 模块组合与配置） | `workspace-preset`（工作台预设） |
| 功能 | 主题（强调色 + 设计 token 覆盖） | `theme`（主题） |

**现实约束（尽调结论，决定架构）**：

1. **单租户**：多用户/团队空间（P2-2）未立项，`users` 表存在但业务为个人/NAS 部署形态 → 市场不能假设「账号体系」，安装主体应是「本机实例 + 浏览器本地」。
2. **默认开放鉴权**：`NAVHUB_AUTH_REQUIRED` 默认关（`apps/api/src/config.ts:219`），开放模式下匿名可调一切接口 → 社区投稿必须走「待审 + 人工审核」兜底（与站点投稿完全同构）。
3. **无沙箱设施**：仓库没有任何 JS 沙箱/VM 隔离 → **插件禁止携带可执行代码**，一律声明式 JSON（这一条同时是安全底线与「可审计」卖点）。
4. **跨部署互传是刚需**：实例之间不联通（无联邦），用户互共享 = 导出文件 → 导入（外加本机注册表页面做社区广场）。

---

## 二、可复用地基（尽调事实清单）

| # | 地基 | 位置（实测） | 复用于 |
| :--- | :--- | :--- | :--- |
| 1 | 投稿三段式：匿名 POST（5/hour/ip 限流）→ pending → 审核 PATCH（approve/reject + 审计） | `apps/api/src/routes/submissions.ts:23,69,119` | 插件发布/审核全流程照抄 |
| 2 | 审核队列存储模板：`status text notNull default 'pending'` + `reviewedAt/appliedAt` + `meta` JSON + `list {items,total}` 分页 + pending 保护 | `packages/store/src/schema.ts:361-378`、`repository/taxonomy-governance.ts:13-62,119-192` | `plugins` 表与 `reviewPlugin()` |
| 3 | 模块注册表：15 个模块（type/title/分类/尺寸约束/configSchema） | `apps/web-overlay/src/lib/modular/registry.ts:22-297` | workspace-preset 的 type 白名单与渲染 |
| 4 | 预设模板与「整体替换当前看板」：`applyTemplate` | `registry.ts:302-357`、`lib/modular/use-modular-layout.ts:371-383` | 预设安装的落点 |
| 5 | 布局导入导出：`importLayoutJson`（v2 多看板整体替换 / 单看板新建）与 `exportLayoutJson` | `use-modular-layout.ts:443-501` | 发布向导读取当前工作台 + 安装为新看板 |
| 6 | **缺口**：没有「向当前看板追加/替换一组模块」的 API（最近的是新建看板） | 同文件 | 本方案新增 `installWidgetPreset(widgets, mode)` |
| 7 | 未知模块净化器 `sanitizeWidgetInstances` + 损坏备份 | `lib/modular/sanitize.ts:25-35`、`workspace-storage.ts:25-38` | 安装时的白名单清洗 |
| 8 | 主题挂载先例：`data-accent`（violet/emerald/amber/rose）与 `data-density` 均以「属性 + globals.css 变量块」实现 | `use-home-diy.ts:620-629`、`density-provider.tsx:41-67`、`styles/globals.css:473-495` | theme 插件的应用机制 |
| 9 | DIY 分享编码：`#diy=` base64(encodeURIComponent(JSON))，**4KB 双向硬上限、无压缩、无版本前缀** | `lib/diy-share-link.ts:33-67`、`use-home-diy.ts:537-599` | **反例**：证明大包不能走 URL hash → 服务端托管为主 |
| 10 | 渲染期 URL 安全：`safeHref/safeSrc` 双重防护 | `lib/safe-url.ts:15-45` | 市场页所有用户内容渲染 |
| 11 | 站点批量导入范式：单事务 + `findSiteByUrl` 去重 + 提交后索引 + 提交后审计 | `apps/api/src/routes/sites.ts:206-268` | `installPlugin()` 的站点落库 |
| 12 | 仓储原语：`withTransaction`（SQLite BEGIN IMMEDIATE + 重试）、`audit`（best-effort）、`ensureCategory`、`upsertTag`、`createSiteWithId`（含检索线索写入） | `repository.ts:85-155`、`repository/events.ts:66-76`、`repository/categories.ts:115-120`、`repository/sites.ts:158-224,320-335` | 插件安装器 |
| 13 | 审核页模板：Tabs（待审/通过/拒绝）+ Table + 详情/拒绝理由弹窗；`requireAdmin` 双分支守卫 | `apps/web/src/app/admin/submissions/page.tsx`（430 行）、`lib/admin-guard.ts:33-51` | `/admin/plugins` 审核页 |
| 14 | BFF 自动代理：`/api/hub/*` catch-all，无路径白名单；**1MB body 上限；浏览器身份头不转发（identity 走 query/body，代理补签）** | `lib/hub-proxy.ts:23-29`、`app/api/hub/[...path]/route.ts:36-42,90-104` | 前端数据层零改动接入新 API |
| 15 | 鉴权事实：`req.auth.actor/kind` 是唯一可信调用者标识；`identityOf`（userId/anonId）**仅展示不可信**（未配 secret 时可自称任意身份） | `apps/api/src/server.ts:289-394`、`routes/shared.ts:185-220` | 发布者归属设计（展示级） |
| 16 | 快照缓存失效白名单：写请求按**路径前缀**失效（sites/categories/tags/submissions…） | `server.ts:184-202` | 插件安装写站点 → 必须把 `/api/plugins` 加入白名单 |

---

## 三、插件模型（声明式）

### 3.1 三种插件形态

```
PluginManifest
├─ manifestVersion: 1            # 契约版本
├─ kind: "site-pack" | "workspace-preset" | "theme"
├─ name / description / icon / author / homepage / license
├─ version: "x.y.z"              # 语义化版本，更新检测用
├─ tags: string[]                # 市场筛选（≤8 个）
└─ payload: 按 kind 分派
```

**① `site-pack`（网址包）——「网址相关信息」**

```jsonc
{
  "categories": [{ "title": "AI 编程", "description": "可选" }],   // ≤20 个
  "sites": [
    { "url": "https://…", "title": "…", "description": "…",
      "category": "AI 编程",       // 按标题引用（已有则复用，无则创建）
      "subCategory": "代码补全",   // 可选
      "tags": ["AI", "IDE"] }      // ≤5 个/站
  ]                                 // ≤200 个
}
```

**② `workspace-preset`（工作台预设）——「功能」**

```jsonc
{
  "boards": [{                     // ≤5 个看板
    "name": "极客工作台",
    "widgets": [{                  // ≤24 个/看板
      "type": "clock-pomodoro",    // 必须在 WIDGET_REGISTRY 白名单内
      "customTitle": "可选",
      "colSpan": 3, "rowSpan": 1,  // 1..12 / 1..6
      "config": {}                 // ≤8KB，URL 字段仅 http(s)
    }]
  }]
}
```

**③ `theme`（主题）——「功能」**

```jsonc
{
  "accent": "violet",              // 复用现成 data-accent 白名单
  "tokens": {                      // 仅 HSL 三值口径（与 globals.css 一致）
    "--primary": "262 83% 58%",
    "--ring": "262 83% 58%",
    "--radius": "0.75rem"          // 仅允许 rem 数值
  }                                // 白名单变量 + 值正则双重校验
}
```

### 3.2 硬约束（校验器统一执行）

| 约束 | 值 | 理由 |
| :--- | :--- | :--- |
| 禁止可执行代码 | 无 `script`/`eval`/任意 JS 字段 | 无沙箱设施 |
| URL 字段 | 仅 http(s)、≤2048 字符；拒绝内网/回环/`javascript:` | 与入库 `httpUrl` schema、SSRF 口径对齐 |
| 图标 | emoji 或短文本 ≤8 字符（**禁止远程图片 URL**） | 避免 SSRF / 追踪像素 |
| 全包体积 | ≤256KB（BFF 1MB 上限内留余量） | 代理层硬约束 |
| 文本字段 | 名称 ≤60、描述 ≤500、许可证 ≤40 | 防垃圾 |
| 包内去重 | 同 URL 出现两次 → 保留首个并在 summary 报告 | 一致性与告知 |

> 校验器为**无 IO 纯函数**（`validateAndCleanPluginManifest` + `summarizePluginManifest`），core 实现 + 前端镜像 + **字节级 parity 测试**（新纪律，补「算法双份无校验」的历史风险）。

### 3.3 明确不做（反目标）

- ❌ 任意 JavaScript / WASM 插件（无沙箱设施，安全底线）
- ❌ 服务端代执行插件声明的远程请求（SSRF 面）
- ❌ 插件携带远程图片/字体（隐私与追踪面）
- ❌ 自动更新（更新必须重新过审 → 状态回 pending）

---

## 四、数据模型（三张新表，双方言）

```sql
-- 插件注册表（社区广场）
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,                -- randomUUID
  slug TEXT NOT NULL,                 -- 唯一（名称 slug 化 + 去重后缀）
  kind TEXT NOT NULL,                 -- site-pack | workspace-preset | theme
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT, tags TEXT NOT NULL DEFAULT '[]',   -- JSON 字符串数组
  author TEXT, author_kind TEXT,      -- 展示身份；来源可信度 token/identity/anonymous/import
  license TEXT, homepage TEXT,
  version TEXT NOT NULL,
  manifest TEXT NOT NULL,             -- 已清洗的完整 manifest JSON
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|published|rejected|delisted
  review_note TEXT, reviewed_at INTEGER,
  source TEXT NOT NULL DEFAULT 'user',     -- user|import|seed
  install_count INTEGER NOT NULL DEFAULT 0,
  star_count INTEGER NOT NULL DEFAULT 0,
  report_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, published_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS plugins_slug_idx ON plugins(slug);
CREATE INDEX IF NOT EXISTS plugins_status_idx ON plugins(status);
CREATE INDEX IF NOT EXISTS plugins_kind_idx ON plugins(kind);

-- 安装记录（复合主键；重装复活行、卸载置 removed_at，计数与活跃挂钩）
CREATE TABLE IF NOT EXISTS plugin_installs (
  plugin_id TEXT NOT NULL, identity TEXT NOT NULL,
  version TEXT NOT NULL, meta TEXT,          -- {siteIds,categoryIds,skipped,extends}
  installed_at INTEGER NOT NULL, removed_at INTEGER,
  PRIMARY KEY (plugin_id, identity)
);

-- 星标（复合主键）
CREATE TABLE IF NOT EXISTS plugin_stars (
  plugin_id TEXT NOT NULL, identity TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, identity)
);
```

登记清单（按仓库既定顺序，缺一不可）：`schema.ts` 表声明 + 表数组（`:380-384`）→ `driver.ts` 双份 DDL（`DDL_SQLITE` `:303` 前 / `DDL_PG` `:561` 前）→ `migrate.ts` 兜底双登记（`:96-102` 先例）→ `records.ts` 记录接口 → `repository/plugins.ts` 域模块 → `repository.ts` 门面（`:59-60` 之间 import + 方法段）→ 测试（含 `store.test.ts:913-916` 表存在断言清单）。

---

## 五、API 契约（`apps/api/src/routes/plugins.ts`）

| # | 方法/路径 | scope | 限流 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `GET /api/plugins` | public | — | 列表（默认仅 published；`status` 筛选需非匿名）；`kind/q/sort(new\|popular\|stars)`；`cache 60s + etag`；每项带 `summary` |
| 2 | `GET /api/plugins/:slug` | public | — | 详情（含完整 manifest）；pending 仅授权身份可见 |
| 3 | `POST /api/plugins` | public | 5/hour | 发布（校验→pending→审计 `plugin.publish`） |
| 4 | `POST /api/plugins/import` | write | — | 导入外部包：校验→建行（source=import, 直接 published）→可选立即安装 |
| 5 | `PATCH /api/plugins/:slug` | write | — | 更新（version/manifest/元数据；已发布→**状态回 pending** 重审） |
| 6 | `PATCH /api/plugins/:slug/review` | write | — | 审核 approve/reject/delist（note 必记审计） |
| 7 | `POST /api/plugins/:slug/install` | write | 30/min | 安装：site-pack 服务端落库（去重+幻影分类），其余返回 manifest 供前端应用；记 installs |
| 8 | `POST /api/plugins/:slug/uninstall` | write | — | 卸载：可选软删来源站点（`source=plugin:<slug>`）；计数字段同步 |
| 9 | `POST/DELETE /api/plugins/:slug/star` | public | 60/hour | 星标切换（幂等） |
| 10 | `POST /api/plugins/:slug/report` | public | 5/hour | 举报（reason → events + report_count++） |
| 11 | `POST /api/plugins/validate` | public | 20/hour | 无副作用校验（导入向导/发布向导预检） |

**状态机**：`pending →(approve) published →(delist) delisted`；`pending →(reject) rejected`；`rejected/delisted →(PATCH 更新) pending`。

**审计动作**：`plugin.publish / plugin.import / plugin.update / plugin.review.approve / plugin.review.reject / plugin.delist / plugin.install / plugin.uninstall / plugin.report`（星标不审计，避免噪音）。

**注意**：`server.ts:184-202` 的 `SNAPSHOT_MUTATING_PREFIXES` 必须加入 `/api/plugins`（安装会写站点，否则首页快照最长 30s 陈旧——比 anticipated 更微妙：失效白名单只认路径前缀）。

---

## 六、前端设计（overlay 事实源 → 镜像 apps/web）

### 6.1 新路由

| 路由 | 形态 | 内容 |
| :--- | :--- | :--- |
| `/marketplace` | 客户端列表 | 卡片网格（图标/名称/kind 徽标/作者/安装数/星标），kind 筛选 + 排序 + 搜索 + 发布/导入入口；空态用 `EmptyState` |
| `/marketplace/[slug]` | 客户端详情 | 摘要预览（站点列表/模块清单/主题色板）、版本与更新提示、安装（consent 弹窗）、星标、举报、导出文件 |
| `/marketplace/publish` | 向导 | 三种 kind 分派：网址包=选自己的分类生成包；工作台=读当前布局；主题=表单调色+实时预览；预检（validate API）→ 提交待审 |
| `/marketplace/import` | 向导 | 粘贴/上传 `.navhub-plugin.json` → 本地校验（镜像）→ 摘要预览 → 导入（可选立即安装） |
| `/admin/plugins` | 审核台 | Tabs（待审/已上架/已拒/已下架）+ 表格 + 详情弹窗（摘要+manifest 原文）+ 通过/拒绝（理由）/下架 |

### 6.2 安装应用矩阵

| kind | 应用位置 | 机制 |
| :--- | :--- | :--- |
| site-pack | **服务端** | `installPlugin()`：事务内 `ensureCategory`（复用或创建 source=plugin:<slug>）+ `findSiteByUrl` 去重 + `createSiteWithId`（source=plugin:<slug>，状态 active）+ 提交后 `indexSite` |
| workspace-preset | **浏览器本地** | 新增 `installWidgetPreset(widgets, mode: 'replace' \| 'new-board')`（补齐 6 号缺口；走 `sanitizeWidgetInstances` 净化与撤销栈） |
| theme | **浏览器本地** | `documentElement.style.setProperty` 白名单变量 + 持久化 `navhub_theme_plugin_v1` + 启动应用（providers 挂载点）+ 卸载清除 |

### 6.3 安全渲染口径

- 站点 URL/图标一律过 `safeHref/safeSrc`（`lib/safe-url.ts`）；文本一律纯文本渲染（不注入 HTML）。
- 前端校验器 = core 校验器的字节级镜像（parity 测试守门），离线导入也能给出完整错误清单。
- 市场列表/详情对 pending/rejected 内容默认不可见（后端过滤，前端不依赖）。

### 6.4 导航与入口

- 首页「探索矩阵」下拉 + 页脚各加「插件市场」入口（`navigation-content.tsx:366-452`、`footer.tsx:19-37`）。
- 后台左侧菜单加「插件审核」（`AdminLayoutClient.tsx:64-164` 菜单数组）。

---

## 七、安全模型（威胁 → 对策）

| 威胁 | 对策 |
| :--- | :--- |
| XSS（站点 URL/描述/模块配置注入） | 声明式-only + 纯文本渲染 + `safeHref/safeSrc` + zod 双重校验 |
| SSRF（插件引远程资源） | 插件**不含**服务端代请求字段；图标禁 URL；站点写入不自动抓取（仅入库，不 fetch） |
| 数据破坏（恶意包乱导入/卸载误删） | 安装=增量去重（绝不删改既有数据）；卸载=软删（进回收站，可恢复，且仅动 `source=plugin:<slug>` 行）；审核预览摘要展示全部影响 |
| 滥用（垃圾发布/刷星/刷举报） | 发布 5/hour + 星标 60/hour + 举报 5/hour + 待审制；举报数进审核视野 |
| 冒充发布者 | `identityOf` 仅展示；真实归属靠审核动作审计（`req.auth`）——与投稿同口径，文档化 |
| 内容合规 | 人工审核队列 + 下架（delist）+ 举报通道 + 审计流水 |

---

## 八、与路线图的关系

- **P3-3 主题/插件市场**：本方案即其落地（主题市场是 `theme` kind 的子集，一并实现）；「MCP 工具对外开放」延后为阶段 C（`list_plugins/install_plugin` 工具）。
- **P1-5 分享短链**：未来短链服务的头号消费方就是插件包（`/s/xxx` 落点到 `/marketplace/[slug]`）——本方案的 slug/OG 元数据先备好。
- **P2-2 多租户**：落地后 `plugin_installs.identity` 自然升级为 workspace 级；表结构已按复合主键预埋，无需迁移破坏。

---

## 九、实施计划与验收

### 阶段 A（本批，后端全量）
1. `packages/core/src/plugin-manifest.ts`：类型 + `validateAndCleanPluginManifest` + `summarizePluginManifest` + `comparePluginVersions`（纯函数，零依赖）+ 单测。
2. 前端镜像 `apps/web-overlay/src/lib/plugins/plugin-manifest.ts` + **parity 测试**（剥离头注释后字节比对）。
3. store：三表（schema/driver×2/migrate 兜底/records）+ `repository/plugins.ts`（create/get/list/update/review/install/uninstall/star/report/getInstallState）+ 门面 + 单测（含迁移断言）。
4. api：`routes/plugins.ts` 十一条端点 + 注册 + 快照失效白名单 + 集成测试（发布→审核→安装→卸载→星标→举报全链路 + 校验失败矩阵）。

### 阶段 B（本批，前端核心）
5. `/marketplace`、`/marketplace/[slug]`、`/marketplace/import`、`/marketplace/publish`、`/admin/plugins` 五页 + 数据层（`navhub-api.ts` 扩展）+ 入口。
6. `installWidgetPreset` 新增 + 主题应用器（`lib/plugins/theme-runtime.ts`）+ 安装 consent/结果 UX。
7. overlay → web 镜像同步 + `check:overlay`。

### 阶段 C（本批已落地）
8. e2e 两条（`e2e/plugin-market.spec.ts`：市场浏览 → 详情 → 一键安装；发布待审 → 管理员审核上架 → 市场公开可见）。
9. MCP 工具 `list_plugins`（read）/ `install_plugin`（write）：与 REST 共用仓储，含只读边界、幂等重放、未上架拒装断言；OpenAPI `x-mcp-tools` 与 parity 测试自动覆盖（工具总数 32 → 34）。
10. 短链落点：`/marketplace/[slug]` 服务端 `generateMetadata`（title / description / openGraph / twitter，取不到数据时回退通用文案）——未来 `/s/xxx` 短链服务可直接 302 至此，slug 即稳定落点。
11. 扩展消费市场：Chrome 弹窗页脚「🧩 插件市场」入口；Raycast「浏览插件市场」动作（跟随 `webUrl` 偏好）。
12. 种子数据：`apps/api/src/seed-plugins.ts`（site-pack / workspace-preset / theme 三 kind 全覆盖 + 1 条待审样例演示审核链路），`pnpm seed` 幂等导入；文档同步（CODEBASE_OVERVIEW / wiki/07 工具计数）。

### 阶段 D（第二批已落地）
13. D1 更新链路：`resolveInstallAction` 纯函数（`apps/web-overlay/src/lib/plugins/install-state.ts`，判定 install / update / installed）+ 单测；列表卡片「更新到 vX」徽标按钮、详情页三态主按钮（安装 / 更新 / 已安装管理）、安装弹窗 `upgrade` 模式文案（确认更新 / 立即平滑升级 / 成功 toast「已更新到 vX」）。服务端零新增状态机——重装即升级（幂等增量，只增不删）。
14. D3 动态 OG 卡片：`apps/web-overlay/src/app/marketplace/[slug]/opengraph-image.tsx`（1200×630；ASCII 安全构图零字体依赖；取数失败回退通用卡）。sitemap / robots 留待下一小批。
15. D4 分享深链：`?install=1` 落地详情页自动弹安装确认（仅未安装时触发、只处理一次防打扰）；详情页「分享」按钮复制带参链接。e2e 测试 1 改走深链流程（含冷启动补击回退）作为回归口径。
16. 同批收编（协作方产出经 overlay 收集器入库）：升级差异比对 `PluginDiffView` + `upgradeDiff` 契约、遥测大盘 `/api/admin/plugins/metrics` + `fetchPluginTelemetry` 契约补齐、Next 16 依赖与 tsconfig 收集、上游 admin 表单 zod4 类型修复（修复 CI 前端门禁红）。
17. D2 语义检索与相似推荐：插件向量独立成表（持久层 `plugin_embeddings` + 向量表 `plugins_vec`；业务 id `plugin:<slug>`），与站点 `sites_vec` 互不挤占 KNN top-N；索引钩子收敛在 review approve / import / seed 一条路径，驳回 / 下架 / 更新回待审同步摘除；新增 `GET /api/plugins/search?q=&kind=&limit=`（语义优先，模型未就绪或不可用时关键词回退并标注 `degraded`）与 `GET /api/plugins/:slug/similar?limit=6`（详情页「相似插件」发现回路）；`reindex` 任务支持 `targets: ['sites','plugins']`（默认 sites 保兼容）；MCP 新增 `search_plugins`（工具总数 35）。测试覆盖持久层往返、降级回退、语义排序、状态门禁与工具计数。

### 验收口径
- `pnpm verify` 全绿（新增测试 ≥60 例）；`next build` + `check:bundle` 不劣化；
- 端到端：发布待审 → 审核通过 → 用户浏览 → 一键安装（站点+看板+主题三类各一次）→ 卸载可恢复；
- 安全：`javascript:` URL、超限大包、未知模块类型、恶意主题值全部被拒且有断言。

---

## 十、反目标（明确不做）

1. 不做任意代码执行插件（无沙箱设施前永久禁止）。
2. 不做服务端代请求（插件定义不含远程执行字段）。
3. 不做自动更新（更新重审）；不做计费（P3-3 原始设想中的「计费」明确去掉：无账户体系）。
4. 不改既有 `#diy=` 分享链路（4KB 上限不动，避免回归）；大包一律走注册表/文件。
5. 不为市场引入新依赖（不下发 zip、不引 UI 库——文件即 JSON）。

---

## 附：本批文件级落地清单

```
packages/core/src/plugin-manifest.ts                 新增（契约）
apps/web-overlay/src/lib/plugins/plugin-manifest.ts  新增（镜像）
apps/web-overlay/test/plugin-manifest.test.ts        新增（+parity）
packages/store/src/schema.ts                         三表声明 + 数组登记
packages/store/src/driver.ts                         DDL ×2
packages/store/src/migrate.ts                        兜底双登记
packages/store/src/repository/records.ts             记录接口
packages/store/src/repository/plugins.ts             新增（安装器/审核/计数）
packages/store/src/repository.ts                     门面装配
packages/store/test/plugins.test.ts                  新增
apps/api/src/routes/plugins.ts                       新增（11 端点）
apps/api/src/server.ts                               注册 + 快照白名单
apps/api/test/plugins-api.test.ts                    新增
apps/web-overlay/src/lib/navhub-api.ts               数据层扩展
apps/web-overlay/src/lib/modular/use-modular-layout.ts installWidgetPreset
apps/web-overlay/src/lib/plugins/theme-runtime.ts    主题应用器
apps/web-overlay/src/app/marketplace/**              五页
apps/web-overlay/src/app/admin/plugins/page.tsx      审核台
apps/web-overlay/src/components/navigation-content.tsx / footer.tsx / admin/AdminLayoutClient.tsx  入口
apps/web/src/**                                      镜像（脚本同步）
```
