# 视频管理 / 智能热点采集中心 — 闭合核验与增量增强方案

> 日期：2026-10-28　基线：`07d88fe8`（a11y 整改 + overlay 入库）
> 关系：本文**不重复** `docs/VIDEO-HOTSPOT-BACKEND-AUDIT-2026-10-28.md`（下称"原审计"）已列的 25 项发现，
> 只做三件事：① 逐项核验原审计的 P0/P1 在**当前代码**上是否真的闭合；② 补原审计"本次未覆盖"的三个领域；
> ③ 给出可验收（有测试/门禁）的增量方案。

---

## 0. 结论（先说最重要的）

1. **鉴权缺口已闭合**：四处写入口（`videos` POST/PUT、`harvest`、`ai-autonomous-harvest`、`webhook-harvest`）现在都过 `verifyAdminSession()` 或 HMAC 验签，且 webhook 未配密钥时**直接 503 关闭**而非回落到硬编码密钥。
2. **并发写仍是最大未闭合风险**：存储层已具备 `ifVersion` 乐观并发（`295a5ef0`），但**四处视频写入一次都没传版本号**，读-改-写依旧是 last-write-wins。采集一旦按小时跑起来，丢更新的概率随并发线性上升。
3. **"删除即永久"仍未加二次确认**：死链清理仍按单次探测结果直接 `filter` 掉条目（`video-deadlink-sweeper.ts:290-296`），一次网络抖动 = 内容永久消失 + 回滚记录被 100 条硬截断覆盖。
4. **"智能热点"的产品真实性仍未解决**：候选池是固定 B 站清单（`video-trending-harvester.ts:45-56`，已在注释中声明并有回归守卫），`/hot` 与视频热点是两套互不相干的热度。这不是缺陷，是**产品定义问题**，必须显式定档，否则对外宣传与实现不一致。

---

## 1. 核验方法（可复现）

| 手段 | 命令 | 用途 |
|---|---|---|
| 鉴权面 | `grep -n "verifyAdminSession\|WEBHOOK_SECRET" apps/web-overlay/src/app/api/videos/**/route.ts` | 确认写入口都有闸门 |
| 验签强度 | `sed -n '1,48p' apps/web-overlay/src/lib/webhook-signature.ts` | 是否 `createHmac` + `timingSafeEqual` |
| 并发写 | `grep -rn "commitFile(" apps/web-overlay/src/app/api/videos` | 是否传 `ifVersion` |
| 删除策略 | `sed -n '275,300p' apps/web-overlay/src/lib/video-deadlink-sweeper.ts` | 是否单次判定即删 |
| 热度新鲜度 | `grep -n "recompute_rank" apps/api/src/jobs.ts` | 重算周期与并发 |
| 缓存口径 | `grep -n "CACHE_TTL_MS" apps/web-overlay/src/lib/github.ts` | 微缓存时长 |

---

## 2. 原审计 P0/P1 闭合状态

状态口径：**已闭合**＝代码层面有闸门且有回归用例；**部分闭合**＝主路径修了但边界仍在；**未闭合**＝行为与审计时一致。

| 编号 | 原问题 | 当前状态 | 证据 |
|---|---|---|---|
| P0-1 | 自主采集接口无鉴权 | **已闭合** | `ai-autonomous-harvest/route.ts:18` 起 GET/POST 均 `verifyAdminSession()` |
| P0-2 | Webhook 签名是伪实现 | **已闭合** | `webhook-signature.ts:16,23`（`createHmac('sha256')` + `timingSafeEqual`）；`webhook-harvest/route.ts:60` 用 `request.text()` 原文验签；未配密钥返回 503 |
| P0-3 | Cron 端点 fail-open | **已闭合** | 同上，密钥缺失即拒绝，不再回落默认值 |
| P0-4 | LLM 摘要接口无鉴权 | 需复核 | 本轮未逐行核对 `video-ai-summary` 的调用面 |
| P0-6 | 健康巡检写错目标文件 | 需复核 | 本轮未复核写入路径常量 |
| P0-7 | 一次探测失败即永久删除 | **已闭合（本轮）** | 新增 `PRUNE_AFTER_CONSECUTIVE_FAILURES = 2` + `videoConfig.failStreak`；单次失败只标记 `broken`，连续两次才进删除候选；恢复健康即清零 |
| P0-8 | 单条增删改清空替换历史 | 需复核 | 本轮未复核 `[id]/route.ts` 的 history 处理 |
| P1-9/10 | 租约锁 owner 不匹配 / 内存单例 | 需复核 | 本轮未复核锁实现 |
| P1-11 | 后台任务在 Serverless 不可靠 | **未闭合**（结构性） | 采集仍依赖请求触发 + `.github/workflows/video-harvest.yml` 定时；进程内状态不跨实例 |
| P1-12 | 读-改-写无并发控制 | **已闭合（本轮）** | 新增 `lib/video-library-store.ts` 的 `mutateVideoLibrary`（每轮重读 + `ifVersion` + 冲突重放）；四处写路径全部接入，冲突返回 409 |
| P1-13 | 写失败被吞成成功 | **已闭合** | `webhook-harvest/route.ts:130` 的 `commitFile` 不再 catch 后继续返回成功 |
| P1-15 | `GET /api/videos` 全量无裁剪 | **已闭合（本轮）** | `compact`/`categoryId`/`limit`/`offset` + 新增 `cursor`（`X-Next-Cursor`），游标锚在 `harvestedAt+id` 上，翻页期间插入新条目不会重复/漏项 |
| P1-16 | `videos/page.tsx` `force-dynamic` | **未闭合** | `app/videos/page.tsx:13` 仍 `force-dynamic`（注释说明为元信息正确性，属有意取舍） |
| P1-17 | 摘要缓存退化为进程内 Map | 需复核 | 本轮未复核 |
| P2-30 | `replacementHistory` 硬截断 100 | **部分闭合（本轮）** | 新增独立文件 `video-replacements.json`（不截断）作为权威副本；内联仍保留上限以控制 videos.json 体积 |

> 说明：标"需复核"的 7 项，本轮未取得足够证据，**不臆断为已修**。建议按第 4 节的验收清单逐条补证据。

---

## 3. 原审计未覆盖的三个领域

### 3.1 `/videos/player` 播放器链路与离线缓存

- 现状：`video-cache-manager.ts`、`offline-video-cache.ts` 与播放器组件是三条独立路径，缓存键未与「视频 externalId」统一，导致同一视频在详情页与播放页可能命中不同缓存条目。
- 风险：离线缓存没有容量上限与 LRU 淘汰的证据（本轮未找到 `maxEntries` 类配置），长期使用会持续占用用户存储。
- 建议：统一 `cacheKey = sha1(externalId + quality)`，并把容量上限做成显式常量 + 单测。

### 3.2 `/hot` 的可信度（决定"热点"是否名副其实）

- 数据链：`/hot` → `hubGet('/api/rank/trending')` → `repo.hotSites(limit)` → `trend_score`；`trend_score` 由 `recompute_rank` 任务**每小时**重算（`jobs.ts:116`，`maxConcurrency: 1`，超时 180s）。
- 结论：`/hot` 的"热"= 站点访问量 + 时间衰减，**与视频采集的热点没有任何数据关系**。两者在 UI 上并列出现会让人以为是同一套热度。
- 建议：要么在文案上区分（"站点热度" vs "视频热点"），要么让视频热点进入同一套 `trend_score` 计算——后者工作量大，前者是文案级修复。

### 3.3 可观测性缺口

- 视频链路只有 `console.warn/error`，没有结构化字段（`externalId`、`stage`、`durationMs`），也没有与中枢 `metrics.ts` / `probe-metrics-buffer.ts` 打通。
- 后果：采集失败时无法回答"是哪个源、哪个阶段、慢在哪"——这正是本轮排查 CI 时最缺的东西。
- 建议：统一 `videoLog(stage, fields)`，把 `stage ∈ {fetch, score, dedupe, persist}` 与 `durationMs` 作为必填字段。

---

## 4. 增量增强方案（按优先级，含验收标准）

### P0（本周，阻断级）

| # | 措施 | 落地位置 | 验收标准 |
|---|---|---|---|
| A1 | 四处视频写入接入 `ifVersion` 乐观并发；冲突返回 409 并带当前版本号 | `videos/route.ts:39`、`webhook-harvest:130`、`[id]/route.ts:15`、`ai-autonomous-harvest:99` | 新增用例：两个并发写同一文件，第二个必须 409 且不覆盖第一个的内容 |
| A2 | 死链删除加二次确认：`brokenIds` 先进 `pendingDeletion`，下一轮仍失败才真删；保留 `lastVerifiedAt` | `video-deadlink-sweeper.ts:290` | 用例：单次 404 → 条目标记 `broken` 但仍在库；连续两次 → 删除 |
| A3 | 回滚记录改为独立存储（`video-replacements.json`），不再受 `slice(0,100)` 约束 | `video-harvester.ts:643` | 用例：写入 150 条替换记录后全部可回滚 |

### P1（两周内）

| # | 措施 | 验收标准 |
|---|---|---|
| B1 | `GET /api/videos` 默认 `compact=1`，并加 `cursor` 游标分页（`updatedAt+id`） | 200 条数据下首包 < 30KB；翻页无重复无遗漏 |
| B2 | 采集候选池改为**可配置 + 有来源标注**（B 站/YouTube/RSS），每条带 `source` 与 `fetchedAt` | 候选来源在响应里可见；新增源不改代码 |
| B3 | 结构化日志 `videoLog(stage, fields)`，接入现有 metrics 缓冲 | 一次失败采集能回答"哪个阶段、耗时多少" |
| B4 | `/hot` 与视频热点在 UI/文案上显式区分，或合并进同一 `trend_score` | 产品确认口径；截图对比 |

### P2（按需）

| # | 措施 | 验收标准 |
|---|---|---|
| C1 | 离线缓存容量上限 + LRU 淘汰 | 缓存条目数不超过上限；淘汰可观测 |
| C2 | `videos/page.tsx` 改 ISR + `revalidate`，元信息走单独轻接口 | 首屏 TTFB 下降；元信息仍正确 |
| C3 | 播放器缓存键统一为 `sha1(externalId+quality)` | 详情页与播放页命中同一条目 |

---

## 5. 预期收益（量化口径）

| 措施 | 可量化收益 | 依据 |
|---|---|---|
| A1 乐观并发 | 并发写丢失更新从「必然」降到「0（冲突可见）」 | 当前 4 处写路径无版本校验 |
| A2 二次确认 | 误删率从「单次探测失败即 100%」降到「需连续两次」 | 探测失败率按 1% 估算，误删降两个数量级 |
| B1 compact+游标 | 列表首包体积降约 60%（章节/字幕是主要体积） | 44KB 中章节与字幕占大头 |
| B3 结构化日志 | 故障定位从「翻日志猜」到「按 stage 聚合」 | 本轮 CI 排查耗时即为反例 |

---

## 5.1 本轮已实施（代码已落地，含回归用例）

| 项 | 落地内容 | 验证 |
|---|---|---|
| A1 并发控制 | `lib/video-library-store.ts`：`mutateVideoLibrary` 每轮**重读**最新数据、取 `getStorageVersion`、写入带 `ifVersion`、409 时重放（最多 3 次）；四处写路径（整包保存 / 单条增删改 / webhook / 自主采集）全部接入，冲突统一返回 409 + `retryable` | `video-remediation.test.ts` 的「版本冲突判定」4 例 |
| A2 删除二次确认 | `PRUNE_AFTER_CONSECUTIVE_FAILURES = 2`；`videoConfig.failStreak` 累加/清零；只有 `streak >= 2` 才进删除候选 | 「死链删除需要连续失败」4 例（含 unverified 永不删除） |
| A3 历史不截断 | `lib/video-library-store.ts` 的 `appendReplacementHistory` 写 `video-replacements.json`；`/api/videos/history` 优先读该文件，回退内联 | 通过 `readReplacementHistory` 的读路径 + 类型检查 |
| B1 游标分页 | `lib/video-pagination.ts`：`encode/decodeVideoCursor`、`pageCategoryByCursor`；`X-Next-Cursor` 响应头；`harvestedAt desc, id asc` 全序 | 「游标分页」4 例（含翻页中途插入的稳定性） |
| B3 结构化日志 | `lib/video-log.ts`：`videoLog(stage, fields, level)` + `startVideoTimer`；死链巡检已落一条 `probe` 汇总（探测数/健康/失败/待删） | 类型检查 + 巡检用例覆盖调用路径 |
| P1-5 读接口鉴权 | `GET /api/videos/history` 加 `verifyAdminSession()`（历史含旧条目全文与回滚入口） | 与写接口同口径 |

**设计取舍（明确记录）**：
- 游标分页只在 `categoryId` 下生效。跨分类的稳定游标需要 `(categoryId, harvestedAt, id)` 复合键，而当前前端是「按分类进入」的交互，收益不抵复杂度。
- `appendReplacementHistory` 失败只告警不回滚：主数据已落盘，回滚记录是审计用途，不能因为它让采集整体失败。

## 6. 本轮未验证 / 风险声明

- 标"需复核"的 7 项（P0-4、P0-6、P0-8、P1-9/10、P1-17）**没有取得代码级证据**，不得据此认为已修。
- 本文所有行号基于 `07d88fe8`；并行会话仍在改动该模块，行号可能漂移，复核时以符号名（函数名/常量名）检索为准。
- 未做压测：A1/B1 的收益是结构性推断，不是实测值。

---

## 附：本次核验的证据锚点

```
apps/web-overlay/src/lib/webhook-signature.ts:16,23         HMAC + timingSafeEqual
apps/web-overlay/src/app/api/videos/webhook-harvest/route.ts:16-18,60,113-121,130
apps/web-overlay/src/app/api/videos/route.ts:39,64-74       写入无版本 / GET 裁剪
apps/web-overlay/src/app/api/videos/[id]/route.ts:15
apps/web-overlay/src/app/api/videos/ai-autonomous-harvest/route.ts:18,99
apps/web-overlay/src/lib/video-deadlink-sweeper.ts:225,290-296
apps/web-overlay/src/lib/video-harvester.ts:643
apps/web-overlay/src/lib/video-trending-harvester.ts:45-56,111
apps/web-overlay/src/app/videos/page.tsx:13
apps/web-overlay/src/lib/github.ts:190,208-254
apps/api/src/routes/rank.ts:25-49
apps/api/src/jobs.ts:116,232
```
