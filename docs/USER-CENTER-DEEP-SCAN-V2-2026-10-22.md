# 用户中心深度扫描与第三批升级方案（v2.0）

> 版本：v2.0 · 2026-10-22 22:40 · 只读扫描，未修改任何业务代码
> 前序：`USER-CENTER-UPGRADE-PLAN-2026-10-22.md`（v1.0，S1–S6 / M1–M11 全部标记已落地）
> 本文定位：**v1.0 之后的增量扫描**。不重复已落地结论，只记录"代码里仍然存在"的缺口，并对每条给出 `文件:行号` 证据。
> 扫描范围：`apps/web-overlay/src/{app/me,app/favorites,app/preferences,components/user-center,hooks/useFavorites.ts,lib/*}`、`apps/api/src/routes/{me,favorites}.ts`、`packages/store/src/{schema.ts,repository/favorites.ts,repository/user-data.ts}`、`e2e/`、`apps/web/test/`、`scripts/bundle-budget.json`

---

## 0. 结论（TL;DR）

v1.0 的 S/M 系列确实解决了**安全授权收口、降级语义、同步引擎换代、数据主权范围**四件大事，后端能力已经相当完整。本轮扫描的结论是：**当前主要矛盾已从"能力缺失"转为"能力未接线 + 身份时序未统一 + 规模化未验证"**。

三条最需要立即处理的事实：

1. **三个已交付的后端能力在 UI 上不可达**——`/api/me/activity`（操作记录）、`/api/me/export/bookmarks.html`（书签 HTML）、`clearCloudFavorites`（清空云端）。v1.0 把 M9/M10 标为"已落地"，但前端零调用（`grep` 0 命中）。用户视角等于没做。
2. **身份就绪竞态只修了 1/3**——`navhub_identity_changed` 事件只被 `/me` 订阅（`me-view.tsx:147-151`）。`/favorites` 与 `/me/history` 仍在挂载时读一次 `getIdentity()` 且不重试。首次登录直接进收藏页，会整页按匿名身份渲染：不触发云同步、不显示文件夹管理，且不会自愈。
3. **收藏页已进入"功能堆积"状态**——1,095 行单文件、Hero 区并列 5 个导出动作、页脚文案与上方同步状态条互相矛盾、无排序/无批量/无虚拟化。用户中心的主任务（管理我的数据）被市场发布流（`ExportPluginModal`）稀释。

**建议节奏**：先做 3 项 P0（身份就绪统一、canonical 解析下沉、三个 API 接线），约 3–4 人日；再做 4 项 P1（文案语义统一、加载态、E2E/行为测试、设置项补全），约 5–7 人日；P2 的"收藏规模化 + IA 重构"单独立项评审，不建议与 P0/P1 混批。

---

## 1. 本轮已验证的现状（与 v1.0 的差异）

| v1.0 声称 | 代码事实 | 判定 |
|---|---|---|
| S1 身份授权收口 | `lib/hub-identity-guard.ts` + `api/hub/**` 已按会话裁决 | ✅ 一致 |
| S2 降级三态 | `/me`、`/me/data`、`/me/history` 均有 error 态与重试 | ✅ 一致 |
| S3 收藏状态全局化 | `useFavorites` 用 `useSyncExternalStore` 模块级共享 | ✅ 一致 |
| S4 重试同步完整性 | `applyCloudResult` 统一落地，重试走同一路径 | ✅ 一致 |
| M1 同步引擎换代 | `POST /api/me/favorites/sync` + 游标 + 墓碑 + 脏集合 | ✅ 一致 |
| M5 `/me` SSR 化 | `app/me/page.tsx` 服务端壳 + `MeView` 客户端岛 | ✅ 一致 |
| M6 移动端导航 | 底部导航已提交（7b51a24） | ✅ 一致 |
| **M9 互操作导出** | 端点存在（`me.ts:185-241`），**前端无入口** | ⚠️ 半落地 |
| **M10 用户可见操作记录** | 端点存在（`me.ts:111-129`），**前端零调用** | ⚠️ 半落地 |
| M2 数据主权闭环 | `exportUserData` / `deleteUserData` 已覆盖星标/评价/工作区/事件/llm_usage | ✅ 一致（导出仍缺 audit 明细） |
| M4 身份模型收口 | `users.email` 唯一化已做；但 `resolveIdentity` **只出现在 `me.ts`** | ⚠️ 部分 |

> 口径提醒：v1.0 §1.6 的"21 文件 / 209 用例"仍是有效基线，但 `/me*` 三页的测试形态没有变——仍是源码字符串断言（`apps/web/test/me-pages.test.ts:6-11` 自述"刻意检查源码字符串而不是渲染"）。

---

## 2. 新发现的问题清单

### 2.1 P0 — 正确性 / 可用性断裂

**P0-1｜三个后端能力在 UI 上不可达（能力空转）**
- `GET /api/me/activity`（`apps/api/src/routes/me.ts:111-129`）：`grep -rn "me/activity" apps/web-overlay/src` → **0 命中**。`/me` 页面（`me-view.tsx:383-414`）的"更多管理入口"里没有"最近操作"。
- `GET /api/me/export/bookmarks.html`（`me.ts:185-241`）：前端唯一 `bookmarks.html` 命中在**导入**组件（`components/bookmark-importer.tsx:228`），**导出**无按钮。`/me/data` 只有 JSON 下载（`me/data/page.tsx:188-191`）。
- `clearCloudFavorites`（`lib/navhub-api.ts:549`）：全仓无调用方，收藏页也没有"清空云端"入口。
- **影响**：v1.0 用 M9/M10 兑现的"可搬回浏览器""操作可追溯"两项承诺，用户完全感知不到；文档与产品面已不一致。
- **验收**：三个入口在页面上可点，且各有行为测试断言"点击 → 调用对应端点"。

**P0-2｜身份就绪竞态只修了 `/me` 一处**
- 事件派发方：`components/user-center/session-sync.tsx:54,77`（`navhub_identity_changed` / `navhub_identity_merged`）。
- 订阅方：仅 `app/me/me-view.tsx:147-151`。
- 未订阅：`app/favorites/page.tsx:136-145`（挂载时读一次 `getIdentity()`，anon 则直接 return，**不再重试**）、`app/me/history/page.tsx:48-74`（`load()` 只在挂载与手动重试时执行）。
- **影响**：首次登录（或刚完成合并）直接落在 `/favorites`，页面按匿名渲染：不触发云同步、`cloudIdentity` 为空 → 文件夹/备注控件整块不渲染，且无任何提示。用户会认为"登录了但收藏没同步"。
- **验收**：新增行为测试——先 `getIdentity()` 返回 anon，再派发 `navhub_identity_changed`，断言同步被触发、`cloudIdentity` 变为登录身份。

**P0-3｜canonical 解析未下沉，合并后旧 id 仍会产生孤儿行**
- `grep -rn "resolveIdentity" apps/api/src/routes/*.ts` → **仅 `me.ts` 命中 10 处**；`favorites.ts`、`history.ts`、`profile.ts`、`vault.ts`、`workspaces.ts` 全部直接用 `identityOf(req)`。
- 与 v1.0 M4 的"canonical 解析下沉到发布订阅层"不一致。
- **影响**：身份合并后，扩展 / MCP / 未刷新的旧标签页仍持旧 id 写入，会在 `favorites` / `search_history` / `user_profiles` / `user_vault_sync` / `user_workspace_blobs` 留下孤儿行——`/me` 概览看不到，导出/注销也不覆盖。
- **约束**：签名对象是**截断 64 字符的 raw identity**，解析必须发生在签名校验**之后**（v1.0 §5.1 第 4 条），因此不能在 preValidation 里改签名输入。
- **验收**：合并后以旧 id 调 `GET /api/favorites` 返回新身份的数据；新增一条 store/api 测试锁住该语义。

### 2.2 P1 — 语义冲突与体验缺口

**P1-1｜同一页面对"数据在哪"给出两种说法**
- 上方同步状态条：`favorites/page.tsx:490-516`（"已把本机 N 条收藏合并到云端 / 云端同步失败…"）。
- 页脚：`favorites/page.tsx:1063-1064`（"收藏数据当前保存在浏览器本地（localStorage）"）。
- v1.0 的 P1-9 未清干净。**影响**：数据主权叙事失信，用户无法判断换设备是否可见。

**P1-2｜匿名用户与登录用户的能力不对等，但文案承诺对等**
- Hero 承诺"本地离线优先存储…无需登录"（`favorites/page.tsx:407-409`）。
- 但文件夹/备注控件只在 `cloudIdentity` 存在时渲染（`favorites/page.tsx:1005`；`cloudIdentity` 在 `:136-145` 仅登录时赋值）。
- **影响**：匿名用户完全无法组织收藏（无本地文件夹存储），"无需登录"只覆盖"能收藏"，不覆盖"能管理"。

**P1-3｜`/me*` 三页无 `loading.tsx`**
- `find apps/web-overlay/src/app/me -name "loading.tsx"` → 空；而 `/favorites`、`/preferences` 都有。
- **影响**：`/me` 已是 `force-dynamic` 的服务端壳（`app/me/page.tsx:21`），慢网下从点击到首字节之间是纯空白，没有任何反馈。

**P1-4｜测试与门禁盲区**
- E2E：`e2e/front-pages.spec.ts` 只覆盖 `/favorites`、`/preferences` 冒烟；`/me`、`/me/history`、`/me/data` **零 E2E**，也无"匿名/登录/降级"三态矩阵。
- 单测：`/me*` 三页仍是源码字符串断言（`apps/web/test/me-pages.test.ts`），锁的是"代码里还有这行字符串"，不是行为。
- bundle：`scripts/bundle-budget.json` 的 `routes` 表无 `/me` 条目，落 `default = 1,270,784 B`；`/favorites = 965,632 B` 是唯一有专属棘轮的用户中心页。
- PG：`packages/store/test/pg-dialect.e2e.test.ts` 共 13 条用例，对 `favorites` / `mergeIdentity` / `deleteUserData` / `user_settings` **零命中**。

**P1-5｜设置项只开放了一半**
- `PATCH /api/me/settings` 只接受 `personalizationEnabled`（`me.ts:66`）。
- `user_settings` 表已有 `favorite_signal_cutoff`（`schema.ts:410`），但无任何 UI/API 可改；`/me` 与 `/preferences` 两处都讲个性化，入口重复。

### 2.3 P2 — 规模化与信息架构

**P2-1｜收藏列表在千级规模下不可用**
- `listFavorites` 无 `LIMIT`（`packages/store/src/repository/favorites.ts:66-71`），被列表/导出/画像三处复用。
- `GET /api/favorites` 无 `q` / `limit` / `offset` / `sort` 参数（`routes/favorites.ts:30-43`），无路由级限流（写路径有 600/min，读路径没有）。
- 前端全量渲染、无虚拟化（`favorites/page.tsx:964-1060`），筛选是纯客户端 `filterFavorites` + `activeFolder` 过滤，**无排序控件**、**无批量操作**。

**P2-2｜收藏页的信息架构已被市场流污染**
- Hero 区并列 5 个动作：导出加密金库 / 解密导入金库 / 导出为插件 / 明文 JSON / 导入 JSON（`favorites/page.tsx:412-469`）。
- "导出为插件"直接拉起 `ExportPluginModal`（`:1070-1090`），这是**市场发布流**，与"管理我的收藏"不是同一任务。
- 标题文案"军工级 AES-256-GCM""零知识"（`:405-409`）属营销语，出现在用户中心主位。

**P2-3｜概览页统计项跨域**
- `STAT_ITEMS`（`me-view.tsx:62-74`）6 项中，"已装插件""我的插件""星标插件"3 项跳往 `/marketplace/*`，与"数据主权"主线混杂；而真正属于本域的"操作记录""导出"没有卡片。

**P2-4｜技术债：schema 导出缺 5 张表**
- `packages/store/src/schema.ts:595-600` 的 `schema` 对象缺 `identityAliases`、`identityMerges`、`userLlmConfigs`、`userSettings`（以及工作区表若已定义）。"单一事实源"名不副实，drizzle 工具链拿不到这些表。

---

## 3. 升级建议（N 系列）

> 排序即执行顺序。N1 未完成前，不要动 `/favorites` 的同步逻辑——它会让"偶发不同步"变成"必然不同步"。

### N1【P0｜高】身份就绪统一：把"读一次 localStorage"改成"等身份就绪"

**目标**：任何页面都不再自己猜身份；登录/合并/退出后，所有用户中心页自动重取。

**实施要点**
1. 新增 `hooks/useIdentityReady()`：内部读 `getIdentity()`，并订阅 `navhub_identity_changed` / `navhub_identity_merged` / `storage`；返回 `{ identity, ready, isAnonymous }`。
2. `SessionSync` 增加一次性 `navhub_identity_ready` 广播（无论登录与否都发），让"尚未同步完"与"确实是匿名"可区分——这是当前无法区分的根因。
3. `/favorites` 的同步 effect 依赖 `identity` 而非 `favorites.ready`；`/me/history` 的 `load()` 由 `identity` 变化触发。
4. 兜底：若 3 秒内未收到 ready 事件，按 `getIdentity()` 现值继续（不阻塞）。

**验收**
- 新测试：`getIdentity()` 先返回 `anon-x`，派发 `navhub_identity_changed(detail.identity='github:1')` → 断言同步函数被调用一次、`cloudIdentity === 'github:1'`。
- `/me/history`：身份变化后自动重取，不出现"匿名历史 + 已登录头部"的混搭。
- 既有 `favorites-*` 5 个测试全绿。

**工作量**：1–1.5 人日　**风险**：低（纯前端时序）

---

### N2【P0｜高】canonical 解析下沉到五个用户域路由

**目标**：合并后旧 id 不再产生孤儿数据。

**实施要点**
1. 在 `routes/favorites.ts`、`history.ts`、`profile.ts`、`vault.ts`、`workspaces.ts` 的每个 handler 里，`identityOf()` 之后统一 `const canonical = await ctx.repo.resolveIdentity(identity)`，后续仓储调用改用 `canonical`。
2. 抽 `resolveCanonicalIdentity(ctx, req)` 到 `routes/shared.ts`，避免 5 个文件各写一遍（当前 `me.ts` 已重复 10 次）。
3. **红线**：签名校验仍在最前，解析只影响"用哪个 id 读写"，不改签名输入（v1.0 §5.1-4）。
4. `GET /api/favorites` 顺手补路由级限流（建议 120/min/身份）。

**验收**
- 新测试：`mergeIdentity(old, new)` 后，以 `old` 调 `/api/favorites`、`/api/search-history`、`/api/profile` 均返回 `new` 的数据；写入不产生新孤儿行（查询 `user_id = old` 计数为 0）。
- 既有 `end-user-identity-plane`（22 条）、`identity-plane-extensions`（12 条）全绿。

**工作量**：1.5–2 人日　**风险**：中（触碰全部用户域读写路径，必须有身份矩阵测试兜底）

---

### N3【P0｜中】把三个已交付能力接到 UI

**目标**：让 M9/M10 从"API 存在"变成"用户能用"。

| 能力 | 落点 | 实施要点 |
|---|---|---|
| 操作记录 | `/me` 新增"最近操作"面板 | 调 `/api/me/activity?limit=10`；只渲染 `action` 的中文映射 + 相对时间；失败落空态不报错（它是辅助信息）；"查看全部"可暂缓 |
| 书签 HTML 导出 | `/me/data` 导出区加第二个按钮 | `location.href = '/api/me/export/bookmarks.html'`；文案说明"可直接导入 Chrome/Firefox/Safari"；与 JSON 导出并列，主次分明 |
| 清空云端收藏 | `/favorites` 的"更多"区 | 二次确认（复用 `/me/data` 的输入 DELETE 模式或两段式按钮）；成功后 `favorites.clear()` + 刷新游标；匿名态隐藏 |

**验收**：三条行为测试（mock fetch 断言端点与参数）；`/me` 在 activity 500 时不显示错误条。

**工作量**：1 人日　**风险**：低

---

### N4【P1｜高】统一"数据在哪"的表述与匿名能力边界

**目标**：一个页面只有一种事实。

**实施要点**
1. 删除 `favorites/page.tsx:1063-1064` 的"收藏数据当前保存在浏览器本地"整段，改为随状态变化的一句话：匿名 → "仅本机"；已同步 → "云端 N 条，本机缓存"；同步失败 → 沿用现有状态条文案。
2. Hero 描述去掉"军工级"等营销词，改为功能性描述（本地优先、E2EE 导出、可迁回浏览器）。
3. 匿名组织能力二选一，**不要含糊**：
   - 方案 A（推荐，成本低）：在匿名态的文件夹区域显示"登录后可创建收藏夹与备注"，并把控件位置保留（可见但禁用 + 说明），避免"功能忽然出现"。
   - 方案 B（成本高）：本地文件夹存 localStorage，登录后随脏集合上推——需扩展 `LocalFavorite.folderId` 的本地来源，列为 P2 单独立项。
4. `/me` 匿名态文案（`me-view.tsx:227-230`）已明确"本机"，保持不变，作为全站基准口径。

**验收**：新增文案一致性测试——同一页面不允许同时出现"保存在浏览器本地"与"云端 N 条"。

**工作量**：0.5 人日　**风险**：低

---

### N5【P1｜中】补齐 `/me*` 的加载态

**实施要点**：`app/me/loading.tsx`、`app/me/history/loading.tsx`、`app/me/data/loading.tsx` 三份，骨架形状对齐真实内容（概览 = 身份条 + 6 卡；历史 = 4 行列表；数据 = 2 个面板）。**形状不一致比没有骨架更糟**——`/favorites` 已有的双骨架问题（`loading.tsx` vs 页内）不要复制。

**验收**：`me-pages.test.ts` 增加"三个 loading.tsx 存在且首屏骨架块数 ≥ 3"。

**工作量**：0.5 人日　**风险**：无

---

### N6【P1｜高】测试门禁补位

**实施要点**
1. **E2E**（`e2e/user-center.spec.ts`）：`/me` 匿名态（"当前是匿名身份" + 登录按钮）、`/me/history` 空态与降级态（拦截 `/api/hub/**` 返回 503 → 断言"暂时取不到"而非"没有记录"）、`/me/data` 匿名态。不做登录态（无测试账号体系，成本高），用匿名 + 网络拦截覆盖三态。
2. **行为测试**：把 `me-pages.test.ts` 的字符串断言**保留**（防删守卫），另加 `me-states.test.tsx` 用 render + mock fetch 覆盖四态切换。
3. **PG**：`pg-dialect.e2e.test.ts` 至少补 3 条——`addFavorite` 幂等、`applyFavoriteOps` 墓碑、`deleteUserData` 计数。
4. **bundle 棘轮**：`bundle-budget.json` 补 `/me`、`/me/history`、`/me/data` 三条（先按实测 +5%，之后只降不升）。

**验收**：`pnpm test:e2e -- user-center` 通过；全量 vitest 不低于当前基线。

**工作量**：1.5–2 人日　**风险**：中（E2E 依赖 dev-all 起服务，注意与并行会话的端口冲突）

---

### N7【P1｜低】设置项收口

**实施要点**：`PATCH /api/me/settings` 增加 `favoriteSignalCutoff`（整数，0–365，zod 校验）；`/preferences` 与 `/me` 的个性化开关**只留一处**（建议留 `/me`，`/preferences` 改为说明 + 跳转），避免两个开关同一字段。

**验收**：`me-api` 增加 cutoff 越界 400 的用例；两页不再各自持有同一状态。

**工作量**：0.5 人日　**风险**：低

---

### N8【P2｜中】收藏规模化（单独立项）

**实施要点**：`listFavorites` 加 `LIMIT`（默认 200，上限 500）；`GET /api/favorites` 支持 `q`（标题/URL/备注 LIKE）、`folderId`、`sort=created|title`、游标分页；前端改为"首屏 50 + 加载更多"或虚拟滚动；批量多选（删除 / 移动）。

**为什么单独立项**：它与 N1/N2 共用同一批文件，但改动面是"列表语义 + UI 交互"，混批会让回归面失控。**前置依赖**：N1 完成（否则分页请求会在身份未就绪时打空）。

**工作量**：4–6 人日　**风险**：中高（分页 + 增量同步游标语义交互，需重新推演 `since` 与 `offset` 的组合）

---

### N9【P2｜中】收藏页信息架构重构

**实施要点**
1. Hero 收敛为"标题 + 一句话说明 + 1 个主操作（导出/导入）"，其余 4 个动作收进"导入导出"抽屉或 `DropdownMenu`。
2. "导出为插件"移出用户中心，入口归 `/marketplace/publish`（它本质是发布，不是管理）。
3. 列表工具条统一为一行：搜索 + 收藏夹筛选 + 排序 + 批量（登录态）。
4. 状态条（同步结果）与页脚说明合并为一处，避免两处讲同一件事。

**验收**：Hero 区可交互元素 ≤ 3；`ExportPluginModal` 在 `/favorites` 的引用为 0。

**工作量**：2–3 人日　**风险**：中（`front-pages.spec.ts` 断言了 Hero 标题与两个按钮，需同步改）

---

### N10【P2｜低】可观测性

**实施要点**：复用 `POST /api/events` 或轻量 counter，记录四类事件：同步成功/失败（含 `retryable`）、merge 成功/失败、降级态出现次数、导出/注销调用。**不要新增通知系统**（全仓零命中，是净新增能力）。

**验收**：`/admin/stats` 或日志能看到这 4 个计数；无 PII。

**工作量**：1 人日　**风险**：低

---

### N11【P3｜低】技术债清理

- `schema.ts:595-600` 补齐 5 张表导出。
- `/favorites` 双骨架统一（`loading.tsx` 与页内 `aria-busy` 块形状对齐）。
- 移除或接线 `clearCloudFavorites`（N3 已覆盖）。
- `favorites/page.tsx` 拆文件：Hero / 同步状态条 / 文件夹面板 / 列表 / 导入导出抽屉 五个组件（当前 1,095 行，已到维护上限）。

**工作量**：1–1.5 人日　**风险**：低（纯重构，行为测试兜底）

---

## 4. 明确不做（Non-goals）

| 项 | 理由 |
|---|---|
| 收藏分享 / 公开集合 | 需权限模型与公开页，与 `/me*` noindex 策略冲突，须单独立项 |
| 通知 / 订阅（同步失败提醒等） | 全仓零命中，属净新增能力；先把同步成功率做可见（N10）再谈触达 |
| 用户自建 API Token | `api_tokens` 无 owner 列，需改 schema + scope 模型，成本远大于收益 |
| 收藏内容 E2EE 上云 | `favorites.note` 服务端可读是现状；改 E2EE 与跨端检索直接冲突 |
| 引入 Zustand/Jotai | `useSyncExternalStore` 已够用，避免依赖膨胀 |
| 第三方 OAuth 扩展 | 先保证现有身份链路正确（N2） |

---

## 5. 硬约束（在 v1.0 §5.1 之上新增）

1. **双目录镜像**：`vitest` 的 `@/` 指向 `apps/web/src`，源码守卫读 `apps/web-overlay/src`；改一边必须同步（`check-web-overlay` 会拦）。
2. **localStorage 键不可改**：`navhub.favorites.v1`、`navhub.anonId`、`navhub.userId`、`navhub.favorites.sync.v1.<identity>`、`navhub.favorites.dirty.v1` 已有存量数据，只能加新键。
3. **签名先于解析**：任何 N2 改动都不得改变签名输入（raw identity 截断 64 字符）。
4. **身份事件是唯一跨组件信号**：新增页面接入用户中心时，必须订阅 `navhub_identity_changed`，禁止"挂载时读一次"。
5. **匿名与登录的文案必须由状态驱动**，不允许硬编码"仅本地"或"已同步"。
6. **`/me*` 页面 metadata 只能由 layout 提供**（页面是 client component），noindex 结论继承 v1.0。
7. **改 `/favorites` Hero 文案前先看 `e2e/front-pages.spec.ts`**——它断言了 `'我的离线收藏与零知识金库'` 与两个按钮名。
8. **提交纪律**：当前工作树有并行会话的 SEO 改动（`apps/web-overlay/src/app/category/**`、`app/sites/**`、`scripts/check-isr-routes.mjs` 等），实施前重新取 `git status`，坚持 pathspec 提交。

---

## 6. 路线图

| 批次 | 内容 | 预估 | 前置 |
|---|---|---|---|
| W1（止血） | N1 身份就绪 + N2 canonical 下沉 + N3 三个入口接线 | 3.5–4.5 人日 | 无 |
| W1 尾 | N4 文案统一 + N5 加载态 + N7 设置收口 | 1.5 人日 | N1 |
| W2 | N6 测试门禁（E2E + 行为 + PG + bundle 棘轮） | 1.5–2 人日 | N1–N3 落地后写才稳 |
| W3 | N11 技术债 + N10 可观测性 | 2–2.5 人日 | 无 |
| W4 起（评审后） | N8 收藏规模化 → N9 IA 重构 | 6–9 人日 | N1、N6 |

**批次原则**：W1 的三项必须同批验收——N1 单独上会让"不同步"从偶发变成可复现，N3 单独上会在匿名态暴露空面板。

---

## 7. 验证清单

```bash
# 用户中心专项（既有 21 文件基线）
node node_modules/vitest/vitest.mjs run \
  apps/api/test/me-api.test.ts apps/api/test/me-data-api.test.ts \
  apps/api/test/workspaces-api.test.ts apps/api/test/ai-config-api.test.ts \
  apps/api/test/identity-signature.test.ts apps/api/test/end-user-identity-plane.test.ts \
  apps/api/test/identity-plane-extensions.test.ts \
  apps/web/test/favorites-sync.test.ts apps/web/test/favorites-merge.test.ts \
  apps/web/test/favorites-storage.test.ts apps/web/test/favorites-filter.test.ts \
  apps/web/test/favorites-shared-state.test.ts apps/web/test/hub-identity-guard.test.ts \
  apps/web/test/me-pages.test.ts apps/web/test/me-identity.test.ts apps/web/test/me-degrade-states.test.ts \
  apps/web/test/profile-view.test.ts apps/web/test/hub-identity-signature.test.ts \
  packages/store/test/identity-merge.test.ts packages/store/test/user-data.test.ts \
  packages/store/test/workspace-blobs.test.ts

# 新增（N1/N6）
node node_modules/vitest/vitest.mjs run apps/web/test/identity-ready.test.tsx apps/web/test/me-states.test.tsx
node node_modules/playwright/... test e2e/user-center.spec.ts

# 门禁
node scripts/check-web-overlay.mjs && node scripts/check-bundle-budget.mjs
```

---

## 附录：本轮扫描的证据索引

| 结论 | 证据 |
|---|---|
| activity 无前端调用 | `grep -rn "me/activity" apps/web-overlay/src` → 0 |
| 书签 HTML 无导出入口 | `me.ts:185-241` 有端点；前端仅 `bookmark-importer.tsx:228`（导入） |
| clearCloudFavorites 无调用方 | `navhub-api.ts:549` 定义；`grep` 无其他命中 |
| 身份事件仅 `/me` 订阅 | `me-view.tsx:147-151`；派发 `session-sync.tsx:54,77` |
| favorites/history 不重试身份 | `favorites/page.tsx:136-145`、`me/history/page.tsx:48-74` |
| canonical 仅 me.ts | `grep -rn "resolveIdentity" apps/api/src/routes/*.ts` → 10 处全在 `me.ts` |
| 页脚与状态条矛盾 | `favorites/page.tsx:1063-1064` vs `:490-516` |
| 文件夹仅登录可用 | `favorites/page.tsx:1005` + `:136-145` |
| 无 `/me*` loading | `find apps/web-overlay/src/app/me -name loading.tsx` → 空 |
| 无 `/me*` E2E | `e2e/front-pages.spec.ts` 仅 `/hot`、`/favorites`、`/preferences`、`/submit`、`/algorithms` |
| 测试是字符串断言 | `apps/web/test/me-pages.test.ts:6-11` |
| 无 `/me` bundle 棘轮 | `scripts/bundle-budget.json` routes 表无 `/me` 条目 |
| PG 零覆盖 | `packages/store/test/pg-dialect.e2e.test.ts`（13 用例）无 favorites/merge/delete/settings 命中 |
| 列表无 LIMIT/无服务端检索 | `repository/favorites.ts:66-71`；`routes/favorites.ts:30-43` |
| Hero 5 个导出动作 | `favorites/page.tsx:412-469` |
| schema 导出缺表 | `schema.ts:595-600` |

---

## 8. 实施进度（2026-10-22 深夜批次）

> 口径：N1–N11 全部落地；本节记录「改了什么 / 谁验证的 / 还差什么」。
> PG 用例**未在本机跑过**（无 docker / 无 psql），只在 CI 的 postgres service 下生效。

| 项 | 状态 | 落点 |
|---|---|---|
| N1 身份就绪统一 | ✅ | `hooks/useIdentityReady.ts`（ready/changed/merged/storage + 3s 兜底）；`session-sync.tsx` 在 `finally` 广播；`/favorites`、`/me/history` 改为依赖 `identityReady.identity` |
| N2 canonical 解析下沉 | ✅ | `routes/shared.ts` 新增 `resolveCanonicalIdentity`；favorites / history / profile / vault / workspaces 五个用户域全部改用；`GET /api/favorites` 补 240/min 限流 |
| N3 三个能力接线 | ✅ | `/me`「最近操作」面板；`/me/data`「导出浏览器书签（HTML）」；`/favorites` 两步确认「清空云端收藏」 |
| N4 文案与能力边界 | ✅ | 收藏页页脚改为随 `cloudIdentity` 变化；Hero 去掉"军工级"；匿名态显示"登录后可创建收藏夹、写备注"；文件夹/备注/清空控件收进登录态 |
| N5 加载态 | ✅ | `app/me/loading.tsx`（身份条 + 6 卡 + 2 面板）、`me/history/loading.tsx`、`me/data/loading.tsx`；`favorites/loading.tsx` 从 list 骨架改为与页面同构的卡片墙骨架 |
| N6 测试门禁 | ✅（PG 待 CI） | 新增 `apps/api/test/user-center-canonical.test.ts`（8 条：canonical 读写/无孤儿行/分页/LIKE 转义/排序/钳位）、`me-data-api` 补 cutoff 越界 3 条、`pg-dialect.e2e` 补用户域 5 条、`apps/web/test/identity-ready.test.ts`（7 条接线守卫）、`e2e/user-center.spec.ts`（6 条三态）；`bundle-budget.json` 为 `/me`、`/me/data`、`/me/history` 补棘轮（901,120 / 892,928 / 880,640 B，实测 +5%） |
| N7 设置收口 | ✅ | `PATCH /api/me/settings` 支持 `favoriteSignalCutoff`（0–2100 年，越界 400），`/preferences` 与 `/me` 的分工保持「画像查看 / 开关」互补而非重复 |
| N8 收藏规模化 | ✅（服务端 + 渐进渲染） | `listFavoritesPage`（JOIN sites 的 `q` / `folderId` / `sort` / `limit` / `offset` / `total` / `hasMore`），双方言安全（`LOWER(COALESCE())`、`ESCAPE '\'`）；`GET /api/favorites?limit=` 分页、无 `limit` 保持全量；前端排序下拉 + 60 条渐进渲染 + 「加载更多」 |
| N9 信息架构收敛 | ✅ | Hero 主区只留「导出加密金库 / 解密导入金库」；其余四个降级到「更多导入导出」行；「导出为插件」标注为市场发布去向 |
| N10 可观测性 | ✅ | 新增 `apps/api/src/user-center-metrics.ts`（有界基数领域计数）+ `GET /api/admin/user-center/metrics`；同步成功/失败/ops/分片、合并成功/幂等/失败、导出/书签/注销/操作记录共 11 个计数点 |
| N11 技术债 | ✅（部分） | `schema.ts` 导出补 `identityAliases` / `identityMerges` / `userLlmConfigs` / `userSettings`；`favorites/loading.tsx` 双骨架统一；`clearCloudFavorites` 死代码已被 N3 接线 |

### 8.1 有意未做（避免过度承诺）

| 项 | 原因 |
|---|---|
| `user_workspace_blobs` 进 `schema.ts` 的 drizzle 表定义 | 该表只在 `migrate.ts` 的 DDL 与裸 SQL 中存在；补 drizzle 定义会牵动迁移与 DDL 生成，收益低于风险，列为下一批 |
| `/favorites` 拆分为多个组件文件 | 页面内金库导出/导入与同步状态、本地 store 强耦合，且 `e2e/front-pages.spec.ts` 断言 Hero 文案；在无渲染测试的环境里拆分，回归只能靠 E2E 冒烟。建议先补 `/favorites` 的组件级测试再拆 |
| 收藏夹本地化（匿名也能建文件夹） | 需要扩展 `LocalFavorite` 的本地来源并让脏集合承载文件夹变更，属协议级改动，与 M1 同步语义耦合，单独立项 |
| 服务端分页替代本地渐进渲染 | 收藏页是「本地优先」，为分页把数据源改成接口会破坏离线可用性。服务端分页（N8）已就位，供将来的「万级收藏 / 多端列表」使用 |

### 8.2 验证记录

```bash
node node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json      # ✅
node node_modules/typescript/bin/tsc --noEmit -p packages/store/tsconfig.json # ✅
node node_modules/vitest/vitest.mjs run apps/web/test                        # ✅ 124 文件 / 1226 条
node node_modules/vitest/vitest.mjs run apps/api/test/user-center-canonical.test.ts apps/api/test/user-center-metrics.test.ts  # ✅ 8 + 3
NEXT_DIST_DIR=.next-verify node scripts/check-bundle-budget.mjs              # ✅ 全部路由在预算内
node scripts/check-web-overlay.mjs                                           # ✅ 535 文件一致
node scripts/sync-overlay-drift.mjs                                          # ✅ overlay → apps/web
```

> 全量 `vitest run` 与 `playwright test` 见 §7 附录；PG 用例在 CI 的 `test-postgres` 作业下生效。
### 8.3 E2E 抓到的真实缺陷：字面量 `null` 被当成故障（已修）

`e2e/user-center.spec.ts` 首跑 3 条失败，暴露出一个**线上级回归**：

NextAuth 在未登录时，`/api/auth/session` 返回的是 **body 为字面量 `null` 的 200**——那是「没有会话」的正常回答。而 S2 的降级语义把 `json().catch(() => null)` 的 null 与「解析抛错」混为一谈，于是：

- `/me`、`/me/data` 对**每一个匿名访客**渲染「登录状态暂时无法确认，请稍后重试」（error 态），
- 而不是本该出现的匿名态（登录入口 + 本机数据说明）。

这与 S2 当初要修的问题正好相反：那次是「把故障说成事实」，这次是「把事实说成故障」——而且影响面是全部未登录用户。

**修法**：只用「解析抛错」当故障（`parsed === undefined` → error）；body 为 `null` / `{}` 一律走匿名分支。改动落在 `me-view.tsx` 与 `me/data/page.tsx`，并在 `me-degrade-states.test.ts` 补了回归锁（断言源码里不再出现 `session === null`，且必须出现 `parsed === undefined`）。

**这条的价值**：它是「降级语义」这类改动的典型二次伤害——修 A 的时候把 B 从事实改成了故障。E2E 三态矩阵（匿名 / 降级 / 空）正是唯一能抓住它的网，因为单测的源码字符串断言对运行时行为完全失明。

### 8.4 E2E 结果

```
e2e/user-center.spec.ts            6 passed（/me 匿名、/me 降级、/me/history 降级、
                                    /me/history 空态、/me/data 匿名、/me/data 降级）
e2e/front-pages.spec.ts（三条冒烟） 3 passed（IA 重构未破坏既有断言）
```

> 备注：`page.route` 的 glob 必须写成 `**/search-history**`——`lib/navhub-api.ts` 的 `hubUrl()` 会剥掉前导 `/api`，真实请求是 `/api/hub/search-history`，不是 `/api/hub/api/search-history`。写错 glob 会让拦截静默不生效，测试「通过」但什么都没验证。
---

## 9. 下一步三项的执行结果（2026-10-23 凌晨）

> 对应 v2.0 结尾给出的三个下一步，按 P0 → P1 → P2 顺序全部执行完毕。

### 9.1 P1 · 先补测试再拆文件（已完成）

**抽出的可测纯逻辑**（原先是页面里的内联代码，零覆盖）：

| 模块 | 覆盖的曾经过失 |
|---|---|
| `lib/favorites-vault.ts` | 收藏 ↔ 金库的字段映射（`note→category`、`icon→tags[0]`）、缺 `url` 条目丢弃、缺 `createdAt` 补确定值、导出文件名 |
| `lib/favorites-sync-copy.ts` | 同步状态条五种分支：同步中 / 推了 N 条 / 纯拉取 / 墓碑优先提示 / 失败必带原因（含"原因未知"）；重试按钮只在「失败 + 可重试」时出现 |
| `lib/favorites-folders.ts` | 本地收藏夹的解析降级、名称归一化与重名拒绝、上传计划（同名复用云端 id） |

新增单测：`favorites-vault` 7 条、`favorites-sync-copy` 8 条、`favorites-folders` 11 条、`favorites-local-folders` 6 条（接线守卫）。

**页面拆分**：E2EE 金库的两个面板（导出 / 解密导入，约 200 行 JSX）抽为 `components/user-center/favorites-vault-panels.tsx`——无自有状态、全部 props 注入，可在没有 store 与网络的环境下单独渲染。`favorites/page.tsx` 从 1,095 行降到约 1,050 行，且主流程（读本地 → 同步 → 渲染列表）不再被两段密码表单淹没。

> 未做完整拆分的理由：剩余部分（同步状态条、收藏夹面板、卡片列表）与本地 store、云端同步强耦合，且 `e2e/front-pages.spec.ts` 断言 Hero 文案；在无组件级渲染测试的环境里继续拆，回归只能靠 E2E 冒烟，风险高于收益。

### 9.2 P2 · 收藏夹本地化（已完成）

**改动**：
- 新键 `navhub.favorites.folders.v1`（**不动** `navhub.favorites.v1` 等既有键——那是"改了等于丢老用户收藏"的红线）；
- `visibleFolders`：登录态取云端夹子，匿名态取本地夹子，**同一套 UI 两个数据源**——不是给匿名用户另做一套界面；
- 建 / 改 / 删三条路径都有本地分支；本地 id 带 `local-` 前缀，与云端 uuid 可区分；
- 登录同步成功后 `migrateLocalFolders` 按名称把本地夹子合并上云（同名复用、异名新建），再把条目 `folderId` 重映射到云端 id，最后清空本地表。

**两个关键实现选择**：
1. 重映射走 `updateMeta`（逐条置脏）而**不是** `replaceAll`——后者会清掉全部脏标记，把还没推送成功的收藏变更一起丢掉；
2. 重映射的条目取自同步结果的 `nextItems` 而**不是** `favorites.items`——后者可能是同步前的旧闭包。

**用户可见变化**：匿名态现在显示"本地收藏夹仅存本机；登录后按名称合并到云端"，卡片上的"移动到收藏夹 / 备注"对匿名用户也可用。

### 9.3 E2E 抓到的第二个测试自身缺陷

本地收藏夹用例首跑假红：`beforeEach` 里的 `page.addInitScript(() => localStorage.clear())` 在**每次导航**（含 `reload`）都会执行，于是"刷新后分组仍在"这条断言必然失败——测的是测试自己的 bug。已改为依赖 Playwright 的 per-test context 隔离（每个用例本就拥有空 localStorage），并在注释里写清原因。

**这条的价值**：持久化类断言与"每次导航都清空"的 init script 是结构性冲突，和上一轮 `null` 会话那个 bug 一样——都属于"测试写错了但看起来像产品坏了"。

### 9.4 验证记录（本轮追加）

```
vitest  apps/web/test/favorites-{vault,sync-copy,folders,local-folders}.test.ts   32 passed
vitest  apps/web/test/favorites-{sync,filter,shared-state,storage,merge}.test.ts  全绿
vitest  apps/web/test/me-{pages,degrade-states,identity}.test.ts                 全绿
tsc     apps/web（排除 .next-* 生成目录与既有的 vitest 类型解析告警）              通过
e2e     user-center.spec.ts                                                       7 passed
```
