# NavHub 代码深度扫描与升级建议方案（V3）

> **扫描时点**：2026-10-19 02:1x，工作树含 11 项在途改动（插件市场）。
> **与旧文档的关系**：V1（21 项）/ V2（下一批）已执行大半；本版不承接其清单，而是**重新实测一遍代码**，只写「现在真实存在」的问题。
> **证据口径**：本文所有数字要么来自本次实测命令（附命令与耗时），要么标注「未实测」。凡未实测的性能数据一律不写成结论。

---

## 一、结论先行（五个判断）

1. **代码不是「烂」，是「重」。** 自研 405 文件 / 80,318 行，29 个 DB 索引、30 个路由模块、按域拆分、per-route 限流、embedding LRU + warmup 都在。工程纪律明显高于同类个人项目。真正的问题集中在两处：**同一份逻辑存了两份**、**门禁有缝隙**。

2. **今天有一个改动必然让 CI 变红，且只在 CI 才红。** 新加的 `plugin-manifest-parity.test.ts` 用 `.ts` 后缀导入，但 `navsphere` 的 tsconfig 没开 `allowImportingTsExtensions`。本地 `vitest` 能过（vite 自己解析），`tsc --noEmit` 直接 TS5097。CI 的 `test-web` 跑的正是这条命令。**1 行配置即可修复。**

3. **最大结构性债是 core ↔ 前端的 13 份算法副本，且已经真的漂移了。** 不是「将来可能不一致」，是现在就不一致：`knowledge-graph` 的 core 版有 `computeGraphCentrality`，前端版没有；`comparison` 两份差 471 行。而这 9 个文件里 core 侧零 Node API、overlay 侧零浏览器 API——**没有任何技术理由让它们不同**，纯粹是复制后各改各的。`plugin-manifest` 已经建立了正确的范式（事实源 + 镜像 + parity 测试），只需把它参数化推广到其余 12 个。

4. **依赖升级里真正值钱的只有 4 个，其余是噪音。** 值钱：Node 24（拿掉 12 处 `--experimental-strip-types`）、Next 16（Turbopack 默认 + 性能）、zod 4（解掉 v3 被前端钉死的死结）、TS 7（类型检查 8–12 倍提速）。噪音：31 个 Radix 包的 minor、`autoprefixer`、`embla` 这类。**一次性全升只会制造一周的假故障。**

5. **`next-auth@5.0.0-beta.32` 不该「等稳定版」。** 实测 npm dist-tags：v5 至今只有 beta，stable 仍是 `4.24.15`。项目已经吃到了最新 beta，等不到头。真正的决策是**留（锁死 + 隔离 + 季度复审）还是拆（自有 API Token + HMAC 身份已经能覆盖管理面，用 300 行自建 session 换掉一个 beta 依赖）**——这个必须单独立项，不该混在依赖升级里做。

---

## 二、实测基线（本次扫描）

| 指标 | 实测值 | 证据 |
| :--- | ---: | :--- |
| 自研源码 | **405 文件 / 80,318 行** | `find ... -name "*.ts" -o -name "*.tsx"` |
| ├ API | 7,824 行 / 30 个路由模块 | `apps/api/src/routes/*.ts` |
| ├ core | 12,274 行 | |
| ├ store | 9,373 行 / 29 个索引 | `grep -c "index(" schema.ts` |
| ├ ai + mcp | 2,954 行 | |
| └ web-overlay | 47,893 行 / 238 文件 | |
| vendored 底座 `apps/web/src` | 62,041 行 | 镜像，非自研 |
| 单元测试 | **1,617 通过 / 15 跳过，129 文件，99.7s** | `pnpm test`（本次实跑） |
| 类型检查 `@navhub/*` | **0 错误（75s）** | `pnpm typecheck`（本次实跑） |
| 类型检查 `navsphere` | **1 错误：TS5097** | `npx tsc --noEmit`（本次实跑，19s） |
| 覆盖层一致性 | 313 文件全一致，372 反向候选仅告警 | `node scripts/check-web-overlay.mjs` |
| 环境变量 | 35 个唯一（37 行，2 组重复键） | `.env.example` |
| next-auth 版本 | `5.0.0-beta.32` = **npm 上的最新 beta**，stable 仍 4.24.15 | `registry.npmjs.org` dist-tags |
| 首位依赖缺口 | Next `15.5.28 → 16.4.2`；TS `5.9.3 → 7.0.2`；zod `3.25.76 → 4.6.7`；vitest `4.1.11 → 5.0.5`；eslint `9.33 → 10.13` | `pnpm outdated -r` |
| 首屏 JS | 637 KB（基线，**本次未重跑构建**） | `scripts/bundle-budget.json` |

**判断**：测试密度（1,617 例对 80k 行）与门禁完整度已经不错，所以本方案不搞「大重构」，只做**降重复 + 补门禁 + 分步升依赖**。

---

## 三、P0：今天就做（约 1 小时）

### P0-1 修复 TS5097（CI 必红）

**证据**

```
apps/web/test/plugin-manifest-parity.test.ts(13,48): error TS5097:
  An import path can only end with a '.ts' extension when
  'allowImportingTsExtensions' is enabled.
```

- 该文件是本次未提交的新增（overlay + web 双份镜像）。
- 全仓 393 处 `.ts` 后缀导入，但 `apps/web` 里**只有这 1 处**——所以 tsc 只报 1 条，之前一直 0 错误。
- CI `test-web` 的第 3 步是 `pnpm --filter navsphere exec tsc --noEmit`（ci.yml:128），vendor 后该文件必然存在 → **下一次 push 必红**。

**修法（推荐，1 行 × 2 个文件）**

`apps/web-overlay/tsconfig.json` 与 `apps/web/tsconfig.json`（两者实测字节一致，必须同改）的 `compilerOptions` 增加：

```json
"allowImportingTsExtensions": true,
```

`noEmit: true` 已开启，满足该选项的前置条件。

**备选**：把导入改成无后缀 `'../src/lib/plugins/plugin-manifest'`。能过 tsc 与 vitest，但与仓库「显式 .ts 后缀」的统一约定冲突，不推荐。

**验收**：`pnpm --filter navsphere exec tsc --noEmit` 输出为空；`pnpm test` 仍 1,617 通过。

### P0-2 在途改动落盘

当前 11 项改动全在工作树（插件市场：`packages/core/src/plugin-manifest.ts`、`apps/web-overlay/src/lib/plugins/`、两侧 parity 测试）。P0-1 修完立即提交，避免又一次「成果停在工作树」——V2 文档里 80+ 项未提交的教训只过去一天。

### P0-3 顺手清理（10 分钟）

| 项 | 位置 | 动作 |
| :--- | :--- | :--- |
| 重复环境变量 | `.env.example` 的 `NAVHUB_TRUST_PROXY`、`NAVHUB_DATABASE_URL` 各出现 2 次 | 删重复项，保留带注释的那条 |
| 死配置 | `pnpm-workspace.yaml` 有 `minimumReleaseAgeExclude`（8 个 next 包），但 `.npmrc` 里**没有** `minimumReleaseAge` | 二选一：在 `.npmrc` 加 `minimumReleaseAge=1440`（推荐，供应链延迟一天再装新包），或删掉这个排除列表 |

---

## 四、P1：架构债——算法双份，且已漂移（1–2 天）

### 4.1 证据：13 个同名文件，9 个环境无关却各写一遍

| 文件 | core 行 | 与 overlay 差异 | core 侧 Node API | overlay 侧浏览器 API |
| :--- | ---: | ---: | :---: | :---: |
| `knowledge-graph` | 347 | **622 行** | 0 | 0 |
| `architecture-recipe` | 270 | **534** | 0 | 0 |
| `comparison` | 240 | **471** | 0 | 0 |
| `visual-fingerprint` | 235 | **434** | 0 | 0 |
| `batch-operations` | 183 | **357** | 0 | 0 |
| `speculative-prerender` | 155 | **312** | 0 | 0 |
| `federated-recommendation` | 132 | **266** | 0 | 0 |
| `wayback-resolver` | 102 | **200** | 0 | 0 |
| `dynamic-tool-synthesizer` | 501 | 108 | — | — |
| `vault` | 268 | 110 | — | — |
| `webmcp-bridge` | 210 | 64 | — | — |
| `prefetch` | 192 | 40 | — | — |
| `crdt-sync` | 469 | 26 | — | — |

**功能性缺失已发生**：`packages/core/src/knowledge-graph.ts` 导出 `computeGraphCentrality`，`apps/web-overlay/src/lib/knowledge-graph.ts` 没有——前端拿不到这个能力，但没人知道，因为没有任何测试比这两份。

**为什么根因不是「人懒」**：`apps/web` 是独立安装的 vendored 底座，`package.json` 里没有任何 `@navhub/*` 依赖，overlay 被复制进去后**物理上无法 import `@navhub/core`**。所以复制是当时唯一可行的做法。现在要做的是把「复制」变成「受控生成」。

### 4.2 方案：把 plugin-manifest 的范式参数化

`plugin-manifest` 已经证明了正确形态（事实源在 core、镜像在 overlay、parity 测试守门），只是**为一个文件手写了 3 条测试**。升级为通用机制：

**Step 1（半天）**：新增 `scripts/sync-core-mirrors.mjs`
- 维护一份清单 `core-mirrors.json`：`{ 源: packages/core/src/x.ts, 目标: apps/web-overlay/src/lib/x.ts, mode: "verbatim" | "adapter" }`
- `verbatim` 模式：直接复制 + 注入头注释（`// @core-mirror: packages/core/src/x.ts`）+ 去除 core 特有导入
- `--check` 模式：只比对不写，CI 用；有漂移即失败并打印 `diff` 命令
- 复用 `scripts/lib/overlay-drift.mjs` 的纯函数风格与单测范式（该目录已有 `walk-copy.mjs`、`overlay-drift.mjs`）

**Step 2（半天）**：把 13 个文件的 parity 测试参数化
- 抽 `test/helpers/core-mirror-parity.ts`，一个 `expectMirrorParity(list)` 覆盖全部条目
- 现在 1 个文件 3 条断言，将来 13 个文件仍是 1 个循环

**Step 3（半天，先做 9 个 verbatim）**
- 对 9 个「零环境依赖」文件：以 core 为唯一事实源重新生成 overlay 版，**前端补齐 `computeGraphCentrality`**，删掉手工分叉
- 对 4 个确有差异的（`vault` 用 WebCrypto、`webmcp-bridge` 走浏览器 MCP、`crdt-sync`、`dynamic-tool-synthesizer`）：标记 `adapter` 模式，把**纯逻辑部分**抽成 core 的 `*-core.ts`，浏览器壳留在 overlay 并显式 `export * from` 同样规则的子集

**收益**：约 3,000 行冗余归零；「改了 core 忘改前端」从「线上才发现的 bug」变成「CI 一条 diff」。

**验收**：`node scripts/sync-core-mirrors.mjs --check` 退出 0；13 个文件 parity 测试全绿；`pnpm typecheck && pnpm test` 不回归。

**不做的事**：不要在此时搞「`packages/shared` + tarball 注入 apps/web 的 node_modules」。听起来更干净，但它会和 `vendor-web.mjs` 重装 `apps/web/node_modules` 的流程打架，属于季度级改造，现在做是自找麻烦。

---

## 五、P2：依赖与运行时升级（分 4 批，禁止并行）

原则：**一批一提交，一批一验证，任何一批红灯就回滚该批**。当前 1,617 例测试与 0 类型错误就是你的安全网。

### 批 1｜Node 22 → 24 + 删掉 12 处实验标志（低风险，半天）

**证据**：Node 22.22.2 实测 `node /tmp/t.ts` 直接跑通（类型剥离自 22.18 起默认开启）。12 处 `--experimental-strip-types` 已是纯冗余：

| 位置 | 条数 |
| :--- | ---: |
| `apps/api/package.json`（dev / start:ts / migrate / seed） | 4 |
| `packages/mcp/package.json`（start / http） | 2 |
| 根 `package.json`（test:pg） | 1 |
| `scripts/dev-all.mjs` | 1 |
| `docker/entrypoint.sh` | 2 |
| `docker-compose.yml` + `docker/docker-compose.yml` | 2 |

**动作**
1. 先删标志（不升 Node）：验证 1,617 例 + 三处启动路径（`pnpm dev` / `pnpm mcp:stdio` / `docker compose up`）
2. 再改 `docker/Dockerfile.{api,web}` 的 `NODE_IMAGE` 默认值 `node:22-bookworm-slim → node:24-bookworm-slim`，`engines.node` 提到 `>=24`
3. `ci.yml` 的 `node-version: 22 → 24`

**风险点（必须验）**：`better-sqlite3@13`、`onnxruntime-node`、`sharp` 三个原生模块的 Node 24 ABI。验收标准是 `pnpm test` 全绿 **且** `pnpm test:pg` 能连库跑通，不是「装上了」。

### 批 2｜zod 3 → 4（中风险，1–2 天）

**为什么现在能解**：`pnpm-workspace.yaml` 把 zod 钉在 `^3.25.76`，原因是 `@hookform/resolvers@3` 只支持 zod 3。而 resolvers 最新是 **5.9.2**（`pnpm outdated` 实测），v5 对 zod 4 有正式支持。

**迁移面（实测）**：26 个文件 import zod；`z.record()` 12 处（v4 必须显式 key + value schema）；`.errors` 1 处；`.email()` 1 处（v4 改 `z.email()`）。

**动作顺序**
1. `@hookform/resolvers 3.9.1 → 5.9.2`，跑前端 tsc + lint（此时仍需 zod 3 兼容，v5 提供 `zod/v3` 入口）
2. `zod 3.25.76 → 4.6.7`，跑官方 codemod：`npx zod-v3-to-v4`
3. 手修 12 处 `z.record`、1 处 `.errors`、1 处 `.email`
4. **删掉** `pnpm-workspace.yaml` 里 `zod: ^3.25.76` 这条 override，以及相关注释

**验收**：`pnpm typecheck` 0 错误；1,617 例全绿；`pnpm build` 通过；`/api/*` 的 OpenAPI 输出（`zod-to-json-schema`）无结构变化——**这条最容易漏**，zod 4 的 JSON Schema 生成会变，需 diff 一份 `openapi.json` 前后对比。

### 批 3｜Next 15.5 → 16.4（中高风险，3–5 天）

**本仓的四个具体阻断点（逐个实测确认过）**

| 阻断点 | 现状 | Next 16 行为 | 动作 |
| :--- | :--- | :--- | :--- |
| `next lint` | CI `test-web` 第 4 步在跑 | **命令已移除**，`eslint` 配置项也移除 | 改 `eslint .`，或换 Biome；用官方 codemod `next-lint-to-eslint-cli` |
| 自定义 `webpack` | `next.config.js:108` 有 `webpack(config, {dev})`（Windows 缓存锁） | 存在 webpack 配置 + 默认 Turbopack → **构建失败** | 删掉该函数（Turbopack 默认内存缓存已覆盖该问题）或 `next build --webpack` |
| `middleware.ts` | `src/middleware.ts` 用 next-auth `auth()` 包了一层 | 改名 `proxy.ts`，且**固定 nodejs 运行时**、不支持 edge | 重命名 + 导出改 `proxy`；顺带确认 next-auth v5 在 nodejs 运行时可用 |
| `images` 默认值 | `remotePatterns` 通配 `**` | `qualities` 默认只 `[75]`、`minimumCacheTTL` 60s→4h、`imageSizes` 去掉 16 | 检查是否有 `quality` prop ≠ 75；无则无需改 |

**好消息**：`params/searchParams` 异步化在本仓影响极小——30 个页面基本是 `'use client'` + `useParams()` + 客户端 fetch，实测 `collections/[slug]/page.tsx` 就是 `useParams`，不涉及 server 侧同步读取。

**动作**：单独分支 → codemod → 四个阻断点 → `pnpm build` + 9 个 E2E spec → `check:bundle` 预算重测。

**必须重测的指标**：首屏 JS。Turbopack 产物体积与 webpack 不同，`bundle-budget.json` 的 685 KB 阈值可能需要按新产物重设基线——**不要为了过门禁去调高阈值**，先看真实数字。

### 批 4｜工具链：TS 7 / vitest 5 / ESLint 10（中风险，3–4 天）

**TS 7 是本批最大收益（官方实测 8–12 倍，Slack CI 类型检查 7.5min → 1.25min），但本仓有三个硬阻断：**

| 阻断 | 证据 | 处理 |
| :--- | :--- | :--- |
| `moduleResolution: "node"` | `apps/web/tsconfig.json` | TS 7 **硬错误移除** → 改 `"bundler"`，再跑一次 tsc |
| `baseUrl: "."` + `paths` | 同上 | TS 7 不支持 `baseUrl` → `paths` 改为相对项目根（`"@/*": ["./src/*"]` 已满足，删 `baseUrl`） |
| `types` 默认变 `[]` | 根 `tsconfig.base.json` 用 `typeRoots`、前端未声明 `types` | 显式补 `"types": ["node"]`（前端再补 react/react-dom），否则 `process`、`Buffer` 全丢 |
| 工具链 API 缺失 | TS 7 native 无 compiler API；Dependabot PR #89 中 `check-syntax` 与 ESLint 失败 | `check-syntax` 已改 esbuild（`fcfcbe2`）；ESLint/typescript-eslint 仍等上游支持。建议门禁 7、web lint 5.9 并存 |

**顺序（2026-10-20 修正）**：TS 6 在 npm 上只有 beta/dev，没有正式版，原「先升 6.0 清 deprecation」不可执行。改为在 5.9 上直接清硬阻断后评估 7.0；ESLint 10 已独立完成，vitest 5 不受影响。

**2026-10-20 执行记录**：

- 已清：两处 `moduleResolution` 均已是 `"bundler"`；`baseUrl` 已移除（`e93db80`）；根 `types` 已显式补 `"node"`（`81a2fab`）。
- 隔离 worktree 用 `typescript@7.0.2` 实测：全量 `pnpm typecheck`、根测试 1850、web 749、web tsc（直接用 TS 7 二进制）、构建全部通过。
- Dependabot PR #89（TS 7.0.2）实测：web `tsc` 通过；ESLint 与 `check-syntax` 失败。`check-syntax` 已改用 esbuild（`fcfcbe2`，702 文件 0 错误 + 3 条守卫测试），不再依赖 compiler API；剩余仅 typescript-eslint 与同伴清单。
- 仍不能合入：① `apps/api`/`packages/*` 各自 pin `typescript: 5.9.3`，其中 `packages/ai`/`packages/store` 是同伴 WIP；② `typescript-eslint@8.71.2` 的 TS peer 是 `>=4.8.4 <6.1.0`。当前结论：**门禁可先升 7，lint 所在的 web 继续留 5.9.3**；等同伴清单落地 + typescript-eslint 支持 7 后再整体切。
- ESLint 10 已单独完成（`34156a0`）：`10.13.0`；需把 brace-expansion override 拆成 `>=2 <5` 与 `>=5`，否则 minimatch@10 启动即崩。

---

## 六、P3：结构性（季度，按价值排序）

| 优先级 | 项 | 现状证据 | 建议 |
| :--- | :--- | :--- | :--- |
| ★★★ | **overlay 镜像机制** | 314 文件 / 47,893 行镜像，配 3 个脚本（vendor / sync / check）维护 | 中期评估「上游 fork 一次 + 定期 merge」替代「每次 vendor 覆写」。收益是删掉一整套同步机制；成本是一次性迁移。**先做 P1，别现在动** |
| ★★★ | **巨型组件拆分** | `algorithm-lab` 2211、`admin/sitelist` 2057、`AdminDashboardClient` 1225、`use-home-diy` 1211、`navigation-content` 1092 | 按「是否影响首屏」排序：`use-home-diy` 与 `navigation-content` 先拆（进首页包），admin 两个后拆（不进首屏） |
| ★★☆ | **CSP 从 report-only 转 enforce** | `next.config.js` 默认关，`NAVHUB_CSP=1` 才下发 enforce；配套 `security-headers.test.ts` 已有 | Next 依赖内联脚本，需 nonce/hash 方案；先开 report-only 收集一周真实违规，再 enforce。这与 Next 16 升级**同时做最省事**（反正要改 next.config） |
| ★★☆ | **可观测性收口** | `metrics.ts` 是进程内 Map，重启即丢、多实例不聚合；有 `/api/metrics` | 别上 OTel 全家桶。先把 `/api/metrics` 的输出格式定成 Prometheus 文本（30 行），交给外部 scrape——成本极低，收益是能跨实例看 |
| ★☆☆ | **next-auth 决策** | beta.32 = 最新 beta，stable 仍是 v4 | 单独立项：留（锁版本 + 管理端 2FA + 季度复审）或拆（自有 Token + HMAC 身份已覆盖，自建 session） |
| ★☆☆ | **i18n / 主题市场 / 实验框架** | V2 的 P3 项，未动 | 继续搁置。当前没有证据表明缺这些会掉用户 |

---

## 七、明确不建议做的四件事

1. **不要一次性升 31 个 Radix 包。** `1.2.21 → 1.3.1` 这种 minor 对 shadcn 组件无功能收益，但会让 diff 淹没真正的改动。要升就按「用到才升」。
2. **不要 TS 7 与 Next 16 同一周做。** 两个都会改 tsconfig 与构建链，同周出问题无法归因。
3. **不要为了「更现代」重写 overlay 体系。** 它是丑，但它现在能跑、有 372 条反向候选告警兜底。P1 做完再谈。
4. **不要引入 prom-client / OpenTelemetry / Sentry 任一整套。** 当前瓶颈不是「看不见」，是「重复」和「门禁缝隙」。

---

## 八、四周排期

| 周 | 内容 | 完成标志 |
| :--- | :--- | :--- |
| W1 | P0（1h）+ P1 算法镜像机制与 13 文件收口 | `sync-core-mirrors --check` 绿；1,617 例仍绿；CI 首航绿 |
| W2 | P2 批 1（Node 24 + 删标志）+ 批 2（zod 4） | 测试 + `test:pg` + `openapi.json` 前后 diff 无差异 |
| W3 | P2 批 3（Next 16） | `pnpm build` 绿、9 个 E2E 绿、首屏 JS 新基线入档 |
| W4 | P2 批 4（TS 6→7、vitest 5、ESLint 10） | `pnpm typecheck` 耗时下降 ≥5×（记录前后秒数） |

**每周末统一做一次**：`pnpm verify:all`（overlay 检查 + extensions + tsc + vitest + lint + playwright），并把结果写进 `docs/`，保持「可复现绿」而不是「本机绿」。

---

## 附录：本次扫描使用的命令

```bash
pnpm typecheck                                    # @navhub/* 类型检查（75s，0 错误）
cd apps/web && npx tsc --noEmit                   # 前端类型检查（19s，1 错误 TS5097）
pnpm test                                         # 129 文件 / 1,617 通过 / 99.7s
pnpm outdated -r                                  # 依赖缺口（含 registry dist-tags 核对）
node scripts/check-web-overlay.mjs                # 313 文件一致，372 反向候选
diff packages/core/src/X.ts apps/web-overlay/src/lib/X.ts   # 双份漂移量化
for p in next-auth typescript next zod; curl registry.npmjs.org/$p   # dist-tags 核对
```

**未实测项（如需补，请明确指示）**：`next build` 后首屏 JS 真实体积、Lighthouse 分数、`pnpm audit` 生产面结果。
