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
| TS / ESLint | TS 5.9.3、ESLint 10.13 | TS 7 待同伴清单与 typescript-eslint；ESLint 10 已完成 |
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

### P2 市场排版轮（2026-10-20，commits `3608c0d` / `51e9dae` / `76c3037`）

深研插件市场排版，用 Playwright 对生产构建实测 390 / 800 / 1280 / 1440 / 1920 五档宽度，发现并修掉四类真问题：

| 问题 | 根因 | 处置 |
| :--- | :--- | :--- |
| 头部描述在 640–1023px 被按钮挤成窄条 | `sm:flex-row` 过早并排 | 市场页与详情页头部改 `lg` 断点 + `min-w-0 flex-1` |
| **市场排版类不进生产 CSS** | `apps/web/src/app/*`、`components/*` 被根 .gitignore 通配忽略，Tailwind v4 的 `@source` 通配扫不到被忽略路径（registry 曾踩过同坑） | globals.css 显式补 `@source '../app/marketplace/**'` 与 `'../components/plugins/**'`；实测补前 `lg:flex-row` / `bg-card/40` / `sm:block` / `text-border/70` 全部缺席，补后齐全（CSS 164→177 KB） |
| `2xl:` 变体全仓无产物 | 本仓库 Tailwind 里 `2xl:` 工具类一律不生成（连已扫描的 navigation-content.tsx 的 `2xl:grid-cols-6` 也缺失），96rem 只出现在 container 链 | 市场页弃用 `2xl:`，改 `min-[1536px]:grid-cols-4!`（任意断点排序在命名断点之前，需 `!` 才能压过 `lg:grid-cols-3`）；实测 1280/1440 三列、1920 四列 |
| 四列窄卡下页脚「详情/安装」断行 | 页脚无换行防御 | 卡片页脚加 `flex-wrap` / `whitespace-nowrap` / `shrink-0` |

同时落地：`market-hero` 背景工具类统一市场各子页（市场/已安装/作者中心/导入/详情）、榜单前三金银铜、筛选栏工具条容器、骨架屏加载态、空状态图标、OG 分享卡更深渐变 + 光斑；新增 `marketplace-visual.test.ts` 接线守卫（锁展板类、扫描源声明、四列断点、骨架屏）。

验证（干净 worktree，vendor → tsc → eslint → build → bundle → web 测试全绿）：web 69 文件 744 测试、全仓 1833 passed / 15 skipped；`/` 1156 KB（预算 1210）、最高路由 1185 KB（预算 1241）。

**教训（协作纪律）**：`51e9dae` 曾把同伴已暂存的「AI 插件工坊」import 一并带进 `marketplace/page.tsx`（同伴新文件未提交 → CI tsc 报 Cannot find module）。已用 git plumbing 重建该文件为仅排版版本（`76c3037`，工作区文件原样保留）。后续提交前必须 `git diff --cached` 确认暂存区只含自己的路径。

**遗留（质量收敛候选）**：同样的扫描缝隙覆盖 `lib/*`、其余 `components/*`、其余 `app/*` 子树。其他页面也可能存在「用类不生效」。（`2xl:` 变体已下一轮根治，见下。）

### P2 宽屏断点根治轮（2026-10-20，commits `bf791f6` → `929666d`）

**定死因（干净 worktree 探针实验，Tailwind 4.1.12）**：`xl:` 生成 ✓、`min-[96rem]:` 生成 ✓、自定义字母断点 `--breakpoint-widescreen` + `widescreen:` 生成 ✓；而 `2xl:` 在扫描文件里、且**即使 `--breakpoint-2xl: 96rem` 显式写进 @theme 也一律不生成** → 与主题无关，是 v4 对「数字开头变体名」的解析问题（`2xl:`/`3xl:` 恒为死类）。

**修复**：全仓 8 处 `2xl:grid-cols-N` → `min-[1536px]:grid-cols-N!`（favorites / hot / tags / video-content×2 / navigation-content×3）；连带发现任意断点排序在命名断点之前——原 `min-[1920px]:grid-cols-M` 一直被 `xl:` 压制，一并加 `!`；同串内 `min-[1920px]!` 靠数值排序晚于 `min-[1536px]!` 胜出（按产物 CSS 逐一核了 important 位置）。新增守卫 `tw-variant-guard.test.ts`：源码禁止再写 `2xl:` 类。

**实拍验收**（生产构建）：首页 1920 由 4 列恢复为预期的 6 列，`/hot` 1920 恢复 5 列，1440 维持 4 列。

**流程教训（`bf791f6` CI 红的复盘）**：vendor-web.mjs 第 6 步把**整个 overlay（含 `test/`）覆盖到 `apps/web`**，`apps/web-overlay/` 才是唯一事实源；`bf791f6` 只提交了镜像 `apps/web/test/favorites-filter.test.ts`、漏了 overlay 副本（还是旧锚点），CI 用旧锚点找新页面 → `-1`，与注解 `expected -1 to be greater than -1` 完全吻合。本地验证 worktree 当时的 vendor 早于测试拷贝，掩盖了不一致——**今后凡动 `apps/web/test/*`，必须连同 overlay 副本一起提交，且改完先跑 vendor 再跑测试**。（`929666d` 补齐后 CI success，run `39306913597`。）


### P2 Tailwind 扫描根治轮（2026-10-20，commit `a4391e7`）

**引擎级定因（oxide 4.3.3 实测）**：v4 的自动源检测与 `@source` 通配在遍历时按「目录」剪枝被 `.gitignore` 忽略的路径；`@source` 的**字面前缀**落在被忽略目录内部才能正常扫描，若在目录之上，整棵子树被剪掉且**不报错**。`git check-ignore` 证实 `apps/web/src/app/*`、`components/*`、`lib/*`、`registry`、`plugins` 都是整目录通配忽略，所以 `../app/**`、`../components/**` 等整树声明贡献为零（宽泛 `../**/*` 实测只扫到 146 个未忽略文件）。

**修复**：`globals.css` 改为「宽泛行 + 每个被忽略子树一条字面 glob」，历史守卫要求的 registry / marketplace / plugins 保留独立行，其余用花括号展开。**构建实锤**：CSS 177300 → 244121 字节（+38%），类集合 1768 → 2546（+778，0 丢失）；`lg:flex-row` / `sm:flex-row` / `min-[1536px]:grid-cols-4` / `ring-offset-background` / `bg-card/40` 全部生成。

**防回归**：新增 `tw-source-coverage.test.ts`，直接调用构建同款 `@tailwindcss/oxide` 的 `Scanner.files` 计算真实扫描集，断言所有受 `.gitignore` 约束的源码文件都在集合内。**不能用 glob 字符串匹配**——旧配置在字符串匹配下同样 0 uncovered。注意 `files` 必须先于 `scan()` 取用，否则会把候选清空。

**教训**：`@source` 通配不会绕过被忽略目录；Turbopack 的 CSS 缓存不跟踪源文件改动，做扫描对照必须改配置文本并删 `.next` 重建；注释里禁止出现 `**/*` 字面（`*/` 会提前闭合块注释，esbuild 报 `Unexpected "*"`）。

### P2 常规内容页美化轮（2026-10-20，commit `da9285f`）

对齐市场轮展板语言，落到 6 个常规内容页：

| 页面 | 本轮改动 |
| :--- | :--- |
| hot | `market-hero` + 双色光斑 + Trophy 水印；热度/新品统计胶囊；骨架网格；两个 Tab 空态换 EmptyState |
| tags | `market-hero` + Tags 水印（右下避让搜索框）；标签数 / 热门数 / 覆盖计数胶囊；药丸骨架云；无数据与无匹配两种空态分开 |
| tags/[slug] | `market-hero` + Tag 图标替代 emoji；`#slug`、收录数胶囊；骨架卡网格；空态 EmptyState |
| favorites | `market-hero` + Shield 水印；本地条数 / AES-256-GCM / 零知识三胶囊；加载骨架网格 |
| site/[id] | 展板 `market-hero` + Globe 水印（下移避开健康状态胶囊）；详情骨架屏；不存在页 EmptyState |
| videos | 新增页头展板 + 分类 / 子分类 / 视频源计数；保留侧栏与播放器布局 |

实现约束：空态文案保留原有三元守卫生效（`list-degrade.test.ts` 的 `notice ? '…' : '…'` 原样保留）；favorites 骨架屏刻意不用 `min-[1536px]:grid-cols-5` 标记，避免 `favorites-filter.test.ts` 的「首个 5 列网格必须是筛选结果」断言误判。

**验证**：干净 worktree（`a4391e7` + 本轮改动）vendor → tsc 0 → eslint 0 errors（504 warnings）→ build 通过（CSS 244640 字节）→ bundle 全绿 → web 71 文件 746 测试 → overlay check OK。Playwright 生产构建实拍 1440 / 1920 两档：`/hot` 1920 五列、1440 四列；tags 云、favorites 空态、videos 页头、site 详情与 tag 详情均正常。

### P2 内容页补漏轮（2026-10-20，commit `01f7f2d`）

扫描修复后对剩余常规页做视觉审计（Playwright 生产构建，1920 / 1440 / 390 三档），补 4 个页面：

| 页面 | 本轮改动 |
| :--- | :--- |
| collections | `market-hero` + Layers 水印 + 双光斑；专题数 / 专题类型数 / 人工策划胶囊；骨架网格；两种空态 EmptyState；卡片补「查看专题」页脚 |
| collections/[slug] | 展板 + Layers 水印；收录数 / 人工策划胶囊；骨架屏；不存在与无站点两种 EmptyState |
| offline | 页头展板（WifiOff 图标 + CloudOff 水印 + 天空色光斑）；列表骨架；空态 EmptyState；记录卡改玻璃卡 + 悬浮 |
| preferences | 展板 + Sparkles 水印 + 状态胶囊（读取中 / 暂无 / 降级 / 已生成）；加载骨架；空态复用 `PROFILE_EMPTY_MESSAGE`；区块两列卡片化（不触碰同伴 `UserLlmConfigCard`） |

**数据诚实性**：`/api/collections` 列表不返回 `siteCount`，首版显示的「0 个站点」会误导；改为「有计数才显示站点数，否则显示『人工精选』」，hero 同步改为「人工策划 · 持续更新」。

**验证**：verify worktree vendor → tsc 0 → eslint 0 errors（503 warnings）→ build 通过（CSS 244232 字节）→ bundle 全绿（最高路由 1185 KB / 预算 1241 KB）→ web 71 文件 746 测试 → overlay check OK。实拍 1920 / 1440 / 390 正常，空态、骨架与悬浮态均按预期渲染。

### P3｜工具链收尾（窗口期，3–5 天）

- **ESLint 10（已完成，`34156a0`）**：`eslint@10.13.0`。`eslint-config-next@16.4` 的 peer 为 `>=9`，现有 `typescript-eslint@8.71.2` 已支持 ESLint 10。实测先撞上自身安全 override：`brace-expansion@>=2: 2.1.4` 会把 minimatch@10 需要的 v5 压回旧 API，ESLint 启动即崩；已拆成 `>=2 <5: 2.1.4` 与 `>=5: 5.0.12`。结果 0 errors / 503 warnings，web 749 测试、构建、bundle、overlay 全绿。
- **TS 7（预处理完成，升级待窗口）**：两个硬阻断已清——`baseUrl` 移除（`e93db80`）、显式 `types: ["node"]`（`81a2fab`）。隔离 worktree 实测 `typescript@7.0.2`：全量 `pnpm typecheck`、根测试 1850、web 749、构建均通过。Dependabot PR #89（TS 7.0.2）也验证了 web `tsc` 可通过；其 ESLint 与 check-syntax 失败，其中 check-syntax 已改用 esbuild（`fcfcbe2`，不依赖 compiler API）。仍有两个提交阻塞：① `apps/api` 与 `packages/*` 各自 pin `typescript: 5.9.3`，其中 `packages/ai`/`packages/store` 是同伴 WIP，不能改清单；② `typescript-eslint@8.71.2` 的 TS peer 是 `>=4.8.4 <6.1.0`，且 TS 6 无正式版，lint 必须继续用 5.9。等同伴落地 + typescript-eslint 支持 TS 7 后，按「根/API/packages 升 7、web 留 5.9 供 lint」执行。
- **前置条件**：同伴 archive/graph 落地后再动 `apps/api` 与 `packages/*` 的 TS 版本；ESLint 10 已完成。
- **验收**：typecheck 耗时对比待真正升级时记录；ESLint 10 已保持 typecheck / lint / build / web 测试全绿。

### P4｜运维与安全（有部署/预发环境再做）

- **CSP（代码/文档就绪，`f51f8d8`）**：先开 `NAVHUB_CSP_REPORT_ONLY=1` + `NAVHUB_CSP_REPORT_URI` 收集一周；把 `unsafe-inline`/`unsafe-eval` 依赖收敛到 nonce/hash 后，再 `NAVHUB_CSP=1`。当前 enforce 策略仍含 `unsafe-inline`，直接开收益有限。本轮把指令收敛为单一事实源、双开关 enforce 优先、enforce 也支持 report-uri；**实测发现 Next 的 `headers()` 在 build 时写入 routes-manifest，运行时改 env 无效**，已改为构建期语义并给 `docker/Dockerfile.web` 增加 build-arg，步骤见 `docs/CSP-ROLLOUT.md`。实际 report-only 观察仍待预发环境。
- **指标（已完成，`d07d7c3`）**：`/api/metrics` 已可 scrape；新增格式与基数守卫（`# HELP` / `# TYPE` 配对、counter/summary 约定、标签白名单、route 模板、转义、家庭快照），抓取配置与告警示例见 `docs/OBSERVABILITY.md`。顺手修正 `navhub_search_semantic_skipped_total` 的 gauge → counter。
- **备份演练（本地完成，`f51f8d8`）**：新增 `scripts/backup-drill.test.ts`（WAL 未 checkpoint 热备 + 源库缺失退出码）；本地临时库写入 50 行后不关连接直接备份，恢复校验 50 行、`integrity_check=ok`、无 `-wal/-shm` 残留。步骤与待演练项见 `docs/BACKUP-RUNBOOK.md`；生产恢复演练仍待环境。
- **auth 决策**：next-auth v5 beta 留/拆是产品决策，单独立项；不做默认动作。

**P4 验证**：web 749 测试（含新增 3 条 CSP）、API 369、`pnpm typecheck` 0、eslint 0 errors、bundle / overlay 全绿；生产构建实测 report-only 与 enforce（双开关时只下发 enforce，带 report-uri）两档响应头。**P3**：ESLint 10 已完成（`34156a0`）；TS 7 预处理完成（`e93db80` + `81a2fab`），受同伴清单与 typescript-eslint 阻塞。

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
