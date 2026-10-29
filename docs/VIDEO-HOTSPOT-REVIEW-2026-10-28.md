# 视频管理 与 智能热点采集中心 —— 深度评审与增强方案

| 项目 | 内容 |
| :--- | :--- |
| 评审对象 | 后端「视频管理」与「智能热点采集中心」两个功能模块 |
| 评审日期 | 2026-10-28 |
| 代码基线 | `apps/web`（Next.js BFF）+ `apps/api`（Fastify 中枢）+ `packages/store`（关系表） |
| 评审方法 | 静态代码审查 · 数据一致性校验 · 单测/类型检查执行 · 运行时数据抽样 · 容量测算 |
| 结论 | **不建议在当前形态下继续叠加功能**；存在 3 项阻断级缺陷（P0）与 7 项结构性风险（P1），需先止血再演进 |

---

## 一、执行摘要

### 1.1 一句话结论

两个模块的**工程细节质量高于同类项目平均水平**（fail-closed 鉴权、三态探活、乐观并发重放、21 个测试文件均有真实断言），但**领域模型选型已经触顶**：视频库是一个 6.37 MB 的单体 JSON 文档，而所有采集、轮换、巡检逻辑都建立在「整包读 → 内存改 → 整包写」之上。由此派生出容量悬崖、并发覆盖、报表失真三类系统性问题，其中「轮换引擎看不到 5,578 条真实条目」直接使核心卖点（智能淘汰轮换）在真实数据上不生效。

### 1.2 六维评分

| 维度 | 得分 | 判断依据 |
| :--- | :---: | :--- |
| 架构设计 | **6.0 / 10** | 分层意图清晰（BFF / 中枢 / 关系表），但视频域逻辑落在 Next 路由层，未下沉到中枢；影子表建好却未切读，形成「双写双读半成品」 |
| 代码质量 | **7.5 / 10** | 注释密度与「为什么这么改」的记录罕见地完整；21 个视频测试文件、73 模块 0 类型错误。扣分项：命名夸大（规则引擎称 AI）、合成内容冒充真实元数据、路由层重复代码 |
| 性能 | **4.0 / 10** | 单次读解析 42 ms / 序列化 61 ms；单次写全表 DELETE+INSERT 5,578 行；公开列表接口默认返回全量且无缓存头 |
| 安全性 | **6.5 / 10** | Webhook HMAC + fail-closed、Cron fail-closed、时序安全比较均已到位；但公开读端点无字段过滤、`custom` 平台 iframe 源无域白名单、全链路无速率限制与入参 schema |
| 可扩展性 | **4.5 / 10** | 4 MB 请求体硬顶（当前文档 6.37 MB）、`db` 模式 500 行读取上限（当前 5,578 条）→ 关系表路径永久回落；采集源硬编码 B 站 |
| 可靠性 | **5.5 / 10** | 有租约锁、有乐观并发、有冲突重放；但锁与队列是进程内单例、无幂等键、指标重启归零、影子表同步失败状态无出口 |
| **加权综合** | **5.7 / 10** | — |

### 1.3 阻断级问题（P0）

| ID | 问题 | 直接后果 |
| :--- | :--- | :--- |
| **F-01** | 轮换引擎只遍历 `category.items`，而库中 **5,578 条视频全部位于 `subCategories[].items`，顶层 `items` 恒为 0** | 容量上限永不触发、过时淘汰永不执行、报表 `currentCount=0 / averageFreshness=100` 恒真 |
| **F-02** | 中枢 `bodyLimit = 4 MB`，而 `videos.json` 实测 **6.37 MB** | 任何基于基线数据回写的操作（后台保存 / 采集 / Webhook）返回 413，且错误信息不指向真实原因 |
| **C-01** | `PUT/DELETE /api/videos/[id]/items` 直接调用 `commitFile`，**绕过统一的 `mutateVideoLibrary`** | 与采集/后台保存并发时 last-write-wins，静默丢条目（该模块设计文档明确禁止的写法） |

### 1.4 修复后预期收益（测算）

| 指标 | 现状 | 目标 | 测算依据 |
| :--- | :--- | :--- | :--- |
| 列表接口响应体 | 6.37 MB | < 200 KB | 分页 20 条 × 单条约 1.1 KB + 分类元数据 |
| 单次保存 P95 | 1.5–6 s（PG 全表重写） | < 150 ms（增量 upsert） | 5,578 次顺序 INSERT，按 0.2–1 ms/往返估算 |
| 容量上限 | ≈3,500 条（4 MB 折算） | ≥100,000 条 | 关系表 + 分页读取 |
| 并发覆盖窗口 | 最长 60 s（Data Cache） | 0 | 版本校验 + 缓存标签失效 |
| 采集失败可归因率 | 未知（静默空转） | 100% | 每源每阶段结构化日志 + 指标落库 |

### 1.5 与既有评审的关系（本次增量）

本仓在同日已产出两份文档：

- `docs/VIDEO-HOTSPOT-BACKEND-AUDIT-2026-10-28.md`（25 项，P0-1 ~ P1-26）
- `docs/VIDEO-HOTSPOT-REMEDIATION-2026-10-28.md`（整改记录）

本文档**不重复已关闭项**，而是在整改后的代码与**新的数据规模**（6.37 MB / 5,578 条）上重新基线化。复核结论如下：

| 既有项 | 当前状态 | 复核证据 |
| :--- | :--- | :--- |
| P0-1 自主采集无鉴权 | ✅ 已关闭 | `ai-autonomous-harvest/route.ts` GET/POST 均调 `verifyAdminSession` |
| P0-2 Webhook 伪签名 | ✅ 已关闭 | `verifyHmacSha256` + 无密钥即 503 + 签名缺失即拒 |
| P0-3 Cron fail-open | ✅ 已关闭 | `requireCronSecret`，未配置即 503 |
| P0-6 巡检写错文件 | ✅ 已关闭 | 路径统一为 `src/navsphere/content/videos.json` |
| P0-7 单次探测即删 | ✅ 已关闭 | `PRUNE_AFTER_CONSECUTIVE_FAILURES = 2` + `failStreak` |
| P0-8 单条增删清空历史 | ✅ 已关闭 | 历史迁至 `video-replacements.json` |
| P1-9 租约锁 owner 不匹配 | ✅ 已关闭 | `lockOwner` 统一 acquire/release + `renewLock` |
| P1-12 读-改-写无并发控制 | ⚠️ **部分关闭** | 3 条路径接入 `mutateVideoLibrary`；`[id]/items` 与巡检仍绕过（见 C-01/C-02） |
| P1-10 内存单例锁 | ❌ 仍存在 | 见 R-01 |
| P1-14 类型门禁关闭 | ⚠️ 缓解未根治 | `ignoreBuildErrors: true` 仍在；靠 `typecheck:video` 单独守 73 模块 |
| P2-19 关键词串行 | ✅ 已关闭 | 并发 3 + 25 s 预算 |
| P2-20 串行探测 | ✅ 已关闭 | 并发 6，上限 10 |

**本次新增（既有审计未覆盖）的 7 项**：

| 新增 ID | 问题 | 为何此前未发现 |
| :--- | :--- | :--- |
| F-01 | 轮换只读顶层 `items`，5,578 条在子分类 | 既有审计写于库仅 16 条、无子分类数据的时期 |
| F-02 | 4 MB bodyLimit vs 6.37 MB 文档 | 同上，当时文档仅 44 KB |
| F-05 | 候选池 6/18 条时长数量级错误 | 此前只核「是否伪造发布时间」，未做章节-时长一致性校验 |
| C-01 | `[id]/items` 绕过统一写入器 | P1-12 整改时按「harvest / webhook / 整包」三条路径收口，遗漏该路由 |
| C-02 | 巡检写回绕过统一写入器 | 同上 |
| C-03 | Data Cache 60 s 无标签失效 | 既有审计只提到「Data Cache 存在」，未追写后失效链路 |
| X-01 | `db` 模式 500 行上限导致永久回落 | 当时条目数远低于 500，触发不到 |

---

## 二、评审范围与方法

### 2.1 模块边界

本仓的「后端」由两层构成，视频域的实现位置与直觉不同，需先明确：

| 层 | 位置 | 承担职责 | 规模 |
| :--- | :--- | :--- | :--- |
| **BFF / 领域层** | `apps/web/src/app/api/videos/**`（9 个路由） | 鉴权、采集编排、写库、巡检触发 | 1,244 行 |
| **BFF / 领域层** | `apps/web/src/lib/video-*.ts`（核心 13 个） | 采集、评分、轮换、队列、去重、分页 | 3,132 行 |
| **存储层** | `apps/api/src/storage.ts`、`video-catalog.ts` | KV 文档读写、影子表同步、一致性校验 | 1,425 行 |
| **关系层** | `packages/store/src/repository/videos.ts` | 关系表 CRUD 与全量替换 | 484 行 |
| **数据** | `apps/web/src/navsphere/content/videos.json` | 事实源（单文档） | **6.37 MB / 5,578 条** |

> 结论：所谓「视频管理后端」实际上是 **Next.js Route Handler 承载的领域服务**，Fastify 中枢只提供 `GET/PUT /api/storage?path=videos.json` 这一条通用文档通道。这决定了它无法复用中枢已有的任务队列、审计、指标与事务能力。

### 2.2 数据流

```
                        ┌──────────────────────────────────────────┐
   手动/后台  ─────────▶ │ POST /api/videos/harvest                 │──┐
   Cron      ─────────▶ │ GET  /api/cron/video-harvest             │  │
   Webhook   ─────────▶ │ POST /api/videos/webhook-harvest (HMAC)  │  │
   任务队列  ─────────▶ │ POST /api/videos/harvest/task            │  │
   自主采集  ─────────▶ │ POST /api/videos/ai-autonomous-harvest   │  │
   巡检      ─────────▶ │ GET  /api/cron/video-health-sweep        │  │
                        └──────────────────────────────────────────┘  │
                                                                       ▼
                        ┌──────────────────────────────────────────────────┐
                        │ video-harvester / autonomous / multi-source      │
                        │  · B 站 wbi 搜索（真实）                          │
                        │  · video-topics.json 静态候选池（构建期内联）      │
                        │  · 规则评分 evaluateVideoWithAIModel              │
                        └──────────────────────────────────────────────────┘
                                              │ 整包 JSON
                                              ▼
                        ┌──────────────────────────────────────────────────┐
                        │ PUT /api/storage?path=videos.json  (bodyLimit 4MB)│
                        │   → writeKv(jobs.payload)                         │
                        │   → syncVideoCatalogSafely()  全表 DELETE+INSERT   │
                        │   → syncReplacementHistory()  全表 DELETE+INSERT   │
                        └──────────────────────────────────────────────────┘
```

### 2.3 本次执行的验证

| 验证项 | 命令 | 结果 |
| :--- | :--- | :--- |
| 视频模块单测 | `npx vitest run video-api-guards / video-harvester / video-scoring-guard / video-health-tristate` | **45 passed / 4 files**，2.43 s |
| 视频域类型检查 | `node scripts/typecheck-video-scope.mjs` | **73 模块 0 错误**（已排除 next/* 环境性报错） |
| 数据结构校验 | 脚本统计 `videos.json` | 12 分类 / 顶层条目 **0** / 子分类条目 **5,578** |
| 序列化开销 | `JSON.parse` / `JSON.stringify` 基准 | 42.0 ms / 61.0 ms（indent=2）/ 41.2 ms（compact） |
| 候选池质量 | 逐条比对 `durationSec` 与 `chapters` 时长和 | **6 / 18 条数量级错误**（如 314,062 s ≈ 87 小时） |

---

## 三、架构现状评估

### 3.1 值得保留的设计（先说好的）

客观地讲，这套代码在以下六点上明显优于同类业务的平均水平，重构时**不应推翻**：

1. **写入口收口意识**。`video-library-store.ts` 明确把「读-改-写 + 版本校验 + 冲突重放」抽成 `mutateVideoLibrary`，并在注释里记录了 last-write-wins 的真实事故。
2. **fail-closed 的鉴权默认值**。`cron-auth.ts` 与 `webhook-harvest` 都做到「未配置密钥 = 关闭」，而非「用默认密钥」。这是多数项目会踩的坑。
3. **三态探活**。`probeVideoAvailability` 区分 `healthy / dead / unverified`，只有平台明确回答「不存在」才进入删除候选，超时与限流不进分母。
4. **去重键的平台维度**。`videoExternalKey` 统一为 `platform:externalId`，修掉了「所有 Webhook 来源被判成同一条」的历史缺陷。
5. **诚实性修复的痕迹**。代码里多处主动删除了「伪造 stats / 伪造发布时间 / 伪造封面」，并写明原因，说明作者已经意识到数据可信度问题。
6. **测试形态合理**。`video-api-guards.test.ts` 采用「读源码断言错误写法不再出现」的守卫式测试，对这类一行改错就静默失效的修复是恰当选择。

### 3.2 结构性缺陷

#### 缺陷 A：领域逻辑错位（BFF 承载了本应属于中枢的能力）

视频的增删改查、采集编排、并发控制全部实现在 Next.js Route Handler 中，导致：

- 无法使用中枢的 `repo.withTransaction`、审计表、Prometheus 指标、任务表；
- 无法使用关系表的索引查询（`video_items_category_idx`、`video_items_external_idx` 建了但读路径不用）；
- 每个写操作都要经历「BFF → HTTP → 中枢 → SQLite/PG」两次序列化 + 一次 6 MB 传输。

#### 缺陷 B：单文档模型与业务规模不匹配

| 指标 | 当前值 | 该模型的合理上限 |
| :--- | :--- | :--- |
| 文档体积 | 6.37 MB | ≤ 1 MB（超过后每次读写都是全量开销） |
| 条目数 | 5,578 | ≤ 500（与 `db` 模式读取上限一致） |
| 单次写放大 | 全量 5,578 行 | 应仅写变更行 |

模型与规模已经错位一个数量级，这是所有性能与并发问题的根因。

#### 缺陷 C：影子表「建而不用」，且切换条件永远不满足

`video-catalog.ts` 设计了 `json / dual / db` 三态灰度，思路正确。但 `loadVideoCatalogFromDb` 有硬编码的 500 行读取上限，并在条目数超过上限时主动回落 KV：

```ts
// apps/api/src/video-catalog.ts:510,518
listVideoItems(ctx.repo, { limit: 500 }),
...
if (items.length < itemCount) {
  console.warn(`[video-catalog] 关系表条目数 ${itemCount} 超过单次读取上限，已回落文档读取以避免截断`);
  return null;
}
```

当前 5,578 > 500，因此 **`NAVHUB_VIDEO_STORE=db` 永远走 KV 读**，同时 `dual/db` 模式仍然承担全表双写的成本。结果是「付了双写的钱，没拿到读路径的收益」。

---

## 四、分维度问题清单

> 严重度定义：**P0** = 功能失效或数据丢失；**P1** = 显著影响性能/可靠性/安全，需排期；**P2** = 质量与演进性问题。

### 4.1 功能正确性

#### F-01 · P0 · 轮换引擎的视野缺失（最严重）

**证据**

```ts
// apps/web/src/lib/video-harvester.ts:540
const currentItems = cat.items || []
...
// :608
if (currentItems.length < maxItems) {
```

而实测数据分布：

```
cat_ai_engineering          items=   0  subs=3  subItems= 500
cat_fullstack_architecture  items=   0  subs=3  subItems= 499
...（12 个分类，顶层 items 全为 0，子分类合计 5,578）
```

**影响链**

1. `currentItems.length < maxItems` 恒为 `true` → **容量上限（400–520）永不生效**，每轮采集无条件追加到顶层 `items`；
2. 淘汰分支（`autoReplaceOutdated`）只在容量已满时进入 → **永不执行**，`totalReplacedCount` 恒为 0；
3. 保鲜分刷新只覆盖顶层条目 → 5,578 条真实内容的 `freshnessScore` 从不更新，衰减模型形同虚设；
4. 报表 `currentCount=0`、`averageFreshness=100`，管理端看到的「健康度 100 分」是假象；
5. 采集结果被写入顶层 `items`，与既有「分类 → 子分类」的信息架构不一致，前端子分类视图看不到新采集内容。

**根因**：数据模型演进（引入 `subCategories`）后，轮换引擎仍按旧模型（扁平 `items`）编写，且无测试覆盖「子分类场景」。

#### F-02 · P0 · 4 MB 请求体硬顶 vs 6.37 MB 文档

```ts
// apps/api/src/server.ts:138
bodyLimit: 4 * 1024 * 1024,
```

- 文档 6,369,615 字节 = 4 MB 上限的 **1.52 倍**；
- 适配器发送的 body 是 `{ path, content: "<6.37MB 字符串>", message, ifVersion }`，还需 JSON 转义，实际更大；
- 触发路径：全新部署时 KV 中无 `kv:videos` → `getFileContent` 回落构建期基线（6.37 MB）→ 管理员任意保存 → **413**；
- Fastify 返回的是 `FST_ERR_CTP_BODY_TOO_LARGE`，前端只看到「保存失败」，无任何容量提示。

#### F-03 · P0 · Webhook 入库固定 `freshnessScore: 100`

```ts
// apps/web/src/lib/video-multi-source-connector.ts:267
freshnessScore: 100,
```

同文件第 263–264 行已经正确做到「发布时间未知就不写 `publishedAt`」，却在下一行把保鲜分写死为 100。后果与历史缺陷完全一致：老内容永远「满分新鲜」，`worstScore < 45` 永不成立，淘汰逻辑（即使 F-01 修复后）也不会触发。

#### F-04 · P1 · YouTube 平台静默空转

```ts
// apps/web/src/lib/video-harvester.ts:249
if (!platforms.includes('bilibili')) return
```

- `VideoHarvestPolicy.platforms` 类型允许 `['bilibili','youtube']`，UI 默认勾选两者；
- 实现中**没有任何 YouTube 分支**，`platforms` 仅用于「是否执行 B 站」；
- 用户只勾 YouTube 时，函数直接 `return`，既不采集也不写 `failures`，报告显示「+0，无异常」——与「确实没有好内容」无法区分。

#### F-05 · P1 · 候选池时长数据错误（6/18）

`video-topics.json` 中 `durationSec` 与 `chapters` 时长和不一致，且差距达 1–2 个数量级：

| 条目 | `durationSec` | 章节时长和 | 折算 |
| :--- | ---: | ---: | :--- |
| 李宏毅机器学习 | 314,062 | 16,100 | **87.2 小时** |
| JavaScript 前端全套 | 188,921 | 15,800 | 52.5 小时 |
| 黑马 C++ 教程 | 188,972 | 22,200 | 52.5 小时 |
| 黑马 SpringBoot3 + Vue3 | 87,120 | 16,200 | 24.2 小时 |
| 吴恩达机器学习 | 69,864 | 10,200 | 19.4 小时 |
| RabbitMQ 高可用 | 41,829 | 12,200 | 11.6 小时 |

**影响**：`calculateQualityScore` 的时长区间（>7,200 s 得 12 分）与前端时长展示均被污染；`chapters` 的 `startTime` 最大仅 16,100 s，播放器章节跳转与总时长矛盾。

#### F-06 · P1 · 多源连接器伪造统计数据

```ts
// video-multi-source-connector.ts:143
stats: { views: 50000, likes: 3500 },        // YouTube RSS：RSS 无播放量字段
// :160-163
stats: { views: r.stars * 10, likes: r.stars }, // GitHub：把 star 数当播放量
// :109
likes: item.favorites || item.stat?.like || 0,  // 字段错位：likes 取自 favorites
```

这些伪造值会进入 `evaluateVideoWithAIModel` 的「投币点赞比 / 收藏播放比」两个评分维度，使评分变成常量的函数。与本仓其它位置「没有真实来源就留空」的原则自相矛盾。

#### F-07 · P0（随 F-01）· 管理端统计口径失真

```ts
// apps/web/src/app/api/videos/harvest/route.ts:30-31
const items = cat.items || []
totalVideos += items.length
```

`GET /api/videos/harvest` 是管理端仪表盘的数据源，`totalVideos`、`averageFreshness`、`outdatedCount` 全部只统计顶层 `items`。真实库 5,578 条时仪表盘显示 **0 条视频、平均新鲜度 100、过时 0 条**。

---

### 4.2 并发与一致性

#### C-01 · P0 · 条目路由绕过统一写入器

`apps/web/src/app/api/videos/[id]/items/route.ts` 的 POST / PUT / DELETE 三处：

```ts
// :58, :106, :154
await commitFile(VIDEOS_FILE_PATH, JSON.stringify({ ...data, navigationItems: updatedItems }, null, 2),
  'Add video item', authCheck.githubToken || undefined)
```

- 未传 `ifVersion`；
- 读取用 `getFileContent`（含 2.5 s 进程内缓存 + 60 s Data Cache）；
- 与采集、后台整包保存并发时，后写者覆盖前写者，双方均收到 200。

这是模块自身文档（`video-library-store.ts` 文件头）明确列为「必须收口」的四条写入路径之一，实际只收口了三条。既有整改（P1-12）按「整包 / webhook / 自主采集」三条路径接入 `mutateVideoLibrary`，遗漏了条目级路由与巡检路由。

#### C-02 · P0 · 巡检路由同样绕过

```ts
// apps/web/src/app/api/cron/video-health-sweep/route.ts:56
await commitFile(VIDEOS_FILE_PATH, JSON.stringify(updatedData, null, 2), ...)
```

巡检会把全库的 `healthStatus` / `lastVerifiedAt` / `failStreak` 写回。若此时采集正在写库，巡检的整包覆盖会抹掉本轮新增条目——而巡检是定时任务，与采集撞车的概率不低。

#### C-03 · P1 · 写后读旧：Data Cache 无标签失效

```ts
// apps/web/src/lib/storage-adapter.ts:202
...(isRead && revalidateS > 0 ? { next: { revalidate: revalidateS } } : { cache: "no-store" })
```

- 读请求进 Next Data Cache 60 s，但 `commitFile` 写成功后只调用 `invalidateContentCache(path)`（清进程内 Map），**不清 Data Cache**；
- 全仓仅 `/api/hub/[...path]` 调用了 `revalidateTag`，视频链路未接入；
- 后果：写入成功后 60 s 内的读取仍返回旧数据 → 管理端「保存后刷新还是旧值」→ 用户再次保存 → 用旧值覆盖新值。

#### C-04 · P1 · 手动采集入口无锁

`POST /api/videos/harvest` 直接调用 `runVideoHarvestAndRotation`，**不获取** `videoTaskQueue` 的租约锁；而 `POST /api/videos/harvest/task` 会获取。两入口并存时：

- 手动 + Cron 并发 → 双方各自搜索、各自整包写 → 靠 `ifVersion` 冲突重放兜底；
- 重放的代价是**重新发起全部网络搜索**（每轮 25 s 预算），而非仅重试写入。

#### C-05 · P2 · 版本号本身经过缓存

`getStorageVersion` 走 `getAdapter().version()` → 同一个 `call()` → 同样带 `next: { revalidate: 60 }`。版本号可能滞后 60 s。虽然滞后会导致 409（fail-safe），但会让「本可成功的写入」无谓重试一次，放大采集成本。

---

### 4.3 性能瓶颈

| ID | 问题 | 量化 | 影响 |
| :--- | :--- | :--- | :--- |
| **P-01** | 整包读：每次 `GET /api/storage?path=videos.json` 解析 6.37 MB | `JSON.parse` **42 ms**（本机，冷） | 每次列表/详情/采集去重都要付一次 |
| **P-02** | 整包写：`JSON.stringify(data, null, 2)` 6.37 MB | **61 ms** + 6.37 MB 传输 | 采集每轮至少 1 次 |
| **P-03** | 影子表全量重写 | 5,578 行 DELETE + 5,578 次 INSERT | PG 下逐条 `await query`，按 0.2–1 ms/往返估算 **1.1–5.6 s** |
| **P-04** | 替换历史整包重写 | `appendReplacementHistory` 读全量 → 前插 → 写全量 | 记录累积后线性恶化；单条 6–10 KB |
| **P-05** | `/api/videos` 默认返回全量 | 6.37 MB 响应体，无 `Cache-Control` | 管理端首屏、每次 SWR 重验都拉全量 |
| **P-06** | 采集无全局预算 | 每分类 `totalBudgetMs=25 s`，12 分类最坏 **300 s** | 同步 POST 必然超时（Vercel 默认 10–60 s） |
| **P-07** | 巡检写回整包 | 30 条探测 + 6.37 MB 写 | 巡检本应只写 30 条字段 |

**补充观察**：`/api/videos?compact=1` 只剥离 `chapters` / `transcript`，而全库仅 **11 条**含这两字段，压缩收益 < 1%。真正的体积来自 5,578 条条目的基础字段，`compact` 参数无法解决。

---

### 4.4 安全性

#### S-01 · P1 · 公开读端点无字段过滤

`GET /api/videos` 与 `GET /api/videos/[id]` 均**无鉴权**，返回 `enabled: false` 的条目、`qualityScore`、`healthStatus`、`failStreak`、`stats` 等运营字段。若用于「先采集后审核」的草稿流，未上架内容会对外可见。

#### S-02 · P1 · `custom` 平台 iframe 源无域白名单

```tsx
// apps/web/src/components/video-player-page.tsx:813-816
<iframe src={sourceId} ... allow="accelerometer; autoplay; ..." />
```

`sourceId = videoConfig.videoId`，对 `custom` 类型完全来自 Webhook 载荷或后台输入。虽已通过 HMAC 保护写入，但一旦密钥泄露或内部误操作，可在站内嵌入任意外部页面（钓鱼 / 点击劫持 / 权限滥用）。`bilibili` 与 `youtube` 分支是拼接固定域名，安全。

#### S-03 · P2 · 全链路无速率限制

采集、解析、Webhook 三个端点均无限流。Webhook 有 HMAC，但攻击者可无限次提交**无效签名**请求，每次触发一次 HMAC 计算与 JSON 解析。

#### S-04 · P2 · 写接口无入参 schema

`POST /api/videos` 直接 `await request.json()` 后整包写入，无 zod 校验。畸形结构（`navigationItems: "x"`）会被原样落库，直到读路径 `Array.isArray` 兜底才暴露。

#### S-05 · 正向：已到位的安全措施

- Webhook：`HMAC-SHA256 over raw body` + 无密钥即 503 + 签名缺失即拒绝（不再有「不传签名就跳过校验」）；
- Cron：`requireCronSecret` + `timingSafeEqual`（先 sha256 等长化）+ 不接受 `?secret=`；
- 后台：`verifyAdminSession` 统一校验 + 生产环境未配 `NAVHUB_ADMIN_IDS` 时拒绝全部管理员请求；
- 探测：`probeVideoAvailability` 的 URL 由固定域名 + `encodeURIComponent` 拼接，无 SSRF 面。

---

### 4.5 可扩展性

| ID | 问题 | 说明 |
| :--- | :--- | :--- |
| **X-01** | `db` 模式 500 行读取上限 | 5,578 > 500 → 永久回落 KV，灰度开关形同虚设 |
| **X-02** | 单文档容量天花板 | 4 MB bodyLimit → 约 3,500 条即封顶 |
| **X-03** | 采集源硬编码 | 仅 B 站搜索；YouTube / RSS / 热榜均无实现，新增源需改 `harvestVideosForTopic` 主干 |
| **X-04** | 无查询能力 | 无法「按平台/健康状态/时间窗」查询，全部在内存过滤 |
| **X-05** | 候选池构建期内联 | `import topicsFile from '.../video-topics.json'`，更新选题需重新部署 |

---

### 4.6 可靠性

| ID | 问题 | 说明 |
| :--- | :--- | :--- |
| **R-01** | 队列与锁是进程内单例 | `VideoTaskQueueStore` 的 `tasks` / `currentLock` 在内存；多副本部署时锁无效，快照互相覆盖（注释已承认「不要误解为分布式队列」） |
| **R-02** | 无幂等键 | 重复 POST 会产生多个任务；Webhook 靠 `externalId` 去重（正确），但采集侧无 `Idempotency-Key` |
| **R-03** | 冲突重放放大成本 | `runVideoHarvestAndRotation` 冲突时整体重放，重新发起全部搜索（最坏 3 轮） |
| **R-04** | 指标易失且不完整 | `video-harvest-metrics` 为进程内累加，重启归零；`videoCatalogSyncState()` **导出后全仓无调用**，影子表连续失败次数无任何出口 |
| **R-05** | 无死信与退避策略 | 任务失败只置 `failed`，无重试队列、无告警 |
| **R-06** | 同步执行长任务 | `POST /api/videos/harvest` 同步跑完才返回，无超时保护 |

---

### 4.7 代码质量

| ID | 问题 | 具体 |
| :--- | :--- | :--- |
| **Q-01** | 命名与实质不符 | `evaluateVideoWithAIModel` 实为关键词表 + 加权规则，无任何模型调用；`generateAISanitizedMetadata` 同理 |
| **Q-02** | 合成内容冒充真实元数据 | 该函数生成固定 4 章节、4 条字幕、3 道测验（含硬编码代码片段与讲解文案），并以 `chapters` / `transcript` 字段入库，UI 呈现为「AI 提炼」。这是**数据可信度**问题，而非性能问题 |
| **Q-03** | 路由重复代码 | `POST` 与 `PUT /api/videos` 函数体完全相同（约 30 行 × 2）；`[id]/items` 三个方法各自重复「读 → 找 → map → commit」 |
| **Q-04** | 类型门禁被绕过 | `next.config.js:44` `typescript: { ignoreBuildErrors: true }`；好在 `typecheck:video` 单独守住 73 模块 |
| **Q-05** | 超长文件 | `video-harvester.ts` 771 行混合了「URL 解析 / 搜索 / 轮换 / 回滚」四种职责 |
| **Q-06** | `any` 残留 | `AutonomousHarvestLogEntry.details?: Record<string, any>`、`catch (err: any)` 多处 |

---

## 五、优先级矩阵

| ID | 问题 | 维度 | 影响 | 修复成本 | 优先级 |
| :--- | :--- | :--- | :--- | :--- | :---: |
| F-01 | 轮换视野缺失 | 功能 | 核心卖点失效，报表失真 | 低（约 150 行） | **P0** |
| F-02 | 4 MB 写入悬崖 | 功能/容量 | 保存直接 413 | 低（改配置 + 分片） | **P0** |
| C-01 | 条目路由绕过 OCC | 一致性 | 静默丢条目 | 低（约 60 行） | **P0** |
| C-02 | 巡检绕过 OCC | 一致性 | 静默丢条目 | 低（约 20 行） | **P0** |
| F-03 | Webhook 固定 freshness=100 | 功能 | 衰减模型失效 | 极低（1 行） | **P0** |
| F-07 | 报表口径 | 功能 | 运营决策依据错误 | 低（随 F-01） | **P0** |
| F-05 | 候选池时长错误 | 数据 | 评分与展示污染 | 极低（改 JSON） | **P0** |
| C-03 | Data Cache 无失效 | 一致性 | 写后读旧 → 二次覆盖 | 中 | P1 |
| C-04 | 手动采集无锁 | 一致性 | 并发重复采集 | 低 | P1 |
| C-05 | 版本号走缓存 | 一致性 | 无谓重试 | 低 | P2 |
| P-01~P-04 | 整包读写 + 全表重写 | 性能 | 写 1.5–6 s，读 42 ms | 高 | P1 |
| P-05 | 列表全量无缓存 | 性能 | 6.37 MB/次 | 中 | P1 |
| P-06 | 无全局预算 | 可靠性 | 请求超时 | 低 | P1 |
| F-04 | YouTube 空转 | 功能 | 静默无结果 | 中 | P1 |
| F-06 | 伪造统计 | 数据 | 评分失真 | 低 | P1 |
| X-01 | 500 行上限 | 扩展 | db 模式失效 | 低（约 30 行） | P1 |
| S-01 | 公开读无过滤 | 安全 | 草稿外泄 | 低 | P1 |
| S-02 | iframe 无白名单 | 安全 | 嵌入注入 | 低 | P1 |
| R-01/R-02 | 进程内队列/无幂等 | 可靠性 | 多副本失效 | 高 | P1 |
| R-04 | 指标易失/死代码 | 可观测 | 故障不可见 | 中 | P1 |
| Q-01/Q-02 | 合成内容 | 质量 | 信任风险 | 中 | P2 |
| X-03 | 采集源硬编码 | 扩展 | 无法扩源 | 高 | P2 |
| S-03/S-04 | 限流/schema | 安全 | 滥用面 | 中 | P2 |
| Q-03~Q-06 | 代码结构 | 质量 | 维护成本 | 中 | P2 |

---

## 六、增强方案

### 阶段一 · 止血（P0，建议 1 周内）

#### 措施 1：统一「分类条目视图」，让轮换引擎看见全部条目

**目标**：容量、淘汰、保鲜刷新、报表四处口径一致，且同时覆盖 `items` 与 `subCategories[].items`。

**改动**：新增 `apps/web/src/lib/video-category-items.ts`：

```ts
import type { NavigationItem, NavigationSubItem } from '@/types/navigation'

export interface CategoryItemRef {
  item: NavigationSubItem
  subCategoryId?: string
  subCategoryTitle?: string
  /** 原地替换：把新条目写回它原本所在的数组，保持信息架构不变 */
  replaceWith: (next: NavigationSubItem) => void
}

/** 把「分类 → 顶层条目 + 子分类条目」展开成一维引用列表（保持原数组身份） */
export function collectCategoryItems(cat: NavigationItem): CategoryItemRef[] {
  const refs: CategoryItemRef[] = []
  const top = cat.items ?? []
  top.forEach((item, i) => {
    refs.push({ item, replaceWith: (next) => { top[i] = next } })
  })
  for (const sub of cat.subCategories ?? []) {
    const arr = sub.items ?? []
    arr.forEach((item, i) => {
      refs.push({
        item,
        subCategoryId: sub.id,
        subCategoryTitle: sub.title,
        replaceWith: (next) => { arr[i] = next },
      })
    })
  }
  return refs
}
```

**接入点**（`video-harvester.ts`）：

| 行 | 现状 | 改为 |
| :--- | :--- | :--- |
| 540 | `const currentItems = cat.items \|\| []` | `const refs = collectCategoryItems(cat)` |
| 543–552 | 只刷新顶层 freshness | 遍历 `refs` 刷新 |
| 554 | `currentItems.length` | `refs.length` |
| 608 | `currentItems.length < maxItems` | `refs.length < maxItems` |
| 619–642 | 只从 `currentItems` 选淘汰对象 | 从 `refs` 选，替换用 `ref.replaceWith(candidate)` |
| 645–655 | 审计记录无子分类信息 | 补 `subCategoryId` / `subCategoryTitle` |

**新增不变量（必须写入测试）**：

1. 任意分类的条目总数 = `items.length + Σ subCategories[i].items.length`；
2. 轮换后该总数不变（除非是新增）；
3. `summary.currentCount` 等于上述总数。

**验收标准**：以当前 5,578 条基线跑 `dryRun`，报告 `currentCount` 之和 = 5,578；将 `maxItems` 调至 10 后，第二轮采集必须进入淘汰分支并产生 `replacements`。

---

#### 措施 2：解除 4 MB 容量悬崖

**目标**：写入不再因体积失败，且失败时有可读的错误。

**短期（当天可完成）**

1. 为 `/api/storage` 单独放开 bodyLimit（`apps/api/src/routes/navsphere.ts`）：

```ts
const VIDEO_BODY_LIMIT = Math.max(8, Number(process.env.NAVHUB_VIDEO_BODY_LIMIT_MB || 32)) * 1024 * 1024

app.put('/api/storage', {
  config: { scope: 'admin' },
  bodyLimit: VIDEO_BODY_LIMIT,   // 路由级覆盖，不影响其它端点
}, handler)
```

2. 增加业务守卫，把 413 变成可理解的 422：

```ts
if (Buffer.byteLength(body.data.content, 'utf8') > VIDEO_BODY_LIMIT * 0.9) {
  reply.code(422)
  return { error: 'video_library_too_large',
           detail: `视频库已达 ${size}MB，接近 ${limit}MB 上限；请启用分片存储或归档历史条目` }
}
```

**中期（随阶段二）**：按分类拆分文档（`videos/cat_ai_engineering.json`），单文档 ≤ 512 KB，写入只影响目标分类。

**验收标准**：以 6.37 MB 基线执行一次完整保存，返回 200；构造 40 MB 文档，返回 422 且 `error=video_library_too_large`。

---

#### 措施 3：收敛全部写入口到 `mutateVideoLibrary`

**目标**：消除最后两条绕过 OCC 的写路径。

**改动 A** — `apps/web/src/app/api/videos/[id]/items/route.ts`，三个方法统一改写：

```ts
const outcome = await mutateVideoLibrary<{ kind: 'not-found' | 'invalid' | 'ok' }>(
  (data) => {
    const cat = data.navigationItems.find(c => c.id === id)
    if (!cat) return { next: data, result: { kind: 'not-found' as const }, skip: true }
    const items = [...(cat.items ?? [])]
    if (!Number.isInteger(index) || index < 0 || index >= items.length) {
      return { next: data, result: { kind: 'invalid' as const }, skip: true }
    }
    items[index] = item
    return {
      next: { ...data, navigationItems: data.navigationItems.map(c => c.id === id ? { ...c, items } : c) },
      result: { kind: 'ok' as const },
    }
  },
  'Update video item',
  { token: authCheck.githubToken || undefined },
)
if (!outcome.ok) return NextResponse.json({ error: 'Conflict', retryable: true }, { status: 409 })
```

**改动 B** — `apps/web/src/app/api/cron/video-health-sweep/route.ts`：把「探测」与「写回」拆开，写回走 `mutateVideoLibrary`，在 mutate 内部只应用 `healthStatus` / `lastVerifiedAt` / `failStreak` 三个字段的增量，避免整包覆盖：

```ts
await mutateVideoLibrary((data) => {
  const byId = new Map(probes.map(p => [p.videoId, p]))
  // 只改三个字段，其余以最新读到的数据为准
  ...
}, 'chore(video): health sweep')
```

**验收标准**：新增并发测试——采集写入与条目写入同时发起，断言最终条目数 = 初始 + 采集新增 + 1，且无丢失。

---

#### 措施 4：修复 Webhook 保鲜分

```ts
// video-multi-source-connector.ts
freshnessScore: calculateFreshnessScore(
  payload.timestamp ? new Date(payload.timestamp).toISOString() : undefined,
  evalResult.aiQualityScore,
  90,
  title,
),
```

**验收标准**：构造 `timestamp` 为 3 年前的事件，断言 `freshnessScore < 45`。

---

#### 措施 5：修正候选池数据

1. 以 `Σ chapters[i].duration` 为准重算 `durationSec`（或反之修正章节）；
2. 在 `video-evolution-v8.test.ts` 的「候选质量」用例中补一条不变量：

```ts
const sum = topic.chapters.reduce((a, c) => a + c.duration, 0)
expect(Math.abs(topic.durationSec - sum)).toBeLessThanOrEqual(60) // 允许 1 分钟误差
```

3. 同一用例补 `durationSec <= 8 * 3600`（超过 8 小时的"教程"必然是脏数据）。

**验收标准**：`pnpm test` 中候选质量用例全绿，且 18 条全部满足时长一致性。

---

#### 措施 6：修复报表口径

`GET /api/videos/harvest` 改用 `collectCategoryItems(cat)` 统计。同时把 `runtime` 指标中新增 `lastSyncError` 与 `syncConsecutiveFailures`（来自中枢 `videoCatalogSyncState`），让影子表故障可见。

---

### 阶段二 · 结构（P1，建议 2–4 周）

#### 措施 7：视频域下沉到中枢（最关键的一步）

**目标**：让视频成为中枢的一等公民，复用事务、索引、审计、指标。

新增 `apps/api/src/routes/videos.ts`：

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/api/videos` | 分页（`categoryId` / `cursor` / `limit` / `healthStatus` / `platform`），走 `video_items_category_idx` |
| `GET` | `/api/videos/:id` | 单条详情（含 payload） |
| `POST` | `/api/videos` | 新增，`ON CONFLICT (platform, external_id)` 幂等 |
| `PATCH` | `/api/videos/:id` | 局部更新（只写变更列） |
| `DELETE` | `/api/videos/:id` | 软删除（`deleted_at`） |
| `GET` | `/api/videos/replacements` | 审计分页查询（`categoryId` / 时间窗） |
| `POST` | `/api/videos/:id/restore` | 回滚 |

**迁移路径（三阶段，可回滚）**：

1. **双写**：BFF 写 KV 的同时调 `POST /api/videos` 增量写表（仅变更行，非全量）；
2. **影子读校验**：读路径仍走 KV，但异步比对表，差异写指标；
3. **切读**：列表/详情走表，KV 降级为快照备份（保留 7 天）。

**关键收益**：写入从「全表 5,578 行」降到「单行 upsert」，P95 从 1.5–6 s 降到 <150 ms。

#### 措施 8：修复 `db` 模式读取上限

```ts
// video-catalog.ts
const MAX_REBUILD_ITEMS = Math.max(1000, Number(process.env.NAVHUB_VIDEO_REBUILD_MAX || 20000))
const items = await listVideoItems(ctx.repo, { limit: MAX_REBUILD_ITEMS })
if (items.length < itemCount) { /* 明确报错，不再静默回落 */ }
```

更彻底的做法：`loadVideoCatalogFromDb` 改为**按分类分页拼接**，单次读取上限只约束单分类（≤520 条），彻底消除全库上限。

**验收标准**：`NAVHUB_VIDEO_STORE=db` 且库中 5,578 条时，`GET /api/storage?path=videos.json` 返回完整数据，日志无回落告警。

#### 措施 9：缓存一致性

```ts
// storage-adapter.ts
const tag = `storage:${path}`
...(isRead && revalidateS > 0 ? { next: { revalidate: revalidateS, tags: [tag] } } : { cache: 'no-store' })

// github.ts commitFile 成功后
try {
  const { revalidateTag } = await import('next/cache')
  revalidateTag(`storage:${path}`, 'max')
} catch { /* 非 Next 环境（脚本/测试）忽略 */ }
```

**注意**：动态 `import('next/cache')` 在 vitest 下会失败，必须 try/catch（本仓 `storage-adapter` 已有同类处理先例）。

**验收标准**：写入后立即读取，返回新值（延迟 < 100 ms）。

#### 措施 10：采集编排重构

1. **全局预算**：`runVideoHarvestOnce` 增加 `deadline = now + (env.NAVHUB_VIDEO_HARVEST_BUDGET_MS ?? 45_000)`，每分类开始前检查，超时则记录 `skipped: budget_exhausted` 并退出循环（而非静默截断）；
2. **平台实现补齐或显式拒绝**：`platforms` 含 `youtube` 但无实现时，写入 `failures.push({ keyword: '(全局)', reason: 'YouTube 采集未实现' })`，让报告诚实；
3. **统一入口**：`POST /api/videos/harvest` 改为「入队 + 返回 taskId」，与 `/harvest/task` 合并；同步模式仅保留 `dryRun`（预览，限 1 个分类）；
4. **冲突重放只重放写**：把「搜索」结果缓存到本轮上下文，重放时复用候选集，只重做「读最新 → 合并 → 写」。

#### 措施 11：可观测性补齐

| 项 | 现状 | 目标 |
| :--- | :--- | :--- |
| 采集指标 | 进程内累加 | 落 `video_harvest_runs` 表（runId / trigger / ok / added / replaced / degraded / durationMs） |
| 影子表状态 | `videoCatalogSyncState()` 无调用 | 挂到 `/api/health` 与 `/api/videos/harvest` 的 `runtime` |
| 任务历史 | 内存 + 20 条快照 | 表 + 保留 90 天 |
| 告警 | 无 | 连续失败 ≥3 次 / 采集 0 新增连续 3 轮 → Webhook 告警 |

#### 措施 12：公开读接口治理

1. 匿名请求过滤 `enabled === false`；
2. 默认分页（`limit` 上限 50），移除「不传参返回全量」的隐式行为（保留 `?all=1` 给管理员）；
3. 响应头：`Cache-Control: public, s-maxage=60, stale-while-revalidate=300`；
4. 引入 `zod` 校验写入体（复用 `apps/api` 的 schema 风格）。

#### 措施 13：iframe 域白名单

```ts
const EMBED_ALLOWLIST = new Set(['player.bilibili.com', 'www.youtube.com', 'www.youtube-nocookie.com'])
// custom 平台：仅 https + 白名单域可进 iframe；否则渲染为「外链卡片」
```

---

### 阶段三 · 演进（P2，建议 1–2 月）

#### 措施 14：内容可信度治理（优先级高于任何新功能）

当前 `generateAISanitizedMetadata` 会为**每条**入库内容生成固定的 4 章节、4 条字幕、3 道测验，其中代码片段与讲解文案是硬编码模板。这些字段会进入播放器章节树、字幕面板与测验组件，用户无法分辨真伪。

**建议**：

1. **立即**：给合成字段打标 `synthetic: true`，UI 显示「示例大纲（非视频原字幕）」；
2. **短期**：默认关闭合成，仅在「人工确认」或「拿到真实字幕源」时启用；
3. **中期**：接入真实字幕（B 站 `subtitle` 接口 / Whisper 转写），无源则留空；
4. **命名**：`evaluateVideoWithAIModel` → `evaluateVideoByRules`；若接入 LLM，用 `evaluateVideoWithLLM` 并保留规则版作为降级。

#### 措施 15：采集源插件化

```ts
export interface VideoSource {
  id: 'bilibili' | 'youtube' | 'rss' | 'hotlist'
  search(query: SourceQuery, ctx: SourceContext): Promise<RawCandidate[]>
  probe(id: string): Promise<ProbeResult>
  capabilities: { search: boolean; trending: boolean; stats: boolean }
}
```

注册表 + 能力声明，`harvestVideosForTopic` 只做「调度 + 去重 + 评分」，不再关心平台细节。新增源 = 新增一个文件。

#### 措施 16：真热点源接入

当前「热点」由三部分组成：关键词搜索（真实）、静态候选池（构建期内联）、Webhook（外部推送）。缺少**真正的热榜数据**。

建议按成本排序：

1. B 站 `x/web-interface/ranking/v2`（分区排行榜，公开接口，需 wbi）；
2. GitHub Trending 页面解析（已有 `parseGitHubTrendingFeed` 骨架，但输入是伪造的）；
3. RSS（少数派 / InfoQ / Hacker News）—— 用 `fast-xml-parser` 替换手写正则（现有 `parseYouTubeRssFeed` 的正则无法处理 CDATA 嵌套与属性顺序）。

#### 措施 17：分布式任务与幂等

- `standard` 模式：`pg-boss`（Postgres 原生，无需额外中间件）；
- `lite` 模式：SQLite 表 + 单进程轮询（保持零外部依赖）；
- 所有采集入口接受 `Idempotency-Key`，24 h 内重复键返回同一 `taskId`。

---

## 七、目标架构

```
┌──────────────────────────────────────────────────────────────────┐
│ 接入层                                                            │
│  Admin UI · Cron · Webhook · MCP · 公开列表                        │
└───────────────┬──────────────────────────────────────────────────┘
                │ 鉴权 / 限流 / zod schema / Idempotency-Key
                ▼
┌──────────────────────────────────────────────────────────────────┐
│ BFF（apps/web）—— 只做聚合与鉴权，不再持有领域逻辑                   │
└───────────────┬──────────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────┐
│ 视频域服务（apps/api/src/routes/videos.ts + services/video/*）      │
│  · CatalogService   分页查询 / 单条 CRUD / 软删除                   │
│  · HarvestService   预算调度 / 去重 / 评分 / 轮换                   │
│  · SourceRegistry   bilibili | youtube | rss | hotlist            │
│  · TaskRunner       pg-boss / sqlite 队列，幂等，重试，死信          │
└───────────────┬──────────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────┐
│ 存储（packages/store）                                             │
│  video_items（索引：category, health, platform+external 唯一）      │
│  video_categories · video_replacements · video_harvest_runs        │
│  KV 文档降级为「快照备份」，仅用于灾备与回滚                          │
└──────────────────────────────────────────────────────────────────┘
```

**关键契约变化**：

| 项 | 现状 | 目标 |
| :--- | :--- | :--- |
| 事实源 | KV 单文档 | `video_items` 表 |
| 写粒度 | 全库覆盖 | 单行 upsert |
| 读粒度 | 全库 | 分页 + 索引 |
| 并发控制 | `ifVersion`（文档级） | 行级 `updated_at` + 唯一索引 |
| 审计 | JSON 数组 + 表 | 表（可分页、可按时间窗查询） |

---

## 八、预期收益汇总

> 以下为基于当前基线的**估算**，非实测承诺；测算依据已列出。

| 维度 | 指标 | 现状 | 目标 | 依据 |
| :--- | :--- | :--- | :--- | :--- |
| 性能 | 列表响应体 | 6.37 MB | < 200 KB | 20 条 × 1.1 KB + 元数据 |
| 性能 | 列表 TTFB | 42 ms（解析）+ 传输 | < 15 ms（索引查询） | 索引命中，无需解析整包 |
| 性能 | 单次保存 P95 | 1.5–6 s | < 150 ms | 单行 upsert vs 5,578 次 INSERT |
| 性能 | 采集单轮耗时 | 最坏 300 s | ≤ 45 s（预算硬约束） | 全局 deadline |
| 容量 | 可承载条目 | ≈3,500（4 MB 折算） | ≥100,000 | 表存储 |
| 一致性 | 并发覆盖窗口 | ≤60 s | 0 | 行级 OCC + 缓存标签 |
| 可靠性 | 采集失败可归因率 | 未知 | 100% | 每源每阶段结构化日志 |
| 可靠性 | 任务可追溯 | 内存 20 条 | 90 天 | 表 + 保留策略 |
| 安全 | 草稿外泄面 | 存在 | 消除 | 匿名过滤 |
| 质量 | 合成内容占比 | 100% 新入库条目 | 0（默认关闭） | 打标 + 默认关闭 |
| 运维 | 影子表故障可见性 | 无 | 健康检查 + 告警 | 暴露 `videoCatalogSyncState` |

**成本估算**（1 人月 ≈ 20 工作日）：

| 阶段 | 工作量 | 关键交付 |
| :--- | :--- | :--- |
| 阶段一 P0 | 4–5 人日 | 6 项修复 + 回归测试 |
| 阶段二 P1 | 12–15 人日 | 域下沉 + 缓存 + 队列 + 观测 |
| 阶段三 P2 | 15–20 人日 | 可信度 + 插件化 + 真热点 |

---

## 九、风险与取舍

| 决策点 | 选项 A | 选项 B | 建议 |
| :--- | :--- | :--- | :--- |
| 容量问题 | 抬高 bodyLimit 到 32 MB（1 天） | 按分类分片 / 下沉关系表（2–3 周） | **先 A 止血，再 B 治本**；A 单独上线会让 6 MB 文档的每次写更慢，必须限定为过渡 |
| 事实源切换 | 一次性切到 `db` 模式 | 三阶段灰度（双写 → 校验 → 切读） | **必须灰度**；本仓 `NAVHUB_VIDEO_STORE` 已具备开关，成本低 |
| 合成内容 | 保留（体验完整） | 关闭（诚实） | **打标 + 默认关闭**；保留开关给演示场景 |
| 队列选型 | pg-boss | 自研表队列 | `standard` 用 pg-boss；`lite` 自研（保持零依赖） |
| 采集源 | 继续只做 B 站 | 插件化 + 多源 | 先修「静默空转」，插件化排入 P2 |

**主要风险**：

1. **迁移期双写不一致**：必须有对账任务（每日比对 KV 与表，差异告警），且保留 7 天回滚窗口；
2. **`revalidateTag` 在测试环境不可用**：动态 import + try/catch，且加单测断言「写入后读新值」；
3. **轮换逻辑修复后可能触发大量替换**：首次上线建议 `dryRun` 观察 1–2 轮，确认淘汰对象合理后再放开；
4. **`ignoreBuildErrors: true` 掩盖类型回归**：`typecheck:video` 已覆盖 73 模块，但新增的 `video-category-items.ts` 必须纳入该脚本的自动发现范围（按目录 glob，无需改配置）。

---

## 十、验收指标（SLO）

| 指标 | 目标 | 采集方式 |
| :--- | :--- | :--- |
| 视频库写入成功率 | ≥ 99.5% | `video_harvest_runs.ok` |
| 写入 P95 延迟 | < 300 ms | 路由埋点 |
| 列表接口 P95 | < 200 ms，响应体 < 200 KB | 网关指标 |
| 采集单轮耗时 | ≤ 45 s（P99 ≤ 60 s） | `durationMs` |
| 采集失败可归因率 | 100% | `degradedKeywords` 覆盖率 |
| 并发写入丢失事件 | 0 | 对账任务 |
| 影子表同步延迟 | < 5 s | `videoCatalogSyncState.lastSuccessAt` |
| 合成元数据占比 | 0（默认配置） | 入库字段扫描 |

---

## 十一、实施进展（2026-10-28 晚）

阶段一的 P0 项已落地并通过回归验证。逐项状态：

| ID | 问题 | 状态 | 落地方式 |
| :--- | :--- | :---: | :--- |
| F-01 | 轮换引擎视野缺失 | ✅ 已修复 | `video-harvester.ts` 增加 `allCategoryItems`（顶层 + 子分类），容量判断、保鲜刷新、淘汰替换、报表口径统一走该视图；替换写回原容器（`worst.container[worst.index]`） |
| F-07 | 报表口径失真 | ✅ 已修复 | `GET /api/videos/harvest` 统计 `subCategories[].items`，并输出 `subCategoriesCount` |
| C-01 | 条目路由绕过 OCC | ✅ 已修复 | `[id]/items` 的 POST/PUT/DELETE 全部改为 `mutateVideoLibrary`（带 `ifVersion` + 冲突重放） |
| C-02 | 巡检绕过 OCC | ✅ 已修复 | `video-health-sweep` 改为「探测 → 收集健康补丁 → `mutateVideoLibrary` 按 id 合并」；只回写 `healthStatus` / `lastVerifiedAt` / `failStreak` 三个字段，不再整包覆盖 |
| F-03 | Webhook 固定保鲜分 | ✅ 已修复 | 两处 `freshnessScore: 100` 改为 `calculateFreshnessScore(publishedAt, qualityScore, 90, title)` |
| F-05 | 候选池时长错误 | ✅ 已修复 | 6 条 `durationSec` 按章节时长之和重算（如 314,062 → 16,100）；新增 `video-topics-consistency.test.ts` 守住三条不变量 |
| F-02 | 4 MB 容量悬崖 | ✅ 已修复 | `/api/storage` 路由级 `bodyLimit` 放宽到 32 MB（`NAVHUB_STORAGE_BODY_LIMIT_MB` 可调），75% 处返回可读 422；超 8 MB 打警告 |
| C-04 | 手动采集无锁 | ✅ 已修复 | `POST /api/videos/harvest` 与异步任务共用 `videoTaskQueue` 租约锁（owner 配对释放、TTL 10 分钟），并发触发返回 409 `harvest_in_progress` |
| F-04 | YouTube 静默空转 | ✅ 已修复 | `harvestVideosForTopic` 在 `platforms` 含 youtube 时写入一条 `(全局)` degraded 原因，报告不再把「未实现」显示成「没有好内容」 |
| X-01 | `db` 模式 500 行上限 | ✅ 已修复 | `loadVideoCatalogFromDb` / `checkVideoCatalogConsistency` 改为按 500 一页翻到底（上限 `NAVHUB_VIDEO_REBUILD_MAX`，默认 5 万），超限或读失败回落 KV 并留日志 |
| C-03 | Data Cache 无标签失效 | ✅ 已修复 | 适配器 `read` 按路径打 `storage:<path>` 标签（与构造期静态标签合并去重），`commitFile` 写成功后动态 `revalidateTag(tag, 'max')`；顺带修 C-05：`version()` 改 `no-store`，避免拿旧版本号白撞 409 |

> 阶段一的 P0 与全部 P1 项至此关闭。

### 阶段二 · 第一刀：中枢只读端点（已完成）

目标：**先建读路径、不动事实源**，让列表页不必再把 5,578 条全读进内存。

| 端点 | 行为 |
| :--- | :--- |
| `GET /api/videos` | 分页（`limit` ≤ 200 / `offset`），支持 `categoryId` / `platform` / `healthStatus` 过滤；默认不返回 `videoConfig`，`compact=0` 才返回 |
| `GET /api/videos/:id` | 单条详情，始终带 `videoConfig`（播放页需要章节树/字幕） |
| 数据来源 | 仅当 `NAVHUB_VIDEO_STORE=db`（读路径已正式切换）才用关系表；`json` / `dual` 模式以 KV 为事实源，关系表只是影子副本 |
| 来源标注 | 响应体 `source` + 响应头 `X-Video-Source`（`db` / `kv`）；`?source=db` 可临时查看影子表（仅排查用） |

配套改动：

- `packages/store` 的 `listVideoItems` 增加 `platform` 过滤；`countVideoItems` 支持 `{categoryId, platform, healthStatus}`（旧的 `countVideoItems(repo, categoryId)` 写法保持兼容），保证 `total` 与筛选口径一致。
- 路由策略重新生成（275 条），`gen-hub-route-policy --check` 通过。
- 新增 `apps/api/test/videos-api.test.ts`（8 例）：KV 回落、分页、双条件筛选、compact 开关、详情 404、参数越界 400。

**实测（真实库 5,578 条）**

| 指标 | 旧路径（整包文档） | 新端点（20 条/页） | 变化 |
| :--- | ---: | ---: | :--- |
| 响应体 | 6.37 MB | 13.8 KB | **≈ 460×** |
| 单次读取 | 解析全量 + 全库序列化 | SQL 分页（命中 `video_items_category_idx`） | — |
| 来源 | KV 文档 | `source=db`，`total=5578` | 读路径已可切关系表 |

> 未做：写入端点（会立即产生第二个事实源，必须先完成双写对账）、BFF 切读（需配合前端分页改造）。

### 阶段二 · 第二刀：双写对账（已完成，并发现真实漂移）

`apps/api/src/video-catalog-main.ts` 升级为对账工具：

| 能力 | 说明 |
| :--- | :--- |
| 固定读原始 KV | 改用 `readKv(ctx, "videos")`，**不再用 `readVideosData`** —— 后者在 `db` 模式下返回的是由表重建的文档，拿它和表对账等于表跟自己比，永远「一致」 |
| `--json` | stdout 只输出一段 JSON（`ok` / `mode` / `doc` / `db` / `missingInDb` / `extraInDb` / `mismatched`），日志走 stderr，可直接 `jq` |
| `--sample N` | 控制差异样例条数（默认 10） |
| 退出码 | `0` 一致 / `1` 不一致 / `2` KV 无数据 |
| npm 入口 | `pnpm video:catalog:reconcile` |

**首次运行即发现真实漂移**：

```
ok: false | mode: json
doc: { categories: 12, items: 74 }     ← 线上事实源（KV）
db:  { categories: 12, items: 5578 }   ← 影子表（由构建期基线灌入）
missingInDb: 70 | extraInDb: 5574 | mismatched: 0
```

这条证据直接改变了第一刀的设计：若按最初的「表里有数据就用表」，`/api/videos`
会返回 **5,504 条站点上根本不存在的幻影视频**。因此端点改为**按模式选源**：

| `NAVHUB_VIDEO_STORE` | `/api/videos` 事实源 | 说明 |
| :--- | :--- | :--- |
| `json`（默认） | KV 文档 | 表是影子副本，可能已分叉 |
| `dual` | KV 文档 | 同 json（双写但读 KV） |
| `db` | 关系表 | 切读后才以表为准，空表回落 KV |

**切读前置条件**：`pnpm video:catalog:reconcile` 连续返回 `ok: true`（退出码 0）。
当前返回 1，说明**尚不可切读** —— 需先执行一次导入把表对齐到 KV。

### 阶段二 · 第三刀：内容可信度治理（已完成）

`generateAISanitizedMetadata()` 不调用任何模型，按模板产出 4 章节 / 4 字幕 / 3 测验，
却以 `chapters` / `transcript` 身份入库并呈现为「AI 提炼」。本轮改为：

| 项 | 改动 |
| :--- | :--- |
| 默认行为 | **不写**合成章节/字幕/测验，`description` 不再用模板文案填充 |
| 开关 | `NAVHUB_VIDEO_SYNTHETIC_METADATA=1` 才生成（`video-metadata-policy.ts`，纯函数、可单测） |
| 打标 | 开启时写 `videoConfig.synthetic: true`，类型已补字段，供 UI 标注「示例大纲（非视频原字幕）」 |
| 接线 | 自主采集与 Webhook 两个入口都按开关分支，并有源码守卫防回退 |

> 保留生成函数而非删除：它仍是演示与离线兜底的有效能力，问题不在「有没有」，而在「冒充成真实内容」。

**验证结果**

| 项目 | 结果 |
| :--- | :--- |
| 视频域单测 | **290 passed / 26 files**（含接口 10 例、合成元数据策略 5 例、采集锁与平台诚实性守卫） |
| 存储适配器单测 | **21 passed**（新增路径标签、version no-store 两例） |
| 视频仓储测试 | `packages/store/test/video-catalog.test.ts` **15 passed** |
| 对账 CLI | `--check --json` 输出可解析、退出码 1（正确检出漂移） |
| 视频域类型检查 | **75 模块 0 错误** |
| 前端全量类型检查 | `tsc --noEmit -p apps/web` **退出码 0** |
| 中枢 API 类型检查 | `tsc --noEmit -p apps/api` **退出码 0** |
| 存储包类型检查 | `tsc --noEmit -p packages/store` **退出码 0** |
| 路由策略一致性 | `gen-hub-route-policy --check` **OK（275 条）** |
| 镜像一致性 | `check-web-overlay`：**914 个文件一致** |
| 运行验证 | `/` 200 · `/videos` 200 · `/api/videos` 200 · `/api/videos/harvest` 401（鉴权生效） |

> 注意：`apps/api` 的 `bodyLimit` 与 `video-catalog` 改动需重启中枢进程才生效（本次已随全栈重启生效）。
>
> 工程提示：`next dev`（Turbopack）运行期间并发跑 `vitest` / `tsc` 会因 `node_modules/.vitest-cache` 高频写入触发 Turbopack panic（`Expected file content for file`）。验证与开发服务应串行执行。

---

## 附录 A · 证据索引

| 结论 | 文件:行 |
| :--- | :--- |
| 轮换只读顶层 items | `apps/web/src/lib/video-harvester.ts:540` |
| 容量判断基于顶层 | `apps/web/src/lib/video-harvester.ts:608` |
| YouTube 静默返回 | `apps/web/src/lib/video-harvester.ts:249` |
| Webhook 固定 freshness | `apps/web/src/lib/video-multi-source-connector.ts:267` |
| likes 取错字段 | `apps/web/src/lib/video-multi-source-connector.ts:109` |
| 伪造 RSS 统计 | `apps/web/src/lib/video-multi-source-connector.ts:143` |
| 伪造 GitHub 统计 | `apps/web/src/lib/video-multi-source-connector.ts:160` |
| 4 MB bodyLimit | `apps/api/src/server.ts:138` |
| db 模式 500 上限 | `apps/api/src/video-catalog.ts:510` |
| 超限静默回落 | `apps/api/src/video-catalog.ts:518` |
| 同步状态无出口 | `apps/api/src/video-catalog.ts:93` |
| 条目路由绕过 OCC | `apps/web/src/app/api/videos/[id]/items/route.ts:58,106,154` |
| 巡检绕过 OCC | `apps/web/src/app/api/cron/video-health-sweep/route.ts:56` |
| Data Cache 无标签 | `apps/web/src/lib/storage-adapter.ts:202` |
| 报表只统计顶层 | `apps/web/src/app/api/videos/harvest/route.ts:30` |
| custom iframe 无白名单 | `apps/web/src/components/video-player-page.tsx:813` |
| 合成章节/字幕/测验 | `apps/web/src/lib/video-autonomous-ai-harvester.ts:187-296` |
| 类型门禁关闭 | `apps/web/next.config.js:44` |

## 附录 B · 复现命令

```bash
# 1. 数据规模与分布
node -e "const d=require('./apps/web/src/navsphere/content/videos.json');
let n=0,s=0;for(const c of d.navigationItems){n+=(c.items||[]).length;
for(const x of c.subCategories||[])s+=(x.items||[]).length}
console.log({topItems:n,subItems:s})"

# 2. 候选池时长一致性
node -e "const j=require('./apps/web/src/navsphere/content/video-topics.json');
for(const t of j.topics){const sum=t.chapters.reduce((a,c)=>a+c.duration,0);
if(Math.abs(t.durationSec-sum)>60)console.log(t.bvidFallback,t.durationSec,sum)}"

# 3. 序列化开销
node -e "const fs=require('fs');const raw=fs.readFileSync('apps/web/src/navsphere/content/videos.json','utf8');
const t=Date.now();JSON.parse(raw);console.log('parse',Date.now()-t,'ms')"

# 4. 单测与类型检查
npx vitest run apps/web/test/video-api-guards.test.ts apps/web/test/video-harvester.test.ts
node scripts/typecheck-video-scope.mjs
```

---

*本文档基于 2026-10-28 的代码与数据快照。所有量化结论均可通过附录 B 复现；标注「估算」的项为测算值，非线上实测。*
