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
| `check-syntax` | 1025 文件 / 0 错误 |
| `typecheck`（5 包，TS 7.0.2） | 通过 |
| `check:bundle` | 69 条路由全部在预算内（首页 1041/1115 KB 最紧） |
| 全量 vitest | 见 §4 |
| `check-web-overlay` | 1 个漂移，**判定为并行会话未同步**，未代为 `--fix` |

---

## 4. 全量测试

```
 Test Files  343 passed | 1 skipped (344)
      Tests  3782 passed | 24 skipped (3806)
   Duration  323.80s
```

| 时点 | 结果 |
|---|---|
| 改动前基线 | `1 failed | 339 passed`（文件），`52 failed | 3718 passed`（用例） |
| 改动后 | `343 passed | 1 skipped`（文件），`3782 passed`（用例），**0 失败** |

1 个 skipped 文件是 `pg-dialect.e2e.test.ts`（未设 `NAVHUB_TEST_DATABASE_URL`，CI 的 test-postgres 作业会跑）。

用例净增 64 条：12 条新增回归（3 个新文件）+ 52 条从失败转为通过。

---

## 5. 未执行项与原因

| 项 | 状态 | 原因 |
|---|---|---|
| 用户中心视觉/布局改动 | 未动 | 并行会话正在编辑 7 个文件（mtime 15:57–15:59，内容为 sticky 子导航、玻璃卡片、图标芯片）。按纪律不覆盖。 |
| `check-web-overlay` 漂移修复 | 未动 | 漂移来自上述并行会话的半成品改动；代为 `--fix` 会把半成品镜像进 vendored 目录。 |
| 巨型组件拆分（`algorithm-lab` 2216 行、`sitelist` 2147 行） | 未执行 | 属结构性重构，需独立批次 + 行为对照测试；与本轮「可验证缺陷」目标不同档。 |
| 前端触控目标 / a11y 补强 | 未执行 | 复核发现 guard 体系已相当完整（`keyboard-activation` / `graph-keyboard` / `a11y-contrast` 三道扫描），`/favorites` 已无 `h-6/h-7` 裸尺寸。没有找到确证的缺口，不做「为改而改」。 |
| 插件星标导入批量 | 未执行 | 导入条数为几十级，N 次查询不构成量级问题；且现有实现用 `err.message.includes()` 判分支，改造需先做结构化错误，属技术债而非缺陷。 |

---

## 6. 回滚

全部改动集中在 5 个文件 + 3 个测试文件，无 schema 变更、无 API 契约变更：

```
packages/store/src/repository/sites.ts        # findExistingSiteUrls / insertSitesBulk
packages/store/src/repository/embeddings.ts   # saveEmbeddingsBatch
packages/store/src/repository.ts              # 两个绑定
apps/api/src/routes/sites.ts                  # batch 去重 + 索引批量
apps/api/src/routes/backup.ts                 # restore 走批量
apps/api/src/index-site.ts                    # 复用 saveEmbeddingsBatch
scripts/check-isr-routes.test.ts              # fixture 幂等化
```

回滚方式：`git revert <commit>`。新增函数均为纯增量，旧调用路径（`findSiteByUrl` / `saveEmbedding` / `createSite`）未被修改，仍可用。
