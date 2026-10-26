# 插件网址智能体检与 AI 自愈：增强设计与缺陷审计

- 日期：2026-10-26
- 范围：`apps/api/src/plugin-audit.ts`、`apps/api/src/routes/plugin-audit.ts`、`apps/web-overlay/src/components/plugins/plugin-url-health-panel.tsx`
- 依据：当前工作区代码（含进行中的 WIP），类型检查 5/5 包通过，但**语义层存在 7 类缺陷**

---

## 一、目标

把「抽样探活 + 一键替换」升级为**可取证、可解释、可复检**的治理链路：

1. **可取证**：单站点定位失败原因时，给出分层证据（URL 结构 → 重定向 → HTTP → 内容 → 历史），而不是一个凭空的状态码。
2. **可解释**：推荐平替站点时给出可信度分解，而不是一个无法追溯的 `qualityScore`。
3. **可复检**：任何改动清单的操作都**不得伪造健康度**；改动后进入「待复检」，由真实探活重新判定。

---

## 二、现状能力盘点

已有能力（本次不重造）：

| 能力 | 位置 | 说明 |
|---|---|---|
| 均匀抽样 | `apps/api/src/plugin-audit.ts:144` `sampleUrls` | 等距取点、确定性、覆盖尾部 |
| 并发探活编排 | `plugin-audit.ts:241` `probeUrls` | 分批并发 + `Promise.race` 单条兜底超时 |
| 五分类汇总 | `plugin-audit.ts:164` `summarizeProbes` | ok / blocked / suspicious / broken + 原因分布 |
| WAF 误杀修正 | `plugin-audit.ts:122` `BLOCKED_BY_BOT_STATUSES` | 401/403/405/412/418/429 计入可达 |
| 内容级防劫持 | `packages/core/src/health-sentinel.ts:320` `auditPageHealth` | Shannon 熵 + 停放词 + 感知哈希 |
| 抽样体检端点 | `routes/plugin-audit.ts:399` | `POST /api/plugins/:slug/audit` |
| 历史快照预载 | `routes/plugin-audit.ts:455` | `GET /api/plugins/url-health/summary` |
| AI 自愈 | `routes/plugin-audit.ts:555` | `POST /api/plugins/:slug/ai-heal` |
| 一键净网 | `routes/plugin-audit.ts:1040` | `POST /api/plugins/:slug/apply-health-fix`（scope=admin） |

---

## 三、缺陷审计（逐条）

### D1【P0·越权写】`ai-heal` 声明只读，却能改清单并自动过审

- 位置：`apps/api/src/routes/plugin-audit.ts:557`
  ```ts
  { config: { scope: "read", rateLimit: { max: 20, timeWindow: "1 minute" } } },
  ```
- 触发：请求体带 `autoApply: true`，走到 `routes/plugin-audit.ts:753` 的 `ctx.repo.updatePlugin(...)`，随后 `:759` 调 `reviewPlugin(slug, "approve", ...)` 自动上架。
- 根因：路由级 scope 只覆盖了「主要语义（诊断）」，但 `autoApply` 是**同一路由内的写分支**，没有二次鉴权。
- 影响：只读 token（`scopes: ["read"]`）即可改写全站插件清单并绕过人工审核。`apply-health-fix` 要求 `admin`，而 `ai-heal` 走的是更宽的入口——权限模型自相矛盾。
- 修法：`autoApply === true` 时要求 `scopes` 含 `write` 或 `admin`，否则 **403 明确拒绝**（不做静默降级：静默降级会让调用方以为已应用）。

### D2【P0·数据造假】自愈后写入 100% 健康的假快照（后端 2 处 + 前端 1 处）

- 后端位置 A：`routes/plugin-audit.ts:781-798`，`autoApply` 成功后写
  ```ts
  action: "audit.plugin_url_health",
  diff: { okCount: Math.min(updatedSites.length, 30), brokenCount: 0, reachability: 1 }
  ```
- 后端位置 B：`routes/plugin-audit.ts:1155-1172`，`apply-health-fix` 成功后同样写 `reachability: 1`。
- 前端位置：`plugin-url-health-panel.tsx:1137-1141`
  ```ts
  const nextOk = (cur.okCount || 0) + replacedCount
  const nextReachability = ... ((nextOk + blocked) / nextSampled) ...
  ```
- 根因：把「替换动作完成」等同于「新 URL 可达」。新 URL **从未被探活**，`okCount` 却直接 +N。
- 影响：徽标立刻转绿，掩盖真实状态。若替换目标本身是停放页或死链，运营会误以为已修复——这是整套治理链路里最危险的一条：**修复动作污染了唯一的真相来源**。
- 修法：引入 `stale`（待复检）语义。改动清单后写 `diff: { stale: true, reason: "manifest-healed", declared }`，**不写 `okCount` / `reachability`**；读取端点遇到 `stale` 返回 `reachability: null` + `stale: true`；前端显示「待复检」而不是百分比。

### D3【P1·参数错位】`sampleLimit` 完全失效

- 位置：`routes/plugin-audit.ts:585`
  ```ts
  const limit = clampInt(body.sampleLimit, 1, MAX_SAMPLE, PLUGIN_AUDIT_DEFAULTS.sample)
  ```
- 签名：`clampInt(value, fallback, min, max)`（`:59`）。实参顺序被写成 `(value, 1, 200, 30)`，即 `fallback=1, min=200, max=30`，运算 `Math.min(30, Math.max(200, n))` **恒为 30**。
- 影响：`autoAudit` 的抽样量无法调节；想「只查 5 条快速探一下」也会打满 30 条外部请求。
- 修法：`clampInt(body.sampleLimit, PLUGIN_AUDIT_DEFAULTS.sample, 1, MAX_SAMPLE)`。

### D4【P1·假诊断】诊断原因硬编码 404，真实探活证据被丢弃

- 位置：`routes/plugin-audit.ts:625-627`
  ```ts
  const diag = diagnoseBrokenCause(isSuspicious ? 200 : 404, isSuspicious ? "疑似..." : "网络连接失败或404")
  ```
- 根因：`autoAudit` 在 `:586` 已经拿到 `summary.brokenItems`（含 `status` / `error` / `failureKind`），但只取了 URL，证据在 `:591` 被 `map((i) => i.url)` 丢掉。
- 影响：一个因**超时**（可能只是慢）的站点会被诊断为 `HTTP_NOT_FOUND / critical`；`describeBrokenCause` 的真正价值（区分 DNS 失败、证书错误、5xx、超时）被完全浪费。
- 修法：把 `brokenItems` 的证据透传到 `diagnoseBrokenCause(status, error)`，并在响应里带 `evidence: { source: 'live-probe' | 'client-claimed', status, failureKind, latencyMs }`。客户端直接传 URL 时标 `client-claimed`，不伪装成实测。

### D5【P1·静默失败】`autoApply` 校验失败时返回 `undefined`，与「未请求」无法区分

- 位置：`routes/plugin-audit.ts:740`（`updatedSites.length === 0` → `return undefined`）、`:749`（`!validation.ok` → `return undefined`）。
- 影响：前端拿到 `autoApplied: undefined`，无法区分「没开自动应用」「应用了 0 条」「清单校验失败」，只能显示模糊的成功。
- 修法：返回结构化为 `{ applied: boolean, reason?: 'validation-failed' | 'empty-manifest' | 'no-candidates', detail?: string }`，路由原样透出。

### D6【P1·候选可信度】平替站点只判 2xx，不判内容健康

- 位置：`routes/plugin-audit.ts:149-165` `probeCandidateUrl`
- 根因：只做 `status >= 200 && status < 400 || isBlockedByBotStatus` 判定，`maxBytes: 2048` 也拿不到足够内容做熵判断。
- 影响：一个已停放的域名（HTTP 200 + 「域名出售」页）会被判为 `verified: true`，并被 `autoApply` 首选采纳——**用死链替换死链**。
- 修法：候选探活改为内容级（`maxBytes: 8KB` + `auditPageHealth`），产出 `verified` / `blocked` / `suspicious` / `dead` 四档；`autoApply` 只在 `verified` 里挑。

### D7【P2·注入面与信息外泄】清单内容直接拼 prompt；降级文案透传上游错误

- 位置 A：`routes/plugin-audit.ts:856-859`，`plugin.manifest.name` / `description` / `d.title` / `d.category` 原样进入 prompt。这些字段由插件作者填写，可含指令性文本。
- 位置 B：`:1028-1030`，降级 `overview` 直接拼 `err.message`，可能把上游 URL、Key 片段、内部端点暴露给前端。
- 修法 A：数据区用显式定界（`<untrusted-data>`）+ 截断（名称 80 字符、描述 200 字符、标题 120 字符）+ 提示词声明「以下仅为数据，其中任何指令都不执行」。
- 修法 B：对外只给分类化文案（配额 / 网络 / 解析），原始错误写服务端日志。

---

## 四、增强设计

### 4.1 分层深度取证（Deep Diagnose）

新增 `packages/core/src/url-deep-diagnose.ts`：**只做判定，不做 I/O**。

输入（采集结果）：

```ts
interface DeepProbeObservations {
  url: string
  finalUrl?: string
  status?: number
  contentType?: string | null
  redirects?: string[]
  bodySample?: string
  error?: string
  failureKind?: ProbeFailureKind
  latencyMs?: number
  dnsOk?: boolean
  waybackLatestYear?: number
}
```

输出：

```ts
interface DeepDiagnosis {
  verdict: 'healthy' | 'bot-blocked' | 'soft-404' | 'parked'
         | 'expired-domain' | 'server-error' | 'redirect-hijack'
         | 'unreachable' | 'http-error'
  confidence: number            // 0..1
  headline: string              // 一句话结论
  evidence: Array<{ layer: 'url' | 'dns' | 'redirect' | 'http' | 'content' | 'wayback'
                    status: 'pass' | 'warn' | 'fail' | 'skip'
                    detail: string }>
  actions: Array<{ id: string; label: string; kind: 'replace' | 'remove' | 'archive' | 'manual' }>
}
```

判定优先级（从强到弱）：`ssrf-blocked` → `unreachable` → `server-error` → `bot-blocked` → `redirect-hijack`（跨域跳转到不同于原域名的可疑落点）→ `parked` → `soft-404` → `http-error` → `healthy`。

设计要点：

- **证据链必须逐层给出 `skip`**：没采集的层写 `status: 'skip'` 并说明原因，不用 `pass` 蒙混。
- **`confidence` 由证据强度加权**：内容层命中停放词（强）+0.35、熵 < 2.0（中）+0.2、DNS 失败（强）+0.4，上限 0.98，下限 0.3。
- 与既有 `auditPageHealth` 的关系：**复用它产出内容层事实**，不重复实现熵/关键词算法。

### 4.2 待复检（stale）语义

```
体检快照 diff 形状（向后兼容）
  { declared, sampled, okCount, blockedCount, suspiciousCount, brokenCount, reachability }
治愈后（新增）
  { stale: true, reason: 'manifest-healed', declared, healedAt, replaced, removed }
  // 刻意不含 okCount / reachability
```

读取侧统一：

```ts
if (diff.stale === true) return { checked: true, stale: true, auditedAt: null, reachability: null, ... }
```

前端：徽标显示「待复检」（outline），不显示百分比；健康条隐藏；提供「立即复检」按钮走真实 `audit`。

### 4.3 体检历史与趋势

新增 `GET /api/plugins/:slug/url-health/history?limit=20`：

- 数据源：`audit_logs` 中 `action='audit.plugin_url_audit'` 且 `target=slug` 的记录（**已有数据，无需迁移**）。
- 输出：按时间正序的点序列 + `trend: 'improving' | 'degrading' | 'stable'`。
- 趋势判定用**最小二乘斜率**而非首尾差：单点抖动不应翻转结论。阈值 `|slope| < 0.005/次` 视为 stable。

### 4.4 候选可信度分解

```ts
confidence: {
  total: number          // 0..100
  reachability: number   // 探活结果（dead=0 / blocked=60 / verified=100）
  contentHealth: number  // auditPageHealth：suspicious=0 / 正常=100
  domainFit: number      // 领域词典命中=100 / 同类目=85 / 语义召回=70
}
```

`total = round(0.5*reachability + 0.3*contentHealth + 0.2*domainFit)`，并附 `reasons: string[]`。

---

## 五、接口契约变更

| 端点 | 变更 | 兼容性 |
|---|---|---|
| `POST /:slug/audit` | 响应新增 `suspiciousItems`（已有）、`stale` 读取 | 向后兼容 |
| `POST /:slug/ai-heal` | `autoApply` 需 write/admin；`autoApplied` 增加 `applied`/`reason`；诊断增加 `evidence` | **行为收紧**（越权从「可用」变 403） |
| `GET /:slug/url-health` | 新增 `stale` 字段；stale 时 `reachability: null` | 向后兼容（null 已有先例） |
| `GET /:slug/url-health/history` | **新增** | 新增端点 |
| `POST /:slug/url-deep-diagnose` | **新增** | 新增端点 |
| `POST /:slug/apply-health-fix` | 不再写假健康快照，改 stale | 语义修正 |

---

## 六、验收标准

1. 只读 token 调 `ai-heal` 带 `autoApply` → **403**，且插件清单未被修改（`version` 不变）。
2. `apply-health-fix` 后再读 `url-health` → `stale: true` 且 `reachability === null`；徽标文案为「待复检」。
3. `autoAudit` 传 `sampleLimit: 5` → 实际抽样 5 条（日志/响应可验）。
4. 超时类失败诊断 `cause === 'TIMEOUT'`，404 类为 `HTTP_NOT_FOUND`（不再一律 404）。
5. 候选站点若为停放页 → `verified: false` 且 `confidence.contentHealth === 0`，不进入 `autoApply` 首选。
6. 深度取证对同一输入确定；六层证据齐备（未采集层为 `skip`）。
7. 历史趋势：构造 3 组序列（上升/下降/抖动）判定正确。
8. 全量：typecheck 5 包、新增单测全过、既有 `plugin-audit.test.ts` 21 例不回归、a11y 四项门禁全过。

---

## 七、实施顺序

1. core 判定模块 + 单测（可独立验证）
2. API 缺陷修复（D1–D7）
3. API 新端点（深检、历史）
4. 前端接入（stale / 深检 / 趋势 / 失败原因）
5. 深度验证（类型、单测、a11y、真实浏览器）

---

## 八、实施结果（2026-10-27 00:10）

### 8.1 新增与改动文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `packages/core/src/url-deep-diagnose.ts` | 新增 | 分层判定纯函数（`diagnoseUrlDeep`）+ 趋势最小二乘（`computeReachabilityTrend`）+ 主域抽取 |
| `packages/core/src/index.ts` | 改动 | 导出上述模块 |
| `packages/core/test/url-deep-diagnose.test.ts` | 新增 | 26 例，锁住每类 verdict、证据层级、置信度边界、趋势判据 |
| `apps/api/src/routes/plugin-audit.ts` | 改动 | D1–D7 修复 + 两个新端点 |
| `apps/api/test/plugin-audit-api.test.ts` | 改动 | 新增 9 例（stale 3 / 深检 3 / 历史 1 / 鉴权 3），总数 11 → 20 |
| `apps/web-overlay/src/components/plugins/plugin-url-health-panel.tsx` | 改动 | 待复检徽标与横幅、深检入口与证据链面板、历史趋势迷你图、候选四档与可信度、失败原因 |
| `apps/web/src/components/plugins/plugin-url-health-panel.tsx` | 同步 | overlay 的镜像副本 |
| `deliverables/plugin-health/ui-regression.mjs` | 新增 | 真实浏览器回归（33 条断言），拦截 `/api/hub/**` 固定六种状态 |
| `deliverables/plugin-health/screenshots/plugin-health-deep-and-heal.png` | 新增 | 回归过程的整页截图（待复检 + 深检 + 趋势 + 四档候选同屏） |

### 8.2 缺陷修复对照

| 编号 | 修法 | 回归防线 |
|---|---|---|
| D1 越权写 | `autoApply` 前校验 `scopes` 含 write/admin，否则 403 `forbidden_scope` | 只读令牌 + autoApply → 403 且清单版本不变（**反向验证：去掉校验即变红**） |
| D2 伪造健康 | 治愈后写 `stale: true`（同一 `plugin_url_audit` action），读取端点返回 `reachability/okCount = null` | 3 例断言全为 null（**反向验证：改成 `stale: false` 后 3 例全红**） |
| D3 参数错位 | `clampInt(body.sampleLimit, DEFAULTS.sample, 1, MAX_SAMPLE)` | 代码层修正，注释说明错位后的实际运算 |
| D4 假诊断 | 新增 `UrlEvidence` 与 `diagnoseFromEvidence`；`autoAudit` 保留 `brokenItems` 的 status/failureKind；调用方声称的 URL 标 `UNVERIFIED` | 断言 `cause === 'UNVERIFIED'` 且 `evidence.source === 'client-claimed'` |
| D5 静默失败 | `autoApplied` 增加 `applied/reason/detail`，四类原因枚举 | 前端徽标区分「已应用」与「未应用：原因」 |
| D6 候选不判内容 | `probeCandidateUrl` 提至 8KB + `auditPageHealth`，产出 verified/blocked/suspicious/dead 四档；`autoApply` 只采纳 verified | 候选渲染显示四档徽标 + 可信度三项分解 |
| D7 注入与外泄 | 清单字段压平换行、截断、JSON 定界并把 `<` 转义为 `\u003c`；降级文案改为分类化，原文写服务端日志 | prompt 不再直接拼接作者可控字段 |

### 8.3 新增能力

1. **`POST /api/plugins/:slug/url-deep-diagnose`**：六层证据（URL/DNS/重定向/HTTP/内容/归档），默认只诊断本包内 URL，包外需 `allowExternal: true`。DNS 预检区分「解析失败」与「解析成功但落在私网」——后者不判 `expired-domain`（这是本次实现中修正的一处易错点）。
2. **`GET /api/plugins/:slug/url-health/history`**：按时间正序的体检点 + 斜率趋势，`stale` 记录被排除并计数（`skippedStale`）。
3. **证据链补齐**：判定在「连不上」处早返回时，`finish()` 会把未采集的层补成 `skip` 并固定层序 —— 任何结论都是完整六层，杜绝「没查」被读成「没问题」。

### 8.4 验证记录

**A. 静态与单测**

- 类型检查：5/5 包通过（`node scripts/typecheck.mjs`，20.6s）。
- 单测：`url-deep-diagnose.test.ts` 26/26；`plugin-audit-api.test.ts` 20/20；`plugin-audit.test.ts` 15/15；面板契约测试 11/11；a11y 门禁 `keyboard-activation` + `clipboard-honesty` 44/44。
- 反向验证：权限校验、stale 语义各做一次「拆掉即红、恢复即绿」。
- `field-names` 与 `url-hygiene` 的剩余红灯来自**并行会话正在开发的 `admin/videos` 与 `collections` 文件**，不在本次改动范围。

**B. 真实浏览器回归（`deliverables/plugin-health/ui-regression.mjs`）**

生产模式（`next build` + `next start`）跑 Chromium，`/api/hub/**` 全部拦截成固定桩，验证六种状态下界面是否「说实话」。结果 **33/33 通过**。

| 场景 | 关键断言 | 结果 |
|---|---|---|
| 待复检 | 徽标显示「待复检」；横幅写明「健康度待复检」「不会用推算值填补」；本行**不出现**「真健康」与任何百分比 | 通过 |
| 深检证据链 | 结论「域名停放 / 广告占位」、置信度 90%、URL/DNS/重定向/HTTP/内容/归档六层齐备、HTTP 200 + 采样 16384 字节、Wayback 入口、**未查的层显示「未查询 Wayback 归档」而非省略** | 通过 |
| 历史趋势 | `role="img"` + aria-label「可达率趋势：近期恶化，共 6 个数据点」、`-7 个百分点`、「已排除 1 条待复检记录」 | 通过 |
| 候选四档 | 「实测可达」/「拒绝爬虫·未验证」/「疑似停放」三档徽标；可信度分解在 `title` 中（可达性 100 × 0.5 + 内容健康 88 × 0.3 + 领域匹配 85 × 0.2 = 92） | 通过 |
| 诚实性 | client-claimed 标「结论未实测」；`applied:false` 显示「未应用：无实测通过的平替」；包外 URL 有「不属于本包，已跳过诊断」提示 | 通过 |
| 运行时 | 无 JS 异常 / pageerror；`/api/hub/*` 无 4xx/5xx | 通过 |

唯一一条 502 是 `/api/me/sync`（后台同步打向独立 API 进程，该进程在本轮验证时未启动），属环境事实，已在脚本里单独归类打印，不计为面板缺陷。

**C. 回归过程中发现并修掉的三处「只在真实浏览器里才暴露」的问题**

1. **`ignoredUrls` 只进类型、从未渲染**：后端已经会拒绝包外 URL 并回传清单，前端却什么也不显示——用户只能看到「AI 说没问题」。已补提示块（最多列 5 条）。
2. **待复检时健康微条画成全零空条**：看起来像「0 个健康」，与「没有测量值」是两回事。已改为 `snap && !snap.stale` 才渲染。
3. **可信度分解只挂在「质量分」徽标上**：该徽标仅当 `qualityScore` 是数字才渲染，而 AI 直出的候选常常没有质量分，刚算好的可信度就没人看得见。已把分解挂到候选行本身。

同时给行与抽屉补了 `data-testid`（`pack-row-<slug>` / `pack-detail-<slug>`）：原先按文案过滤 `div` 定位单行会命中整个列表容器，导致「点错行」「读错块」——回归脚本自身的假失败正是这么来的。

### 8.5 已知边界

- 深度取证不单独做 TLS 握手与证书链解析（`guardedFetch` 不暴露响应头与证书），因此「证书过期」类问题只能归入 `connect` 失败，不会给出证书细节。这是刻意取舍：不猜。
- Wayback 层目前恒为 `skip`（只返回快照链接供人工点开），未做归档年份查询；避免为一条体检引入额外外部 API 依赖。
- 历史趋势依赖 `audit_logs` 保留策略；若将来做日志归档，需同步调整 `skippedStale` 口径。

### 8.6 如何复跑这份验证

```bash
# 1) 生产构建（独立输出目录，避免踩到并行会话的 .next）
cd apps/web && NEXT_DIST_DIR=.next-uibuild3 node node_modules/next/dist/bin/next build

# 2) 起服务（生产模式下 bypass 快捷登录按设计关闭，必须给管理口令）
NEXT_DIST_DIR=.next-uibuild3 NAVHUB_ADMIN_PASSWORD=<临时口令> \
  node node_modules/next/dist/bin/next start -p 3452

# 3) 跑回归（33 条断言，约 40 秒；--shot 会存整页截图）
NAVHUB_VERIFY_PASSWORD=<临时口令> \
  node deliverables/plugin-health/ui-regression.mjs --base http://localhost:3452 --shot
```

两条环境经验（本次踩过，写下来免得重踩）：

- **不要用 `next dev` 跑这份回归**：本机同时存在多个 dev 实例共用 `apps/web/.next`，互相把对方的写入当成变更，页面会陷入 Fast Refresh 全量重载（实测 2 分钟导航 104 次），任何点击都报「元素已卸载」。生产模式没有这个循环。
- **不要在满载机器上再起 dev 实例**：16GB 机器上已有 6 个 Next 进程时，第 7 个会在编译期 OOM（`Fatal JavaScript out of memory`）。生产构建 + `next start` 的内存占用小得多。
