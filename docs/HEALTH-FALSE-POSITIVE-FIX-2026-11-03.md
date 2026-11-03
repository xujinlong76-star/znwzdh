# 健康巡检误杀修复：拒绝爬虫 ≠ 死链（2026-11-03）

> 这不是新增功能，是修一个**正在伤害用户**的数据缺陷。所有数字都来自真实库
> `data/navhub.db` 的普查结果，可复跑复现。

## 1. 问题：13 个能正常访问的站点被标成「已失效」

对真实库做普查，结论如下：

| 观测项 | 数值 |
|---|---|
| `broken` 站点总数 | 16 |
| 其中有 `health_error` 的 | 3 |
| **无任何原因的** | **13** |
| 其中 HTTP 401/403 的 | 13（全部） |
| 真死链（404/410/451） | **0** |
| 最近 30 天失败巡检数 | 243 |
| 其中 `error` 为空的 | **133（55%）** |

被误杀的站点名单（全部实测可正常访问）：

```
Claude(403)  ChatGPT(403)  Midjourney(403)  npm(403)  Unsplash(401)
Uiverse(403) Grok(403)     AlternativeTo(403) CodePen(403) JSBin(403)
Enpass(403)  CCleaner(403) Macrium Reflect(403)
```

**对用户的伤害**：这些站点在导航站上显示「已失效」，用户以为链接坏了不敢点，
而它们在浏览器里完全正常。这是把「WAF 挡我」读成了「站点已死」。

## 2. 根因：巡检没接上本仓已有的判据

`packages/core/src/probe-policy.ts` 早就是这个问题的**单一事实源**，文件头写得很清楚：

> 只有「页面确定不存在」才允许说死：404/410/451、域名不解析、端口拒绝、证书无效……
> 401/403/405/412/418/429 是「服务端活着、只是拒绝爬虫」。

但 `apps/api/src/jobs.ts` 的巡检自己写了一行 `healthy = status >= 200 && status < 400`，
完全绕过这个判据，并且 `reason` 在纯 4xx 分支恒为 `null` —— 这就是 133 条空原因的来源。

同类判据在本仓被写过三遍（插件审计、深检、候选评分），收敛到 `probe-policy` 后，
**巡检这个最重要的消费方反而漏接了**。

## 3. 修复

### 3.1 巡检接上统一判据（`apps/api/src/jobs.ts`）

- 4xx 分支先过 `classifyProbeStatus(status)`，得到 `blocked` / `dead` / `server-error` / `unverified`；
- 异常分支走 `classifyProbeError(err, {...})`，产出中文可读原因，且**不外泄原始英文堆栈与内部地址**；
- `blocked` 的处理是：**不算健康**（确实没验证到内容），**也不判死**（服务器有应答即证明存活）；

### 3.2 阻止 blocked 推进连续失败计数

`markBroken` 对 blocked 必须**显式传 `false`**。这里有个容易踩的坑：

```ts
// health.ts 的状态表达式
status = ok ? (currentStatus ?? "active")
           : (markBroken === false ? (currentStatus ?? "active") : "broken")
```

只有严格等于 `false` 才保住当前状态，传 `undefined` 会落到 `"broken"` —— 等于没修。

### 3.3 新增 `health_checks.blocked` 列

- SQLite / PG 建表 DDL 同步；
- 老库走 `COLUMN_ALTERS` 补列（默认 0 = 普通失败，历史行不重算）；
- `recentHealthChecks` 查询改为 `AND blocked = 0`，连续失败计数只反映「真的探测不到」；
- **blocked 行仍然落库**（可观测、可审计），只是不参与判死计数。

### 3.4 数据订正 + 自愈

- 一次性订正：13 个误杀站点 `broken → active`，并在 `health_error` 写明原因；
- 长期自愈：巡检遇到 blocked 且站点为 `broken` 时会恢复成 `active`——
  下一轮巡检即可自愈，不依赖这次数据订正。

订正后真实库状态：`active 1023 / broken 3`（此前 1010 / 16）。

剩下 3 个是真正的网络异常（`fetch failed`、`terminated`），保留 broken 是正确的。

## 4. 验证

| 测试文件 | 内容 | 结果 |
|---|---|---|
| `apps/api/test/health-probe-policy.test.ts` | 19 项：状态码分类 + 异常分类 + 阈值 | 通过 |
| `packages/store/test/health-blocked.test.ts` | 5 项：blocked 不判死 / 自愈 / 真失败仍判死 / 原因非空 / 仍落库 | 通过 |

全量回归（硬证据）：

- `pnpm vitest run packages/store` → **576 passed, 0 failed**
- `pnpm vitest run apps/api` → **1549 passed, 0 failed**
- `@navhub/store` / `@navhub/api` 的 `tsc --noEmit` → **0 错误**

真实库订正前已备份：`data/navhub.db.bak-healthfix-20261103-081634`（45MB）。

## 5. 可复现的核查方式（已固化为守卫脚本）

```bash
# 在仓库根直接跑，退出码 0 = 无误杀
node scripts/check-health-false-positive.mjs

# 实测输出（修复后）
#   全站状态分布: active 1023 / broken 3
#   ✅ 无误杀：没有「拒绝爬虫」类状态码的站点被标 broken（应为 0）
```

守卫脚本刻意**不 import** `probe-policy` 的常量——它用一份独立写死的清单去交叉核对
库里的数据；若两边同源，判据写错了守卫会跟着错，等于没守。

> 踩坑记录：`better-sqlite3` 是原生模块，只装在 `apps/api` 下，而 ESM 的模块解析
> 是「沿脚本自身位置向上找 node_modules」、**不看运行时 cwd**，所以放在 `scripts/`
> 的脚本必须用 `createRequire(apps/api/package.json)` 显式加载，否则报
> `ERR_MODULE_NOT_FOUND`。PowerShell 里内联 `node -e` 写含 `SELECT` 的 SQL 还会被
> 当成 cmdlet 解析，必须落成 `.mjs` 文件。
