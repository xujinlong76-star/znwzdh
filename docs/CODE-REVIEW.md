# 代码审查流程（现行）

> 状态：**现行**。适用 `main` / `master`。
> 本文只管「审查怎么做、审什么、什么算通过」。测试该写哪一层见
> [`TESTING-CONVENTIONS.md`](TESTING-CONVENTIONS.md)；测试准入准出与覆盖率见
> [`TESTING-STRATEGY.md`](TESTING-STRATEGY.md)；CI 红了怎么查、发版前查什么见
> [`GATES-OPERATIONS.md`](GATES-OPERATIONS.md)。
>
> 一页速览（入口）见 [`REVIEW-TESTING-PROCESS.md`](REVIEW-TESTING-PROCESS.md)。

---

## 1. 角色与流程

### 1.1 四个角色

| 角色 | 做什么 | 不能做什么 |
|---|---|---|
| **作者** | 提交前自审、跑通选测、在 PR 里如实填写测试证据与风险；对 diff 每一行负责 | 不能自己 approve 自己的 PR |
| **审查者** | 至少 1 人；读 diff 全文 + **本地复跑关键命令**；按严重度分级提意见 | 不能只凭 CI 绿灯 approve |
| **领域负责人** | 对高风险域（`packages/store` 方言、`scripts` 门禁、`apps/web-overlay` a11y、`apps/api` 鉴权）强制审查 | 不能在不看 diff 的情况下盖章 |
| **合并人** | 确认 `ci-passed` 绿 + 无未解决 🔴 + 模板字段完整后合并 | 不能在 🔴 未闭环时合并 |

最小要求：任何 PR 至少 1 名审查者 approve；高风险域必须有对应领域负责人 approve（CODEOWNERS 强制项当前**未启用**，见 §5）。

### 1.2 审查触发点

1. PR 打开 / 转为 Ready for review（Draft 不强制）。
2. 作者推送新 commit → 审查者重新确认受影响部分（GitHub 会标记 stale review）。
3. CI 变红后修复重跑 → 审查者确认红因已消除，而不是「重跑就绿了」。
4. 改动 `GLOBAL_FILES`（`package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` / `vitest.config.ts` / `tsconfig.base.json` / `types/`）→ 必须附全量测试证据。

### 1.3 SLA 与升级

| 项 | 目标 |
|---|---|
| 首次响应 | 1 个工作日内；P0 热修 2 小时内 |
| 审查完成 | 小 PR 4 小时内；跨域 PR 1 个工作日内 |
| 作者响应 review | 1 个工作日内回复或改完 |

升级路径：

```
审查者提 🔴 → 作者 1 工作日未响应
  → PR 留言 @作者 + @领域负责人，标 status:blocked
  → 再 4 小时无响应 → 升级工程负责人
  → 涉及安全 / 数据损坏 → 直接升级，不等 SLA
```

紧急修复（线上事故）：允许「先合并后补审」，但 PR 描述必须标 `hotfix`，合并后 24 小时内补一次 retro review。

### 1.4 小 PR 拆分（硬性）

- 单 PR 改动 **≤400 行 diff**（不含 lock 文件与生成物），超过则拆分或说明理由。
- **禁止跨变更域大 PR**：`apps/api` + `apps/web-overlay` + `packages/store` 同时改必须拆（例外：一次 schema 变更的连带改动，需列明耦合关系）。
- 重构与功能分开；纯格式化 / 重命名单独 PR。
- **GLOBAL_FILES 改动单独 PR**：改一行 `package.json` 也会触发全量测试（本机实测全量约 27 分钟，见 `GATES-OPERATIONS.md` §4）。
- **生成物不手改**：`apps/web/**`（vendored）、`packages/*/dist/**` 由脚本生成；PR 只提交事实源 + 生成结果，并把生成命令写进描述。

### 1.5 「可合并」8 条标准

1. `ci-passed` 为绿（8 个聚合作业全 success）。
2. 至少 1 名审查者 approve；高风险域有领域负责人 approve。
3. 无未解决 🔴；🟠 已修复，或作者书面说明另开 issue 并附链接。
4. PR 模板所有字段已填（无适用内容写「不适用」）。
5. 改 `GLOBAL_FILES`：附全量测试证据（`pnpm test` + `pnpm build` 输出摘要）。
6. 含 PG 用例：注明「仅 CI 验证」，且 `test-postgres` 绿。
7. overlay 改动：`check-web-overlay` 绿 + 双镜像同步说明。
8. commit message 合规；跳钩子有书面声明（§4.2）。

---

## 2. 作者侧（提交前）

### 2.1 自审清单

- [ ] 跑过与改动域对应的选测，结果贴进 PR（命令见 §3.2）。
- [ ] `git diff --cached --name-only` 核对过：暂存区**没有别人的文件**（多会话并行时 `git add -A` 会带走他人改动——本仓已发生过）。
- [ ] 跳钩子时，commit message 里写明原因、红灯归属文件、本次自测通过了什么（§4.2）。
- [ ] overlay 改动：`apps/web-overlay/**` 与 `apps/web/**` 双镜像同步，`node scripts/check-web-overlay.mjs` 通过。
- [ ] 新增 overlay 目录已在 `apps/web-overlay/src/styles/globals.css` 登记 `@source`。
- [ ] 新增/修改 PG 用例：PR 注明「仅 CI 验证」。
- [ ] diff 里没有密钥 / 凭证 / 内网地址（`AUTH_SECRET`、`NAVHUB_INTERNAL_TOKEN`、连接串）。
- [ ] 新增测试做过 fail-before-pass 验证（`node scripts/verify-guard.mjs`）。

### 2.2 提交纪律

- 提交一律走 `node scripts/safe-commit.mjs`（或至少提交前用 `--dry-run` 核对路径）。
- 一次提交只做一件事；不要把格式化、重命名与行为变更混在一起。
- 改动 `GLOBAL_FILES` 的提交单独一个 commit，便于定位「哪一步触发了全量」。

---

## 3. 审查者侧

### 3.1 六问（按顺序问）

1. **层选对了吗？** 断言的是行为还是源码字符串？字符串级事实写 L4（慢且随注释漂移）→ 打回；行为事实只写 L1（源码改了照样绿）→ 打回。
2. **能 fail-before-pass 吗？** 把被测代码临时改坏，这条测试会红吗？不会 = 假测试。
3. **是假绿吗？** 检查 `test.skip`、PG 静默 skip、空分母（sitemap 族下限缺失）、mock 前缀错误、只断言 `toBeTruthy()`。
4. **守卫排除注释了吗？** `not.toContain` 会被「注释里引用了旧代码」顶掉，要求行首锚定正则。
5. **overlay 同步了吗？** `apps/web-overlay/test/` 改了要镜像到 `apps/web/test/`，两份都提交。
6. **GLOBAL_FILES 跑全量了吗？** 改 `package.json` / `vitest.config.ts` 的 PR，证据必须是全量日志。

### 3.2 按变更域的审查清单

#### 3.2.1 `apps/api`

- 端点契约：新增/修改路由在 `apps/api/src/routes/**`，入参/出参用 zod schema。
- 写操作全部经 zod 校验；非法入参返回 400 而非 500。
- 多表写入包在 `withTransaction` 内；回滚场景有测试。
- 新端点落入 `@fastify/rate-limit`；公开端点是否会被打穿。
- `config.scope` 声明正确（public / read / write / admin）；拼错会让路由「人人 403」。
- scope 不足时走 `auditAuthFailure("auth.scope_denied", ...)`。
- 命令：`pnpm --filter @navhub/api test`（本机约 3 分钟）；单文件 `node node_modules/vitest/vitest.mjs run apps/api/test/<file>.test.ts`。

#### 3.2.2 `packages/store`

- 双方言兼容：占位符（SQLite `?` vs PG `$n`）、`ON CONFLICT`、`COUNT(DISTINCT)` 不硬编码，走方言分支或 `sql-in.ts` / `sql-like.ts`。
- 迁移脚本有向上/向下兼容策略；PG schema 同步。
- 事务并发与 await 隔离有断言。
- PG 用例本地 skip 正常，但 PR 必须注明「仅 CI 验证」，且 `pnpm test:pg:suite` 在 CI 真的执行。
- 命令：`pnpm --filter @navhub/store test`（本机约 124 秒）。

#### 3.2.3 `apps/web-overlay`

- 五条 a11y 门禁：`field-names`、`nested-interactive`、`keyboard-activation`、`a11y-contrast`、`design-system`。
- **mock 路径必须带 `/api/hub` 前缀**：`hubUrl()` 会把 `/api/backup/restore` 归一成 `/api/hub/backup/restore`。写错 = 请求真打后端污染数据，且真实响应文案与 mock 一致 → 「看起来正常」的假绿。
- 新增目录登记 `@source`，否则 `tw-source-coverage.test.ts` 会红。
- 双镜像同步 + `pnpm check:overlay` 通过。
- 改了 `packages/core` 的前端运行时副本：`node scripts/sync-core-mirrors.mjs --check`。
- 命令：`node node_modules/vitest/vitest.mjs run apps/web/test`（本机约 2.5 分钟）；`pnpm --filter navsphere exec tsc --noEmit && pnpm --filter navsphere exec eslint .`。

#### 3.2.4 `scripts`

- 不许「假绿」模式：静默 skip、无匹配时 `exit 0` 兜底、`catch {}` 吞错、`passWithNoTests`、`continue-on-error` 滥用。
- 守卫必须显式失败（缺环境变量 exit≠0，而不是 skip）。
- 新增/改门禁脚本必须配套 `scripts/*.test.ts`，且测试要验证「删掉关键项确实会红」。
- 改 `.github/workflows/ci.yml` 后跑 `node scripts/check-ci-gate.mjs`。
- 阈值不许为上绿而下调（`bundle-budget.json` 等）。
- 命令：`node node_modules/vitest/vitest.mjs run scripts`。

#### 3.2.5 `e2e`

- 断言「发了什么请求」而非「显示了什么」；toast 有两份 DOM（可见 + `aria-live`），用 `.first()`。
- 独立库 `data/e2e/navhub-e2e.db`；不得写开发库。
- `fullyParallel: false`、`workers: 1`；新 spec 不得依赖并行假设或跨 spec 共享状态。
- mock 带 `/api/hub` 前缀；不得 `reuseExistingServer`。
- 新 spec 必须 `--repeat-each=3` 全绿才提 PR。
- 命令：`node scripts/e2e-local.mjs`（不要裸 `playwright test`）。

#### 3.2.6 配置类（`GLOBAL_FILES`）

- 必须跑全量 `pnpm test` + `pnpm build`，并在 PR 贴证据。
- `pnpm-lock.yaml` 只含本 PR 引入的依赖变化，无无关版本漂移。
- 改 `vitest.config.ts` 的 `include` / `coverage`：附 `pnpm coverage` 前后对比，并同步 `coverage-thresholds.json`。

### 3.3 严重度分级

| 级别 | 含义 | 处理要求 | 本仓示例 |
|---|---|---|---|
| 🔴 阻塞 | 安全漏洞 / 数据损坏 / **假绿门禁** / 破坏性变更无迁移 | 必须修复才能合并 | 端点 scope 拼错（人人 403）；mock 缺 `/api/hub` 前缀导致请求真打后端；PG 套件静默 skip 仍绿灯；多表写入未包事务；硬编码密钥 |
| 🟠 应改 | 正确性缺陷 / 性能隐患 / 可维护性明显问题 | 本 PR 修复，或书面说明另开 issue | 方言硬编码；非法入参返回 500；`getByText` 断言 toast；漏登记 `@source`；新增脚本无测试 |
| 🟡 建议 | 可读性 / 一致性 / 更优实现 | 酌情采纳，不阻塞 | 命名不清晰；重复代码可抽函数；用例命名不表意 |
| ⚡ nit | 风格偏好 | 可忽略 | 空行/缩进；import 排序 |

规则：**一个 🔴 即 request changes**；🟠 累计 ≥3 也 request changes；「假绿门禁」类问题一律 🔴。评论前缀标注级别：`🔴 [blocker]` / `🟠 [should]` / `🟡 [suggest]` / `⚡ [nit]`。

### 3.4 三条「直接拒」

1. 用 `--no-verify` 或 `NAVHUB_SKIP_PRECOMMIT=1` 提交，且 commit message 未写明红灯归属与自测内容。
2. 为过覆盖率门禁加 `/* v8 ignore */` 且无理由、无审查确认。
3. 新增端点没有 L3 集成用例（只有 L1 守卫或只有 E2E）。

---

## 4. commit 规范

### 4.1 格式

```
<type>(<scope>): <subject>

<body 可选：为什么改、影响面、实测数字>

<footer 可选：BREAKING CHANGE / Refs / 跳钩子三行>
```

- **type**：`feat` / `fix` / `refactor` / `perf` / `test` / `docs` / `chore` / `security` / `build` / `ci`。
- **scope**：`api` / `store` / `ai` / `core` / `mcp` / `web` / `overlay` / `scripts` / `e2e` / `ci` / `deps`。
- **subject**：中文或英文均可，≤72 字符，祈使句，不以句号结尾。

### 4.2 跳钩子三行声明（强制）

使用 `NAVHUB_SKIP_PRECOMMIT=1` 或 `git commit --no-verify` 时，footer 必须包含：

```
Skip-Precommit: NAVHUB_SKIP_PRECOMMIT=1
Skip-Precommit-Red: apps/api/test/backup-restore-job.test.ts（红因是他人未提交改动，非本次引入）
Skip-Precommit-Selftest: node scripts/verify-guard.mjs --all → 6/6 有效
```

语义边界：

- `Skip-Precommit` 声明「跳了」；
- `Skip-Precommit-Red` 声明「红灯属于谁」——只写「有 1 例失败」等于没写；
- `Skip-Precommit-Selftest` 声明「另做了什么验证」，这是允许跳过的**唯一对价**。

`Skip-Precommit-Red` 必须指向**不属于本 PR** 的文件；若红灯在本 PR 文件里，不允许跳过，必须先修。`commit-msg` 钩子会校验这三行（先 warning，稳定后转硬拦截）。

### 4.3 破坏性变更

```
feat(store)!: 迁移脚本改为双阶段执行

BREAKING CHANGE: 旧库需先跑 `node apps/api/src/migrate.ts` 再启动；
回滚需执行 scripts/backup.mjs 恢复。
```

---

## 5. CODEOWNERS 与分支保护（只写差异项）

`.github/CODEOWNERS` 已提交，但**当前未启用** `Require review from Code Owners`。

- 原因：少人仓库启用强制审查会锁死合并（作者无法自我 approve），而锁死的门禁必然被绕过。
- 启用条件：常驻审查者 ≥2 人，且完成一次反向验收（改 `/.github/workflows/ci.yml` 的 PR 未获 owner approve 时 Merge 必须被禁用）。
- `@navhub/*` 是占位名，启用前必须替换为真实 GitHub 账号/团队。

网页端操作步骤、required checks、验收方法见 [`CI-BRANCH-PROTECTION.md`](CI-BRANCH-PROTECTION.md) §2；本节只列**差异项**：

| 选项 | 建议 | 说明 |
|---|---|---|
| Required approvals | 1 | 核心路径靠 CODEOWNERS 抬到 2（启用后） |
| Dismiss stale approvals on new commits | 勾选 | 防止「审的是旧代码」 |
| Require review from Code Owners | **暂不勾选** | 见上 |
| Require linear history | 勾选 | 禁 merge commit，统一 squash/rebase |
| Require conversation resolution | 勾选 | 审查意见必须闭环 |
| Do not allow bypassing | 勾选 | 管理员也不能绕过；事故时临时关规则并留记录 |

---

## 6. 审查反模式（15 条）

| # | 反模式 | 后果 | 正确做法 |
|---|---|---|---|
| 1 | 只看 diff 不跑选测 | CI 红在别处才发现；「重跑就绿」掩盖真问题 | 本地跑对应域命令并贴结果 |
| 2 | 用 approve 代替验证 | 假绿门禁 / 方言 bug 被放行 | 高风险域必须本地复跑 |
| 3 | 跨目录大 PR | 无法归因、审查疲劳、回滚困难 | ≤400 行，按域拆 |
| 4 | 只看 CI 绿就合并 | 聚合关系可能被改（漏 `needs`） | 合并前确认 `pnpm check:ci-gate` |
| 5 | 「重跑就绿」当已修复 | 掩盖 flaky / 竞态 | 定位红因；flake 单独开 issue |
| 6 | 接受静默 skip / `exit 0` 兜底 | 门禁假绿 | 一律 🔴 |
| 7 | mock 路径不带 `/api/hub` | 请求真打后端污染数据且「看起来正常」 | 逐条核对 `page.route` |
| 8 | 跳过钩子不写声明 | 无法判断红灯归属与自测范围 | 三行 footer 强制 |
| 9 | `git add -A` 带走他人文件 | commit 混入他人改动，`git log` 失真 | 提交前核对暂存区 |
| 10 | 生成物手改 | 下次 vendor 被覆盖、双镜像漂移 | 改事实源 + 跑生成脚本 |
| 11 | 为新功能上调阈值 | 门禁形同虚设 | 先优化再按真实产物重定基线 |
| 12 | 只写 E2E 不写 L1 守卫 | CI 慢、失败定位到整页 | 按四层选择规则 |
| 13 | 用 L1 守卫测行为 | 行为坏了照样绿 | 行为用 L3/L4 |
| 14 | review 只挑 nit 不提 blocker | 真问题被风格噪声淹没 | 先列 🔴/🟠，nit 折叠 |
| 15 | 无回滚方案的迁移 PR | 出问题无法恢复 | 模板「风险与回滚」必填 |

---

## 附录 A：PR 模板字段说明

模板本体在 [`.github/pull_request_template.md`](../.github/pull_request_template.md)。字段设计意图：

| 字段 | 为什么要有 |
|---|---|
| 变更摘要 | 强制写「为什么」，避免只贴 diff |
| 变更类型 | 决定审查重点与 commit type |
| 影响域 | 决定选测范围与领域负责人 |
| 测试证据 | 区分「跑过」与「以为没问题」；要求贴 3–10 行真实输出 |
| 本仓特别字段 6 项 | 覆盖本仓最容易踩的六个坑（GLOBAL_FILES / PG skip / 双镜像 / 跳钩子 / 暂存区 / `@source`） |
| 风险与回滚 | 高风险改动必须事先想好退路 |
| 审查者核对 | 把审查清单变成可勾选项，避免「只挑 nit」 |

## 附录 B：审查清单

**唯一副本在 PR 模板的「审查者核对」小节**，本文不复写（两处清单必然有一处先过期）。域内追加项见 §3.2。
