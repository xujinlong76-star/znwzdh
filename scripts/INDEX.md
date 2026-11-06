# scripts/ 脚本索引（INDEX）

> 本文件是给人读的中文索引：`scripts/` 下 **113 个 .mjs**（2026-11-06 实测，
> `glob scripts/*.mjs`），本轮治理只聚焦其中 `check-*.mjs` 这 **30 个门禁脚本**的真实用途。
> 用途逐份读文件头注释 / 源码采集，不是按文件名猜的。
>
> machine-readable 全量清单见 [`docs/docs-index.json`](../docs/docs-index.json) 的 `scripts.checkMjs`。
> 本文件**不修改**任何已有脚本（尤其不碰 `check-governance.mjs` 与 `verify.mjs`，由 Lead 集成）。

---

## 一句话：这些脚本是什么

`check-*.mjs` 是仓库「护栏 / 门禁」体系的静态或半动态断言：大多数**零依赖、只读、exit 非 0 即判红**，
被 pre-commit / pre-push / `pnpm verify` / CI 调用。它们防的不是「代码写错」，而是
**「本地全绿、CI 干净检出就红」「并行会话互相带半成品」「旧方案被重做」「假绿」**这类工程事故——
每个脚本头部注释都记着一次真实事故。

运行方式（通用）：`node scripts/<名字>.mjs [参数]`。具体参数看各脚本头注释或 `--help`。
**按用途分组如下。**

---

## A. 提交与并行会话完整性（防「少提交 / 带别人半成品 / 不原子」）

| 脚本 | 真实用途（摘自头部注释 / 源码） |
|---|---|
| [`check-committed-refs.mjs`](./check-committed-refs.mjs) | 提交完整性：**已跟踪文件不得引用未入库文件**（`./x`、`../x`、`@/x` 与 package.json 里的 `node scripts/x.mjs`）；`--staged` 只查暂存集，默认按 HEAD 全量查。防 2026-10-27「worker-budget.ts 没 git add → CI 两个作业同时红」 |
| [`check-commit-closure.mjs`](./check-commit-closure.mjs) | 提交闭包：判据不是「切片改了哪些文件」而是**「HEAD 缺了哪些符号」**，防少一个文件编译不过、或多带一个无关文件把别人半成品带进历史 |
| [`check-commit-atomicity.mjs`](./check-commit-atomicity.mjs) | 提交原子性：**本次提交的测试不得依赖「脏了但没提交」的文件**（源码、ci.yml、css、Dockerfile、docs/*.json 都算）。防 2026-10-29「先提交测试、源码还在暂存区 → CI 26 例红」 |

## B. 上游 / 镜像 / 边界一致性（防「本地绿、镜像或干净检出炸」）

| 脚本 | 真实用途 |
|---|---|
| [`check-upstream-ref.mjs`](./check-upstream-ref.mjs) | 上游底座 ref 四处同源：`scripts/vendor-web.mjs` 的 DEFAULT_REF / `docker/Dockerfile.web` 的 ARG / `apps/web-overlay/UPSTREAM.md` / `docker-compose.yml` build arg。防「按 --profile web 构建拉会动的 main」 |
| [`check-core-mirrors.mjs`](./check-core-mirrors.mjs) | core 镜像一致性：**读 HEAD 的提交内容**，防 `packages/core` 改了而 `apps/web-overlay` 的生成镜像没重生成（别人未提交改动不该挡我的推送） |
| [`check-web-overlay.mjs`](./check-web-overlay.mjs) | `apps/web` 与 `apps/web-overlay` 一致性：正向（overlay→web）漂移 exit 1，反向（web→overlay）只告警；可选 `--fix` 定点修复 |
| [`check-import-boundaries.mjs`](./check-import-boundaries.mjs) | 依赖边界：规则表化「谁能 import 谁」，防 overlay 直接 `export … from "@navhub/core"` 在生产镜像里 TS2307（例外仅测试目录） |
| [`check-client-node-imports.mjs`](./check-client-node-imports.mjs) | `'use client'` 够得着的任何文件不许 import node 内建模块。防 2026-10-28「node:crypto 被打进 /videos 首屏 +476 KB 且密钥外泄」 |

## C. CI / 门禁账本诚实度（防「门禁是装饰 / 聚合错 / 清单漏登记」）

| 脚本 | 真实用途 |
|---|---|
| [`check-ci-gate.mjs`](./check-ci-gate.mjs) | CI 合并门禁离线校验：解析 `.github/workflows/ci.yml` 全部 jobs 与 `ci-passed` 的 `needs` 聚合关系并逐个断言，防「本该阻塞的作业被从 needs 里删掉」 |
| [`check-gates-registry.mjs`](./check-gates-registry.mjs) | 门禁清单对账：`scripts/gates.json` ↔ pre-commit 模板 ↔ pre-push 模板 ↔ ci.yml 三向一致（登记没接线 / 接线没登记 / CI 作业缺登记都判红） |
| [`check-hooks-fresh.mjs`](./check-hooks-fresh.mjs) | 钩子新鲜度：`.git/hooks/` 生成物仍须是 `scripts/install-git-hooks.mjs` 的产物；仅 pre-commit 跑 |
| [`check-defused-thickness.mjs`](./check-defused-thickness.mjs) | 撤防账「厚度」棘轮：吃 `explain-ci-failure --defused --json` 快照只比数字，防写侧漏登记一道导致账自洽地变薄 |
| [`check-governance.mjs`](./check-governance.mjs) | **治理门禁聚合器**：把 `check-plan-status` / `check-env-surface` / `check-audit-exceptions` 三条单一事实源合成 `verify` 的一步，失败时逐条打印哪个子门禁红 |

## D. 单一事实源 / 棘轮（防「按旧方案重做 / 例外永久化 / 新变量没登记」）

| 脚本 | 真实用途 |
|---|---|
| [`check-plan-status.mjs`](./check-plan-status.mjs) | 计划项 → 落地证据收口：按**符号名 / 特征字符串**判 `docs/plan-status.json` 的 landed 证据（行号会随并行会话漂移，符号不会）；`status=landed` 无证据判红 |
| [`check-env-surface.mjs`](./check-env-surface.mjs) | 配置面登记棘轮：`process.env.NAVHUB_*` 新增未登记变量即红（against `scripts/env-surface.json` 的 knownUnregistered，只降不升） |
| [`check-audit-exceptions.mjs`](./check-audit-exceptions.mjs) | 依赖审计例外到期：每条例外须有 ghsa/reason/owner/expiresAt，今天 > expiresAt 判红；`--emit-ignore` 生成参数供 CI 用（防 ci.yml 与 workspace 手写两遍） |
| [`check-source-truth.mjs`](./check-source-truth.mjs) | 读路径事实源判据必须是**显式开关**（如 `resolveVideoStoreMode() === "db"`），不许「哪边数据多用哪边」。防 2026-10-30「按条数多的关系表供数返回幻影视频」 |

## E. 构建产物 / 覆盖率 / 体积（只读产物，不重跑测试）

| 脚本 | 真实用途 |
|---|---|
| [`check-syntax.mjs`](./check-syntax.mjs) | 语法快速门禁：用 **esbuild** 秒级解析 TS/TSX，不依赖 tsc 项目配置，与 TS 7 解耦（防 Dependabot 升级后 compiler API 消失） |
| [`check-coverage.mjs`](./check-coverage.mjs) | 覆盖率取数：只读 vitest 产出的 JSON，自己不跑测试。不传阈值只出数 exit 0；`--thresholds` 任低于阈值 exit 1；`--max-age` 防旧数据假绿 |
| [`check-bundle-budget.mjs`](./check-bundle-budget.mjs) | 首屏 JS 预算：从构建产物静态统计路由**初始 chunk**（扣异步 chunk 与只对旧浏览器的 polyfills），不用 Lighthouse |
| [`check-isr-routes.mjs`](./check-isr-routes.mjs) | ISR 路由门禁：构建产物模式（CI test-web）+ `--live --base=…` 线上形态抽查。防 Next 16 页面签名读 `searchParams` 触发 `DYNAMIC_SERVER_USAGE` **500**；`--min-checked=N` 防「0 页通过看起来像绿灯」 |
| [`check-rest-contract-coverage.mjs`](./check-rest-contract-coverage.mjs) | REST 契约覆盖率：路由表（Fastify onRoute 真实清单）↔ `RESPONSE_SCHEMA_BINDINGS` 对账，写路由 100% 绑定或进 allowlist，allowlist 只许缩小 |
| [`check-component-contracts.mjs`](./check-component-contracts.mjs) | 组件 props 契约静态检查：调用点多传未声明属性 / 必填属性在所有调用点都没传（正则非 AST，跨行展开会跳过，只做早期预警） |

## F. 依赖 / 配置 / 运行时正确性

| 脚本 | 真实用途 |
|---|---|
| [`check-deps-integrity.mjs`](./check-deps-integrity.mjs) | 依赖完整性：抓 pnpm 在 Windows 上 `ERR_PNPM_EPERM` 安装半途而废导致的「被装残的包」（只剩 README/prebuilds/src，症状误导成「代码全坏了」） |
| [`check-extensions.mjs`](./check-extensions.mjs) | 浏览器与桌面扩展规范性：Chrome Manifest V3 清单/资源/JS 语法 + Raycast 包规范、命令与入口文件存在性 |
| [`check-large-files.mjs`](./check-large-files.mjs) | 大文件入库守卫：`--staged` 默认 50 MiB（GitHub 硬限 100 MiB 的一半）/ `--unpushed` 扫未推送 blob。防 2026-10-26「141 MiB Playwright 包进本地历史、推送三连拒」 |
| [`check-cleanup-coverage.mjs`](./check-cleanup-coverage.mjs) | 清理动作覆盖每条出口（登记制 `CLEANUP_RULES`），尤其**提前 return 绕过 finally**。防 2026-10-30「删了还在」 |
| [`check-rate-limit-exemption.mjs`](./check-rate-limit-exemption.mjs) | 限流豁免的**集成**覆盖：预览站上验证「SSR 取数不再 429 → 详情页不再渲染成 noindex 壳被 ISR 缓存」，把一次性手动 A/B 变成每次 CI 都跑的断言 |

## G. 检索 / SEO / 数据流巡检

| 脚本 | 真实用途 |
|---|---|
| [`check-search-recall.mjs`](./check-search-recall.mjs) | 检索召回回归器（只读）：起盘上引擎 + **库复制到临时目录**再打开（绝不碰 `data/navhub.db` 本体），默认关语义通道保可复现，重放「某类查询根本召不回来」的缺陷探针 |
| [`check-sparsity.mjs`](./check-sparsity.mjs) | 分类稀疏度巡检：拉 `:8787/api/categories` 与 `/counts`，核验 18 个一级 / 215 个二级分类站点数 **≥20** 达标率，并抽查首页 navigation.json 与搜索 API 的权重降序、web 首页/分类页健康 |

---

## 怎么用 / 怎么维护

- **单个跑**：`node scripts/<名字>.mjs`（多数零依赖，Node >= 20；本仓实测 Node 24.22.2、`package.json` `"type": "module"`）。
- **全量跑**：`pnpm verify` / `pnpm verify:full` 由 `scripts/verify.mjs` 编排；CI 见 `.github/workflows/ci.yml`。
- **新增 `check-*.mjs`**：请同步更新 [`docs/docs-index.json`](../docs/docs-index.json) 的 `scripts.checkMjs` 清单
  （由 `scripts/gen-docs-index.mjs` 的 `CHECK_SCRIPTS` 常量维护），并在本文件对应分组补一行。
- **本轮新增**：[ `gen-docs-index.mjs` ](./gen-docs-index.mjs) 与 `metrics.json` 的生成器 `gen-docs-metrics.mjs` 一样，
  采用「默认生成 + `--check` 校验」双模式，但**它生成的是文档索引而非测试门禁**，不要误接进 `verify` 的门禁账本。
