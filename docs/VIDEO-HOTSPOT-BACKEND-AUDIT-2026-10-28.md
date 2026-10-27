# 视频管理 与 智能热点采集中心 — 后端深度审计与增强方案

- 审计日期：2026-10-28
- 审计范围：`apps/web-overlay/src/app/videos/**`、`apps/web-overlay/src/app/api/videos/**`、`apps/web-overlay/src/app/api/cron/**`、`apps/web-overlay/src/app/hot/**`、`apps/web-overlay/src/lib/video-*.ts`、中枢侧 `apps/api/src/routes/navsphere.ts` + `apps/api/src/storage.ts`
- 方法：全链路静态通读 + 数据规模实测 + 契约反查（未修改任何代码，未跑写操作）
- 结论口径：只报**有代码证据**的问题，每条附 `文件:行号`

---

## 0. 一句话结论

两个模块的**界面与路由骨架已经成型，但服务端内核是「演示级」的**：视频侧存在 4 个匿名可写入口与 1 处写错路径导致能力空转；热点侧根本不存在采集，候选池是 12 条硬编码常量，播放量是 `Math.random()` 生成的。当前状态可以演示，**不能对外承诺「自动采集 / 智能热点」**。

| 维度 | 视频管理 | 热点采集 | 说明 |
|---|---|---|---|
| 架构设计 | 5 / 10 | 3 / 10 | 三套写入口各自 read-modify-write 同一 JSON，无单一写入通道 |
| 代码质量 | 6 / 10 | 3 / 10 | 视频侧结构清晰但有类型断链；热点侧大量「名不副实」命名 |
| 性能 | 5 / 10 | 6 / 10 | 全量文档覆盖式读写；LLM 摘要服务端无持久缓存 |
| 安全性 | **2 / 10** | 6 / 10 | 4 处鉴权缺口 + 伪 HMAC + 硬编码密钥 |
| 可扩展性 | 3 / 10 | 2 / 10 | 文档整包模型不支持按条查询、分页、并发 |
| 可靠性 | 3 / 10 | 4 / 10 | 锁不释放、任务全内存、一次探测失败即删内容 |

---

## 1. 模块边界与真实调用链

```
                        ┌──────────────────────────────────────────┐
  /videos (RSC)  ──────▶│ getFileContent('src/navsphere/content/    │
  force-dynamic         │                  videos.json')           │
                        │   ↓ StorageAdapter (http 默认)           │
                        └──────────────┬───────────────────────────┘
                                       ▼
                        ┌──────────────────────────────────────────┐
                        │ 中枢 GET /api/storage?path=…  (scope:read)│
                        │      PUT /api/storage         (scope:admin)│
                        │   ↓ readKv / writeKv                      │
                        │ jobs 表单行 JSON，ON CONFLICT DO UPDATE    │
                        └──────────────────────────────────────────┘
                                       ▲
        ┌──────────────────────────────┼──────────────────────────────┐
        │                              │                              │
  /api/videos/harvest        /api/videos/ai-autonomous-harvest   /api/videos/webhook-harvest
  (admin ✅)                  (无鉴权 ❌)                          (签名可绕过 ❌)
        │                              │                              │
        ▼                              ▼                              ▼
  runVideoHarvestAndRotation   AutonomousAIHarvesterController   MultiSourceConnector
  (真实 B 站搜索)               (12 条硬编码常量)                  (弱哈希验签)

  /hot (RSC, revalidate=60) ──▶ 中枢 GET /api/rank/trending + /api/rank/new
                                └─ 依赖 trend_score 由 recompute_rank 任务产出
                                   （页面自述「访问量统计尚未积累」）

  /api/cron/video-harvest      ──▶ 同一 harvest 引擎（fail-open 鉴权，且无调度器）
  /api/cron/video-health-sweep ──▶ 读写 'data/navigation.json'（路径错误 ❌）
```

**关键事实**：`videos.json` 当前 44KB / 5 分类 / 16 条目，`harvestPolicy.enabled` 为 5（全分类开启）。规模很小，因此下面的问题不是「现在会炸」，而是「一旦真跑起来就会炸」。

---

## 2. 安全性：4 个匿名可写入口与 1 个伪加密

### P0-1 自主采集接口完全无鉴权

`apps/web-overlay/src/app/api/videos/ai-autonomous-harvest/route.ts:70-113`

```ts
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    // ❌ 没有 verifyAdminSession，没有 CRON_SECRET
    const currentData = (await getFileContent(VIDEOS_FILE_PATH)) as NavigationData
    const controller = new AutonomousAIHarvesterController()
    const { updatedData, report } = await controller.runCycle(currentData, {...})
    if (!dryRun && report.newCourses.length > 0) {
      await commitFile(VIDEOS_FILE_PATH, JSON.stringify(updatedData, null, 2), ...)
    }
```

- **影响**：任何人 POST 一次即可往视频库写 12 条内容（当前 `dryRun` 默认 false），并触发整包覆盖写。写请求打到中枢 `PUT /api/storage`（scope:admin）——若前端侧配置了 `NAVHUB_STORAGE_TOKEN`，等于把管理员写权限暴露成公开接口。
- **根因**：该路由是后加的功能，未套用同目录其它路由的 `verifyAdminSession` 模板。

### P0-2 Webhook 签名是伪实现，且可整体绕过

`apps/web-overlay/src/lib/video-multi-source-connector.ts:66-80`

```ts
export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false
  if (signature.startsWith('sha256=')) {
    const rawSig = signature.replace('sha256=', '').trim()
    // ❌ 注释写 HMAC，实现是 32 位滚动哈希
    let hash = 0
    const str = `${secret}:${payload}`
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
    }
    const simulatedHex = Math.abs(hash).toString(16).padStart(8, '0')
    // ❌ 子串匹配：只对 8 个 hex 位
    return rawSig.toLowerCase().includes(simulatedHex.toLowerCase()) || rawSig === secret
  }
  return signature === secret   // ❌ 允许把密钥本身当签名
}
```

`apps/web-overlay/src/lib/video-multi-source-connector.ts:199`

```ts
if (signature && !verifyWebhookSignature(JSON.stringify(payload), signature, this.webhookSecret)) {
  return { ok: false, message: 'Webhook HMAC 签名验证失败，拒绝请求' }
}
// ❌ signature 为空 → 直接进入业务逻辑
```

`apps/web-overlay/src/app/api/videos/webhook-harvest/route.ts:13-15`

```ts
const connector = new MultiSourceConnector(
  process.env.NAVHUB_VIDEO_WEBHOOK_SECRET || 'navhub_video_webhook_secret_2026'
)
// ❌ 默认密钥硬编码，且同文件 GET 把端点和算法公开告知
```

四个独立缺陷叠加，实际安全强度为零：

| # | 缺陷 | 后果 |
|---|---|---|
| a | 不是 HMAC，是 32 位滚动哈希 | 输出空间 4.3e9，可离线暴力 |
| b | `includes()` 子串匹配 | 8 hex 位任意位置命中即通过，熵进一步坍塌 |
| c | `rawSig === secret` | 密钥可直接当签名用，泄露即永久通行 |
| d | `if (signature && …)` | 不带签名头 = 跳过校验 |
| e | 对 `JSON.stringify(payload)` 验签 | 与原始 body 的键序/空格不一致，正解实现也会误拒 |
| f | 未配置环境变量时用硬编码默认值 | 攻击者不需要探测密钥 |

### P0-3 Cron 端点 fail-open

`apps/web-overlay/src/app/api/cron/video-harvest/route.ts:24-35`（health-sweep 同构，`:19-29`）

```ts
const cronSecret = process.env.CRON_SECRET || process.env.INTERNAL_JOB_TOKEN
const querySecret = searchParams.get('secret')
const providedSecret = authHeader?.replace(/^Bearer\s+/i, '') || querySecret
// ❌ 未配置 cronSecret 时整段跳过校验
if (cronSecret && providedSecret !== cronSecret) {
  return NextResponse.json({ error: 'Unauthorized: Invalid CRON_SECRET' }, { status: 401 })
}
```

- 生产环境漏配 `CRON_SECRET` 即完全开放写接口，且**不会报错、不会告警**。
- `?secret=` 允许密钥走 URL，会进反向代理 access log、浏览器历史、Referer。

### P0-4 LLM 摘要接口无鉴权且是死代码

`apps/web-overlay/src/app/api/videos/ai-summary/route.ts:6-40`

- 无 `verifyAdminSession`，`description` 从 query 直入 prompt（`video-ai-summary.ts:207`），无长度上限 → prompt 注入 + 任意计费。
- 实测调用方：`video-player-page.tsx:95` 与 `VideoPlayerContext.tsx:7` 都直接 `import { getVideoAISummary }` 客户端调用，**没有任何地方 fetch 这个路由** → 当前是纯攻击面，零收益。
- `video-ai-summary.ts:227` 把 Gemini key 拼进 URL query（`?key=`），会进上游日志。

### P1-5 审计与回滚数据的读接口无鉴权

`apps/web-overlay/src/app/api/videos/history/route.ts:11-27` GET 无鉴权，返回全部 `replacementHistory`（含被替换视频的完整 oldItem/newItem）。属内部运营数据。

---

## 3. 正确性与数据安全：三处「静默失效」

### P0-6 健康巡检写错目标文件，能力完全空转

`apps/web-overlay/src/app/api/cron/video-health-sweep/route.ts:8`

```ts
const VIDEOS_FILE_PATH = 'data/navigation.json'   // ❌ 应为 src/navsphere/content/videos.json
```

同目录其它 6 个路由全部是 `'src/navsphere/content/videos.json'`。后果：

1. 读进来的是**站点导航**（`navigation.json`），里面 `videoConfig` 为 0 → `videoItems` 为空 → 报告永远 `totalScanned: 0`。
2. `dryRun=false && report.brokenCount > 0` 才会写；brokenCount 恒 0，所以暂时没触发写。
3. 但 `writeStoragePath` 对 `navigation.json` 走的是 `writeNavigationData`（`apps/api/src/storage.ts:632-638`），一旦条件成立就是**整站导航结构被视频数据覆盖**。

### P0-7 一次探测失败即永久删除内容

`apps/web-overlay/src/lib/video-deadlink-sweeper.ts:148-158`

```ts
} catch (err: any) {
  return {
    healthy: false,                        // ❌ 超时/网络错误 = 不健康
    reason: err?.message || 'Network timeout or probe aborted',
  }
}
```

`apps/web-overlay/src/lib/video-deadlink-sweeper.ts:173-175, 222-249`

```ts
const autoPrune = options?.autoPrune ?? true    // ❌ 默认直接删
if (autoPrune && brokenIds.size > 0) {
  updatedCategories = navigationData.navigationItems.map(cat => {
    const filteredItems = (cat.items || []).filter(item => {
      if (brokenIds.has(item.id)) { prunedCount++; return false }   // 无二次确认
```

本仓既有口径是「**超时 = 不可判定，不是死**」（见 `packages` 探活判定与记忆归档）。此处反其道而行：B 站接口抖动一次，条目就从库里消失，且 `replacementRecords` 永远是空数组（`:193` 定义后从未 push），**没有回滚凭据**。

### P0-8 单条增删改会清空替换历史

`apps/web-overlay/src/app/api/videos/[id]/items/route.ts:58-63`（PUT `:106-111`、DELETE `:154-159` 同）

```ts
await commitFile(
  VIDEOS_FILE_PATH,
  JSON.stringify({ navigationItems: updatedItems }, null, 2),  // ❌ 只序列化一个键
  'Add video item',
```

`NavigationData` 还有 `replacementHistory`（`video-harvester.ts:584` 写入、`history/route.ts` 读取、`rollbackReplacement` 依赖）。任何一次单条视频编辑都会把它抹成 `undefined` → 回滚功能静默失效，且无报错。

---

## 4. 可靠性：锁、队列、并发写

### P1-9 租约锁永不释放（owner 不匹配）

`apps/web-overlay/src/lib/video-task-queue.ts:221` 与 `:258`

```ts
const lockResult = videoTaskQueue.acquireLock(`worker_${Date.now()}`)   // owner = worker_1712...
...
} finally {
  videoTaskQueue.releaseLock(task.id)                                   // owner = task_vharvest_<uuid>
}
```

`releaseLock` 的实现是 `if (this.currentLock && this.currentLock.owner === owner)`（`:86`）→ 恒不相等，锁永远不释放，只能等 `DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000`（`:50`）自然过期。

**用户可见后果**：采集跑完后 5 分钟内再次点击「开始采集」会得到「已有任务正在执行中（持有者: worker_…）」，而实际上没有任务在跑。

**测试为什么没抓到**：`apps/web-overlay/test/video-evolution-suite.test.ts:58-77` 是手工用同一 `owner1` 配对 acquire/release，只验证了 API 语义，没有覆盖 `scheduleAndRunVideoHarvest` 这条真实调用路径。

### P1-10 「分布式租约锁」是内存单例

`apps/web-overlay/src/lib/video-task-queue.ts:44-59`

```ts
// 内存态全局单例任务与锁存储
class VideoTaskQueueStore {
  private static instance: VideoTaskQueueStore
  private tasks = new Map<string, VideoHarvestTask>()
```

- 多副本 / 多容器 / Serverless 并发实例下**零互斥**，注释里的「分布式」不成立。
- 进程重启 → 所有 task 记录与锁状态丢失；`GET /api/videos/harvest/task` 返回空，管理端看不到历史。
- `taskOrder` 上限 50（`:138-141`）会把 `tasks` 删除但只在 `createTask` 时裁剪。

### P1-11 后台任务在 Serverless 上不可靠

`apps/web-overlay/src/lib/video-task-queue.ts:230`

```ts
void (async () => {   // 不 await，HTTP 已返回
```

Next.js 部署在 Vercel / 边缘函数时，响应返回后执行上下文可能被冻结或终止。这条 `void` 任务会停在 `percent: 10`（`:233-236`），永远不进入 `completeTask`。

### P1-12 读-改-写无并发控制

三个写入口（harvest / ai-autonomous-harvest / webhook-harvest）都是「读整包 → 改内存 → 写整包」，中枢侧落库为：

`apps/api/src/storage.ts:457-459, 488-497`

```ts
export async function writeVideosData(ctx: AppContext, data: unknown): Promise<void> {
  await writeKv(ctx, "videos", data);      // 单行 JSON 整包覆盖
}
...
db.sqlite!.prepare(
  "INSERT INTO jobs (id, kind, payload, ...) VALUES (?,?,?,?,0,?,?) " +
  "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
).run("kv:" + key, "kv", payload, "done", now, now);
```

无版本号、无 `If-Match`/ETag、无事务内的 read-check-write。两个入口同时跑 = **last-write-wins，先写的那批内容凭空消失**，且日志上看不出异常。

### P1-13 写失败被吞成成功

`apps/web-overlay/src/app/api/videos/ai-autonomous-harvest/route.ts:90-92`

```ts
} catch (commitErr) {
  console.warn('Storage commit failed (possibly read-only fallback):', commitErr)
}
// 继续 return { code: 0, success: true, ... }
```

`webhook-harvest/route.ts:87-89` 同构。运营看到「处理成功」，实际没入库。

### P1-14 类型契约断链被构建配置静默放行

`apps/web-overlay/src/lib/video-task-queue.ts:11, 31, 178`

```ts
import { runVideoHarvestAndRotation, type HarvestRunReport } from './video-harvester'
//                                      ^^^^^^^^^^^^^^^^ 该文件只导出 VideoHarvestReport
```

全仓 grep 结果：`HarvestRunReport` 在 `video-harvester.ts`、`types/navigation.ts` 中**均无定义**。`apps/web-overlay/next.config.js:44` 是

```js
typescript: { ignoreBuildErrors: true },
```

所以这个 TS2305 一路绿灯。`apps/web-overlay/test/video-evolution-suite.test.ts:50` 还从 `@/types/navigation` 导入同名类型（同样不存在），vitest 走 esbuild 剥离类型也不报。

**这不是一个类型错误，而是「该模块的类型检查事实上不存在」**——本次审计发现的多数问题都因此长期未被拦下。

---

## 5. 性能瓶颈

| # | 位置 | 问题 | 量化影响 |
|---|---|---|---|
| P1-15 | `api/videos/route.ts:10-20` | `GET` 返回整份 `videos.json`，无分页、无字段裁剪 | 当前 44KB；条目数线性增长，采集跑起来后每次列表请求都传全量 |
| P1-16 | `app/videos/page.tsx:13` | `dynamic = 'force-dynamic'` + 同请求两次 `getFileContent`（videos + site） | 全量数据进 RSC payload，无法 ISR；`/hot` 反而正确用了 `revalidate = 60` |
| P1-17 | `lib/video-ai-summary.ts:16-24, 144-181` | 服务端 `getStorage()` 返回 `null`，只剩进程内 `Map` | Serverless 冷启动即失效 → 每次播放都打一次 Gemini，首字延迟 + 成本线性 |
| P1-18 | `components/video-content.tsx:353-390` | 全量 `map` 渲染，无分页/虚拟化 | 当前 16 条无感；200 条以上首屏 DOM 与 RSC 体积同时失控 |
| P2-19 | `lib/video-harvester.ts:288-370` | 关键词串行 `for` + 每词 6s 超时，无并发/无整体预算 | 5 分类 × 2 词 ≈ 最坏 60s+，贴近函数超时；超时后整包写不落盘 |
| P2-20 | `lib/video-deadlink-sweeper.ts:196-217` | 串行探测，默认 30 条 × 3.5s | 最坏 105s，必然超过多数 Serverless 超时窗口 |

---

## 6. 「智能热点采集」的真实性核查（最高优先级产品风险）

这一节不是性能问题，是**内容诚信问题**。

### P0-21 候选池是 12 条硬编码常量，不存在采集

`apps/web-overlay/src/lib/video-trending-harvester.ts:33-249`

```ts
export const CURATED_TRENDING_TOPICS: TrendingTechTopic[] = [
  {
    domain: 'cat_ai_engineering',
    keyword: '李宏毅机器学习与大模型前沿',
    hotIndex: 98,                    // ❌ 手写数字，非任何数据源产出
    recommendedTitle: '李宏毅 2021/2022 …',
    bvidFallback: 'BV1Wv411h7kN',
    durationSec: 314062,             // ❌ 87 小时（合集时长，被当成单视频）
```

全库唯一的"采集"是 `video-harvester.ts:294` 的 B 站 wbi search，而该接口**未带 wbi 签名**（`w_rid`/`wts`），线上大概率返回 `-352`/`412` 风控。`harvestVideosForTopic` 对此的兜底是 `catch → console.warn`（`:366-368`）→ 静默返回空数组，任务仍报 `success: true`。

### P0-22 播放量/点赞是随机数，质量分因此失效

`apps/web-overlay/src/lib/video-trending-harvester.ts:323-329`

```ts
stats: {
  views: 125000 + Math.floor(Math.random() * 80000),   // ❌ 每次采集都不一样
  likes: 9800 + Math.floor(Math.random() * 5000),
  coins: 4500 + Math.floor(Math.random() * 2000),
  favorites: 14200 + Math.floor(Math.random() * 4000),
  danmaku: 850 + Math.floor(Math.random() * 300),
},
```

`video-autonomous-ai-harvester.ts:410-416` 更直接，写死 `views: 195000 / likes: 14200 / coins: 6800 / favorites: 18400`。

这些数字随后进入 `calculateQualityScore`（`video-harvester.ts:184-225`，其 `viewsScore = log10(views) * 5`、`favScore = favRate/0.05*20`）→ **质量分是随机数的函数**，且会被 `pinned` 之外的所有排序/推荐逻辑消费。

### P0-23 伪造发布时间，绕过整个保鲜衰减模型

`apps/web-overlay/src/lib/video-trending-harvester.ts:313-316`、`video-autonomous-ai-harvester.ts:400-403`

```ts
publishedAt: new Date().toISOString(),   // ❌ 2021 年的视频被标成"今天发布"
freshnessScore: 98,                      // ❌ 写死
```

`calculateFreshnessScore`（`video-harvester.ts:230-264`）的核心是 `decayFactor = 0.5 ^ (ageDays / halfLife)`。`publishedAt` 被伪造成当前时间 → `ageDays = 0` → `decayFactor = 1` → 永远保鲜。**「过时内容平滑轮换」这个卖点因此在数据层面不可能触发**（`worstScore < 45` 的替换条件永不成立）。

### P0-24 「AI 审核 / AI 提炼」是正则与模板字符串

`apps/web-overlay/src/lib/video-autonomous-ai-harvester.ts:67-160`

```ts
export function evaluateVideoWithAIModel(rawVideo: {...}): AIEvaluationResult {
  const clickbaitRegex = /震惊|必看|绝了|逆天|全网最强|看这一篇就够了|秒杀|暴打|吊打/i
  ...
  techKeywords.forEach(kw => { if (new RegExp(kw, 'i').test(fullText)) matchedTags.push(kw) })
  let baseScore = 75
  if (matchedTags.length >= 3) baseScore += 10
```

零模型调用、零 API 请求。`generateAISanitizedMetadata`（`:188-261`）输出**固定** 4 个章节（`ai-ch-1..4`）、**固定** 3 道选择题、**固定** 4 条字幕文案。

前端把它呈现为「AI 深度审核」「AI 成功生成 N 个结构化章节、N 条中文字幕与 N 道课后测验」（`:365`）→ 用户看到的是编造的课程大纲。

### P0-25 没有任何调度器在触发采集

- 仓库内无 `apps/web-overlay/vercel.json`；
- `.github/workflows` 中无任何文件引用 `video-harvest`；
- 全仓仅 `VideoTelemetryDashboard.tsx:65,110` 手工调用。

结论：所谓「定时自动采集」当前**一次都不会发生**，只有人工点按钮时才跑，而它跑的是硬编码常量。

### P1-26 `/hot` 与视频热点是两套无关的「热度」

- `/hot`（`app/hot/page.tsx:39-51`）读中枢 `/api/rank/trending`，是**站点访问量**排序；页面自己承认「访问量统计尚未积累，榜单暂不反映真实热度」（`hot-view.tsx:237`）。
- 视频侧的 `hotIndex` 是硬编码常量。

两者共用「热点/热榜」这个词，但数据源、口径、可信度完全不同，对外表述会互相拖累。

---

## 7. 代码质量与可观测性

| # | 位置 | 问题 |
|---|---|---|
| P2-27 | `video-task-queue.ts:279-280` | `isRunning` / `timer` 是死字段，从未赋值或读取；`new AutonomousAIHarvesterController()` 每请求新建（`ai-autonomous-harvest/route.ts:76`）→ `logs` 无法跨周期累积 |
| P2-28 | `video-harvester.ts:375-386` | `parseDurationToSeconds(durationStr?: string)` 内部判 `typeof durationStr === 'number'`，与签名矛盾；B 站搜索返回 `"MM:SS"`，`view` 接口返回 `number`，两条路径口径不一 |
| P2-29 | `video-harvester.ts:105, 159, 366` | 全部 `console.warn` 后继续，无结构化字段、无指标、无 traceId；与中枢侧 `metrics.ts` / `probe-metrics-buffer.ts` 体系脱节 |
| P2-30 | `video-harvester.ts:584` | `replacementHistory` 硬截断 100 条，回滚记录随之永久丢失 |
| P2-31 | `video-multi-source-connector.ts:235` | `bvid: id.startsWith('BV') ? id : 'BV1whDefault'` — 非 B 站来源被塞入**同一个假 BV 号**，去重逻辑会把它们全部判为重复 |
| P2-32 | `video-multi-source-connector.ts:231, 305, 392` | 所有入库视频共用同一张 Unsplash 图（`photo-1526374965328…`），封面无区分度 |
| P2-33 | `video-content.tsx:38` | `buildVideoSearchIndex` 在客户端对全量数据建倒排索引，`navigationData` 引用变化即全量重建（当前可接受，需设阈值） |

---

## 8. 增强方案（按优先级）

### 8.1 P0 — 必须先做，否则不具备对外条件

| ID | 措施 | 具体改动 | 预期收益 | 验证方式 |
|---|---|---|---|---|
| **A1** | 补鉴权，收敛匿名写入口 | `ai-autonomous-harvest/route.ts` POST 首行加 `verifyAdminSession()`（与同目录 6 个路由一致）；`cron/*` 改为**未配置 secret 即 503 fail-closed**；删掉 `?secret=` 通道 | 消除 4 个匿名写入口中的 3 个 | 未登录 `curl -X POST` 期望 401；`unset CRON_SECRET` 后期望 503 |
| **A2** | 用真 HMAC 替换伪实现 | 见下方代码；签名头必填；用 `await request.text()` 原始 body 验签 | webhook 从「可绕过」变为可信 | 新增单测：错误签名 401、缺签名 401、正确签名 200、篡改 body 401 |
| **A3** | 修 health-sweep 路径 | `'data/navigation.json'` → `'src/navsphere/content/videos.json'` | 健康巡检从空转变为真实可用 | 跑一次 `dryRun=true`，断言 `totalScanned === 16` |
| **A4** | 探测失败改为三态，取消默认删除 | 见下方代码：`dead` / `unverified` / `healthy`；`autoPrune` 默认改 `false`；仅连续 N 次 `dead` 才进入待删列表 | 一次网络抖动不再删内容 | 注入 `AbortError`，断言条目仍在库、`healthStatus='unverified'` |
| **A5** | 单条编辑保留顶层字段 | `[id]/items/route.ts` 三处 `JSON.stringify({ navigationItems })` → `JSON.stringify({ ...data, navigationItems })` | 替换历史不再被静默清空 | 编辑一条视频后断言 `replacementHistory.length` 不变 |
| **A6** | 删掉死代码路由 | 删除 `api/videos/ai-summary/route.ts`（无消费方，前端直调 lib） | 移除一个无收益的 LLM 计费攻击面 | `grep -r 'ai-summary' src/` 仅剩注释 |
| **A7** | 停止把伪造数据当真实内容 | 二选一：① `publishedAt` 用 B 站真实 `pubdate`、`stats` 用真实 API 值，拿不到就**不填**；② 前端明确标注「示例数据」并 `noindex` | 恢复产品诚信；让保鲜模型重新有意义 | 断言新入库条目 `stats` 字段与上游 API 一致；`freshnessScore` 不再恒为 98/99 |
| **A8** | 恢复类型检查 | 移除 `typescript.ignoreBuildErrors: true`，或至少把 `lib/video-*.ts` 纳入 `scripts/typecheck.mjs` 的显式清单；补 `HarvestRunReport` 定义或改用 `VideoHarvestReport` | 让后续所有同类缺陷在 CI 被拦住 | 修复前后各跑一次类型检查，期望「修复前红、修复后绿」 |

#### A2 参考实现

```ts
// lib/webhook-signature.ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifyHmacSha256(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false                 // fail-closed
  const provided = header.startsWith('sha256=') ? header.slice(7) : header
  if (!/^[0-9a-f]{64}$/i.test(provided)) return false  // 固定长度，禁止子串匹配
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(provided.toLowerCase(), 'hex')
  const b = Buffer.from(expected, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

// route.ts
const raw = await request.text()                        // 原始 body，不要 stringify
if (!verifyHmacSha256(raw, request.headers.get('x-hub-signature-256'), secret)) {
  return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
}
const body = JSON.parse(raw) as WebhookPayload
```

配套：启动时若未配置 `NAVHUB_VIDEO_WEBHOOK_SECRET` 则**禁用该路由**（返回 503）而不是回落到默认值。

#### A4 参考实现

```ts
export type ProbeState = 'healthy' | 'dead' | 'unverified'

export async function probeVideoAvailability(item, timeoutMs = 4000): Promise<ProbeResult> {
  try {
    // …原有请求逻辑
  } catch (err) {
    // 超时 / 连接失败 / 5xx / 403 / 429 一律不可判定，不进删除分母
    return { videoId: item.id, title: item.title, platform: config.type ?? 'custom',
             state: 'unverified', reason: '网络或限流未能确认状态', latencyMs: Date.now() - start }
  }
}

// sweep：只有连续 2 次 dead 才进入 prunedCandidates，且写进 replacementRecords 供回滚
```

### 8.2 P1 — 让「自动采集」真正成立

| ID | 措施 | 具体改动 | 预期收益 |
|---|---|---|---|
| **B1** | 修锁的 owner | `const owner = task.id` 后再 `acquireLock(owner)`；或 `acquireLock` 返回 token 存到 task 上，`finally` 用同一个 token 释放 | 采集结束后可立即再次触发，去掉 5 分钟空窗 |
| **B2** | 引入真实调度 | 新增 `.github/workflows/video-harvest.yml`（`cron: '0 */6 * * *'`）调 `/api/cron/video-harvest` 带 `Authorization: Bearer`；或接中枢已有 `jobs.ts` 调度器 | 从「人工点按钮」变成真定时 |
| **B3** | 改用中枢作业队列 | 复用 `apps/api/src/jobs.ts`（已有 `acquireLock`/`releaseLock`、状态机、持久化），删掉 `video-task-queue.ts` 的内存单例 | 任务状态跨重启、跨副本可见；锁真正互斥 |
| **B4** | 单写通道 | 所有写路径统一走 `mutateVideos(mutator)`：读 → 带版本号 → 写 → 版本冲突重试（≤3 次指数退避）；中枢侧 `PUT /api/storage` 增加 `ifVersion` 字段 | 三个入口不再互相覆盖 |
| **B5** | 写失败不要报成功 | `commitFile` 抛出后返回 502 + `retryable: true`，前端给重试按钮 | 运营不再误判「已入库」 |
| **B6** | B 站搜索加 wbi 签名 | 复用社区实现（先取 `nav` 接口拿 `img_key`/`sub_key`，再算 `w_rid`/`wts`）；失败时降级到 YouTube oEmbed/RSS，并在报告里显式标 `degraded` | 采集成功率从「静默 0」变为可观测 |
| **B7** | 分页与字段裁剪 | `GET /api/videos?limit&cursor&fields=summary`，默认不返回 `videoConfig.chapters/transcript`（单条最大字段） | 列表响应体积降一个数量级 |
| **B8** | LLM 摘要持久缓存 | 服务端落 KV（`writeKv('video-summary:'+videoId)`）或中枢表；`Cache-Control` 之外再加服务端命中 | 冷启动不再重复计费；P95 延迟显著下降 |
| **B9** | 并发化采集 | `harvestVideosForTopic` 改 `Promise.allSettled` + 信号量（并发 3）+ 总预算 25s | 任务总时长从 O(n×6s) 降到 O(n/3×6s)，且不会超时 |

#### B4 参考实现（乐观并发）

```ts
// 中枢侧：/api/storage 接受 ifVersion
app.put('/api/storage', { config: { scope: 'admin' } }, async (req, reply) => {
  const { path, content, ifVersion } = schema.parse(req.body)
  const current = await readVersion(ctx, path)
  if (ifVersion !== undefined && ifVersion !== current) {
    reply.code(409)
    return { error: 'version_conflict', currentVersion: current }
  }
  const next = await writeStoragePath(ctx, path, content)
  return { ...next, version: current + 1 }
})
```

### 8.3 P2 — 结构性与体验优化

| ID | 措施 | 预期收益 |
|---|---|---|
| **C1** | 热点候选池改为可配置资产（DB 表或 seed JSON），带 `source`/`fetchedAt`/`evidenceUrl` 三个必填字段 | 去掉硬编码；任何"热点"都可追溯到证据 |
| **C2** | 若短期无真实数据源，把 `/hot` 与视频侧的「热点」表述统一降级为「精选/推荐」，并从 sitemap 与导航中移除暗示实时性的文案 | 避免用户与搜索引擎误判 |
| **C3** | `video-deadlink-sweeper` 改为并发探测 + 批量落盘（单向遍历一次，不逐条 commit） | 消除 N 次全量 JSON 写 |
| **C4** | 统一观测：采集/轮换/巡检三条链路输出同一套 metrics（`harvest_total`、`harvest_failed_total`、`prune_total`、`probe_unverified_total`） | 与中枢 `metrics.ts` 对齐，可做告警 |
| **C5** | 清理死字段（`isRunning`/`timer`）、统一封面来源、去重键改用 `platform:externalId` 复合键 | 降低维护成本；避免跨平台内容被判重复 |
| **C6** | `videos.json` 落到关系表（`video_category` / `video_item` / `video_replacement_log`） | 支持按条查询、分页、审计、并发写；这是 A/B 阶段的终局形态 |

---

## 9. 落地路线

### 迭代 1（P0，建议 1–2 天）
1. A1 补鉴权 + cron fail-closed
2. A2 真 HMAC（含 4 个单测）
3. A3 修路径、A5 保字段（两处一行改动，收益最大）
4. A4 探活三态（先只做 `autoPrune=false`，删除策略留到有回滚凭据后再开）
5. A6 删死路由

**出口标准**：未登录访问 4 个写入口全部 401；`health-sweep?dryRun=true` 返回 `totalScanned = 16`；编辑单条视频后 `replacementHistory` 长度不变。

### 迭代 2（P1，建议 3–5 天）
1. A7 去伪造数据 + A8 恢复类型检查（这两条决定后续质量下限，优先于功能）
2. B1 修锁、B3 迁到中枢作业队列、B2 接真实调度
3. B4 单写通道 + B5 写失败上报
4. B6 wbi 签名与降级链、B9 并发化

**出口标准**：连续手动触发 3 次采集不出现「已有任务执行中」；同一时间两个入口并发写，最终数据条目数与预期一致（不丢更新）；采集报告里 `degraded` 字段能反映真实成功率。

### 迭代 3（P2，按需）
B7 分页、B8 LLM 缓存、C1–C6。

---

## 10. 风险与取舍

| 风险 | 说明 | 应对 |
|---|---|---|
| A8 恢复类型检查会一次性暴露大量历史错误 | `ignoreBuildErrors: true` 很可能就是为绕过这些而加的 | 不要直接删开关：先只把 `lib/video-*.ts` 加进 `scripts/typecheck.mjs` 显式清单，逐个模块收敛 |
| A7 去掉伪造 stats 会让「质量分/推荐」短期内缺少输入 | 现有排序依赖这些数字 | 缺失时降级为「无分数」分支，而不是回填随机数；同时在 UI 隐藏分数徽标 |
| B3 迁队列涉及中枢改动 | `jobs.ts` 已有锁与状态机，但视频任务的进度字段需要扩展 | 先只迁移"互斥 + 状态持久化"，进度字段可后补 |
| A4 关闭自动删除会让无效内容短期堆积 | 无人清理 | 改为「标记 + 进待审列表」，管理端加一键批量确认，保留可回滚 |

## 11. 本次未覆盖

- 前端交互与可访问性（`video-*.tsx` 共 40+ 组件）只看了数据流，未做交互审计
- `/videos/player` 播放器链路、P2P/离线缓存未深入
- 中枢 `recompute_rank` 任务的真实产出质量（决定 `/hot` 是否可信）— 建议单独排一轮

---

## 附：证据索引

| 编号 | 文件 | 行号 |
|---|---|---|
| P0-1 | `app/api/videos/ai-autonomous-harvest/route.ts` | 70-113 |
| P0-2 | `lib/video-multi-source-connector.ts` / `app/api/videos/webhook-harvest/route.ts` | 66-80, 199 / 13-15 |
| P0-3 | `app/api/cron/video-harvest/route.ts` / `cron/video-health-sweep/route.ts` | 24-35 / 19-29 |
| P0-4 | `app/api/videos/ai-summary/route.ts` / `lib/video-ai-summary.ts` | 6-40 / 227 |
| P0-6 | `app/api/cron/video-health-sweep/route.ts` | 8 |
| P0-7 | `lib/video-deadlink-sweeper.ts` | 148-158, 173-175, 222-249 |
| P0-8 | `app/api/videos/[id]/items/route.ts` | 58-63, 106-111, 154-159 |
| P1-9 | `lib/video-task-queue.ts` | 221, 258, 86, 50 |
| P1-10 | `lib/video-task-queue.ts` | 44-59, 138-141 |
| P1-11 | `lib/video-task-queue.ts` | 230-260 |
| P1-12 | `apps/api/src/storage.ts` | 457-459, 488-497 |
| P1-13 | `app/api/videos/ai-autonomous-harvest/route.ts` / `webhook-harvest/route.ts` | 90-92 / 87-89 |
| P1-14 | `lib/video-task-queue.ts` / `next.config.js` | 11, 31, 178 / 44 |
| P0-21..25 | `lib/video-trending-harvester.ts` / `lib/video-autonomous-ai-harvester.ts` | 33-249, 313-329 / 67-160, 188-261, 400-416 |
| P1-26 | `app/hot/page.tsx` / `app/hot/hot-view.tsx` | 39-51 / 237 |

---

## 12. 本次已实施的修复（2026-10-28 执行）

> 本节记录审计后**实际落地**的改动，与前面第 8 章的"建议"对应。
> 未标"已完成"的条目仍是待办。

### 12.1 已完成的 P0

| 编号 | 修复内容 | 关键文件 | 回归守卫 |
|---|---|---|---|
| A1 | `ai-autonomous-harvest` 的 GET/POST 补 `verifyAdminSession`；两个 cron 改为 `requireCronSecret`（未配置 = 503 fail-closed，取消 `?secret=` 通道，`timingSafeEqual` 比较） | `app/api/videos/ai-autonomous-harvest/route.ts`、`lib/cron-auth.ts`（新增） | `cron-auth.test.ts`（7 例）、`video-api-guards.test.ts` |
| A2 | 伪哈希换成真 HMAC-SHA256：定长 64 hex + `timingSafeEqual`；签名改为**必填**；默认密钥取消（未配置即 503）；改用 `await request.text()` 原始 body 验签 | `lib/webhook-signature.ts`（新增）、`lib/video-multi-source-connector.ts`、`app/api/videos/webhook-harvest/route.ts` | `video-evolution-v10.test.ts`（新增 4 条反例：密钥当签名 / 子串 / 截断 / 篡改 body）、源码守卫 |
| A3 | health-sweep 路径 `data/navigation.json` → `src/navsphere/content/videos.json`；落盘改用 `updatedData`（否则 prune 与 healthStatus 落不了盘） | `app/api/cron/video-health-sweep/route.ts` | 源码守卫（断言错误路径不再出现、断言写的是 `updatedData`） |
| A4 | 探活改三态 `healthy / dead / unverified`；超时、403/429/412、5xx 一律 `unverified` 且**不进删除分母**；`autoPrune` 默认改 `false` | `lib/video-deadlink-sweeper.ts`、`types/navigation.ts` | `video-health-tristate.test.ts`（10 例，含 404→dead、429→unverified、默认不删、显式开启也不删 unverified） |
| A5 | `[id]/items` 三处写盘改为 `{ ...data, navigationItems }`，不再抹掉 `replacementHistory` | `app/api/videos/[id]/items/route.ts` | 源码守卫（逐条断言三处 `JSON.stringify` 都展开 `...data`） |
| A6 | 删除无调用方的 `/api/videos/ai-summary`（无鉴权的 LLM 计费入口，调用方实际直连 lib） | 删 `app/api/videos/ai-summary/route.ts` | `grep ai-summary` 无路由引用 |
| A7 | 停止伪造数据：`stats` 不再用 `Math.random()` / 写死值；`publishedAt` 不再写 `new Date()`；`freshnessScore` 改由真实发布时间推导（缺失时按 `quality*0.8` 的保守值） | `lib/video-trending-harvester.ts`、`lib/video-autonomous-ai-harvester.ts`、`lib/video-harvester.ts`、`lib/video-ai-summary.ts` | `video-scoring-guard.test.ts` |
| A8 | 恢复类型契约：`VideoChapter` 补 `id/startTime/endTime/summary/codeLanguage`（两套字段超集）、`VideoQuizQuestion` 补 `correctAnswerIndex`；`HarvestRunReport` → `VideoHarvestReport`；评分函数抽到 `lib/video-scoring.ts` 断开 `video-harvester → github → auth → next-auth` 依赖链 | `types/navigation.ts`、`lib/video-quiz-generator.ts`、`lib/video-task-queue.ts`、`lib/webhook-notifier.ts` | 类型错误从 20+ 降到 0（`lib/` 侧）；`quote-dialog` 答对不再判错 |

**A8 的连带发现（已修）**：类型恢复后暴露两个被 `ignoreBuildErrors` 掩盖的真实故障——
1. `video-task-queue.ts` 读 `report.totalHarvested` / `totalRotated`（字段不存在）→ 管理端进度条永远是 `undefined`；
2. `webhook-notifier.ts` 整模块读一套**不存在的报告结构**（`dryRun`/`categoriesProcessed`/`summary.freshnessScoreAverage`/`details`），且格式化调用在 `try` 外、调用方是 `void …` → 只要配置 `HARVEST_WEBHOOK_URL` 就产生 unhandled rejection。

### 12.2 已完成的 P1

| 编号 | 修复内容 | 回归守卫 |
|---|---|---|
| B1 | 锁 owner 统一：`const lockOwner` 同时用于 acquire/release；`createTask` 抛错也释放；新增 `renewLock` 在进度更新时续租（防 TTL 到期后互斥失效） | 源码守卫（禁止 `releaseLock(task.id)`）+ 反向验证（回退后 2 条断言变红） |
| B2 | 新增 `.github/workflows/video-harvest.yml`：每 6 小时 + 手动触发，`concurrency` 互斥，缺 secret 直接失败，把 `degradedKeywords` 写进 job summary | YAML 就位；需配 `NAVHUB_SITE_URL` / `CRON_SECRET` 才会生效 |
| B4 | 乐观并发写：中枢 `PUT /api/storage` 接受 `ifVersion`，冲突返回 409；新增 `GET /api/storage/version`；`writeKv` 写入前比对 `updated_at`；采集主流程改为「实时读 + 带版本写」，409 时**整体重放**（重读→重算→重写，最多 3 次） | `apps/api/test` 1093 例全绿 |
| B5 | 写失败不再吞成成功：`ai-autonomous-harvest` / `webhook-harvest` 的 `commitFile` 失败直接 500 + `retryable: true` | 源码守卫 |
| B9 | 采集并发化：关键词池 + 并发 3 + 25s 总预算；每关键词独立计数（修掉跨关键词 `break` 导致的超额采集）；失败原因进 `degradedKeywords` | `video-scoring-guard.test.ts`、源码守卫 |

### 12.3 为解除提交阻塞而做的 a11y 整改

`apps/web-overlay/` 的任何改动都会让 pre-commit 选测 `apps/web/test` **整棵测试根**
（`.git/hooks/navhub-precommit-tests.mjs` 的 `ROUTES`）。该树当时有 8 例全仓守卫红灯，
它们全部落在视频模块：

| 守卫 | 存量问题 | 修法 |
|---|---|---|
| `clipboard-honesty` | 10 个组件直摸 `navigator.clipboard`，其中 3 处无条件 `setCopied(true)`（非安全上下文下凭空报喜） | 一律改走 `lib/clipboard` 的 `copyText`，只有 `result.ok` 才显示「已复制」 |
| `field-names` | 35 处 `<input>/<select>/<textarea>` 无 `aria-label`，也无 label 关联 | 逐个命名（「人声增益」「片段起始时间」「静音跳过阈值（分贝）」…） |
| `label-association` | 4 处 `<label>` 紧邻控件但无 `htmlFor` | 加 `htmlFor` + 控件 `id`，并移除重复 aria-label 避免覆盖标签文本 |
| `keyboard-activation` | `video-card` 根节点是 `<div role="button">`；3 处 `div onClick` 无键盘入口 | 主点击区改真 `<button type="button">`（右上角操作按钮移出，避免非法嵌套）；闪卡补 `aria-pressed`、热力图补 `role="slider"` + ←/→/Home/End、幻灯片补 `role="button"` + Enter/Space |
| `silent-catch` | 6 处空 `catch {}` 未说明理由 | 补理由（离线状态探测、mediaSession 清理、全屏请求、localStorage 配额），零行为变更 |
| `tw-source-coverage` | `app/api/{cron,media,og}`、`app/videos/{feed.xml,sitemap.xml}`、`src/contexts` 被 `.gitignore` 父级剪枝，独有工具类不生成 | `globals.css` 补 3 条 `@source` |

**`video-card` 的结构改动值得单独记一笔**：把它改成 `<button>` 会与内部的
「稍后再看 / 离线缓存」按钮形成嵌套 `<button>` —— 非法 HTML，浏览器会重排 DOM 并触发
hydration 告警。代码里 267 行那句注释「button 只允许 phrasing content」说明前人已经
踩过这个坑并退回 `div role="button"`。正确解法是把操作按钮移到主按钮**之外**的兄弟节点。

### 12.4 仍未实施（保留为待办）

| 编号 | 原因 |
|---|---|
| B3 迁到中枢作业队列 | 需要扩展 `jobs.ts` 的任务类型与进度字段，属于跨包重构；当前已用 B1+B4 把「同一进程互斥 + 跨实例版本冲突」堵住，风险已降级 |
| B6 B 站 wbi 签名 | 实测接口返回空（无 `w_rid`/`wts`）；签名算法需要抓 `nav` 接口取 key 后计算，无法在离线环境验证。当前已改为**失败可见**（`degradedKeywords`），不会再伪装成「没有结果」 |
| B7 列表分页 | 当前 16 条 / 44KB，未到瓶颈；接口形状变更会影响管理端三个页面，留给下一轮 |
| B8 LLM 摘要服务端缓存 | 复核后确认调用方都是客户端（`video-player-page` / `VideoPlayerContext`），已有 localStorage 缓存；真正的问题是死路由（A6 已删） |
| C1 候选池转可配置资产 | 需要 DB 迁移与新表 |
| A8 全量类型检查进 CI | `apps/web-overlay` 当前有 **21555** 个既有类型错误（`plugin-url-health-panel.tsx` 单文件 618 个），直接打开 `ignoreBuildErrors` 会全红。建议先按目录增量收敛（`lib/video-*` 已清零） |

### 12.5 验证记录

| 检查 | 结果 |
|---|---|
| `apps/web/test/video*` + 新增守卫 | **18 文件 / 220 例全绿**（基线为 14 文件 176 例，其中 2 例红） |
| 前端全量 `apps/web/test` | **212 文件 / 2398 例全绿**（整改前为 2390 通过 / 8 失败） |
| 中枢全量 `apps/api/test` | **112 文件 / 1093 例全绿** |
| `apps/api` 类型检查 | 通过（0 错误） |
| `apps/web-overlay` 类型检查（`lib/video-*` / `lib/webhook-*` / `api/videos/**`） | 0 代码错误（剩余 49 条均为 overlay 无 `node_modules` 导致的 `Cannot find module 'next/server'` 环境性报错） |
| `scripts/check-syntax.mjs` | 1357 文件 / 0 错误 |
| `scripts/check-web-overlay.mjs` | 863 文件一致 |
| 锁守卫反向验证 | 回退为 `releaseLock(task.id)` 后 2 条断言变红，恢复后转绿 |

### 12.6 提交记录

| commit | 内容 |
|---|---|
| `295a5ef0` | `feat(api)`：`PUT /api/storage` 支持 `ifVersion`（409 冲突）+ `GET /api/storage/version` |
| `c4fc505e` | `docs(video)`：本报告 + `.github/workflows/video-harvest.yml` |
| `de9a442a` | `fix(video)`：P0/P1 后端修复（20 文件）——鉴权、真 HMAC、cron fail-closed、路径、探活三态、保字段、去伪造、锁 owner、并发化、ifVersion 重放、类型契约 |
| `07d88fe8` | `fix(a11y)`：a11y 整改（34 文件）+ overlay 前端层首次纳入版本控制（115 文件） |
| `cb6d04ca` | `test(video)`：4 个新守卫 + 5 个既有测试对齐真实契约（9 文件） |

> overlay 目录长期半跟踪（`src/lib` 58 个、`src/components` 48 个文件从未进过索引），
> 因此 `07d88fe8` 的 115 个文件里大部分是**首次纳入**而非本次改动。`src/app`
> （含并行会话改动的 admin 页）与 `videos.json`（内容数据变更）未包含。

---

## 13. 第二轮增强：12.4 待办的处理结果

### 13.1 已完成

| 编号 | 内容 | 关键实现 |
|---|---|---|
| **C3** | 巡检并发化 | `sweepVideoHealth` 从串行 `for + await` 改为有界并发（默认 6，上限 10）。原来 30 条 × 3.5s = 最坏 105s，超过函数上限会出现「跑一半被掐断、状态只落一部分」 |
| **C4** | 运行期指标 | 新增 `lib/video-harvest-metrics.ts`，采集/巡检累计计数（runs / failed / added / replaced / degradedKeywords；healthy / dead / unverified / pruned）挂到 `GET /api/videos/harvest` 的 `runtime`；该端点同时补上管理员鉴权 |
| **C5** | 去重键与伪造内容 | 新增 `lib/video-identity.ts`，去重键统一 `platform:externalId`；webhook 平台由 `payload.source` 决定（原来一律 `bilibili`），去掉硬编码假 BV 号 `BV1whDefault`、三处共用 Unsplash 假封面、`isRunning`/`timer` 死字段；控制器改单例（`logs` 可跨周期累积） |
| **B6** | B 站 wbi 签名 | 新增 `lib/bilibili-wbi.ts`：nav 取 img/sub key → 置换表推 32 位 mixinKey → 参数排序 + `wts` 算 `w_rid`。密钥缓存 6h + inflight 去重；取不到时返回 null 并记 degraded（不静默降级）。**本机实测 `api.bilibili.com` 返回 `http=000`（连接不通），签名算法只能靠单测锁定确定性，无法在线验证** |
| **B7** | 列表分页与裁剪 | `GET /api/videos` 增加 `compact=1`（剥离 chapters/transcript）、`categoryId`、`limit`/`offset`；元信息走响应头 `X-Total-Items`，不改响应体形状 |
| **C1** | 候选池外部化 | 12 条候选移到 `src/navsphere/content/video-topics.json`（18KB），构建期读入；四条数据契约写进 `$schema` 与注释，由 v8 的结构性断言守住 |
| **C2** | 文案降级 | 「通过 AI 深度审核」→「已通过规则初筛（关键词 / 时长 / 互动加权）」；「【热点精选】」→「【精选】」（候选池是人工维护的静态选题，不是实时热榜） |
| **B3** | 任务状态持久化（渐进版） | 任务快照写 `data/video-harvest-tasks.json`（防抖 400ms + fire-and-forget），路由读取前 `hydrate()` 懒加载；上次残留的 `running`/`pending` 改判 `failed` 并注明「进程重启，任务中断」；过期锁不恢复 |

### 13.2 仍未做（明确不做的理由）

| 编号 | 理由 |
|---|---|
| **B3 完整版**（迁中枢 `jobs.ts`） | 需要扩展中枢任务类型与进度字段，属跨包重构。当前渐进版已解决「重启后看不到历史」，跨实例互斥由 `ifVersion` 兜住，剩余收益不足以承担重构风险 |
| **C6** `videos.json` 落关系表 | 需要 DB schema 变更 + 迁移脚本 + 双写过渡期 + 回滚方案，是独立的架构演进项。在一个提交流里改 schema 会让「数据迁移失败怎么办」无从回答。建议单独立项，前置条件：先补 PG 方言下的视频表迁移测试 |
| **A8** 类型检查进 CI | 全仓 **21555** 个既有类型错误（`plugin-url-health-panel.tsx` 单文件 618 个），视频 `lib/` 内也有 **37** 个既有分叉（`video-failover.ts` 用 `sourceId`/`label`，而 `VideoMirrorSource` 定义的是 `id`/`platform`/`href`）。直接开门禁必然全红。**收敛路径**：按目录增量修 → 每个目录清零后加入 `scripts/typecheck.mjs` 的显式清单，而不是一次打开 |

### 13.3 本轮顺带发现并修复

`video-autonomous-ai-harvester` 的 `items: [...cat.items]` 裸展开：`NavigationItem.items` 是可选字段，分类缺它时会在运行期抛 `undefined is not iterable`，整个采集周期中断（tsc 报 TS2488，被 `ignoreBuildErrors` 掩盖）。同一函数内其它地方都写了 `|| []`，唯独这里漏了。

### 13.4 第二轮提交

| commit | 内容 |
|---|---|
| `855bc48f` | C3/C4/C5/B6/B7（13 文件，含 3 个新 lib + wbi 单测 15 例） |
| `0c426d79` | C1 候选池外部化 + C2 文案降级（4 文件，含 18KB JSON 资产） |
| `a28ab928` | B3 渐进版：任务状态跨重启持久化（3 文件） |
| `f068b26b` | 修复分类条目裸展开（1 文件） |

验证基线：`apps/web/test` **213 文件 / 2413 例全绿**；`check-syntax` 1362 文件 0 错误；overlay 一致性 869 文件。

---

## 14. 第三轮：13.2「不做」三项的实际处理

### 14.1 A8 类型门禁 —— 改用「作用域化」而非直接开门禁

全仓 21553 个既有错误不可能一次清零，所以做了 `scripts/typecheck-video-scope.mjs`：
只对**已经清零的 16 个视频模块**断言 0 错误。新文件进清单的前提是自己先做到 0 错误；
已列入的退化立刻红 —— 这正好能防住 `HarvestRunReport` 那种「类型不存在却一路绿灯」。

- 排除 `app/api/**`：overlay 无 `node_modules`，`next/server` 解析不到（TS2307），
  那是环境问题；route 的类型由 `apps/web` 构建时兜住。
- 反向验证：向 `video-identity.ts` 注入 `const x: number = "a"` 后门禁报错退出 1，
  恢复后转绿。
- 顺带清掉清单内 8 个错误，其中两处是真缺陷：
  - `VideoConfig.type` 缺 `'custom'` → `video-deadlink-sweeper` 里 `config.type || 'custom'`
    的兜底分支永远不可达，等于「非 B 站/YouTube 内容无处可放」；`sourceType` 缺 `'webhook'`。
  - `webhook-notifier` 的飞书卡片仍读 `report.dryRun` / `report.totalRotated`（都不存在）
    → `undefined > 0` 为 false，「有替换」的通知永远走蓝色模板。改为
    `totalReplacedCount`，并给报告补上真实的 `dryRun`。
- 用法：`node scripts/typecheck-video-scope.mjs` 或 `pnpm typecheck:video`。

### 14.2 C6 关系表 —— 基础设施落地，不切换事实源

新增三张表（两种方言各一份 DDL）+ `repository/videos.ts` 的六个原语：
`replaceVideoCatalog` / `listVideoItems` / `getVideoItem` / `countVideoItems` /
`logVideoReplacement` / `listVideoReplacements`。

设计要点：
- 列只放可过滤/可排序字段（platform、external_id、health_status、quality_score…）；
  章节树与逐句字幕放 `payload`，避免「查一个健康状态要解析几十 KB」。
- 唯一索引是 `(platform, external_id) WHERE external_id IS NOT NULL` ——
  外部 ID 只在同平台内唯一，这正是「只比 bvid 就判重」会出错的地方。
- 全量替换在事务内完成，中途失败不留「分类已删、条目没写」的半截状态。

**没有切换读写**：JSON 仍是唯一事实源，表是影子副本。切换需要「数据导入 + 双写过渡 +
读路径灰度 + 回滚方案」四件事，在当前 16 条规模下收益不足以承担风险。前置条件已就绪。

### 14.3 B3 完整版 —— 明确不做，以及为什么

「迁到中枢 `jobs.ts`」的真实含义是**把采集执行搬到中枢**，因为 `jobs` 的 JobRunner
在中枢进程里。但采集逻辑（B 站 wbi 签名、YouTube oEmbed、轮播淘汰算法）在 Next 应用里，
搬过去等于跨应用重构，且会失去 Next 侧的类型与测试覆盖。

真正合理的分工是「采集留在 Next，中枢只提供任务登记与锁」—— 那正是 B3 渐进版
（快照 + `hydrate`）在做的事，只是存储从 KV 文档换成了 `jobs` 表。换成 `jobs` 表的收益是
「跨副本可见 + 复用既有 lease 机制」，代价是改 `video-task-queue` 的全部方法签名
（现在测试大量依赖同步 API）。在当前规模下不值得。

### 14.4 第三轮提交

| commit | 内容 |
|---|---|
| `66071cbb` | A8：作用域化类型门禁 + 清单内 8 个错误清零（7 文件） |
| `2ecabc43` | C6：视频关系表 DDL + 仓储原语 + 10 例测试（5 文件，含 935 行） |

验证：`apps/web/test` 213 文件 / 2413 例；`packages/store/test` 48 文件 / 355 例；
`apps/api/test` 112 文件 / 1093 例；`packages/store` tsc 0 错误；
`node scripts/typecheck-video-scope.mjs` 16 模块 0 错误。

> 附带：`packages/store/src/data-inventory.ts`（既有模块，6.7KB）一直被 `index.ts`
> 导出但从未进索引，pre-commit 的依赖检查因此拦下 C6 提交 —— store 包与 overlay
> 一样存在「半跟踪」，这次一并补齐。

---

## 15. 第四轮：把 14 章的三个「阶段成果」推到闭环

### 15.1 A8 类型门禁 —— 从 16 个模块扩到 23 个，`lib/video-*` 全部清零

上一轮只把 16 个模块纳入门禁，剩下的 `lib/video-*` 里还有 **29 处**类型分叉。
本轮逐个修完：

| 模块 | 处数 | 真实后果 |
|---|---|---|
| `video-failover.ts` | 13 | `VideoMirrorSource` 声明的是 `{platform,id,href,title?,author?}`，代码读写的是 `sourceId`/`label`/`priority`/`isDirectStream`；`href` 被声明为必填却**从未被任何代码读过**，也没人填 |
| `video-slide-detector.ts` | 7 | BigInt 字面量（`0n`）在 `target: es2017` 下报 TS2737 |
| `video-spaced-repetition.ts` | 4 | 见下（两处功能失效） |
| `video-scrubber-filmstrip.ts` | 2 | `VideoChapter.startTime` 变可选后仍直接参与算术 |
| `video-code-diff.ts` | 1 | 同上：里程碑 `timeSec` 取 `ch.startTime` → `undefined` |
| `video-concept-graph-navigator.ts` | 1 | 同上：章节跳转 `seekSec` 为 `undefined` |
| `video-offline-storage.ts` | 1 | TS 5.7 起 `Uint8Array<ArrayBufferLike>` 不满足 `BufferSource` |

**两处是真的功能失效，不只是类型洁癖**：

1. **所有自测题闪卡的答案是错的**。`generateFlashcardsFromQuizzes` 把 `options`
   当 `{ isCorrect, label }` 对象读，而它的类型是 `string[]` —— `find()` 永远返回
   `undefined`，于是每张卡的答案都是兜底值「查看详解」。同一函数还读了不存在的
   `q.title`（应为 `q.question`）。改用 `quizCorrectIndex(q)`。
2. **章节跳转与代码对照的时间点是 `undefined`**。采集器写入的章节只有 `timeSec`，
   而这三处只读 `startTime`。统一改走 `chapterStartSec()`（`timeSec ?? startTime ?? 0`）。

修法上有一条边界值得记：`VideoMirrorSource.href` 改成可选，但**没有**顺手让
「只有 href、没有 sourceId」的线路也能进列表 —— `videos.json` 里 `mirrors` 目前
是 **0 条**，那是潜在功能，没有真实数据支撑的行为改动属于投机。

**`tsconfig.json` 的 target 从 `es2017` 改成 `ES2022`**：`es2017` 是 Next 模板残留，
而仓库根 `tsconfig.base.json` 是 `ES2022`，应用只跑现代浏览器与 Node 18+。
改完 `apps/web/tsconfig.json`（vendored）也随之同步。

### 15.2 一个会让门禁假红/假绿的问题

overlay 的 tsconfig 开着 `incremental: true`，会在
`apps/web-overlay/tsconfig.tsbuildinfo` 留下缓存。实测：**改完 target 后仍报原来的
7 处 BigInt 错误**，删掉 tsbuildinfo 重跑是 0 错误。

也就是说，同一个门禁在陈旧缓存下可能给出相反结论。现在 `typecheck-video-scope.mjs`
固定传 `--incremental false`。反向验证：注入 `const p: number = "x"` →
打印 1 处错误且 **exit=1**，恢复后转绿。

### 15.3 C6 关系表 —— 读写切换落地（三档模式）

第 14 章只建了表和原语，表里没有数据、也没有写入路径 —— 相当于「备好了但没通电」。
本轮接上：

| `NAVHUB_VIDEO_STORE` | 写 | 读 |
|---|---|---|
| `json`（默认，不配就是它） | 只写 KV 文档 | KV 文档 |
| `dual` | KV + 关系表 | KV 文档 |
| `db` | KV + 关系表 | 关系表（空表回落 KV） |

三个刻意的决定：

1. **任何模式都继续写 KV 文档。** 它是回滚快照：环境变量改回 `json` 就是完整回滚，
   不需要反向导入，这期间采集到的内容也不会丢。
2. **影子表写失败不阻断正本写入。** 事实源是文档，表是副本；让副本故障把
   `PUT /api/storage` 打成 500 是把主次搞反。失败记进 `videoCatalogSyncState()`
   （`lastSyncError` / `consecutiveFailures`），由 `--check` 与运维发现。
3. **`db` 模式下空表回落 KV。** 判据是「条目数为 0」而非「分类数为 0」——
   迁移中途失败会留下「有分类没条目」的状态，那种状态读出来是「所有分类都是空的」，
   比回落更糟。

映射上的三个细节：

- `payload` 存**完整原始条目**（`{ item, sub }`）而不是 `videoConfig`：列只承担
  「可过滤 / 可排序」的投影职责，重建一律以 payload 为准，将来列增删不会让
  round-trip 丢字段。
- 子分类元数据（id/title/icon）跟着条目 payload 走 —— 表里没有 sub_category 表，
  但重建必须还原子分类结构。
- `video_items.id` 是主键，而文档里同一 id 出现在两个分类下是可能的（复制粘贴类目）。
  压平时对重复 id 加 `#2` 后缀，避免一条重复让整批 INSERT 失败。

**已知边界（写进 `docs/VIDEO-CATALOG-MIGRATION.md`，不当 bug）**：
`replacementHistory` 的 `subCategoryId`/`subCategoryTitle` 没有对应列，不 round-trip
（当前库该数组 0 条）；单次读取上限 500 条，超过时**回落文档**而不是截断；
`db` 模式不做按条写合并（写入仍是整包 + 全量替换表）。

### 15.4 B6 wbi 签名 —— 找到离线可验证的锚点

第 13 章把 B6 记为「无法在线验证」。这次先把「为什么」测清楚：

```
https://www.bilibili.com    http=000  time=0.08s
https://api.bilibili.com    http=000  time=0.04s
https://example.com         http=200  time=2.78s
https://www.baidu.com       http=200  time=0.77s
```

DNS 正常（`api.bilibili.com` → 111.19.247.x），但 TCP 连接**瞬间被重置**
（0.04s，不是超时）—— 是网络策略拦截 B 站，不是代码问题，也不是风控。

于是换了个思路：`bilibili-API-collect` 的 WBI 文档给出了一组公开样例
（多份独立实现引用同一组值）：

```
img_key   = 7cd084941338484aae1ad9425b84077c
sub_key   = 4932caff0ff746eab6f01bf08b70ac45
mixin_key = ea1db124af3c7062474693fa704f4ff8
```

跑 `getMixinKey()` 结果**完全一致**，已固化为断言。这条的价值在于：原有那几条
（长度 32 / 十六进制 / 前三位对应第 46、47、18 位 / 同输入同输出）在有人把置换表
末尾几个数字调换顺序时**全部仍会通过**，而签名已经废了 —— 只有样例向量能发现。

**仍未验证（如实记录，不当「已完成」）**：
- 服务端是否接受该签名（需要能访问 B 站）
- `w_rid` 的端到端正确性（公开资料只有 `mixin_key` 这一步的样例，没有 `w_rid` 向量）
- 风控阈值（频率限制、是否需要 cookie / `bili_ticket`）

### 15.5 顺带复核：热点榜单页没有同类问题

原始需求里的「智能热点采集中心」在代码里对应两处：采集链路（`video-trending-harvester`
/ `video-autonomous-ai-harvester`，前几轮已修）与站内榜单页 `/hot`。
后者复核结论：`app/hot/page.tsx` 服务端取数（`hubGet`，带 `AbortSignal.timeout` +
`catch` 降级）、`revalidate=60` 与中枢 `/api/rank/*` 的 maxAge 对齐、失败时把
`degraded` 传给客户端岛，**无硬编码 / 无 `Math.random` 伪造**。不需要改动。

### 15.6 本轮提交

| commit | 内容 |
|---|---|
| `276c51fa` | `fix(video)`：清零剩余 29 处类型分叉，门禁 16 → 23 个模块，tsconfig target → ES2022，新增 `video-type-contract.test.ts`（10 例） |
| `e271cc48` | `feat(api)`：视频库关系表读写切换（三档模式 + 导入 CLI + 灰度手册），新增 13 例测试 |
| `f47a9e0d` | `test(video)`：用公开样例锚定 wbi 置换表 |

### 15.7 验证记录（本轮）

| 检查 | 结果 |
|---|---|
| `apps/web/test` 全量 | **214 文件 / 2423 例全绿**（本轮起点 213 / 2413） |
| `apps/api/test` 全量 | **113 文件 / 1106 例全绿**（起点 112 / 1093） |
| `packages/store/test` | **48 文件 / 355 例全绿** |
| `scripts/typecheck.mjs` | 5 个包通过（16.8s） |
| `apps/api` + `packages/store` ESLint（`--max-warnings 0`） | exit 0 |
| `scripts/typecheck-video-scope.mjs` | **23 模块 0 错误**；反向验证 exit=1 |
| `scripts/check-bundle-budget.mjs` | 全部路由在预算内 |
| `scripts/check-web-overlay.mjs` | 871 文件一致 |
| C6 CLI 端到端（临时库，不碰开发库） | 空库退出 2；`--check` 退出 1 并列出缺失项；导入 `2 分类 / 3 条目`；导入后一致；`db` 模式读出的结构与 `json` 完全一致 |

> 环境说明：`node scripts/verify.mjs` 的「后端 lint」步骤在本机失败，原因是
> **该 shell 里没有 `pnpm`**（`'pnpm' 不是内部或外部命令`），不是 lint 本身的问题。
> 已按 `lint:backend` 的实际命令（`eslint . --max-warnings 0`）在
> `apps/api` 与 `packages/store` 分别复跑，两者 exit 0。

---

## 16. 第五轮：性能三项 + 33 项清单逐条对账

### 16.1 P1-16 `/videos` 从 `force-dynamic` 改成 ISR

改造前：

```ts
export const dynamic = 'force-dynamic'
async function getData() { /* 每次请求两次 getFileContent */ }
```

`getFileContent` 的读链路本来就带 Next Data Cache（`revalidateFromEnv`，默认 60s），
`force-dynamic` 把这一层**整个废掉** —— 每个请求都要打一次中枢，而读到的东西最多只差
60 秒。同类的 `/hot` 早就用的 `revalidate = 60`，没有道理一半 ISR 一半动态。

改成：

- `export const revalidate = 60`（与 `NAVHUB_STORAGE_REVALIDATE_S` 默认值对齐）；
- `getData` 用 React `cache()` 包一层：`generateMetadata` 与页面组件各调一次，
  合并成**同一请求内一次读取**。Data Cache 命中时本来也不贵，但两条链路各自 await
  会让首字节多等一轮调度；一旦适配器冷却降级，重复调用就是双倍失败重试。

元信息不会「固化在构建产物里」：`generateMetadata` 在每次再生成时都会重跑。
遗留口径：若把 `NAVHUB_STORAGE_REVALIDATE_S` 设为 0（要求改完立刻可见），
页面仍会有 60s 的 ISR 窗口 —— Next 要求 `revalidate` 是静态字面量，读不了环境变量。

### 16.2 P2-30 替换历史上限从「静默丢弃」改成「可观测丢弃」

原来是一行裸的 `slice(0, 100)`：第 101 条起**静默消失**，运营想回滚两周前的替换时
才发现记录没了，日志里也没有任何痕迹。

现在抽成 `capReplacementHistory()` + `REPLACEMENT_HISTORY_LIMIT`，丢弃时打日志并带上
条数，注释里写清三条：为什么必须有上限（每条内嵌 oldItem/newItem，单条 6–10KB，
整包参与每次读取）、为什么必须告警、以及「完整历史在 `video_replacements` 表里
（C6），所以永久丢失只在纯 `json` 模式下成立」。

**落地说明**：这段改动在 `lib/video-harvester.ts`，而同一文件里并行会话正在做
「替换历史外置到独立文件」（`appendReplacementHistory` + 不截断的权威副本）。
对方的外置方案其实**比容量上限更彻底** —— 内联数组受限、独立文件不截断，
两者配合才完整。因此这两处必须一起提交，本轮的提交不单独带上 `video-harvester.ts`。

### 16.3 P2-33 搜索倒排索引改为懒构建

`buildVideoSearchIndex(navigationData)` 原来在**每次进页面**时都跑一遍
（遍历全部分类/子分类/条目、拆 CJK bigram、累计词频），而绝大多数访问只浏览不搜索。

改成 `hasQuery` 为真时才建。依赖用布尔 `hasQuery` 而不是 `searchQuery`：
一次搜索会话里它从 false 变 true 后不再翻转，因此「输入框反复增删字符」不会重复构建。

### 16.4 P1-18 明确不做，以及触发条件

「`video-content.tsx` 全量 `map` 渲染，无分页/虚拟化」。当前视频库 **16 条**，
首屏 DOM 与 RSC 体积都没有问题。这一项不动，理由与触发条件写清楚：

- 触发条件：某个分类条目数 > 60，或整库 > 200；
- 届时的做法不是加虚拟列表（会破坏 SEO 内链与 Ctrl+F），而是复用首页已经验证过的
  **渐进披露**（每组首屏 N 张 + 「展开全部」客户端揭示，零请求），
  它已经有现成的守卫测试（`deliverables/web-audit/verify-progressive-disclosure.mjs`）。

### 16.5 两项复核结论（不改代码）

| 编号 | 原文结论 | 复核结果 |
|---|---|---|
| P1-17 | 服务端 `getStorage()` 返回 `null`，冷启动即失效 → 每次播放打一次 Gemini | `getVideoAISummary` 的调用方是 `video-player-page` 与 `VideoPlayerContext`（都是客户端组件），走的是浏览器 localStorage 缓存。服务端那条路径根本不存在 —— 原文把「lib 里有个 Map 兜底」误当成服务端链路。真问题是同目录的死路由，已由 A6 删除 |
| P2-28 | `parseDurationToSeconds(durationStr?: string)` 内部判 `typeof === 'number'`，与签名矛盾 | 抽取 `video-scoring.ts` 时签名已改为 `string \| number`，两条路径（B 站 `"MM:SS"` 与 view 接口的 number）都覆盖 |

### 16.6 33 项清单逐条对账

> 原文编号并非严格连续（`P1-5` 夹在 `P0-4` 与 `P0-6` 之间）。这里按实际存在的 33 项核对。

| 编号 | 问题 | 状态 | 落点 |
|---|---|---|---|
| P0-1 | 自主采集接口完全无鉴权 | 已修 | §12.1 A1 |
| P0-2 | Webhook 签名是伪实现且可绕过 | 已修 | §12.1 A2 |
| P0-3 | Cron 端点 fail-open | 已修 | §12.1 A3（`cron-auth.ts`） |
| P0-4 | LLM 摘要接口无鉴权且是死代码 | 已修 | §12.1 A6（删除） |
| P1-5 | 审计/回滚读接口无鉴权 | 已修 | `api/videos/history` 已加 `verifyAdminSession` |
| P0-6 | 健康巡检写错目标文件 | 已修 | §12.1 A3 |
| P0-7 | 一次探测失败即永久删除 | 已修 | §12.1 A4（三态 + 默认不删）；并行会话又加了「连续失败 2 次」阈值 |
| P0-8 | 单条增删改清空替换历史 | 已修 | §12.1 A5 |
| P1-9 | 租约锁 owner 不匹配 | 已修 | §12.2 B1 |
| P1-10 | 「分布式租约锁」是内存单例 | 部分 | §12.2 B1（`renewLock` 续租）+ B3 渐进版；真正的跨实例租约见 §14.3 的取舍 |
| P1-11 | 后台任务在 Serverless 不可靠 | 部分 | §12.2 B3（快照 + `hydrate`）；完整版迁 `jobs` 表明确不做（§14.3） |
| P1-12 | 读-改-写无并发控制 | 已修 | §12.2 B4（`ifVersion` + 409 + 整体重放） |
| P1-13 | 写失败被吞成成功 | 已修 | §12.2 B5 |
| P1-14 | 类型契约断链被构建配置放行 | 已修 | §12.1 A8 + §15.1（29 处清零，门禁 23 模块） |
| P1-15 | 列表无分页、无字段裁剪 | 已修 | §13.1 B7 |
| **P1-16** | `force-dynamic` + 同请求两次取数 | **已修** | §16.1 |
| P1-17 | 服务端摘要缓存缺失 | 复核不改 | §16.5 |
| P1-18 | 全量 `map` 渲染无虚拟化 | 明确不做 | §16.4（阈值 + 渐进披露方案） |
| P2-19 | 关键词串行采集 | 已修 | §12.2 B9（并发 3 + 25s 预算） |
| P2-20 | 探活串行 | 已修 | §13.1 C3（并发 6） |
| P0-21 | 候选池是 12 条硬编码 | 已修 | §13.1 C1（外部化 JSON 资产） |
| P0-22 | 播放量/点赞是随机数 | 已修 | §12.1 A7 |
| P0-23 | 伪造发布时间 | 已修 | §12.1 A7 |
| P0-24 | 「AI 审核」是正则与模板 | 已修 | §13.1 C2（文案降级为「规则初筛」+ 修中文误杀；不再声称 AI） |
| P0-25 | 没有任何调度器触发采集 | 已修 | §12.2 B2（`.github/workflows/video-harvest.yml`） |
| P1-26 | `/hot` 与视频热点是两套热度 | 已修 | §13.1 C2（文案）+ §15.5（`/hot` 复核无伪数据） |
| P2-27 | 死字段 + 控制器每请求新建 | 已修 | §13.1 C5 |
| P2-28 | `parseDurationToSeconds` 签名矛盾 | 已修 | §16.5（抽取时改 `string \| number`） |
| P2-29 | 全 `console.warn`，无指标 | 已修 | §13.1 C4（运行期指标）+ 并行会话的 `videoLog` 结构化 |
| **P2-30** | 替换历史硬截断 100 条 | **已修**（随并行会话的历史外置同批落地） | §16.2 |
| P2-31 | 非 B 站来源塞同一个假 BV 号 | 已修 | §13.1 C5 |
| P2-32 | 全库共用同一张 Unsplash 封面 | 已修 | §13.1 C5 |
| **P2-33** | 客户端倒排索引全量重建 | **已修** | §16.3 |

统计：**已修 28 项、部分修 2 项（P1-10 / P1-11，均有明确取舍记录）、复核不改 1 项
（P1-17）、明确不做 1 项（P1-18，带触发条件）、待并行会话落地 1 项（P0-7 的阈值增强）**。

### 16.7 与并行会话的交界（必须知道）

本轮收尾时检测到另一个会话正在同一批文件上活跃编辑（`video-library-store.ts`、
`video-log.ts`、`video-pagination.ts`、`video-write-guard.ts` 四个新文件尚未入索引，
`video-deadlink-sweeper.ts` 在 40 秒前刚被改过）。他们做的是 P1-5 的读接口收敛、
P2-29 的结构化日志、以及「连续失败两次才删」的阈值增强 —— 并且**引用了本轮的
`capReplacementHistory`**，说明两边在互相叠加。

因此本轮的 `§16.1`–`§16.3` 三项改动在文件层面已就位并通过 `typecheck:video`
（23 模块 0 错误）与视频测试（19 文件），但**提交要等对方收尾**：pre-commit 会跑
`apps/web/test` 整棵根，而当前工作区里有两个由对方 WIP 引起的红灯
（`video-health-tristate` 仍按「一次失败即删」断言、`video-library-store.ts` 有两处
未写理由的空 `catch`）。这两条都不属于本轮改动范围，硬改会覆盖对方正在写的文件。

处理原则（与 §12.3 一致）：**不修别人的业务分支、不把别人的 WIP 混进自己的提交**，
等对方完成后只提交自己那几个文件。
