# CodeQL 高危第 4 类修复笔记 — 插件审计资源耗尽 + 不安全随机数

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
