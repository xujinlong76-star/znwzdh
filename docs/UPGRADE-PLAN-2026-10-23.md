# NavHub 全仓升级方案（2026-10-23 四路扫描合成）

> 版本：v1.0 · 2026-10-23 00:40
> 输入：四路只读扫描（后端/存储 · 前端/体验 · 质量/测试体系 · 安全/运维），由 team-lead 逐条复核后合成
> 前序：`USER-CENTER-UPGRADE-PLAN-2026-10-22.md`（S1–S6 / M1–M11）、`USER-CENTER-DEEP-SCAN-V2-2026-10-22.md`（N1–N11，已全部落地并提交 `a5a2f09`）
> 本文定位：**用户中心之外的全仓缺口**。用户中心的 N 系列已收口，不再重复。

---

## 0. 结论（TL;DR）

四路扫描共提出约 20 条候选。我逐条复核后，**保留 3 条 P0、4 条 P1、3 条 P2，并明确证伪 2 条**。

保留下来的 P0 有一个共同特征：**它们都是"重用了别的东西"造成的隐性耦合**，单看每个文件都正确，合起来就错：

1. **CRDT 编辑日志既不在导出包里，也不在注销删除清单里**——用户点了「注销账号」，他自建的分类/自定义站点/置顶与排序的全量操作日志仍留在服务端。
2. **KV 存储借用了 jobs 表**，于是被 jobs 的清理策略反向管理——冷键 7 天后被静默删除，同时 `kv:` 行混入 dashboard 的任务成功率统计。
3. **admin 守卫在未配置白名单时 fail-open**——而同一仓库里 `verifyAdminSession` 的同类豁免是限定 dev 环境的，两者口径不一致。

**建议节奏**：P0 三条共约 1.5–2.5 人日，必须同批验收（1 与 3 都是「数据/权限的对外承诺与实际不符」，分开上会让承诺缺口长期存在）。P1 约 3–4 人日。P2 单独立项评审。

---

## 1. 方法与口径（诚实声明）

| 类别 | 处理方式 |
|---|---|
| **已复核** | 我逐条打开源文件核对行号与语义，本文 P0 三条全部属于此类，证据可直接照着改 |
| **已证伪** | 扫描报告提出、但复核后不成立的，单列在 §4，**不进入方案** |
| **待复核** | 扫描报告提出、我未逐条打开的，标注 ⚠️，不排在 P0 |

> 为什么单独声明：上一轮 N 系列里最严重的一个缺陷（NextAuth 字面量 `null` 被当故障）恰恰是**单测与源码断言都测不出来**的。如果方案本身建立在未复核的转述上，就会把同样的错误复制一遍。

---

## 2. P0 — 隐性耦合造成的真实缺陷

### P0-1【高】CRDT 编辑日志逃出了数据主权范围

**证据**

| 位置 | 事实 |
|---|---|
| `apps/api/src/routes/crdt.ts:30` | GET 读 `getUserVault("crdt:" + identity)` |
| `apps/api/src/routes/crdt.ts:76` | POST 写 `crdtKey = "crdt:" + identity` |
| `packages/store/src/repository/user-data.ts:99-110` | `exportUserData` 只取 `repo.getUserVault(identity)`——**不含 `crdt:` 前缀行** |
| `packages/store/src/repository/user-data.ts:251` | 注销删除只 `DELETE FROM user_vault_sync WHERE user_id = ?`（精确匹配） |
| `packages/store/src/repository/user-data.ts:269` | 第二次删除只覆盖 `workspaces:` 与 `ws_members:` 两个前缀——**仍不含 `crdt:`** |
| `apps/api/src/routes/crdt.ts:115` | 唯一删除路径是用户自己在前端点「清空」 |

**影响**

- 用户点「注销账号」后，其自建分类、自定义站点、置顶与排序的**全量操作日志**仍留在 `user_vault_sync` 里，无任何后续清理路径。这是删除权（个保法第 47 条意义上的删除）未履行，不是「清理不干净」这种程度的问题。
- 导出包自称「全部数据」，实际不含这部分。用户拿着导出包以为搬走了全部，换设备后自建分类全没了。

**最小改法**（都在 `packages/store/src/repository/user-data.ts` + `apps/api/src/routes/crdt.ts`）

1. `exportUserData`：在 `Promise.all` 里补 `repo.getUserVault("crdt:" + identity)`，作为一个具名字段并入导出包。
2. `deleteUserData`：补一条 `DELETE FROM user_vault_sync WHERE user_id = ?`，参数传 `"crdt:" + identity`。
3. `counts` 里的 `vault` 计数同步加上 `crdt:` 行，否则「已删除 N 项」的回执与实际不符。

**验收**：新增测试——写一个 `crdt:<id>` 行 → 调 `deleteUserData` → 断言该行查不到；调 `exportUserData` → 断言导出包含它。
**工作量**：**S**（约 30 分钟 + 1 条测试）· **破坏面**：低（纯增量，不改既有语义）

**顺带修（同一文件，建议同批）**：`crdt.ts:30/76` 直接用 `identityOf`，没有走 N2 的 `resolveCanonicalIdentity`。身份合并后旧设备会写 `crdt:<旧id>` 孤儿行——与 N2 覆盖的五个用户域是同一个问题，只是那一轮漏了 crdt。

---

### P0-2【高】KV 存储借用 jobs 表，被 jobs 的清理策略反向管理

**证据**

| 位置 | 事实 |
|---|---|
| `apps/api/src/storage.ts:472,475` | KV 读取：`SELECT payload FROM jobs WHERE id = 'kv:'+key` |
| `apps/api/src/storage.ts:493-501` | KV 写入：`INSERT INTO jobs (..., status) VALUES (..., 'done')`，`ON CONFLICT DO UPDATE SET payload, updated_at` |
| `packages/store/src/repository/jobs.ts:168-180` | `pruneJobs(olderThanDays = 7, statuses = ["done","failed","cancelled"])`，按 `updated_at <= cutoff` 删除 |
| `packages/store/src/repository/dashboard.ts:99` | `SELECT COUNT(*) FROM jobs WHERE status='done'`——`kv:` 行计入 24h 成功任务数 |

**触发面（已核实，这条决定了风险画像）**

全仓 `pruneJobs` **只有两个调用点**：`apps/api/src/routes/jobs.ts:162`（`POST /api/jobs/prune`，admin scope，默认 `olderThanDays=7`、statuses 含 `"done"`）与 `packages/store/test/dashboard-repo.test.ts:144`。`packages/store/src/retention.ts` **不碰 jobs 表**。

→ **没有定时自动清理会触发它**，只有管理员手动 prune 才会。这把问题从「7 天后自动消失」降级为「管理员点一下清理就丢数据」——概率低了，但后果没变，而且**更隐蔽**：事故会被归咎于「刚才那次清理」，却查不出为什么品牌配置没了。

**影响**

- **静默数据丢失**：KV 行 `status='done'` 且 upsert 只刷新 `updated_at`、不刷新 `created_at`，正好落在 `pruneJobs` 的清理集合里（删除条件为 `status IN (...) AND updated_at <= cutoff`，**只按 status 过滤、不看 kind**）。7 天内被重写过的 KV 能活；**超过 7 天没被重写的会被当已完成任务删掉**——而 `site.json` 品牌配置、`resource-metadata.json`、`videos.json`、`doc:*` 恰恰就是低频写入的那类数据。
- **指标失真**：`kv:` 行以 `'done'` 混入 `dashboard.ts:99` 的任务成功计数，运维看到的「24h 任务成功率」被 KV 写入量虚高，故障信号被稀释。

**最小改法（S，不是 M）**

`packages/store/src/repository/jobs.ts:173` 与 `:179` 两条 DELETE 的 WHERE 各加 `AND kind <> 'kv'`（SQLite 与 PG 同一句，方言无关，零破坏面）。KV 行自带 `kind='kv'`，比用 `id NOT LIKE 'kv:%'` 更可靠——`kind` 是显式语义字段，不依赖 id 前缀约定。

同步：`dashboard.ts:99` 的成功计数加 `AND kind <> 'kv'`；`listJobs` 一并排除，避免管理端任务列表里出现 KV 噪音。

**验收**（两层，合计 S）
1. **store 层**（不装 spy、不用假时钟）：`packages/store/test/` 里写 1 行 `kind='kv'` 的 `done` 任务，直接 `await repo.pruneJobs(repo, 0, ["done"])`——请求体钳位只影响 HTTP 入口，`pruneJobs` 本身接受 `olderThanDays=0`，是最干净的红→绿路径。**红优先验证**：先跑一次确认它暴露缺陷，加上 `kind <> 'kv'` 后再跑确认变绿。
2. **API 层**（证明它真的被接进 HTTP 入口）：`apps/api/test/maintenance-optimize.test.ts` 补两条——`POST /api/admin/maintenance/optimize` 带 `days:365` 后 `readKv('site-config')` 仍返回原值；`GET /api/admin/maintenance/status` 的 `pruneDeleted` 也不再计入 KV 行。

> 踩坑预警（scan-quality 实测）：只改 DELETE 不够。**`:173` 的 COUNT 语句与 `:179` 的 DELETE 都要加 `AND kind <> 'kv'`**——否则 `POST /api/jobs/prune` 的「已清理 N 条」回执仍会把 KV 算进删除数，回执与实际不符。

**工作量**：**S** · **破坏面**：极低
**根治（可选，L）**：KV 迁独立表 `kv_store`。**可以不做**——止血后 jobs 表多几行 KV 不影响正确性。列为 P2-1。

---

### P0-3【中高】admin 守卫在未配置白名单时 fail-open，且与 `verifyAdminSession` 口径不一致

**证据**

| 位置 | 事实 |
|---|---|
| `apps/web-overlay/src/lib/admin-guard.ts:26-51` | `requireAdmin()`：`ADMIN_IDS.length > 0` 才校验白名单；**未配置时任何已登录用户都返回 `ok: true`**，且**不区分环境** |
| `apps/web-overlay/src/lib/auth.ts:206-210` | `verifyAdminSession()` 的同类豁免写成 `isDev && !hasAdminIds`——**只在非 production 生效** |
| 两者并存 | 同一仓库里两个管理员口径，一个区分环境、一个不区分 |

**影响**

若部署开启了 GitHub OAuth 但未设 `NAVHUB_ADMIN_IDS`，**任何能登录的人都能调用 `/api/admin/*`** 读写站内数据。代码注释里写的是「渐进收紧，避免未配置时误伤既有部署」——这个初衷是对的，但代价是把安全默认值设成了开放。

**最小改法**

把 `auth.ts` 的 `verifyAdminSession` 提为**唯一口径**，`requireAdmin` 改为复用它。即：`requireAdmin` 在生产环境且未配置白名单时，与 `verifyAdminSession` 一样 fail-closed（403）而不是放行。

**验收**：测试——`NODE_ENV=production` + 未设 `NAVHUB_ADMIN_IDS` + 已登录非白名单用户 → 断言 403。
**工作量**：**M** · **破坏面**：**中**——可能锁死现有部署

> ⚠️ **上线顺序硬约束**：必须**先**确保所有环境的 `NAVHUB_ADMIN_IDS` 已配置，**再**合入这条改动，否则会把现有部署的管理端锁死。建议在改动里加启动期告警：production 且未配置白名单时打一条 WARN，让「还没配」变成可观测状态，而不是等到被锁死才发现。

---

## 3. P1 / P2

### P1-1【中】源码字符串断言型「假门禁」占比过高

**证据**：`apps/web/test/` 下有 **40 个**测试文件通过 `readFileSync` 直接读源码做字符串断言（我 `grep` 复核过数量）。这类测试能拦住「谁删了这一行」，但**对运行时行为完全失明**。

**佐证**：上一轮 N 系列最严重的缺陷（NextAuth 未登录返回字面量 `null` 被当成故障→每个匿名访客看到错误态）是 **E2E 三态矩阵抓住的**，源码断言一条都没报警——因为它断言的是「源码里有 `session === null` 这个判断」，而那个判断恰恰就是 bug 本身。

**最小改法**：不删除既有断言（它们对防误删仍有价值），而是**分层**：对已有 E2E 覆盖的面（`/me*`、`/favorites`），把源码断言降级为「存在性守卫」（只断言文件/导出存在），行为正确性交给 E2E 与渲染测试；新增行为一律优先写 E2E。
**工作量**：**M**（需逐个判定归属，不能批量改）

**已执行（2026-10-23，本轮）**——分层规则与落点：

| 层 | 断言什么 | 落点 |
|---|---|---|
| L1 存在性 | 文件/路由/导出存在、页面不被索引 | `me-pages` 的页面存在与 `robots`、`favorites-local-folders` 的模块存在 |
| L2 接线 | API 路径、hook 返回值、state 分支、存储键、导航入口 | `me-degrade-states`（分支→state）、`identity-ready`（useIdentityReady/重载）、`favorites-sync`（页面接纯函数）、`favorites-filter`（渲染链用筛选结果）、`me-pages`（API/入口） |
| L3 行为 | 真实模块执行与真实页面渲染 | 纯函数单测（`favorites-sync-copy` / `favorites-folders` / `describeFavoritesFilter`）+ `e2e/user-center.spec.ts` |

本轮具体动作：

1. **新增 E2E**：`/favorites` 筛选无命中 → 断言「没有收藏匹配…」与「收藏并没有丢：共 1 个都还在本机」（此前只有源码断言）；清空后条目恢复。
2. **降级重复文案断言**（E2E 已断言渲染结果）：`me-degrade-states` 移除 `/me` 的「登录状态暂时无法确认」与 `/me/history` 的「不代表历史被清空」字面量，改为断言「降级分支与真空分支互斥」；`me/data` 的「重试」改为断言按钮接回 `loadSession`。
3. **去掉实现形状断言**：`me-pages` 不再锁 `STAT_ITEMS` 的整行字面量，只要求入口表里存在 `/me/history`。
4. **favorites 两处**：`favorites-filter` 移除已被新 E2E 覆盖的「收藏并没有丢…」，保留「真空 vs 筛选未命中必须是两个分支」；`favorites-local-folders` 只保留旧错误文案的反向断言与新文案片段。

**刻意保留**：L2 接线断言无法用渲染测试替代（node 环境跑不起 Next 页面），删掉就等于没人挡「接线被移除」。它们不是「假门禁」，只是职责不同——E2E 管「跑起来对不对」，源码守卫管「能力还在不在」。


### P1-2【中】昂贵端点缺少独立限流额度

**证据**：`apps/api/src/server.ts:146` 注册了全局 `rateLimit { max: 300, timeWindow: "1 minute" }`——**有兜底，不是裸奔**。但 `copilot.ts` / `enrich.ts` / `sites.ts`（LLM 路径）/ 导入类端点没有更严格的独立额度。300/min 对普通读接口合理，对触发 LLM 调用的接口意味着**单 IP 每分钟可发起 300 次模型调用**。

**最小改法**：为这几个端点加 `config: { rateLimit: { max: N, timeWindow: "1 minute" } }`，额度按成本定（LLM 类建议 20–30/min）。
**工作量**：**S**

### P1-3【中】CRDT 未走 canonical 解析

见 P0-1「顺带修」，同批处理。

### P1-4【中】`POST /api/sites/cluster` 既有 N+1 又零测试

**证据**：`apps/api/src/routes/sites.ts:168-183`——对每个 `siteHistory` 行单独 `ctx.repo.getSite(row.site_id)`，N 条历史就是 N+1 次查询（注释里写「历史条目通常很少」，但无上限约束）。`apps/api/test/` 下对 `cluster` **零命中**，该端点完全没有测试。

**影响**：历史条目多的站点上，这个端点的查询数随历史长度线性增长，且因为没测试，任何性能回归都不会被发现。

**最小改法**（改代码 + 补测试同一次提交）
- 代码：handler 内 `Promise.all(siteIds.map(id => repo.getSite(id)))`（上限 `.max(100)`）换成 `repo.getSitesByIds(ids)`——`packages/store/src/repository/sites.ts:142`，自带分片 IN，`sites.ts:117` 有调用先例。
- 测试：**两条分支各一条**。① 传 100 个 id 时 `spy(ctx.repo.getSite)` 调用次数 ≤1；② 不传 siteIds 走 `listSites({categoryId, limit:100, status:"active"})` 的默认分支也要有用例——否则改了批量那条，默认那条没人挡。

**工作量**：**S**

### P1-5【中】插件审核状态变更有审计、无事件流

**证据**：`PATCH /api/plugins/:slug/review`（`apps/api/src/routes/plugins.ts:1091`）会写 `audit_logs`（`action='plugin.review'`），但**不写 `events` 表**。而 `GET /api/me/activity` 读的是 `audit_logs`，所以用户侧是**看得到**的——scan-quality 之前「用户看不到自己的审核动作」的判断不成立，已撤回。

**仍要补的理由**：`audit_logs` 是管理视角的追加日志，`events` 才是用户行为的时间序列。审核态变更（approve/reject）不在 `events` 里，就没法与其它用户行为做统一的时间序列分析，也没法在「用户活跃度 / 行为画像」这类聚合里出现。

**最小改法**：在 `plugins.ts:1091` 的审计写入旁补一条 `events` 写入（`kind` 沿用既有命名），或明确记录「审核态属管理动作、刻意不进用户事件流」的设计决策——二选一，但必须有一个，不能悬空。
**工作量**：**S**

### P1-6【中】11 个写端点零测试（不只是 cluster）

> **状态：已复核证伪，不实施。** 详见 §4 第三行：7 个端点不存在，4 个已有测试。

**证据**（scan-quality 全量核对）：`apps/api/test/` 下**完全没有**这 11 个写端点的用例——`POST /api/enrich`、`POST /api/sites/:id/revalidate`、`POST /api/sites/crawl/start`、`POST /api/sites/crawl/refresh`、`POST /api/plugins/:slug/publish`、`PATCH /api/plugins/:slug/review`、`PATCH /api/plugins/:slug/status`、`POST /api/plugins/:slug/report`、`POST /api/plugins/:slug/auto-review`、`POST /api/me/merge`、`POST /api/copilot/session/rotate`。

**影响**：这些端点走的是「请求体解析 → 钳位/上限 → 校验 → 写库」这条链，正是 `.max(100)`、`z.number().min().max()` 之类的边界逻辑所在。没有测试时，改任何一个上限或钳位都可能静默改变行为。

**最小改法**：新增 `apps/api/test/write-paths-gap.test.ts`，覆盖三类断言——① 上限边界（如 `navIds` 传 101 个 → 400）；② 钳位（越界值被夹到合法区间而非报错）；③ 校验失败路径（400 的 detail 结构）。
**工作量**：**M**

### P1-7【低】SSE 与导出端点零测试

**证据**：`GET /api/navsphere/events`（SSE 流）、`GET /api/backup/export`、`GET /api/me/export` 三个端点在 `apps/api/test/` 零命中。

**最小改法**：`apps/api/test/stream-export.test.ts`，断言 Stream 与 buffer 两条路径各自产出完整字节流、`content-type` 与 `content-disposition` 正确、SSE 心跳帧格式正确。
**工作量**：**S**

### P1-8【低】后端零 ESLint（前后端口径不一致）

**证据**：`apps/web-overlay` / `apps/web` 有 `eslint.config.mjs`（配 `eslint-plugin-jsx-a11y`），`apps/api` 与 `packages/store` **没有**。

**影响**：后端代码没有静态检查，空 catch、未用变量、`any` 逃逸这类问题只能靠 code review。

**最小改法**：给两个包各加一个 `eslint.config.mjs`，首轮只开 `no-unused-vars` / `no-empty` / `no-console`（`scripts/*.mjs` 除外），在 CI 里先报 warning 不 block。
**工作量**：**M**（全量修复告警要单独排）

### P1-9【低】`user_workspace_blobs` 未进 `schema.ts` 的 drizzle 表定义

**证据**：该表只在 `migrate.ts` 的 DDL 与裸 SQL 中存在（`docs/USER-CENTER-DEEP-SCAN-V2-2026-10-22.md` §8.1 已记录为有意未做）。后果是「schema 是单一事实源」名不副实，drift 无从校验。
**工作量**：**M**（牵动迁移与 DDL 生成）

### P1-10【中】pre-commit 按「工作区改动集」选测试，把并行会话的红灯拖进彼此的提交

**证据**：hook 用 `vitest run --changed` 选测试，而 `--changed` 取的是**工作区改动集**，不是本次提交集。当前工作树有并行会话 60+ 个无关改动时，它们的红灯会被拖进我的提交——反之亦然。

**这不是理论问题**：本次提交 `a5a2f09` 就因为它被迫用 `NAVHUB_SKIP_PRECOMMIT=1`。目前只能靠「人工核对零文件交集 + 在 commit message 里书面声明」兜底——**只要有人忘了核对，这个逃生口就会变成真正的漏洞**。

**最小改法（两处，都在 hook 里）**
1. 选测试的依据从 `vitest --changed` 改为 `git diff --cached --name-only`（提交集），读取暂存区而不是工作区；
2. 去掉 `--passWithNoTests` 的静默绿——改成「无匹配测试时显式打印 SKIP 清单」，否则「什么都没跑」和「跑过了」在输出里长得一样。

**工作量**：**S** · **破坏面**：低（只影响本地 hook，不改 CI）

### P1-11【低】`/admin` 页面层守卫仍是「已登录即可」（API 层已收口，页面层未跟）

**证据**：`apps/web-overlay/src/proxy.ts`（Next 16 认 `src/proxy.ts` 而不是 `middleware.ts`）对 `/admin/:path*` 只判 `req.auth?.user`——**已登录即可进**，不查管理员白名单。而 `authConfig.callbacks.authorized` 的 fail-closed 判定在这条链路上不生效：proxy 传了自定义 handler 给 `auth()`，next-auth 5.0.0-beta.32 的 `handleAuth` 里 `!authorized` 的重定向是 `else if` 分支，只在没有自定义 handler 时才执行。

**危害定性（已核实，不是数据泄露）**：`/admin/*` 页面全是客户端组件，数据一律走 `/api/admin/*` 或 `/api/hub/*`；前者已由 `requireAdmin` 收口，`apps/web-overlay/src/app/api/hub/[...path]/route.ts:60` 的后者也调 `verifyAdminSession()`，**与 requireAdmin 同一个口径**。所以非管理员进了页面也只能看到一片 403 的空白控制台，拿不到数据。

**为什么仍要修**：API 关了、页面开着，用户会落在一个「进得去但什么都加载不出来」的后台，看起来像系统故障而不是权限不足——这是把安全默认值变成了坏的失败体验。

**最小改法**：`proxy.ts` 的 `/admin` 分支改用 `verifyAdminSession()`（与 API 层同一口径），未通过时重定向到首页或明确提示「无管理员权限」，而不是静默放行。
**工作量**：**S**

### P2-1【中】KV 根治（独立表）— 见 P0-2 第二档
### P2-2【中】`/favorites` 组件级测试补全后再拆文件

**理由**：页面内金库导出/导入与同步状态、本地 store 强耦合，且 `e2e/front-pages.spec.ts` 断言了 Hero 文案。在**没有组件级渲染测试**的环境里拆分，回归只能靠 E2E 冒烟。顺序必须是「先补测试，再拆文件」。

### P2-3【低】匿名用户的收藏夹本地化

需要扩展 `LocalFavorite` 的本地来源并让脏集合承载文件夹变更，属协议级改动，与 M1 同步语义耦合，单独立项。

---

## 4. 已证伪 / 需修正的扫描断言

| 报告原断言 | 复核结果 |
|---|---|
| 「`dashboard.ts` 用 `'completed'`，而 `completeJob` 写 `'done'`，状态枚举不匹配」 | ❌ **证伪**。`dashboard.ts:99` 用的就是 `status = 'done'`；`jobs.ts:107-108` 的 `completeJob` 写入值也是 `'done'`，两者一致。`'completed'` 只出现在 `driver.ts:198/632` 的 `identity_merges.status` DDL 默认值与 `identity.ts:319`，与 jobs 无关。 |
| 「30 个路由文件完全没有限流」 | ⚠️ **需修正表述**。`server.ts:146` 注册了全局 300/min 兜底，所有路由都受它约束。准确表述是「昂贵端点缺少更严格的独立额度」，而非「无保护」。已按修正后的表述重写为 P1-2。 |
| P1-6「11 个写端点零测试」 | ❌ **大半不成立**（2026-10-23 实跑复核）。其中 7 个端点在本仓根本不存在：`/api/sites/:id/revalidate`、`/api/sites/crawl/start`、`/api/sites/crawl/refresh`、`/api/plugins/:slug/publish`（实际是 `POST /api/plugins/:slug/versions`）、`/api/plugins/:slug/status`（实际由 `review` 的 `delist` 承担）、`/api/plugins/:slug/auto-review`、`/api/copilot/session/rotate`。剩下 4 个已有用例：`POST /api/enrich`（`api.test.ts:614`）、`review`（`plugins-api.test.ts:105`，approve/reject/delist 全覆盖）、`report`（同文件 `:157`）、`/api/me/merge`（`me-api.test.ts:72` 四条）。**不新增 `write-paths-gap.test.ts`**——补一份只覆盖不存在端点的测试文件，比不写更糟。真正缺测试的 `POST /api/sites/cluster` 已由 P1-4 的 `sites-cluster.test.ts` 收口。 |

> 保留这两条的理由：方案里每一条都会变成代码改动与测试用例。**把证伪的断言留在方案里，等于让后面的人去实现一个不存在的问题**——那比漏掉一个真问题更贵，因为它同时消耗了时间和信任。

---

## 5. 路线图

| 批次 | 内容 | 预估 | 前置 / 约束 |
|---|---|---|---|
| **W1（同批验收）** | P0-1（+ CRDT canonical）· P0-2（`kind <> 'kv'`）· P0-3 · P1-4（N+1，同一文件段） | 1.5–2 人日 | P0-3 必须先配置 `NAVHUB_ADMIN_IDS` 再合入；P0-2 需红→绿双验 |
| **W1 尾** | P1-10 pre-commit 修法（S，当天就能收） | 0.5 人日 | 无——越早越好，它正在被每天绕过去 |
| **W2** | P1-1 测试分层 · P1-2 限流额度 · P1-5 事件流决策 · P1-7 SSE/导出 | 2–3 人日 | P1-1 需逐个文件判定归属，**禁止批量脚本改** |
| **W3** | P1-6 写端点门禁 · P1-8 后端 ESLint · P1-9 schema 补齐 · P0-3 的启动期告警 | 3–4 人日 | P1-8 全量修告警另排 |
| **评审后** | P2-1 KV 独立表 · P2-2 拆分 `/favorites` · P2-3 匿名收藏夹 | 6–9 人日 | P2-2 必须先补组件级测试 |

> P0-2 修正后为 **S**，因此 W1 从原估 2.5 人日降到 1.5–2 人日。

**批次原则**：P0 三条必须同批验收。P0-1 与 P0-3 都是「对外承诺与实际不符」（删除权 / 管理权限），分开上会让承诺缺口长期存在且无人跟踪。

### 5.1 执行状态（2026-10-23）

| 项 | 状态 | 说明 |
|---|---|---|
| P0-1 / P0-2 / P0-3 | ✅ 已完成 | 代码 + 定向测试，随 W1 提交 |
| P1-2 / P1-7 / P1-10 | ✅ 已完成 | 限流额度、SSE/导出测试、pre-commit 暂存集选测 |
| P1-3 / P1-5 | ✅ 已完成 | CRDT canonical 与审核事件流决策注释 |
| P1-11 | ✅ 已完成 | `auth.config.ts` 的 `isAdminAccessAllowed` 成为唯一放行矩阵，`proxy.ts` 与 API 同口径；顺手去掉 `authorized` 里对 `role` 的信任（历史 session 可能带被默认成 admin 的 role） |
| P1-9 | ✅ 已完成 | `user_workspace_blobs` 补进 `schema.ts` 的 drizzle 定义与导出集 |
| P1-8 | ✅ 首轮落地（+ 后续清死导入） | `apps/api` / `packages/store` 各加 `eslint.config.mjs`（仅 src，三条规则全部 warn），根脚本 `lint:backend`，CI 以 `continue-on-error` 运行。store 基线 868 → **0**、api 61 → **24**（见 §7.3） |
| P1-6 | ⛔ 复核后不实施 | 见 §4：7 个端点不存在，其余已有测试 |
| P1-4 | ✅ 已完成（并行会话） | `recipes.ts` 改走 `getSitesByIds`，`sites-cluster.test.ts` 覆盖两条分支 |
| P1-1 | ✅ 已执行（用户中心面） | `/me*` 与 `/favorites` 的源码断言按 L1/L2/L3 分层：重复文案断言移交给 E2E（新增 `/favorites` 筛选无命中用例），源码只保留存在性与接线守卫；规则与落点见 §3 P1-1。其余页面按同一规则在后续改动中逐步收口 |

---

## 6. 硬约束（沿用既有纪律）

1. **双目录镜像**：改 `apps/web-overlay/src` 必须同步 `apps/web/src`（`check-web-overlay` 会拦）。
2. **最小改动**：不重构、不破坏接口；每个修复必须可验证。
3. **诚实遥测**：禁止硬编码假数据；「待采样」不得渲染成真实数字。
4. **签名先于解析**：任何 canonical 改动都不得改变签名输入（raw identity 截断 64 字符）。
5. **提交隔离**：当前工作树有并行会话的改动（SEO / 数据保留 / 嵌入向量），坚持 pathspec 提交。`pre-commit` 的 `vitest run --changed` 按**工作区改动集**选测试，会被并行会话污染——必要时用 `NAVHUB_SKIP_PRECOMMIT=1`，但必须在 commit message 写明原因 + 已核对零文件交集。**这是权宜之计，正解见 P1-10**（改读 `git diff --cached --name-only`），建议 W1 尾就收掉。
6. **新增文件后跑 `git check-ignore -v <path>`**：`.gitignore` 的 `data/` 规则曾把 `/me/data/loading.tsx` 静默排除（本机一切正常，但永远进不了版本库）。已加目录级反排除，同类问题仍可能出现在其它路由目录。

---

## 7. 实施进度（2026-10-23 凌晨批次）

> 口径：三个方案（W1 / W1尾 / W3）全部落地。本节记录「谁落的 / 验证到什么程度 / 还差什么」。

| 项 | 状态 | 落点 / 验证 |
|---|---|---|
| P0-1 CRDT 数据主权 | ✅ | `user-data.ts:106/117`（导出）、`:233`（回执计数）、`:269`（注销删除）、`:86`（类型）。测试 3 passed |
| P0-1b crdt canonical | ✅ | `crdt.ts:27/31`、`50/54`、`138/140` 三段式，解析严格在签名校验之后 |
| P0-2 KV 免于 prune | ✅ | `jobs.ts` COUNT 与 DELETE **各 2 处**（sqlite + pg）共 4 处 `kind <> 'kv'`；`dashboard.ts` 五条计数全排除 |
| P0-3 admin 守卫 | ✅ | `admin-guard.ts` 删除本地 `ADMIN_IDS` 副本、完全委托 `verifyAdminSession()`；`auth.ts` 加生产期告警 |
| P1-4 cluster N+1 | ✅ | `recipes.ts:260-273` 改 `getSitesByIds`（返回 `Map<string, Site>`，调用前去重、保持原顺序）。测试 3 passed，含反向自证 |
| P1-10 pre-commit 选测 | ✅ | `install-git-hooks.mjs` 改 `git diff --cached --diff-filter=ACMRD`；去掉 `--passWithNoTests` 改打印 SKIP 清单 |
| P1-11 `/admin` 页面层同口径 | ✅ | 由并发会话一并落地（见下方 §7.1） |
| W3 覆盖率出数 | ✅（数字见 §7.2） | `vitest.config.ts` coverage 段 + `scripts/check-coverage.mjs` + `package.json` coverage 脚本 |
| W3 后端 ESLint | ⚠️ **能跑，但不能当门禁** | 基线噪音过大，见 §7.3 |

**验证汇总**：定向测试 4 文件 **23 passed**；`tsc --noEmit` api / store **双 0**；全量回归 **3032 passed / 11 failed / 20 skipped**（11 条见 §7.4）。

### 7.1 关于并发会话

执行过程中出现一个并发会话在**同时实现同一份方案**，它先一步把 P0-1 / P0-2 / P0-3（含我后来才补进文档的 P1-11 页面层）提交为 `6a5260f`，W3 的 ESLint 部分提交为 `2c91975`。我的 worker 因此多次报告「文件被同名覆盖」。

处理原则：**照做、不重做、不抢锁**——不推翻对方实现，而是核对是否与定稿改法等价，并把验证补回来。上述各项我已逐行核验过 HEAD 里的实际代码（不是采信任何一方的自述），确认与规格一致。

### 7.2 覆盖率实测：被环境护栏挡住，已定位根因

首次跑 `vitest run --coverage` **拿不到产物**，根因不是代码：

```
[coverage] 找不到覆盖率产物：.../coverage/coverage-summary.json
Unhandled Error: [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]
  {"count":345,"threshold":50,"scope":"turn","targets":[".../coverage\\.tmp"]}
  ❯ V8CoverageProvider.cleanAfterRun
```

vitest 收尾时会整体删除 `coverage/.tmp`（几百个文件），被本机的**批量删除护栏**拦下并抛错，`reportsDirectory` 里因此只剩半成品，`coverage-summary.json` 根本没写出来。

**两点值得记下来**：

1. `scripts/check-coverage.mjs` 的行为是对的——它打印「找不到产物 + 先跑什么」，**没有拿空数据编一个 0% 出来**。这正是先只出数不定阈值的价值：脚本宁可说"没数据"，也不说假数字。
2. 修法（`vitest.config.ts` 已改）：
   ```
   clean: false,
   cleanAfterRun: false,
   ```
   不清理只是留下 `.tmp` 与上轮残留，两者都在被 gitignore 的 `coverage/` 内，无副作用。

**实测结果（2026-10-23，`vitest run --coverage`，3072 条用例 / 248s）**：

| 指标 | 覆盖 / 总数 | 百分比 |
|---|---|---|
| 行 lines | 12 053 / 14 360 | **83.93%** |
| 语句 statements | 13 245 / 16 371 | **80.90%** |
| 函数 functions | 2 027 / 2 398 | **84.52%** |
| 分支 branches | 8 825 / 12 909 | **68.36%** |

- 全量用例：**3052 passed / 20 skipped / 0 failed**；`coverage-summary.json` 正常产出，`check-coverage.mjs` 能读到。
- 统计口径仅 `apps/api/src` + `packages/*/src`（vendored 的 `apps/web` 不计入），与配置注释一致。
- **未设阈值**：本轮只出数。分支 68% 是最低项，下一轮若要收紧，先看 `packages/store/src/vector/pgvector.ts`（0%）这类真实零覆盖文件，而不是一刀切卡总行数。

> 一次时序 flake 记录：同一命令第一次跑时，唯一失败是 `site-duplicates.test.ts > 同样输入下比参考实现快`（性能断言，未过 3× 阈值）。第二次同命令全绿——coverage 插桩会放大耗时，性能断言在插桩下不稳定。**这不是产品回归**，但后续若把 coverage 放进 CI，建议对该类断言单独排除或用相对基线。


### 7.3 W3 后端 ESLint 的诚实结论

配置能跑，但**现在不能当门禁用**：

| 包 | 基线（清理前） | 清理后 |
|---|---|---|
| `apps/api` | **61 条**（43 `no-console` + 18 未使用导入） | **24 条**（20 条 `console.log` 调试残留 + 4 条非导入位置的未用变量） |
| `packages/store` | **868 条**（862 未使用导入 + 6 `no-console`） | **0 条**（`b3982bb` + `sites.ts` 收尾，共清 862 个死导入） |

`no-console` 口径已收紧为「只提示 `console.log`」：服务端的 `console.warn/error/info` 是正常运维输出，不再计噪音（两个包配置一致）。

**此前「大量疑似误报、集中在 barrel 再导出」的判断已被推翻**（2026-10-23 复核）：

- 抽查 `repository/analytics.ts`、`categories.ts`、`behavior.ts`、`vault.ts` 等文件，`rowToFavorite` / `rowToFolder` / `rowToJob` / `toPgSql` 等被点名的符号在每个文件里**只出现一次**——就在 import 行，正文与 `export` 中都没有引用；`git grep` 全仓也只在真正的使用方（`repository.ts`、`migrate.ts`、`search.ts`）里找到引用。
- 这些文件不是 barrel：它们是从 `records.ts` / `dialect.ts` 复制过来的大段导入后**没有裁剪**，属真实死导入。误报不会如此整齐地分布在 28 个文件、每个文件 41–43 条。

**已落地的修法**（`b3982bb` + `5a0ff2e` + 本批）：用 TypeScript AST 定点剔除 `packages/store` 23 个仓库文件里的 **862 个**未使用具名导入、`apps/api` 8 个文件里的 **14 个**（按字符区间删除，保留其余格式与再导出）。验证：`tsc --noEmit` 5 包全过，store 测试 **303 passed**，全量回归 **3052 passed / 0 failed**，store lint **0 warning**。

**剩余 24 条的归属**（全部在 `apps/api`）：20 条是 `console.log` 调试残留（需逐条判断是真调试残留还是启动横幅，不能脚本一刀切），4 条是非导入位置的未用变量。store 侧已清零，可先把它单独提为 error 门禁；api 侧等 24 条清完再提。

> 跑法备忘（ESLint 10.13.0 已作为 `apps/api` / `packages/store` 的 devDependency 安装）：
> 在仓库根跑 `pnpm run lint:backend` 即可（内部 `pnpm --filter ... run lint`）；flat config 的 basePath 在各自包根。


### 7.4 全量回归的 11 条失败（**与本次改动无关**，待归属方确认）

11 条**全部**集中在 `scripts/check-isr-routes.test.ts` 一个文件，失败信息为：

```
✖ 读不到 .../apps/web/.next-isr-gate-fixture/prerender-manifest.json
  —— 先跑 next build（或设对 NEXT_DIST_DIR）
```

判定依据（三条，都可复核）：
1. **零文件交集**：该文件在 `git status` 里是干净的（非本次任何批次改动），与我的五个批次无任何重叠文件；
2. **失败性质是构建产物缺失**，不是逻辑断言失败；
3. **归属方正在动这块**：近期提交 `05c244e fix(ci): check-isr-live 的两个前提——next start 的 cwd 与中枢先于构建`、`d9b97ba fix(isr-gate): --live 接受分页归一与硬 404` 都在这个区域，属在制品。

**需要 ISR 门禁的归属方确认：这是本机环境问题（缺 `next build` 产物），还是门禁本身的回归。** 我未擅自修改该文件。

> **归属方答复（2026-10-23，`9ed424d` 之后）**：既不是缺产物，也不是门禁回归 —— 是**用例自己的 fixture 目录被并发进程删掉**。
> `scripts/check-isr-routes.test.ts` 的 `writeManifest()` / `writeSources()` 第一步就 `rmSync` 整个 fixture 目录，
> 而目录名是写死的 `apps/web/.next-isr-gate-fixture`（与 `.next-isr-gate-src-fixture`）。这台机器上常有第二个会话同时跑同一套用例：
> A 进程刚写好 `prerender-manifest.json`，B 进程把它 rm 掉，A 随后 spawn 的门禁就报「读不到产物，先跑 next build」。
> 11 条全部集中在同一个文件、且都是这一句，正是这个形状。
> 已修：fixture 目录改为按 `process.pid` 隔离（`apps/web/*` 本来就在 .gitignore 里，不留脏文件）。
> 复核：`node node_modules/vitest/vitest.mjs run scripts/check-isr-routes.test.ts` 同时开两份，两份都 42/42 绿（改前这类并发就是这 11 条红）。
> 顺带一条同族的并发坑：满并发跑整仓用例时本机还会出 `EBUSY rmdir`（Windows 文件锁），与 fixture 隔离无关，降到 `--maxWorkers=2` 即可。

---

## 8. 验证清单

```bash
# W1 新增/修改的定向测试
node node_modules/vitest/vitest.mjs run \
  packages/store/test/user-data-crdt.test.ts \   # P0-1：crdt 行导出覆盖 + 注销删除
  packages/store/test/kv-retention.test.ts \     # P0-2：pruneJobs 不得删 kind='kv'
  apps/web/test/admin-guard.test.ts              # P0-3：production + 无白名单 → 403

# P0-2 的第二层验收（内嵌在 optimize 测试里）
node node_modules/vitest/vitest.mjs run apps/api/test/maintenance-optimize.test.ts

# P1-4：N 条历史只产生 1 次批量查询
node node_modules/vitest/vitest.mjs run apps/api/test/sites-cluster.test.ts

# 类型检查
node node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p packages/store/tsconfig.json

# 镜像一致性
node scripts/check-web-overlay.mjs && node scripts/sync-overlay-drift.mjs
```
