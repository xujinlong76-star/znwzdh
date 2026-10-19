# NavHub 下一步开发计划（2026-10-19）

> 定位：功能扩张之后的**质量收敛**方案。
> 口径：本文的数字均来自本轮实测（命令与文件路径可复核）；未实测的只标「文档口径」，不写成结论。
> 协作前提：同伴正在改 `archive.ts` / `graph.ts` / `federated-recommendation.ts` / `speculative-prerender.ts` / `server.ts` / `recipes.ts` / `packages/core/src/types.ts`，本计划**不碰这些文件**。

---

## 一、结论先行（五个判断）

1. **功能扩张已到拐点。** 插件市场、搜索、DIY 工作台、AI Copilot、健康审计、团队空间、CRDT、极客工具都已闭环；Next 16 / zod 4 / vitest 5 / Node 24 也已落地。继续堆功能的边际收益在下降，**把已有能力做成可度量、可复现、可持续交付的产品**，收益更高。

2. **最大的风险不是缺功能，是门禁有缝隙。** `scripts/check-bundle-budget.mjs` 早就存在，但 **CI 和 `verify.mjs` 都没有调用它**；一次标点级语法错误就能让 main 全红一个修复周期。首屏预算、语法解析这两条线必须补上门禁。

3. **首屏还有明确的减重空间，但别指望「拆文件」自动变小。** 旧口径 `/` 约 637 KB（预算 685 KB）；2026-10-19 用 Next 16 Turbopack 的完整口径复测为 **1174 KB（57e0c3c）/ 1160 KB（b8ae238，Spotlight 懒加载后）**，其中 React/ReactDOM + Next 运行时约 500 KB 是地板。旧 637 KB 来自 webpack `app-build-manifest` 口径，未完整计入 layout/providers 共享 chunk，与新数字不可比。真正能靠工程手段拿回来的是全局 provider/浮层的懒加载与依赖替换（如 `cmdk` 约 56 KB）；拆巨型组件的主要收益是**可维护性与可测试性**，不是 KB。

4. **可观测性/安全比旧文档写的更完整，不要重复造。** `/api/metrics` 已经是 Prometheus 文本格式（`text/plain; version=0.0.4`）；CSP 已有 `NAVHUB_CSP=1`（enforce）与 `NAVHUB_CSP_REPORT_ONLY=1`（观察）双开关。剩下的只是「打开开关、收集、修依赖、再 enforce」的运维动作。

5. **同伴在做下一波功能，我的轨道应聚焦「门禁 + 首屏 + 文档 + 我的组件」。** 避免在 search/spotlight、archive/graph、federated/speculative 这些文件上与同伴抢写权。

---

## 二、实测基线（2026-10-19）

### 2.1 已落地

| 项 | 状态 | 证据 |
| :--- | :--- | :--- |
| CI | 8 个 job 全绿 | `57e0c3c`，run `39225414140` |
| 单测 | 约 1805 通过 / 147 文件 / 15 跳过 | 本地全量 vitest |
| E2E | 10 个 spec / 32 条 test | `e2e/*.spec.ts` |
| Node 24 | engines `>=24`、CI `node-version: 24`、Docker `node:24-bookworm-slim` | `package.json` / `ci.yml` / `docker/Dockerfile.*` |
| 实验标志 | `--experimental-strip-types` 已清零 | 各 package.json / 脚本 / Docker 实测无命中 |
| Next | 16.4.2 | `apps/web/package.json` |
| zod | 4.6.7（workspace 已统一 v4） | `apps/api` / `apps/web` / `packages/core` |
| vitest | 5.0.5 | 根 `package.json` |
| 指标 | `/api/metrics` 输出 Prometheus 文本 | `apps/api/src/routes/health.ts:37-40` |
| CSP | enforce + report-only 双开关 | `apps/web-overlay/next.config.js:58-95` |
| 算法镜像 | `sync-core-mirrors --check` 已进 CI | `ci.yml` check-web-overlay job |
| 覆盖层漂移 | 373 文件一致 | `check-web-overlay.mjs` |

### 2.2 仍未落地 / 有缝隙

| 项 | 现状 | 影响 |
| :--- | :--- | :--- |
| **首屏预算未进 CI** | `check:bundle` 存在，但 `ci.yml` 与 `verify.mjs` 均未调用 | 体积回退无人拦截 |
| **无快速语法门禁** | 只靠 `tsc --noEmit`（web 约 19s，根约 75s）；提交前无解析级检查 | 标点级错误可直达 main |
| README 版本陈旧 | 仍写 `Node.js v22.x`，实际 engines `>=24` | 新同学按错版本装环境 |
| 巨型组件 | `algorithm-lab` 2059 / `admin/sitelist` 1992 / `navhub-api` 1763 / `marketplace/[slug]` 1500 / `AdminDashboardClient` 1174 / `use-home-diy` 1111 / `navigation-content` 1036 | 改一处要读全文件，回归面大 |
| TS / ESLint | TS 5.9.3、ESLint 9.33（TS 7 / ESLint 10 未升） | 类型检查慢；工具链落后 |
| CSP 未 enforce | 默认关闭，只有开关 | XSS 防线未真正启用 |
| 产品项 | 搜索 2.0、PWA 深化、分享短链、移动端 DIY 拖拽未做 | 见 P2 菜单 |

---

## 三、计划总览（4 周 + 产品菜单）

主线顺序：**先补门禁（P0）→ 再减首屏/拆结构（P1）→ 再做产品（P2）→ 工具链看窗口（P3）**。

### P0｜门禁补缝（本周，1–2 天）

| 编号 | 任务 | 具体动作 | 验收 |
| :--- | :--- | :--- | :--- |
| P0-1 | 首屏预算进 CI | 在 `test-web` 的 `pnpm --filter navsphere build` 之后加 `node scripts/check-bundle-budget.mjs`；`verify.mjs` 检测到 `apps/web/.next` 时自动跑，缺失则明确提示而非静默跳过。**同时修正预算口径**：旧 637/685 KB 未完整计入 layout/providers 共享 chunk，按 57e0c3c 实测逐路由 +5% 重定 `bundle-budget.json`（`/` 1233 KB、最高路由 1294 KB），作为棘轮而非放宽 | CI 中预算超限即红；本地 build 后 `pnpm verify` 覆盖；新基线写入本文件 |
| P0-2 | 语法快速门禁 | 新增 `scripts/check-syntax.mjs`：用 TypeScript `createSourceFile(...).parseDiagnostics` 解析 `apps/api/src`、`apps/api/test`、`apps/web-overlay/src`、`apps/web-overlay/test`、`packages` 的 `.ts/.tsx/.mts/.cts`，输出 `file:line:col`（`transpileModule` 在个别文件会触发 TS 内部 "Output generation failed"，故改用纯解析路径）；接入 `verify.mjs`，并挂到 pre-commit（仅检查 staged 的 TS 文件） | 故意删一个 `}`，脚本 2s 内定位；正常树退出 0 |
| P0-3 | 文档/环境对齐 | README `v22.x → v24.x`；复核 `.env.example` 重复键（V3 P0-3 提出，本轮实测未见重复，若已修复则记录关闭）；把 2.1 基线写进 `CODEBASE_OVERVIEW` 或本文件 | 文档与 engines/CI/Docker 一致 |
| P0-4 | 首屏基线入档 | `node scripts/vendor-web.mjs` → `pnpm --filter navsphere build` → `node scripts/check-bundle-budget.mjs --json`，记录逐路由数字 | 基线 JSON/表格进 docs，作为 P1 对照 |

**2026-10-19 首屏实测（未压缩字节，Turbopack 口径）**

| 参照 | `/` | 最高路由 | HTML `<script>` 实测 |
| :--- | ---: | :--- | ---: |
| 57e0c3c（CI 绿灯基线） | 1174 KB | `/admin/navigation` 1231 KB | `/hot` 1047 KB |
| b8ae238（Stage 3–5 + Spotlight 懒加载） | 1160 KB | `/admin/navigation` 1217 KB | — |
| 新预算（各路由 +5%） | 1233 KB | 1294 KB | — |
| b7d157e（P1-1/P1-2 拆分后） | 1161 KB | `/admin/navigation` 1217 KB | — |
| 本轮 P1-3（Spotlight/AI 网关） | 1152 KB | `/admin/navigation` 1182 KB | — |
| 本轮棘轮预算（各路由 +5%） | 1210 KB | 1241 KB | — |

结论：旧 637 KB 不是同一把尺子；首轮预算比 57e0c3c 实测高 5%，只用于阻止继续增长。P1-3 后 `/` 实测 1152 KB（较 57e0c3c −22 KB，较 b7d157e −9 KB），最高路由 1182 KB（较 b7d157e −35 KB）；本轮已把预算棘轮到 1210/1241 KB。距离 P1 的 ≤1.05 MB 仍差约 77 KB：React/Next 地板约 500 KB，剩余大头是首页自身的图标/Radix/业务组件；后续优先继续拆全局浮层与首页 vendor，不为了数字牺牲交互。

**风险**：低。唯一注意：同伴的 `node_modules` 换装目录（`.nm-partial-*` / `node_modules.partial-*`）存在时不要跑 build/测试。

### P1｜首屏减重与结构拆分（第 2 周，3–5 天）

| 编号 | 任务 | 具体动作 | 验收 |
| :--- | :--- | :--- | :--- |
| P1-1 | ✅ `use-home-diy` 拆分 | 已拆为 `home-diy-storage.ts`（587 行：共享状态、localStorage、迁移、#diy 分享 hash）与 `home-diy-io.ts`（127 行：导入导出/E2EE/云金库）；hook 保留编排并用 `export *` 保持导入路径 | 主文件 594 行（≤600）；home-diy 测试全绿；行为不变 |
| P1-2 | ✅ `navigation-content` 拆分 | 实际拆为 `navigation-toolbar.tsx`（280 行）与 `navigation-category-section.tsx`（428 行）；批量操作坞、录入弹窗、主 landmark 仍留父组件 | 主文件 500 行；web 66 文件 726 测试全绿 |
| P1-3 | 首屏懒加载核查 | ✅ 已完成首轮：Spotlight 45 KB 实现改为首次 Cmd/Ctrl+K 或 `open-spotlight` 事件才加载（`global-spotlight-gateway.tsx`）；AI 抽屉改为首次 Cmd/Ctrl+J 或 `open-ai-copilot` 事件才加载（`global-ai-gateway.tsx`）；theme-runtime 动态导入实测无收益，保留静态。`ModularCanvas`/`HomeHeroDeck`/批量工具此前已动态化 | `/` 1152 KB、最高路由 1182 KB；≤1.05 MB 仍差 ~77 KB，继续但不硬压 |
| P1-4 | 预算下调 | ✅ 本轮按 P1-3 实测将 `/` 预算 1233 → 1210 KB、最高路由 1294 → 1241 KB；保留 ≤1.05 MB / ≤900 KB 为后续目标 | `bundle-budget.json` 与文档一致，CI 绿 |

**风险**：中。首页是核心 UX；用「纯重构 + 现有测试/E2E 兜底」控制，不做行为变更。回滚粒度到组件/文件。

**说明**：拆文件本身不必然减 KB；P1-3 才是体积手段，P1-1/P1-2 是可维护性手段。两者分开验收，避免「拆了但没瘦」的错觉。

### P2｜产品增值（第 3–4 周，三选一）

按「用户价值 / 与同伴冲突风险 / 工作量」排序：

| 选项 | 内容 | 工作量 | 冲突风险 | 建议 |
| :--- | :--- | :--- | :--- | :--- |
| **A. PWA 深化** | 安装引导（`beforeinstallprompt` + 访问次数门槛）、离线阅读（收藏/最近访问的 IndexedDB 快照）、SW 更新提示、离线状态条 | 3–5 天 | 低（同伴未动 `sw.js` / `pwa-register`） | **推荐先做**：底座已有（manifest/sw/离线回退），只差最后一公里 |
| **B. 搜索 2.0 可解释性** | 结果分组折叠、语法提示（`tag:` / `site:`）、命中原因、空结果引导 | 8–10 天 | **高**（同伴在做 search/spotlight/wayback） | 价值最高，但必须等同伴窗口并划分文件 |
| **C. DIY 分享短链** | `#diy=base64` 分享 + 短链服务 + 内容安全边界 | 5–8 天 | 中（`use-home-diy` 是 P1 主战场） | 增长向；需先定内容审核边界 |
| D. 移动端 DIY 拖拽 | dnd-kit 触摸传感器，替代当前的 ⬆️/⬇️ 按钮 | 3–5 天 | 低 | 体验补课，可放 P2 备选 |
| E. i18n | 中英双语 | 大 | 中 | **暂缓**：V3 结论是无证据表明缺它掉用户 |

**P2-A 首轮落地（2026-10-19，commit `8a5337d`）**

| 能力 | 落地 | 验收 |
| :--- | :--- | :--- |
| 安装引导 | `lib/install-prompt.ts` 纯判定（3 次访问门槛、14 天稍后提醒、standalone/可安装判断）+ `components/install-prompt.tsx`（`beforeinstallprompt` / `appinstalled`），挂到根布局 | 纯逻辑单测覆盖阈值/退避/standalone；首次访问不打扰 |
| 离线阅读 | 新增 `/offline` 页 + `offline-recent-list.tsx`，读取/清空本机最近访问；卡片普通点击记录，离线状态条加入口 | SW 预缓存 `/offline` 及其 `_next/static` 产物（`navhub-v4`），首次离线可打开 |
| 已有能力接线 | SW 更新提示、离线状态条此前已实现；本轮只补入口与预缓存，不重复造 | 接线守卫测试锁住布局/入口，防「写好没挂上」 |

本地验证：web 68 文件 737 测试、全仓 1826 passed / 15 skipped；root/web tsc 0；ESLint `--quiet` 0；overlay 一致；build 通过；`/` 1156 KB（预算 1210 KB）、最高路由 `/admin/navigation` 1185 KB（预算 1241 KB）。

### P3｜工具链收尾（窗口期，3–5 天）

- **TS 6 → 7（native）**：TS 7 用于 `tsc --noEmit` 门禁；`typescript@6` 留给 typescript-eslint（TS 7 暂无 compiler API）。先处理两个硬阻断：`moduleResolution: "node"` → `"bundler"`；`baseUrl` → 相对 `paths`。
- **ESLint 10**：先验证 `eslint-config-next@16.4` 与现有插件的兼容性；不兼容就只升 TS，不硬上。
- **前置条件**：同伴 archive/graph 阶段落地、`pnpm-lock.yaml` 稳定、无 `.nm-partial-*`；不同周同时动 TS 7 与 ESLint 10。
- **验收**：`pnpm typecheck` 前后耗时记录（目标 ≥5×）；typecheck / lint / build / E2E 全绿。

### P4｜运维与安全（有部署/预发环境再做）

- **CSP**：先开 `NAVHUB_CSP_REPORT_ONLY=1` + `NAVHUB_CSP_REPORT_URI` 收集一周；把 `unsafe-inline`/`unsafe-eval` 依赖收敛到 nonce/hash 后，再 `NAVHUB_CSP=1`。当前 enforce 策略仍含 `unsafe-inline`，直接开收益有限。
- **指标**：`/api/metrics` 已可 scrape；补一条格式快照测试（`# HELP` / `# TYPE` / 有界标签），文档写抓取配置。
- **备份演练**：`scripts/backup.mjs` 做一次备份→恢复→校验，步骤写进 runbook。
- **auth 决策**：next-auth v5 beta 留/拆是产品决策，单独立项；不做默认动作。

---

## 四、排期建议

| 周 | 内容 | 完成标志 |
| :--- | :--- | :--- |
| W1（本周） | P0-1 ~ P0-4 | CI 有预算门禁 + 语法门禁；基线入档 |
| W2 | P1-1 ~ P1-4 | `/` 实测下降；预算下调；E2E 32/32 |
| W3–W4 | P2-A（PWA 深化）或 P2-D（移动端拖拽） | 离线/安装/更新至少两条可验收 |
| 窗口期 | P3（TS 7 / ESLint 10） | typecheck 提速记录 + 全门禁绿 |
| 有环境时 | P4（CSP/指标/备份） | report-only 有数据；enforce 后 E2E 绿 |

---

## 五、明确不做

1. 不重写 overlay 体系（丑但能跑，且有 373 文件的漂移门禁）。
2. 不引入 prom-client / OpenTelemetry / Sentry 整套（当前瓶颈不是「看不见」）。
3. 不一次性升 31 个 Radix minor（diff 会淹没真改动）。
4. 不同周硬上 TS 7 + ESLint 10（出问题无法归因）。
5. 不为过门禁调高 `bundle-budget.json`。唯一例外是**口径修正**（旧 webpack `app-build-manifest` 口径 vs 新 Turbopack 完整口径，见 P0-4 实测表）；修正必须带实测证据、写入文档，并按新实测 +5% 设棘轮，之后只能降。
6. 不碰同伴正在改的 `archive.ts` / `graph.ts` / `federated-recommendation.ts` / `speculative-prerender.ts` / `server.ts` / `recipes.ts` / `packages/core/src/types.ts`。
7. 不在 `node_modules` 换装期间跑 install/build/长测试。

---

## 六、协作与提交纪律

- **我的轨道**：CI/门禁、`use-home-diy` / `navigation-content`、Spotlight 守卫、插件市场、文档。
- **同伴轨道**：archive/graph、federated recommendation、speculative prerender、search/spotlight 新能力、server/recipes/core types。
- **提交**：path-scoped；不 amend / 不 force-push；不提交同伴 WIP 或同伴 staged 文件；`.git/index.lock` 冲突时重试；必要时 `--no-verify` 但要在提交信息中说明。
- **同步**：`apps/web-overlay/src` 与 `apps/web/src` 本地镜像保持一致，但**不提交**镜像副本（`apps/web/test/*` 除外）。
- **红线**：F4 安全边界不变——单层 bundle；成员仅 site-pack/search-pack/theme；无嵌套 bundle、无级联卸载、无插件依赖插件图。

---

## 七、建议的下一步

**今天先做 P0-1 + P0-2**（半天到一天）：把「绿线」从「这次刚好绿」变成「门禁保证绿」。然后 P0-3/P0-4 补文档与基线；下周进入 P1。

如果只选一件事做，选 **P0-1（首屏预算进 CI）**——它是唯一一个「已经写好、只差两行接线」的高杠杆门禁。
