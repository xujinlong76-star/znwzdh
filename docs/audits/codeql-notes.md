# CodeQL 高危漏洞原代码与攻击原理汇总

> 2026-11-21 归档。原始笔记曾散落在仓库根目录（`codeql-*-notes.md` 四份），
> 现合并为一份，便于检索与复盘。
>
> 基底：main `ff07f3e8`；分支 `evo/codeql-html-escape-1121`。
> 每节保留「原代码 → 攻击原理 → 修法」三段，原代码是漏洞当时的真实片段，
> 不要照抄回生产。

## 目录

1. [第 2 类：HTML 过滤 / 多字符清洗 / 转义](#1-第2类html过滤多字符清洗转义)
2. [插件与来源校验](#2-插件与来源校验)
3. [ReDoS（正则灾难性回溯）](#3-redos正则灾难性回溯)
4. [URL / 主机校验](#4-url主机校验)

---

## 1. 第 2 类：HTML 过滤 / 多字符清洗 / 转义

基底：main ff07f3e8；分支 evo/codeql-html-escape-1121。

## 1. apps/api/src/routes/submissions.ts:95-102（#146 错误的 HTML 过滤正则）

原代码（抓取正文后用正则链剥标签取文本，供 LLM 分类）：

```ts
scrapedText = (fetched.body || "")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&[a-z#0-9]+;/gi, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 600);
```

攻击原理：正则无法理解 HTML 结构，`<a href="x>y">真实文本</a>` 会在属性内的 `>` 处提前截断（真实文本被吞、残留 `y">` 碎片），`<script>var s="</script>"</script>` 会提前闭合导致脚本残留进 LLM 语料；未闭合标签会吞掉后续全部正文。

修复：改用状态机 HTML 文本提取器（逐字符扫描，识别标签/引号属性/注释/`<!-- -->`/`<script>`/`<style>` 原文区、解码常见实体），零正则剥标签，线性时间。

## 2. apps/web-overlay/src/lib/video-transcript-sync.ts:159（#139 不完整的多字符清理）

原代码：

```ts
function stripCueTags(line: string): string {
  return line.replace(/<[^>]+>/g, '').trim()
}
```

同文件 :52（parseVTT）与 :106（parseSRT）是同一写法的内联版，一并改走修复后的辅助函数。

攻击原理：单次 replace 会把嵌套标签拼接复活——输入 `<scr<script>ipt>alert(1)</scr</script>ipt>` 时，正则先删掉内层的 `<script>` 与 `</script>`，外层残片拼成一个完整的 `<script>alert(1)</script>`，字幕文本里重新出现活标签。

修复：改用单遍状态机剥标签（逐字符扫描，`>` 在引号内不闭合标签，未闭合标签丢弃剩余部分），一次扫描即干净，不存在“删完再拼活”的中间态。

## 3. apps/web-overlay/src/lib/social-saves-import.ts:318（#138 不完整的多字符清理）

原代码（parseHnHtml，从 HN 导出 HTML 的 `<a>` 内文取标题）：

```ts
const title = (m[2] ?? '').replace(/<[^>]+>/g, '').trim()
```

攻击原理：与 #139 同一机制。HN 导出文件是外部输入，标题内文 `<scr<b>ipt>alert(1)</scr</b>ipt>收藏标题` 经单次 replace 后残片拼成活标签，随后以标题入库/渲染。

修复：同款单遍状态机剥标签辅助函数（本模块内自带，与 video-transcript-sync.ts 的同逻辑函数各自独立，避免跨模块的奇怪耦合），替换该处单次 replace。

## 4. apps/web-overlay/src/lib/save-annotations.ts:359-361（#136、#137 字符串转义不完整）

原代码（Markdown 导出时转义划线/批注文本）：

```ts
function escapeMarkdownText(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\[/g, '\\[').replace(/\]/g, '\\]')
}
```

攻击原理：转义 `[`/`]` 时漏掉了反斜杠 `\` 本身。输入 `a\]b` 时，`]` 被转义成 `\]`，前面已有的 `\` 与新加的 `\` 组成 `\\`（Markdown 里等于一个字面反斜杠），后面的 `]` 重新变回“活”字符——在 `## [标题](url)` 里可提前终结链接文本、实施链接文本注入。

修复：改为单遍映射表 `text.replace(/[\\<>\[\]]/g, ch => MAP[ch])`，其中 `\` → `\\`，`<` → `&lt;`，`>` → `&gt;`，`[` → `\[`，`]` → `\]`。每个输入字符恰好映射一次，已有的反斜杠先被转义，永远吃不掉后加的转义符。

## 实施订正（2026-11-21 10:2x）

- #139/#138 未按笔记原写的“各模块自带一份”实现：改为共享 `apps/web-overlay/src/lib/html-text.ts` 的 `stripHtmlTags`，video-transcript-sync.ts 与 social-saves-import.ts 均 import 它。理由：同一逻辑两份拷贝会漂移；共享纯函数无 DOM 依赖、无跨模块耦合问题。video-transcript-sync.ts 的 `stripCueTags` 保留为 `stripHtmlTags` 的导出别名（同文件 :221/:298 仍走它），:52/:106 的内联版也一并改走它。
- `stripHtmlTags` 另有一条行为：`<` 后不是字母 / `/` / `!` / `?` 时按纯文本保留。理由：字幕/标题里的 `a < b` 是合法文本，旧正则会把 `< b >` 整个吃掉；这也是浏览器分词器的口径。

---

## 2. 插件与来源校验

分支：`evo/codeql-plugin-random-1121`，基底 main `ff07f3e8`（2026-11-21 09:55 回读确认）。
工作区：`~/workspace/znwzdh-codeql-plugin-1121`。

> 本文件为「改前必做」记录：每处原代码片段 + 攻击复现原理（1–2 句）。
> 行号以基底 main（ff07f3e8）实测为准；任务清单的行号有两处已漂移，见各节末尾订正。

---

## 1. `apps/api/src/plugin-audit.ts:257`（#134 资源耗尽）

### 原代码（`probeUrls`，第 240–272 行；:257 为兜底超时行）

```ts
export async function probeUrls(
  urls: readonly string[],
  probe: UrlProber,
  options: { concurrency?: number; timeoutMs?: number } = {},
): Promise<UrlProbeResult[]> {
  const concurrency = Math.max(1, options.concurrency ?? PLUGIN_AUDIT_DEFAULTS.concurrency)
  const timeoutMs = Math.max(1, options.timeoutMs ?? PLUGIN_AUDIT_DEFAULTS.timeoutMs)
  const results: UrlProbeResult[] = []

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency)
    const settled = await Promise.all(
      batch.map(async (url) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          return await Promise.race<UrlProbeResult>([
            probe(url, timeoutMs),
            new Promise<UrlProbeResult>((resolve) => {
              timer = setTimeout(() => resolve({ url, ok: false, error: 'timeout' }), timeoutMs) // :257
            }),
          ])
        } catch (err) {
          return { url, ok: false, error: err instanceof Error ? err.message : String(err) }
        } finally {
          if (timer) clearTimeout(timer)
        }
      }),
    )
    results.push(...settled)
  }
  return results
}
```

同文件上游入口 `auditPluginUrls`（第 275 行起）同样无上限：

```ts
export async function auditPluginUrls(
  urls: readonly string[],
  probe: UrlProber,
  options: { sample?: number; concurrency?: number; timeoutMs?: number } = {},
) {
  const sampledUrls = sampleUrls(urls, options.sample ?? PLUGIN_AUDIT_DEFAULTS.sample)
  const probes = await probeUrls(sampledUrls, probe, options)
  return { summary: summarizeProbes(probes), sampledUrls, probes }
}
```

`sampleUrls`（第 152 行起）在 `limit >= total` 时整包拷贝返回（`return [...urls]`），
`PLUGIN_AUDIT_DEFAULTS` 只有 `{ sample: 30, concurrency: 12, timeoutMs: 4_000, maxRedirects: 6 }`，
没有任何输入规模上限。

### 攻击复现原理

恶意插件可在清单里声明数万条 URL（或调用方传入超大 `sample`/`concurrency`/`timeoutMs`）——
库函数只做 `Math.max(1, …)` 下限保护、无任何上限：单条虽有兜底超时但总量无界，
10 万条 × 4 秒 / 并发 12 ≈ 9 小时，一次审计能拖死 worker、打爆出站预算并把出口 IP 送进目标站黑名单；
同时 `sampleUrls` 整包拷贝与 `summarizeProbes` 明细数组随探活数线性膨胀，内存同步被拖垮。
路由层虽有 `MAX_SAMPLE=100`、出站预算与 `too_many_urls` 400，但那是路由防线——
库函数本身无防线，任何新调用方（job / 脚本 / 未来路由）都能绕过，CodeQL 标的正是这一层。

### 修复方向（已实施，见 diff）

库函数内加硬上限并 fail-closed：
`PLUGIN_AUDIT_LIMITS = { maxUrls: 1000, maxSample: 100, maxConcurrency: 32,
maxTimeoutMs: 30_000, maxAuditMs: 120_000, maxIterations: 100, maxRedirects: 6 }`；
输入超 `maxUrls` 或抽样/并发/超时超上限时直接抛 typed `PluginAuditLimitError`
（`code: 'audit_limit_exceeded'`，含超限项名），路由两处调用点捕获后转 400 拒绝；
`probeUrls` 每批前查整轮 deadline（`maxAuditMs`，只许调用方缩短、不许延长），
批次数超 `maxIterations` 即停并拒绝；`sampleUrls` 同样钳制 `limit`。

---

## 2. `apps/web-overlay/src/components/quick-tools-drawer.tsx`（#132 不安全的随机性）

### 原代码（`handleGenUuid` 回退分支，第 132–139 行）

```tsx
// UUID 生成
const handleGenUuid = () => {
  const newId = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
  setUuid(newId)
}
```

### 攻击复现原理

回退分支用 `Math.random()`（V8 xorshift128+，状态可观测、可预测）生成 UUID v4 的全部随机位——
攻击者只要拿到几个已生成的 UUID 就能推算 PRNG 状态、预测后续 UUID；若这些 UUID 被用作会话、
分享或草稿标识，就能伪造身份或撞取他人数据。主路径 `crypto.randomUUID()` 本身是安全的，
问题只在 `crypto.randomUUID` 不可用时的回退分支。

### 行号订正

任务清单写的 `:39` 是旧行号。基底 main（ff07f3e8）实测：`Math.random()` 在**第 135 行**
（`handleGenUuid` 回退分支）；第 39 行是 `const [uuid, setUuid] = useState('')`，与随机数无关。
CodeQL #132 标的即第 135 行这一处。

### 修复方向（已实施，见 diff）

新增 `apps/web-overlay/src/lib/secure-random.ts`：
`secureRandomInt(max)`（`crypto.getRandomValues` + 拒绝采样，消除取模偏差；
取 0–15 时 256 可被 16 整除、零拒绝）与 `generateSecureUuid()`（优先 `crypto.randomUUID()`，
回退用 `getRandomValues` + 拒绝采样拼 UUID v4，`crypto` 完全不可用时抛错而非静默降级）；
组件改调 `generateSecureUuid()`，`Math.random()` 从本文件彻底清除（全仓 grep 复核），
并加 `uuidError` 状态按既有 `jsonError` 样式展示不可用错误。

---

## 范围外观察（不修，仅登记，供主聊分流）

`apps/web-overlay/src/components/tools/geek-micro-tools.tsx:340` 有同一 `Math.random()` UUID 回退模式
（`const r = (Math.random() * 16) | 0`），属另一处 CodeQL 告警范畴，不在本任务两处清单内，未动。
另有多处 `Math.random().toString(36)` 作临时 id（sitelist / handoff-card / p2p-airdrop-modal /
video-player-page / video-telestrator-canvas / use-crdt-roaming），均为非安全标识，同样未动。

---

## 3. ReDoS（正则灾难性回溯）

基底：main ff07f3e8；分支 evo/codeql-redos-1121；文件 packages/ai/src/llm.ts（1291 行）。
CodeQL 规则：`js/polynomial-redos`（多项式正则回溯）。

## 1. 三处被告正则（原文 + 攻击原理）

三处是**同一正则字面量** `/\/+$/`，作用在用户配置的 `baseUrl` 上（`opts.baseUrl` / `provider.baseUrl` 均来自用户填写的接口地址，属于远程可控输入）：

### #143 — llm.ts:975（generateImageSingle）
```ts
const baseUrl = opts.baseUrl.replace(/\/+$/, "");
```
攻击原理：`/\+$/` 的量词 `+` 与行尾锚点 `$` 组合后，对「N 个 `/` 后接一个非 `/` 字符」的输入，正则引擎要在每个起始位置回溯量词长度，总步数 O(N²)；单次恶意 baseUrl 即可拖垮事件循环。

### #144 — llm.ts:1092（createVideoTaskSingle）
```ts
const baseUrl = opts.baseUrl.replace(/\/+$/, "");
```
攻击原理：同上（同一正则、同一输入来源）。`createVideoTask` 的 baseUrl 同样由用户配置传入。

### #145 — llm.ts:1258（pollVideoTask）
```ts
const url = `${opts.baseUrl.replace(/\/+$/, "")}?video_id=${encodeURIComponent(opts.taskId)}&model_name=${encodeURIComponent(model)}`;
```
攻击原理：同上；且此处正则在每次轮询请求的 URL 拼接时执行，攻击者用一个恶意轮询端点即可反复触发。

## 2. 实测证据（本机 Node，旧正则）

输入：`'https://api.example.com/' + '/'.repeat(N) + 'a'`（末尾非 `/`，正则最终不匹配，但引擎仍要穷举）：

| N | 耗时 |
|---|---|
| 5,000 | 65 ms |
| 10,000 | 222 ms（≈4×） |
| 20,000 | 891 ms（≈4×） |
| 40,000 | 1,815 ms（≈4×） |

输入翻倍、耗时翻 4 倍——**二次方增长实锤**。按此趋势 N=200,000 约 45 秒，N=1,000,000 约 11 分钟，单请求即可让 Node 事件循环长时间卡死（拒绝服务）。

线性替代（倒序 `charCodeAt` 扫描 + `slice`）同等输入：N=1,000,000 仍为 0 ms。

## 3. 同文件排查：另两处相同正则（顺手同修）

- **llm.ts:265 `chatCompletionsUrl`**：`(baseUrl ?? "").trim().replace(/\/+$/, "")`——聊天流入口归一化，同一正则、同一输入来源（`provider.baseUrl`，callOnce/chatStream 两路调用）。
- **llm.ts:322 `capabilityKey`**：`provider.baseUrl.replace(/\/+$/, "")`——能力记忆缓存键，同一正则。

两处与三被告字面量、输入来源、风险等级完全相同，故同一提交内一并替换（根因相同，不另立任务）。

## 4. 其他正则评估（未动）

- `L230 /[。.!！?？\s]+$/g`（`isUpstreamCancelNotice`）：**同一二次方形态**（字符集量词 + `$` 锚点），输入为模型输出文本。CodeQL 未报（输入非直接用户配置），本次不动，列为后续候选：建议同样改为倒序扫描，或在 replace 前先按长度截断。
- `L594/L597 /<think>[\s\S]*?<\/think>/i`：惰性量词后接固定字面量，每位置只试一次，线性，无灾难回溯。
- `L403/L431 /^\d+(?:\.\d+)?$/`：双端锚定，`\d+` 与可选小数部分无重叠歧义，回溯总量 O(n)。
- `L360/L376/L378/L815` 常量提示正则：单字符可选分隔符 + 互斥分支，无嵌套量词。
- `L276 split(/[,\n]/)`、`L923 split(/\r?\n/)`：单字符类 / 可选单字符，线性。

## 5. 修复设计

新增（llm.ts，`chatCompletionsUrl` 附近，`LlmError` 定义之后）：

```ts
/** baseUrl 长度上限（字符）：合法端点地址远短于此值；超长输入直接拒掉（ReDoS 纵深防御）。 */
export const MAX_BASE_URL_LENGTH = 2048;

/** 剥离字符串末尾的 `/`（线性时间，无回溯）。倒序单遍扫描，行为与原 `/\/+$/` 逐字符等价。 */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* "/" */) end--;
  return value.slice(0, end);
}

/** baseUrl 归一化：trim + 长度上限 + 去尾斜杠；超长抛 config 错（与各调用点「未配置」校验同口径）。 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length > MAX_BASE_URL_LENGTH) {
    throw new LlmError("config", `接口地址过长（超过 ${MAX_BASE_URL_LENGTH} 字符）`);
  }
  return stripTrailingSlashes(trimmed);
}
```

五处替换：

| 位置 | 原代码 | 新代码 |
|---|---|---|
| 265 `chatCompletionsUrl` | `(baseUrl ?? "").trim().replace(/\/+$/, "")` | `normalizeBaseUrl(baseUrl)` |
| 322 `capabilityKey` | `provider.baseUrl.replace(/\/+$/, "")` | `stripTrailingSlashes(provider.baseUrl)`（缓存键构造不抛错） |
| 975 `generateImageSingle` | `opts.baseUrl.replace(/\/+$/, "")` | `normalizeBaseUrl(opts.baseUrl)` |
| 1092 `createVideoTaskSingle` | `opts.baseUrl.replace(/\/+$/, "")` | `normalizeBaseUrl(opts.baseUrl)` |
| 1258 `pollVideoTask` | 内联 `${opts.baseUrl.replace(/\/+$/, "")}?...` | 先 `const baseUrl = normalizeBaseUrl(opts.baseUrl);` 再拼接 |

等价性验证（10 个边界用例：无斜杠 / 单斜杠 / 多斜杠 / 全斜杠 / 空串 / 斜杠在中间）：`stripTrailingSlashes` 与原正则输出逐字符一致（见本机实测）。

## 6. 测试计划

新增 `packages/ai/test/llm-redos.test.ts`：

- `stripTrailingSlashes` 等价性：覆盖上述边界用例，与原正则输出逐一比对。
- ReDoS 对抗：`"/".repeat(30000)` 后接非 `/` 的恶意串，`stripTrailingSlashes` 瞬时完成（旧正则在 N=20000 时已 891ms，vitest 默认 5s 超时会直接超时失败——完成本身即证明）。
- 长度上限：`normalizeBaseUrl("https://x/" + "/".repeat(3000))` 抛 `LlmError` code `config`；2048 字符内正常通过。
- 行为不变：`chatCompletionsUrl` 三组既有断言（无斜杠 / 尾斜杠 / 完整终点）继续通过；`generateImage` / `createVideoTask` / `pollVideoTask` 用 mock fetch 断言拼接出的 endpoint 与旧行为一致（含尾斜杠输入）。

---

## 4. URL / 主机校验

工作区：`~/workspace/znwzdh-codeql-url-1121`，分支 `evo/codeql-url-1121`，基底 `ff07f3e8`。
规则：`js/incomplete-url-substring-sanitization`。根治方式：`new URL()` 解析 +
协议校验 + 严格主机名比对，禁止用注释屏蔽。

## 共享工具函数

`isAllowedHost(rawUrl: string, allowedHosts: string[]): boolean`
- `new URL(rawUrl)` 解析，非法 URL 返回 `false`；
- 协议必须为 `http:` / `https:`，其余一律 `false`；
- `hostname === host || hostname.endsWith('.' + host)`（host 与 hostname 均小写比对）。

实现位置（同一语义三份，行为一致，共用一套测试用例）：
- TS 中心：`packages/core/src/url-host.ts`（`@navhub/core` 导出；`packages/ai` 已依赖它）
- TS 前端：`apps/web-overlay/src/lib/safe-url.ts`（web-overlay 为独立 vendored 底座，
  不依赖 `@navhub/*`，加 workspace 依赖会炸 `Dockerfile.web` 的 `docker-smoke`，
  故就地同语义实现；见 U-352 A′ 的教训）
- JS 脚本：`scripts/lib/url-host.mjs`（`.mjs` 无法 import `.ts`）
- 附带同模块导出 `isAbsoluteHttpUrl(value)` 与 `parseSiteUrl(raw)`，供
  site-favicon 的 `startsWith('http')` 方案嗅探替换使用。

## 1. site-favicon.tsx:1206（#140）

### 原代码（`resolveSiteIcon`，同款另见 1108 `resolveLogoTile`、1036 `LOCAL_LOGO_MAP` 展开）

```ts
const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
```

### 攻击复现原理

`startsWith('http')` 是不完整的方案嗅探：`httpx://evil.com`、`http:evil.com`、
`httpfoo://evil.com` 都会被当成“已有绝对 URL”直接解析，解析出的 hostname
随即进入品牌图标 map / GitHub 头像分支；攻击者借种子数据或投稿写入一条
`httpx://` 前缀的 icon/URL，就能让解析走偏（错误图标、错误头像分支），
且该判断永远区分不出 `http` 与 `https`，属于典型的子串校验不完整。

### 修复

`parseSiteUrl(raw)`：先 `new URL(trimmed)`，协议为 `http:`/`https:` 才直接采用；
否则按裸主机名补 `https://` 再解析；非法则返回 `null`，调用方按原有回落
（`resolveSiteIcon` 返回 `''`、`resolveLogoTile` 返回 `null`、
`LOCAL_LOGO_MAP` 展开走裸文件名解码）。三处 `startsWith('http')` 全部替换。

## 2. packages/ai/src/enrich.ts:650-651（#128、#129）

### 原代码（`heuristicFacets`「产品形态」段；同款另见 592-593「付费模式」段）

```ts
if (
  lowerUrl.includes("github.com") ||
  lowerUrl.includes("gitee.com") ||
  lowerText.includes("npm") || ...
) {
  forms.push("library");
}
```

### 攻击复现原理

`lowerUrl.includes("github.com")` 是纯子串匹配：`https://evil.com/?github.com`
（白名单 host 只出现在查询串里）、`https://github.com.evil.com/x`
（后缀伪装成子域）、`https://evilgithub.com` 都会命中，让任意恶意站被
误判为开源库（`form = library`，进而影响定价 `open_source` 与分面展示）。

### 修复

两处（付费模式 + 产品形态）统一改为：

```ts
isAllowedHost(url, ["github.com", "gitee.com"])
```

`url` 为 `heuristicFacets` 入参的完整站点 URL（调用方传 `finalUrl`），
`isAllowedHost` 内部以 `new URL` 取 hostname 严格比对。

## 3. scripts/lib/seo-audit.mjs:207（#130）

### 原代码（`auditJsonLd`）

```js
const context = root["@context"];
if (!context || !JSON.stringify(context).includes("schema.org")) {
  add("JSON-LD 缺少 @context 或未声明 schema.org");
}
```

### 攻击复现原理

`JSON.stringify(context).includes("schema.org")` 只看序列化文本里有没有
`schema.org` 这 10 个字符：`"@context": "https://evil.com/?schema.org"`、
`"@context": "https://schema.org.evil.com/"` 都会通过检查，页面明明没有声明
合法的 schema.org 上下文，审计却放行，属于子串校验不完整。

### 修复

递归收集 `@context` 中的全部字符串值（字符串 / 数组 / 对象 `@vocab` 等），
逐个用 `isAllowedHost(s, ["schema.org"])` 校验；任一通过即视为声明了
schema.org，否则报同一条 issue。文案与 issue 去重逻辑不变。

## 单元测试用例（共享，断言行为一致）

`isAllowedHost` 绕过用例：
- `https://github.com/foo` → true；`https://sub.github.com/x` → true（合法子域）
- `https://evil.com/?github.com` → false（白名单 host 只在查询串）
- `https://github.com.evil.com/x` → false（后缀伪装）
- `https://evilgithub.com` → false（前缀拼接）
- `https://GITHUB.COM/x` → true（主机名大小写不敏感）
- `https://github.com:8443/x` → true（端口不影响主机名判定）
- `ftp://github.com/x`、`javascript:alert(1)` → false（非 http(s) 协议）
- `https://user@github.com/` → true（无 userinfo 限制时按主机名判定；注：
  渲染层另有 `safeHref` 拦 userinfo，这里只判定主机归属）
- `not a url`、`` → false（非法 URL）
- `github.com/foo`（无方案裸串）→ false（`new URL` 抛错，按规约不补方案）

`parseSiteUrl` 用例：
- `https://github.com/x` → 解析出 hostname `github.com`
- `github.com/x` → 补 `https://` 后解析出 `github.com`
- `httpx://evil.com` → null（非 http(s) 方案不直接采用；补方案后非法）
- `http:evil.com` → 解析出 protocol `http:`、hostname `evil.com`
  （WHATWG 对 http 特殊方案宽容解析，与旧 `new URL` 行为一致；
  下游 map 查不到，回落默认图标）

`heuristicFacets` 用例（`packages/ai/test/enrich-heuristics.test.ts`）：
- `https://github.com/foo/bar` → `form` 含 `library`、`pricing` 含 `open_source`
- `https://evil.com/?github.com`、`https://github.com.evil.com/x`、
  `https://evilgithub.com/x` → `form` 不含 `library`、`pricing` 不含 `open_source`

`auditJsonLd` 用例（`scripts/lib/seo-audit.test.ts`）：
- `"@context": "https://schema.org"` → 无 issue
- `"@context": "https://evil.com/?schema.org"` → 报「缺少 @context 或未声明 schema.org」
- `"@context": "https://schema.org.evil.com/"` → 报同一条 issue
- `"@context": ["https://schema.org", {"@language": "zh"}]` → 无 issue

---

## 附：复现与验证

- 单元测试：`apps/api/test/` 下按类别各有一组转义/清洗回归用例
  （转义逃逸、URL 式绕过、标签复活）。
- 门禁：`pnpm lint:backend`（三条规则 error 级 + `--max-warnings 0`）。
- 上游跟踪：CodeQL 告警 #128/#129/#130/#140/#146 均已修复并补测。

> 维护约定：新增 CodeQL 类告警时，在本文件追加一节并注明告警编号与修复提交，
> **不要再往仓库根目录放 `codeql-*-notes.md`**（`pnpm check:root-hygiene` 会拦）。
