# NavHub 升级执行报告（2026-10-24）

> 基线：`11c8ce9 feat(user-center): 用户中心第四批升级——升级方案 24 项全量落地`
> 范围：全仓只读扫描后确认的**可验证缺陷**，按「正确性 → 性能 → 稳定性 → 体验」优先级施工。
> 纪律：不修改 vendored `apps/web` 自有文件；不覆盖并行会话的活跃 WIP（用户中心视觉美化 7 文件）。

---

## 0. 结论

本轮聚焦「批量路径」这一类隐性性能缺陷：单条正确、批量错误，UI 上完全看不出来，只在真实数据量下表现为超时/回滚。共修复 4 处 N+1 与 1 处测试基础设施缺陷。

| 编号 | 改动 | 类型 | 量化收益 |
|---|---|---|---|
| E1 | `/api/sites/batch` 去重与索引批量化 | 性能 | 200 条导入：400+ 次 DB 往返 → 3 次；索引 200 次推理 → 7 次 |
| E2 | `saveEmbeddingsBatch` 多值 UPSERT | 性能 | 200 条向量写入：200 次 INSERT + 1 长事务 → 2 次语句 |
| E3 | `insertSitesBulk` + 备份恢复批量化 | 性能 | 500 条：749ms → 61ms（**12.3x**） |
| E4 | 恢复路径取消全量回读（`hydrate: false`） | 性能 | 5 万条上限省去 100 次分片大查询 |
| E5 | ISR 门禁测试 fixture 幂等化 | 测试 | 基线 **52 个失败** → 0 |
| E6 | 备份恢复可观测化（耗时/跳过/失败分类/审计） | 可观测 | 失败可追、变慢可测、响应不泄漏原始报错 |
| E7 | 恢复后入队 `reindex` | 正确性 | 修掉「恢复完立刻搜，语义通道为空」 |
| E8 | 巡检增补三项（悬空关联 / 向量缺口 / 向量残留） | 可观测 | 把恢复与批量写入的静默后果变成审计数字 |
| E9 | `/admin/sitelist` 归属索引 + 筛选缓存 | 性能 | 6400 站点筛选 8.60ms → 4.85ms（**1.8x**），且弹窗等无关状态不再重算 |
| E10 | PG 侧批量路径用例（4 例） | 测试 | 本轮新增的批量函数首次获得跨方言覆盖（CI 执行） |

---

## 1. 逐项说明

### E1 `/api/sites/batch`：去掉循环内 N+1 与逐条索引

**问题**

`apps/api/src/routes/sites.ts` 的批量导入在事务内逐条 `await ctx.repo.findSiteByUrl(cleanUrl)`；向量索引在事务外逐条 `await indexSite(...)`。上限 200 条时：

- 去重：200 次查询，全部压在同一个写事务里；
- 索引：200 次 ONNX 推理 + 200 个事务（`indexSitesBatch` 的批量能力此前只有 jobs 与插件路径在用）。

**改法**

1. `packages/store/src/repository/sites.ts` 新增 `findExistingSiteUrls(repo, urls)`：把每条 URL 的三个变体（原文 / canonical / canonical 的斜杠反例）合并成按片 `IN` 查询，一次取回「已存在」集合。语义与 `findSiteByUrl` 严格一致（只认 `deleted_at IS NULL`，三变体任一命中都算重复）。
2. 批次内重复由 `known` 集合就地补登——原实现靠「前一条已插入事务内」使第二条被判重，改批量后必须显式补登，否则同批重复会撞唯一索引返回 500。
3. 索引改为 `indexSitesBatch` 按 32 条分片。片大小是「推理批效率」与「单条失败影响面」的折中。

**验收**

`apps/api/test/site-batch-dedupe.test.ts`（新增 4 例）：同批次重复、跨批次斜杠变体双向、40 新 + 10 重的计数准确性、软删行不算重复（允许重新导入）。

### E2 `saveEmbeddingsBatch`：多值 UPSERT

**问题**

`apps/api/src/index-site.ts` 在事务内 `for` 循环逐条 `saveEmbedding`，每条一次 INSERT。批量导入时这就是「N 次往返 + 一个长事务」。

**改法**

`packages/store/src/repository/embeddings.ts` 新增 `saveEmbeddingsBatch`：每行 5 个绑定参数、100 行/片（500 参数，对 SQLite 老构建的 999 上限留余量），单条多值 UPSERT，不再需要外层事务。**保留** `vectorToBlob` 的非有限值清洗——NaN 一旦进 BLOB，rehydrate 后整个 KNN 距离变 NaN 且零报错。

**验收**

`packages/store/test/embeddings-batch.test.ts`（新增 4 例）：250 条跨 3 个分片全部可读回（抽查 0/99/100/199/200/249 边界）、同 id 覆盖不冲突、NaN/Infinity 清洗为 0、空数组 no-op。

### E3 `insertSitesBulk`：备份恢复从 30 万次往返降到数百次

**问题**

`POST /api/backup/restore` 的上限是 **50,000 站点**，原实现在单事务内逐条 `createSite`。单条 `createSite` 要经过：

```
getDeletedSite（1 查）→ INSERT sites（1 写）→ setSiteTags（每标签 2~3 查/写）
→ setSiteFacets → setSiteRelations → getSite 回读（1 查）
```

即每条约 6~12 次往返。5 万条 = 30 万次以上，全部持写锁。实际表现是「恢复几千条就超时 → 整体回滚 → 用户看到备份恢复失败」。

**改法**

`insertSitesBulk`：唯一标签先一次性解析成 id 映射 → 站点行多值 INSERT（40 行/片 = 760 参数）→ 站点-标签关联批量插入（400 行/片 = 800 参数）→ 可选回读。

三处必须与 `createSite` 等价：fts/pinyin 索引字段（`buildIndexFields`）、metadata 打包（`packMetadata`）、默认值（status/enabled/sort/featured/source/weight）。任何漂移都会造成「恢复出来的站点搜不到」这类隐形缺陷。

**刻意收窄**（不是通用替代）：只走新建路径、不处理软删 id 复活、不处理 facets/relations。

**附带修复**：`site_tags` 按 `(site_id, tag_id)` 去重。`setSiteTags` 不去重，而恢复包的 tags 来自用户导出，完全可能有重复——重复会撞唯一约束让整批 409。

**验收**

`packages/store/test/sites-bulk-insert.test.ts`（新增 4 例）：与 `createSite` 的字段/索引等价（同一标题两条都能搜到）、重复标签去重、`hydrate:false` 跳过回读但写入仍生效、空输入 no-op。

既有 `backup-api` / `backup-dry-run` / `backup-full-coverage` / `backup-scope` 共 16 例全绿。

### E4 取消恢复路径的全量回读

`insertSitesBulk` 加 `hydrate` 选项。备份恢复只需要条数（`restoredSites = inserted.count`），5 万条回读是 100 次分片大查询、每条还要解 metadata/tags，结果只被取 `.length`。

### E5 ISR 门禁测试：52 个基线失败

**问题（基线实测，非本轮引入）**

改动前全量跑：`52 failed | 3718 passed`，全部集中在 `scripts/check-isr-routes.test.ts`。根因不是断言：

```
Error: [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":63,"threshold":50,...}
 ❯ scripts/check-isr-routes.test.ts:137  afterEach → rmSync(SRC_FIXTURE_ROOT, { recursive: true })
```

`afterEach` 与 `writeManifest` 都整树 `rmSync` fixture（60+ 条目），命中宿主环境的批量删除护栏（单轮 >50 条），抛错被记为测试失败。这与门禁逻辑无关，是测试卫生问题：**任何在本机跑全量测试的人都会看到 52 个红灯**，久而久之没人再当真。

**改法**

fixture 改为幂等覆盖：

1. `writeManifest` 只重置单个 `prerender-manifest.json`，不删目录树；
2. `writeSources` 不删根目录——它对全部 15 个白名单文件逐个重写，同名覆盖本身就是重置；
3. `afterEach` 只清那一个产物文件。

删除条目从 63 降到 1。fixture 目录名带 pid 且 `apps/web/*` 在 `.gitignore` 内，残留不污染仓库。

**验收**：该文件 60 例全绿（此前 52 红）。

---

## 2. 量化基准

500 条站点、5 个标签轮转、SQLite `:memory:`：

| 路径 | 耗时 | 说明 |
|---|---:|---|
| 逐条 `createSite` | 749 ms | 原恢复路径 |
| `insertSitesBulk({hydrate:false})` | 61 ms | 新路径 |
| 加速比 | **12.3x** | PostgreSQL 网络往返下差距更大 |

外推：5 万条上限下，原路径约 75 秒（本地 SQLite）到数分钟（PG），且全程持写锁；新路径按 12x 计约 6 秒。

---

## 3. 门禁结果

| 门禁 | 结果 |
|---|---|
| `check-syntax` | 1030 文件 / 0 错误 |
| `typecheck`（5 包，TS 7.0.2） | 通过 |
| `apps/web` 独立 `tsc --noEmit` | 通过（前端改动含新模块与页面） |
| `check:bundle` | 69 条路由全部在预算内（首页 1041/1115 KB 最紧） |
| `check-web-overlay` | **0 漂移**、625 个覆盖层文件一致 |
| `eslint`（改动文件） | 0 errors（剩余 8 个 warning 均为既有：exhaustive-deps ×2、immutability、未使用 `_`） |
| 全量 vitest | 见 §4 |

**一次真实拦截**：首轮全量跑出 `tw-source-coverage` 红灯——新增的 `apps/web-overlay/src/lib/admin/` 不在 Tailwind `@source` 列表里。该守卫检查「被 .gitignore 忽略的源码文件必须真的进入扫描集」，vendored 的 `src/lib` 整目录被忽略，所以新目录必须显式登记。已按守卫意图补 `lib/{admin,p2p,seo,server}`，未绕过。

---

## 4. 全量测试

```
 Test Files  346 passed | 1 skipped (347)
      Tests  3804 passed | 28 skipped (3832)
   Duration  644.29s
```

| 时点 | 文件 | 用例 |
|---|---|---|
| 本轮开始前基线 | `1 failed | 339 passed` | `52 failed | 3718 passed` |
| 第一批后（`f08cdd1`） | `343 passed | 1 skipped` | `3782 passed | 0 failed` |
| 第二批后（本次提交） | `346 passed | 1 skipped` | `3804 passed | 0 failed` |

两批合计用例净增 86 条：38 条新增回归（12 + 6 + 2 + 14 + 4 PG skip），52 条从失败转为通过。

skipped 的 28 条 = 4 条 PG 批量用例（无 `NAVHUB_TEST_DATABASE_URL`）+ 24 条既有 PG 用例，全部由 CI 的 test-postgres 作业执行。

---

## 5. 第二轮：可观测性、跨方言与前端筛选（E6–E10）

### E6 备份恢复可观测化

**问题**：恢复是「一次请求改整库内容」的操作，此前只有两处外部可观测面——成功时一条只含条数的审计、失败时一行日志。三个盲区：

1. **失败不可追**：审计表空白，运维无法回答「什么时候失败、备份多大、什么原因」；
2. **耗时不可测**：没有 `durationMs`，变慢只能靠用户抱怨；
3. **错误不可读**：409 只有一句笼统文案，无法区分「备份里 id 重复」还是「外键坏了」。

**改法**

- 成功审计增加 `durationMs` 与结构化 `skipped`（重复分类 / 非法 URL / 重复 URL）；
- 失败写 `backup.restore_failed` 审计（`reason` + `durationMs` + 计划条数）；
- 新增 `classifyRestoreError()`：跨方言识别 `duplicate_key` / `foreign_key` / `not_null` / `schema` / `unknown`；
- 409 响应回 `reason` 而**不回原始 message**——数据库报错里常带具体值（重复的 URL、约束名），那属于用户数据。

### E7 恢复后入队 `reindex`

**问题（既有缺陷，非本轮引入）**：恢复只写 `sites` / `site_tags`，**不建向量**。于是恢复出来的站点能靠 exact / fts / pinyin 命中，语义通道却要等下一个定时 `reindex`（cron 每 4 小时）才可用。备份恢复后立刻搜，语义结果是缺的。

**改法**：恢复成功且 `restoredSites > 0` 时 `enqueueJob("reindex", { vectors: true })`。5 万条全量重建不能塞进恢复请求（会超时），交给 JobRunner 异步做；入队失败不影响恢复结果（数据已落库，定时任务仍会补）。

### E8 巡检增补三项

`user_data_audit` 原本只查两类用户侧问题（悬空夹引用、收藏缺站点）。新增站点侧三项，全部「只报不动」：

| 指标 | 含义 |
|---|---|
| `orphanSiteTags` | `site_tags` 指向已不存在的站点或标签（批量写入标签解析失败、物理清理漏删） |
| `sitesMissingEmbedding` | 有站点但无向量——**这正是恢复后的状态**，用来验证 E7 是否生效 |
| `orphanEmbeddings` | 向量指向已不存在的站点 |

向量两项只在 `config.embedding.enabled` 为真时统计：lite 模式默认关闭，关闭时「每条都缺」是预期状态，报出来只会变成每日噪音。判据用 `config.enabled` 而非 `ctx.embedding` 是否存在——service 对象在关闭时仍会被构造（供 `/api/health` 如实上报能力）。

### E9 `/admin/sitelist` 归属索引 + 筛选缓存

**问题（实测，非推断）**

三个查找函数各自遍历「分类 × 子分类 × items」，而每行渲染会调用 4 次（筛选 2 次 + 两个单元格各一次 `getSiteCategoryInfo`，每次内部再遍历一遍）。

基准（8400 行同构数据：6400 站点 / 40 分类 / 每分类 40 主项 + 3×40 子项）：

| 实现 | 单次筛选 |
|---|---:|
| 线性查找（原） | 8.60 ms |
| 索引查找（新） | 4.85 ms |

**诚实结论：只有 1.8x，不是数量级提升。** 原因是瓶颈在字符串匹配（6400 站点 × 3 字段 `toLowerCase` + `includes`），分类查找原本的占比被高估了。索引把查找降到 O(1)，但整体收益被字符串成本压住。

因此叠加第二层：`filteredSites` 用 `useMemo` 按五元依赖缓存。页面还有对话框开关、上传进度、表单草稿等十余个状态，原实现每次渲染都重算筛选——打开一个弹窗也要付 5ms。这层的收益不体现在单次基准里，而体现在交互时的无效重算消除。

**未做**：预计算小写化字段（把 `toLowerCase` 从每次筛选移到数据加载）。它能把 4.85ms 再压一半，但需要在 `sites` 更新时维护派生缓存，与现有「`sites` 由多个 CRUD 分支直接 `setSites`」的写法冲突，属独立改造。

**语义等价**：抽取时踩到一个真实的漂移点——原查找函数在**找不到时返回空串**（不是 `undefined`），所以「未归类站点」会被 `none` 子分类筛选命中。用 `?? ''` 保持，并写进测试。

### E10 PG 侧批量路径用例

本轮新增的三个函数是「5 万条恢复」的承载者，此前只在 SQLite 验证。补 4 例（`pg-dialect.e2e.test.ts`）：

1. `findExistingSiteUrls` 三变体命中 + 软删排除；
2. `insertSitesBulk` 45 条多值 INSERT + 重复标签去重 + `hydrate` 两种模式；
3. **原子性**：事务内 `insertSitesBulk` 后抛错，条数与事务前一致；
4. `saveEmbeddingsBatch` 150 条跨分片 UPSERT（PG 的 `BYTEA` + `ON CONFLICT`）。

**本地无法执行**（无 `NAVHUB_TEST_DATABASE_URL`，docker 不可用），由 CI 的 test-postgres 作业执行。这是本轮唯一「未在本地验证」的改动面，已在 §7 单列。

---

## 6. 未执行项与原因

| 项 | 状态 | 原因 |
|---|---|---|
| 用户中心视觉/布局改动 | 未动 | 并行会话正在编辑 9 个文件（mtime 15:57–15:59，内容为 sticky 子导航、玻璃卡片、图标芯片）。按纪律不覆盖。 |
| `check-web-overlay` 的 `tsconfig.json` 漂移 | 未动 | 该漂移在本轮开始前就存在（overlay 与 vendored 底座内容不一致），不属于我的改动范围；`--fix` 会连带镜像并行会话的 WIP。 |
| 巨型组件**整体拆分**（`algorithm-lab` 2216 行、`sitelist` 2147 行） | 部分执行 | 已把 `sitelist` 的归属查找与筛选抽成独立纯函数模块（E9）+ 14 例测试；**组件本身未拆**。理由：2100 行单组件内 50+ 个 state 与回调紧耦合，抽 hook 无法用现有守卫证明行为等价，属独立批次。 |
| 前端触控目标 / a11y 补强 | 未执行 | 复核发现 guard 体系已相当完整（`keyboard-activation` / `graph-keyboard` / `a11y-contrast` 三道扫描），`/favorites` 已无 `h-6/h-7` 裸尺寸。没有找到确证的缺口，不做「为改而改」。 |
| 插件星标导入批量 | 未执行 | 导入条数为几十级，N 次查询不构成量级问题；且现有实现用 `err.message.includes()` 判分支，改造需先做结构化错误，属技术债而非缺陷。 |
| 小写化字段预计算 | 未执行 | 能把 `/admin/sitelist` 筛选再压一半，但需在 `sites` 多处 `setSites` 分支维护派生缓存，属独立改造（见 §5 E9）。 |
| PG 批量用例的本地执行 | 未执行 | 无 `NAVHUB_TEST_DATABASE_URL`，docker 不可用。用例已写，由 CI test-postgres 执行——**这是本轮唯一未在本地跑过的改动面**。 |

---

## 7. 回滚

改动分两批。

**第一批（E1–E5，已提交 `f08cdd1`）**

```
packages/store/src/repository/sites.ts        # findExistingSiteUrls / insertSitesBulk
packages/store/src/repository/embeddings.ts   # saveEmbeddingsBatch
packages/store/src/repository.ts              # 两个绑定
apps/api/src/routes/sites.ts                  # batch 去重 + 索引批量
apps/api/src/routes/backup.ts                 # restore 走批量
apps/api/src/index-site.ts                    # 复用 saveEmbeddingsBatch
scripts/check-isr-routes.test.ts              # fixture 幂等化
```

**第二批（E6–E10，本次提交）**

```
apps/api/src/routes/backup.ts                 # 审计 / 错误分类 / 入队 reindex
apps/api/src/jobs.ts                          # 巡检三项
packages/store/test/pg-dialect.e2e.test.ts    # PG 批量用例
apps/web-overlay/src/lib/admin/sitelist-index.ts        # 新增（事实源）
apps/web-overlay/src/app/admin/sitelist/page.tsx        # 改用索引 + useMemo
apps/web-overlay/test/sitelist-index.test.ts            # 新增
apps/api/test/backup-observability.test.ts              # 新增
apps/api/test/user-data-audit-job.test.ts               # 新增
```

回滚方式：`git revert <commit>`。无 schema 变更、无 API 契约破坏（409 只**新增** `reason` 字段；审计 `diff` 只新增键）。旧调用路径（`findSiteByUrl` / `saveEmbedding` / `createSite`）未被修改，仍可用。

`apps/web` 下的镜像副本不计入 git（vendored，`.gitignore` 排除），回滚后由 `vendor-web.mjs` + overlay 回放重建。
