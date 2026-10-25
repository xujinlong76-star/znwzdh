# NavHub 代码审查与测试保障流程搭建方案

**日期**：2026-10-25
**工作流**：工作流 2（系统设计）· 流程体系搭建
**参与成员**：Cody（代码审查师）/ Tessa（测试专家）/ Rex（SRE 工程师）/ Docu（技术文档师）
**主理人**：甄宇航（工程督导）

---

## 📌 TL;DR（执行摘要）

- **整体结论**：本仓的工程基建（四层测试约定、8 作业聚合门禁、暂存区选测钩子、PG 环境守卫）已达行业中上水平；真正缺的是"人"的流程——审查无清单、覆盖率无门禁、变更类型与测试层无映射、flake 无台账。四位成员已产出可直接落地的完整方案：**1 入口 + 3 分册 + 2 模板/机制文件 + 7 项决策 + 12 条行动项**。
- **严重度分布**：🔴 严重 2 项 / 🟠 高 6 项 / 🟡 中 4 项 / 🟢 低 2 项（共 14 项缺口）。
- **阻塞 / 非阻塞**：2 项阻塞（审查流程完全缺位、覆盖率零门禁）不阻塞现有交付，但在落地前不能宣称"流程已建立"；其余 12 项为非阻塞改进。
- **本次交付性质**：**设计 + 可复制模板**，未修改仓库任何文件；所有命令、路径、阈值均对齐当前仓库实况（扫描时刻 2026-10-25）。

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| 整体评级 | 🟡 有条件通过（方案就绪，待落地执行） |
| 阻塞项数量 | 2（审查流程缺位、覆盖率零门禁） |
| 关键行动项 | 12 条（P0 4 条 / P1 4 条 / P2 4 条） |
| 建议下一步 | 本周做 W0 覆盖率基线 + 提交 PR 模板与 CODEOWNERS + 起文档骨架；两周内接 commit-msg 钩子与覆盖率观察期 |

---

## 一、需求与目标

### 1.1 目标

把"靠人自觉"的代码审查与测试，变成**有清单、有门禁、有证据、有归因**的可执行流程，且不推翻现有基建。

### 1.2 三条设计原则

1. **左移**：能在本地拦的（秒级）不留到 CI；能在 CI 拦的不留到合并后。
2. **单一事实源**：同一事实只有一个"现行"出处，其余位置放链接（复制必然漂移）。
3. **不许假绿**：门禁失败必须显性；静默 skip、exit 0 兜底、`continue-on-error` 滥用一律视为阻塞级缺陷。

### 1.3 非目标（明确不做）

- 不追求 100% 覆盖率（目标态为全局 70%，见 §5.3）。
- 不新增 CI 作业（覆盖率复用 `test-sqlite`；`pr-hygiene` 仅作为未来可选项）。
- 不改业务代码、不调整现有门禁阈值、不动 `ci-passed` 聚合关系。

---

## 二、现状盘点

### 2.1 已有基建（强项，必须保留）

| 能力 | 实现 | 位置 |
|---|---|---|
| 四层测试约定（含本机实测成本） | L1 源码守卫 1–5s / L2 纯函数 1–10s / L3 集成 10–30s / L4 E2E 2–4min | `docs/TESTING-CONVENTIONS.md` |
| 全量单测 | vitest 5.0.5，pool forks / maxWorkers 3，5 个测试根 | `vitest.config.ts` |
| 覆盖率取数 | v8，只统计 `apps/api/src` + `packages/*/src`，只出数不判定 | `scripts/check-coverage.mjs` |
| E2E | Playwright，独立库 `data/e2e/navhub-e2e.db`，workers=1 | `playwright.config.ts` |
| 跨方言测试 | PG 套件带 `NAVHUB_TEST_DATABASE_URL` 守卫（缺失即失败） | `scripts/run-pg-suite.mjs` |
| 提交前门禁 | overlay `--staged` 对齐、扩展/上游 ref、语法、typecheck、暂存区选测 | `scripts/install-git-hooks.mjs` |
| 推送前门禁 | 语法/overlay/CI 门禁/core 镜像/扩展/lint/typecheck/全量测试 | `scripts/verify.mjs` |
| CI | **10 个作业定义**：8 个聚合必过 + `seo-audit-prod`（条件）+ `ci-passed`（闸门） | `.github/workflows/ci.yml` |
| 聚合闸门自检 | 断言 `ci-passed.needs` 覆盖 8 作业、逐个读 result、`if: always()` 存在 | `scripts/check-ci-gate.mjs` + `apps/web/test/ci-gate.test.ts` |
| 分支保护文档 | 网页端操作步骤 + 反向验收方法（故意让 PG 红） | `docs/CI-BRANCH-PROTECTION.md` |

> 口径说明：`ci.yml` 实际有 10 个作业（`test-sqlite`、`test-postgres`、`test-web`、`check-isr-live`、`check-web-overlay`、`test-e2e`、`docker-smoke`、`audit`、`seo-audit-prod`、`ci-passed`），其中前 8 个进入 `ci-passed.needs` 与 `REQUIRED_JOBS`。`seo-audit-prod` 带 `if: github.event_name == 'workflow_dispatch' && vars.NAVHUB_SITE_URL != ''`，PR 下必然 skipped，故**故意不聚合**（见 ADR-4）。

### 2.2 缺口清单（14 项，按严重度排序）

| # | 严重度 | 缺口 | 后果 | 来源 |
|---|---|---|---|---|
| 1 | 🔴 严重 | 无正式代码审查流程：无 PR 模板、无审查清单、无 SLA、无 commit 规范 | 审查质量取决于个人自觉；跨域改动无人兜底 | Cody |
| 2 | 🔴 严重 | 覆盖率零门禁：只出数，无阈值、无 patch 覆盖、无新增文件拦截 | 覆盖率可静默退化；「整文件零覆盖的写端点」只能靠人工比对发现 | Tessa |
| 3 | 🟠 高 | 无「变更类型 × 必跑测试层」矩阵，DoD 未定义 | 同一类改动不同人跑不同测试；审查者不知道该要什么证据 | Tessa |
| 4 | 🟠 高 | E2E `retries: 2` 无 flake 台账与隔离机制 | 重试把 flake 变成绿灯；不稳定用例长期污染红灯信号 | Tessa |
| 5 | 🟠 高 | `commit-msg` 钩子不存在，跳钩子声明无机器校验 | 跳钩子的三行声明只能靠自觉；`git log` 无法追溯红灯归属 | Docu/Rex |
| 6 | 🟠 高 | 仓库特有陷阱未进审查清单（`/api/hub` 前缀、双镜像、GLOBAL_FILES 全量） | 假绿测试与漂移只能靠踩坑发现 | Cody |
| 7 | 🟠 高 | 部署前无成文 Go/No-Go 清单；`backup.mjs` 仅支持 SQLite | 发布依赖记忆；PG 部署无备份路径 | Rex |
| 8 | 🟠 高 | 分支保护仅配 `ci-passed`：无 required approvals、dismiss stale、linear history | 审查通过无强制力；旧 approve 可合并新代码 | Rex |
| 9 | 🟡 中 | 覆盖率产物 `clean: false` 会留上一轮残留 | 可能读到旧数据 → 假绿（需 `--max-age` 兜底） | Tessa |
| 10 | 🟡 中 | `check-coverage.mjs` 参数语义反直觉（`--max-lines` 实为最低阈值） | 误用即静默失效 | Tessa |
| 11 | 🟡 中 | 无流程入口文档，新人无上手路径 | 上手靠口口相传 | Docu |
| 12 | 🟡 中 | `seo-audit-prod` 为何不聚合无文档说明 | 后人可能"顺手补进 needs"→ 每个 PR 永久红 | Docu/主理人 |
| 13 | 🟢 低 | CI 长尾：`check-isr-live` 18–25m、`test-e2e` 15–25m | 反馈慢，但不阻塞 | Rex |
| 14 | 🟢 低 | `docker-smoke` 无层缓存 | 冷构建 8–15m，可降至 3–5m | Rex |

---

## 三、高层设计：四层门禁体系

把新增与既有检查按"拦截时机"分层，同一检查只在一层"硬"，其他层只提示。

| 层 | 触发时机 | 承载检查 | 耗时预算 | 失败后果 |
|---|---|---|---|---|
| **L0 提交前**（pre-commit，已存在） | 每次 `git commit` | overlay `--staged` 对齐、扩展/上游 ref、语法、typecheck、**暂存区选测** | 30s–6min | 阻止提交 |
| **L0.5 提交信息**（commit-msg，**新增**） | 每次 `git commit` | Conventional Commits 格式 + 跳钩子三行 footer | <1s | 阻止提交（先 warning 两周） |
| **L1 推送前**（`pnpm verify`，已存在） | 手工/约定 | 7 项门禁 + 全量 vitest + 首屏预算（有产物时） | ~9min | 阻止推送（约定，非强制） |
| **L2 CI**（10 作业 / 8 聚合，已存在 + 覆盖率增强） | PR / push | 单测与覆盖率、双方言、前端 tsc/eslint/build、overlay 一致性、ISR 契约、E2E、镜像、审计 | 10–25min/作业 | 阻止合并 |
| **L3 分支保护**（已配 `ci-passed`，待补齐） | 合并 | `ci-passed` 唯一必经 + required approvals + dismiss stale + linear history + conversation resolution | — | 阻止合并 |
| **L4 部署前**（Go/No-Go，**新增**） | 发布 | SHA 打 tag、备份、迁移顺序、健康检查、回滚演练 | ~30min | 阻止发布 |

设计要点：

- **覆盖率只在 L2 判定**。pre-commit 是"暂存区选测子集"，算覆盖率是假数字；`pnpm verify` 加 `--coverage` 会让本地多 1–2 分钟，违背"本地快、CI 全"的分工。
- **commit 规范只能在 L0.5 拦**。CI 看到的是 PR 标题/压缩后信息，原始 message 只有本地拿得到。
- **PR 模板校验先做人看的模板**，`pr-hygiene` 作业作为未来可选项（需走五处联动，见 §6.2）。

---

## 四、代码审查流程（Cody 产出）

### 4.1 角色与 SLA

| 角色 | 职责 | 本仓对应 |
|---|---|---|
| 作者 | 提交前自审、跑通选测、如实填写测试证据与风险 | 提交人 |
| 审查者 | 至少 1 人；读 diff + **本地复跑关键命令**；按严重度分级 | 同域工程师 |
| 领域负责人 | 对高风险域（store 方言 / scripts 门禁 / overlay a11y / api 鉴权）强制审查 | 见 CODEOWNERS |
| 合并人 | 确认 `ci-passed` 绿 + 无 🔴 + 模板字段完整后合并 | 作者或领域负责人 |

| SLA 项 | 目标 |
|---|---|
| 首次响应 | 1 个工作日内；P0 热修 2 小时内 |
| 审查完成 | 小 PR 4 小时内；跨域 PR 1 个工作日内 |
| 作者响应 | 1 个工作日内 |
| 阻塞升级 | 超 SLA → @领域负责人 → 再 4 小时 → 升级工程总监；安全/数据损坏直接升级 |

### 4.2 小 PR 硬性规则

- 单 PR 改动 **≤400 行 diff**（不含 lock 文件与生成物）。
- **禁止跨变更域大 PR**（`apps/api` + `apps/web-overlay` + `packages/store` 同时改必须拆，除非一次 schema 变更的连带改动并说明耦合）。
- 重构与功能分开；纯格式化/重命名单独 PR。
- **GLOBAL_FILES 改动单独 PR**（改一行 `package.json` 也要跑全量 ~9 分钟）。
- **生成物不手改**（`apps/web/**`、`dist/**` 由脚本生成，只提交事实源 + 生成结果）。

### 4.3 PR 模板（可直接提交 `.github/pull_request_template.md`）

```markdown
<!--
标题格式：<type>(<scope>): <subject>（Conventional Commits，见 docs/CODE-REVIEW.md §4）
必答项没有适用内容时写「不适用」，不要留空——空白无法区分「没想过」和「不需要」。
模板字段与审查清单是同一份，改这里要同步 docs/CODE-REVIEW.md 附录 B。
-->

## 变更摘要

<!-- 三句话以内：改了什么、为什么现在改、不改会怎样。写「为什么」，不要复述 diff。 -->

## 变更类型

- [ ] `feat` 新功能
- [ ] `fix` 缺陷修复
- [ ] `refactor` 重构（行为不变）
- [ ] `perf` 性能
- [ ] `test` 只改测试
- [ ] `docs` 只改文档
- [ ] `build` / `ci` 构建与流水线
- [ ] `chore` 杂项

## 影响域

- [ ] `apps/api`
- [ ] `packages/store`（含 SQL / 迁移）
- [ ] `packages/core` / `packages/ai` / `packages/mcp`
- [ ] `apps/web-overlay`（前端事实源）
- [ ] `scripts/`（门禁与工具脚本）
- [ ] `e2e/`
- [ ] `GLOBAL_FILES`（`package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` / `vitest.config.ts` / `tsconfig.base.json` / `types/`）
- [ ] 仅 `docs/` 或注释

## 测试证据

- [ ] 本地已跑 `pnpm verify`；若未跑，在下方写明跳过的原因
- [ ] 新增/修改的**守卫类**测试做过反向验证（`node scripts/verify-guard.mjs`：故意改坏源码，确认测试变红）
- [ ] 受影响的 E2E 用 `node scripts/e2e-local.mjs` 跑过（不是裸 `playwright test`，后者共用端口/库）
- [ ] PG 相关用例已标注「仅 CI 验证」

```
（贴 3–10 行关键输出，不要贴整段日志）
```

## 本仓特别字段（6 项必答）

1. **是否改动 `GLOBAL_FILES`？** 否 / 是：列出文件，并说明为什么不能拆成独立 PR
2. **是否含仅 CI 验证的 PG 用例？** 否 / 是：列出文件名（本地无 `NAVHUB_TEST_DATABASE_URL` 时 skip 是正常的）
3. **overlay 是否双镜像同步？** 不涉及 / 是：`pnpm check:overlay` 通过（贴一行输出）
4. **是否跳过 pre-commit？** 否 / 是：在 commit message 里补三行 footer
5. **暂存区是否已核对无他人文件？** 是：`node scripts/safe-commit.mjs --dry-run -- <path...>` 只列出本次路径
6. **新增 overlay 目录是否已登记 `@source`？** 不涉及 / 是：已加到 `apps/web-overlay/src/styles/globals.css`

<details>
<summary>追加两项（改了 SQL 或新增测试时填）</summary>

7. **是否含双方言 SQL？** 否 / 是：差异点（占位符 `?` vs `$1`、`ON CONFLICT`、`COUNT(DISTINCT)`、事务并发）
8. **新增测试的层级与实测成本？** 例：L1 ×5（~5 秒）+ L3 ×1（~12 秒）

</details>

## 风险与回滚

- **风险等级**：低 / 中 / 高（高 = 合并前走 `docs/GATES-OPERATIONS.md` §6 的 Go/No-Go 清单）
- **回滚方式**：revert 本 PR 是否足够；涉及迁移或数据写入时写清数据回滚步骤
- **迁移**：无 / 有 —— 是否可逆、执行顺序（migrate 必须先于 seed）、CWD 必须是仓库根

## 审查者核对

- [ ] 读过 diff 全文，不只看摘要与截图
- [ ] 在本地或 CI 上真的跑过受影响的测试，不是只看「绿灯」
- [ ] 断言检查的是行为或请求，不是源码文本、不是 toast 文案
- [ ] mock 路径带 `/api/hub` 前缀（写错会打到真实后端且看起来正常）
- [ ] 门禁脚本改动有自测，且**没有下调阈值**
- [ ] 迁移有回滚方案，且 migrate 在 seed 之前
- [ ] 生成物（`apps/web/src`、`apps/web/test`）没有被手改
- [ ] 严重度已标注（🔴 / 🟠 / 🟡 / ⚡），无未回复的 🔴
```

### 4.4 按变更域的审查清单

| 域 | 必查项 | 命令 |
|---|---|---|
| `apps/api` | 端点契约与 zod schema 一致；写操作走 `withTransaction`；scope 声明正确（拼错会「人人 403」）；限流覆盖；鉴权失败有审计 | `pnpm --filter @navhub/api test`（~3min） |
| `packages/store` | 双方言兼容（占位符 `?` vs `$n`、`ON CONFLICT`、`COUNT(DISTINCT)`）；迁移向上/向下兼容；事务并发与 await 隔离 | `pnpm --filter @navhub/store test`（~124s） |
| `apps/web-overlay` | 五条 a11y 门禁（field-names / nested-interactive / keyboard-activation / a11y-contrast / design-system）；`@source` 已登记；`/api/hub` mock 前缀；双镜像同步；core 镜像一致 | `node node_modules/vitest/vitest.mjs run apps/web/test`（~2.5min） |
| `scripts` | 无「假绿」模式（静默 skip / exit 0 兜底 / `passWithNoTests` / `continue-on-error` 滥用）；守卫显式失败；有 `*.test.ts` 与反向用例；阈值不许下调 | `node node_modules/vitest/vitest.mjs run scripts` |
| `e2e` | 断言「发了什么请求」而非「显示了什么」；独立库与端口隔离；`fullyParallel:false` / `workers:1` 前提；`/api/hub` 前缀 | `pnpm test:e2e`（2–4min） |
| 配置类（GLOBAL_FILES） | 必须跑全量并在 PR 贴证据；lock 文件无无关版本漂移 | `pnpm test && pnpm build`（~9min） |

### 4.5 严重度分级

| 级别 | 含义 | 处理要求 | 本仓示例 |
|---|---|---|---|
| 🔴 阻塞 | 安全漏洞 / 数据损坏 / **假绿门禁** / 破坏性变更无迁移 | 必须修复才能合并 | 端点 scope 拼错（人人 403）；mock 缺 `/api/hub` 前缀导致请求真打后端；PG 套件静默 skip 仍绿灯；多表写入未包事务 |
| 🟠 应改 | 正确性缺陷 / 性能隐患 / 可维护性明显问题 | 本 PR 修复，或书面说明另开 issue 并附链接 | 方言硬编码；非法入参返回 500；`getByText` 断言 toast；漏登记 `@source` |
| 🟡 建议 | 可读性 / 一致性 / 更优实现 | 酌情采纳，不阻塞 | 命名不清晰；重复代码可抽函数；用例命名不表意 |
| ⚡ nit | 风格偏好 | 可忽略 | 空行/缩进；import 排序 |

规则：一个 🔴 即 request changes；🟠 累计 ≥3 也 request changes；「假绿门禁」类问题一律 🔴。

### 4.6 commit 规范与跳钩子声明

格式：`<type>(<scope>): <subject>` + 可选 body/footer；type 为 `feat/fix/refactor/perf/test/docs/chore/security/build/ci`；scope 为 `api/store/ai/core/mcp/web/overlay/scripts/e2e/ci/deps`。

跳钩子（`NAVHUB_SKIP_PRECOMMIT=1` 或 `--no-verify`）必须补三行 footer：

```
Skip-Precommit: NAVHUB_SKIP_PRECOMMIT=1
Skip-Precommit-Red: apps/api/test/backup-restore-job.test.ts（红因是他人未提交改动，非本次引入）
Skip-Precommit-Selftest: node scripts/verify-guard.mjs --all → 6/6 有效
```

语义边界：`Skip-Precommit` 声明「跳了」；`Skip-Precommit-Red` 声明「红灯属于谁」（只写「有 1 例失败」等于没写）；`Skip-Precommit-Selftest` 声明「另做了什么验证」，这是允许跳过的**唯一对价**。`Skip-Precommit-Red` 必须指向**不属于本 PR** 的文件；若红灯在本 PR 文件里，不允许跳过。

### 4.7 CODEOWNERS（提交文件，但暂不启用强制审查）

```gitignore
# NavHub CODEOWNERS — 按 monorepo 目录分配审查责任
# owner 名按实际团队账号替换；当前阶段只提交文件，不在分支保护里勾选强制审查（见 ADR-3）
*                                   @navhub/core-maintainers

/apps/api/src/server.ts             @navhub/backend-owners
/apps/api/src/routes/               @navhub/backend-owners
/apps/api/src/auth.ts               @navhub/backend-owners
/apps/api/src/migrate.ts            @navhub/backend-owners @navhub/store-owners
/packages/store/                    @navhub/store-owners
/packages/store/src/driver.ts       @navhub/store-owners

/apps/web-overlay/src/              @navhub/frontend-owners
/apps/web-overlay/src/styles/globals.css  @navhub/frontend-owners
/apps/web-overlay/test/             @navhub/frontend-owners
/apps/web/                          @navhub/frontend-owners

/packages/core/                     @navhub/core-owners
/packages/ai/                       @navhub/ai-owners
/packages/mcp/                      @navhub/ai-owners
/packages/sdk/                      @navhub/core-owners

/scripts/                           @navhub/quality-owners
/scripts/install-git-hooks.mjs      @navhub/quality-owners
/scripts/run-pg-suite.mjs           @navhub/quality-owners @navhub/store-owners
/e2e/                               @navhub/quality-owners
/playwright.config.ts               @navhub/quality-owners

/.github/                           @navhub/core-maintainers @navhub/quality-owners
/package.json                       @navhub/core-maintainers
/pnpm-lock.yaml                     @navhub/core-maintainers
/pnpm-workspace.yaml                @navhub/core-maintainers
/vitest.config.ts                   @navhub/quality-owners
/tsconfig.base.json                 @navhub/core-maintainers
/types/                             @navhub/core-maintainers
/docker/                            @navhub/core-maintainers
/Dockerfile                         @navhub/core-maintainers

/docs/                              @navhub/docs-owners
```

### 4.8 15 条审查反模式

| # | 反模式 | 后果 | 正确做法 |
|---|---|---|---|
| 1 | 只看 diff 不跑选测 | CI 红在别处才发现；「重跑就绿」掩盖真问题 | 本地跑对应域命令并贴结果 |
| 2 | 用 approve 代替验证 | 假绿门禁/方言 bug 被放行 | 高风险域必须本地复跑 |
| 3 | 跨目录大 PR | 无法归因、审查疲劳、回滚困难 | ≤400 行，按域拆 |
| 4 | 只看 CI 绿就合并 | 聚合关系可能被改（漏 `needs`） | 合并前确认 `pnpm check:ci-gate` |
| 5 | 「重跑就绿」当已修复 | 掩盖 flaky / 竞态 | 定位红因；flake 单独开 issue |
| 6 | 接受静默 skip / exit 0 兜底 | 门禁假绿 | 一律 🔴 |
| 7 | mock 路径不带 `/api/hub` | 请求真打后端污染数据且「看起来正常」 | 逐条核对 `page.route` |
| 8 | 跳过钩子不写声明 | 无法判断红灯归属与自测范围 | 三行 footer 强制 |
| 9 | `git add -A` 带走他人文件 | commit 混入他人改动，`git log` 失真 | 提交前核对暂存区 |
| 10 | 生成物手改 | 下次 vendor 被覆盖、双镜像漂移 | 改事实源 + 跑生成脚本 |
| 11 | 为新功能上调阈值 | 门禁形同虚设 | 先优化再按真实产物重定基线 |
| 12 | 只写 E2E 不写 L1 守卫 | CI 慢、失败定位到整页 | 按四层选择规则 |
| 13 | 用 L1 守卫测行为 | 行为坏了照样绿 | 行为用 L3/L4 |
| 14 | review 只挑 nit 不提 blocker | 真问题被风格噪声淹没 | 先列 🔴/🟠，nit 折叠 |
| 15 | 无回滚方案的迁移 PR | 出问题无法恢复 | 模板「风险与回滚」必填 |

### 4.9 「可合并」8 条标准

1. `ci-passed` 为绿（8 作业全 success）。
2. 至少 1 名审查者 approve；高风险域有领域负责人 approve。
3. 无未解决的 🔴；🟠 已修复或书面说明另开 issue 并附链接。
4. PR 模板所有字段已填。
5. 改 GLOBAL_FILES：附全量测试证据。
6. 含 PG 用例：注明「仅 CI 验证」且 `test-postgres` 绿。
7. overlay 改动：`check-web-overlay` 绿 + 双镜像说明。
8. commit message 合规；跳钩子有书面声明。

---

## 五、测试保障策略（Tessa 产出）

### 5.1 准入准出矩阵（10 类变更）

| # | 变更类型 | 本地必跑 | CI 必跑 | 审查证据 | 准出条件 |
|---|---|---|---|---|---|
| 1 | 纯 docs | 无测试（钩子 SKIP 正常），typecheck 仍执行 | 全部作业照跑 | PR 注明「仅文档」；暂存集只有 docs | 无代码文件混入 |
| 2 | 单包源码 | `vitest run packages/X/test`（钩子自动选中） | test-sqlite | 该包测试全绿日志 | 区域覆盖率不低于 floor；改动行 ≥70% |
| 3 | 跨包改动 | 全量 `vitest run`（~9min） | test-sqlite + test-postgres（触及 store SQL 时） | 全量日志；列出受影响包与接线点 | 全量绿 + ≥1 条 L3 覆盖新接线 |
| 4 | GLOBAL_FILES | 强制全量（钩子已实现） | test-sqlite + test-web（涉及构建时） | 全量绿；改 `vitest.config.ts` 覆盖率口径附前后对比 | 覆盖率未下降；口径变化显式说明 |
| 5 | 前端 overlay | `pnpm check:overlay` + `vitest run apps/web/test`（~2.5min） | test-web + check-web-overlay + test-e2e（触及交互时） | overlay 字节一致；`@source` 已登记；五条 a11y 守卫绿 | check-web-overlay 绿 + 五条守卫绿 |
| 6 | 新增 API 端点 | `apps/api/test`（~3min）；必须写 L3 | test-sqlite；双方言 SQL 加 test-postgres | 「三件套」：成功路径 / 4xx 含 reason / 鉴权 401-403 | 三件套缺一不可；端点文件 lines ≥60%（假设值） |
| 7 | 迁移与 SQL | `packages/store/test` + `apps/api/test`；迁移在临时库跑一次 | test-sqlite + test-postgres（必须） | 迁移幂等用例（连跑两次）；兼容/回滚说明；PG 注明「仅 CI 验证」 | 幂等用例存在 + test-postgres 绿 |
| 8 | 门禁脚本自身 | `vitest run scripts` | test-sqlite | 正例 + 反例；手工跑真实仓库验证退出码 | 有反向用例；只测 happy path 不接受 |
| 9 | 新增 E2E | 单文件 → 全量；`--repeat-each=3` | test-e2e | 遵守 7 条红线 | 3 连跑全绿；mock 前缀正确；断言请求而非文案 |
| 10 | 新增 PG 用例 | 本地 skip 属正常 | test-postgres（`test:pg:suite` 守卫） | PR 注明「仅 CI 验证」+ 用例名 | test-postgres 绿；不接受「本地 skip 即通过」 |

通用红线：任何 PR 不得以「本地跳过」代替证据；跳过一次 pre-commit 必须按 §4.6 三行声明。

### 5.2 覆盖率门禁：四层阈值架构

| 层 | 内容 | 初始值 | 语义 |
|---|---|---|---|
| A 全局 floor | lines / functions / branches / statements | 首轮实测向下取整（假设 lines 50% / functions 55% / branches 45% / statements 50%，**待 W0 实测校准**） | ratchet，只升不降 |
| B 分区域 floor | `apps/api`、`packages/store`、`packages/core`、`packages/ai`、`packages/mcp` 各自判定 | 各区域实测 | 防止高覆盖区域掩盖低覆盖区域 |
| C 关键文件 floor | `packages/store/src/repository.ts`（目标 80%）、`apps/api/src/server.ts`（75%）、`apps/api/src/auth.ts` 与 `config.ts`（85%）、`packages/ai/src/ssrf.ts`（90%）、`apps/api/src/routes/*.ts`（60% 起步） | 首轮实测 | 数据/安全边界必须高 |
| D 改动行覆盖 | patch 改动行 ≥70%；新增文件 ≥50%（首轮）；新增文件 0% 直接 fail | 固定 | 防「存量不动、新增裸奔」 |

阈值外置到仓库根 `coverage-thresholds.json`（纳入版本控制），结构：

```json
{
  "global": { "lines": 50, "functions": 55, "branches": 45, "statements": 50 },
  "areas": { "apps/api": { "lines": 55 }, "packages/store": { "lines": 60 } },
  "files": { "packages/store/src/repository.ts": { "lines": 80 } },
  "ignore": ["packages/core/src/types.ts"]
}
```

### 5.3 分批收紧路线图

为什么不能一步到位（三条，本仓都发生过）：

1. 存量基线未测，一刀切会让门禁第一天就红 → 第一反应是加 `continue-on-error` 或 `--no-verify`，门禁从此等于不存在。
2. 低覆盖区域补测是数周工作量，混在功能 PR 里会拖慢交付并催生垃圾测试。
3. ratchet 的正确姿势是「先钉住现状，再按固定节奏抬」：红灯只指向「这次改动让数字掉了」，而不是「历史欠账」。

| 阶段 | 时间 | 全局 lines | 关键文件 | 门禁动作 |
|---|---|---|---|---|
| W0 基线周 | 10/27–10/31 | 只出数不判定 | 只记录 | 跑 `--json`，基线写入 `coverage-thresholds.json` |
| W1 钉住 | 11/03–11/14 | 基线 − 2（容差） | = 实测 | CI 硬门禁上线（test-sqlite 内） |
| W3 | 11/17–11/28 | 基线 + 2 | 实测 + 3 | patch 覆盖 ≥70% 同步上线 |
| W5 | 12/01–12/12 | 基线 + 4 | 实测 + 6 | 新增零覆盖文件拦截上线 |
| W7 | 12/15–12/26 | 基线 + 6 | 实测 + 9 | 分区域 floor 独立判定 |
| W9 | 12/29–01/09 | 基线 + 8 | 实测 + 12 | 全局 ≥65%，关键文件 ≥75% |
| 目标态 | 2027 Q1 末 | 70% | repository 80% / server 75% / auth 85% | 稳定 ratchet |

规则补充：每两周的收紧必须是**独立 PR**（只改 `coverage-thresholds.json`）；连续 3 个功能 PR 因同一阈值红灯 → 回退 1pp 并留痕；允许回退，但禁止「悄悄调低」。

### 5.4 防退化四机制

1. **patch 覆盖**：`node scripts/check-coverage.mjs --patch --base=origin/main --min-patch-lines 70`；用 `git diff --unified=0` 取改动行 + `coverage-final.json` 的 statementMap 映射；分母 <10 行跳过判定；删除行不计；纯 re-export/类型文件进 ignore 清单（逐条列出，不许通配）。
2. **新增零覆盖文件拦截**：PR 新增的 `apps/api/src/**`、`packages/*/src/**` 文件 lines=0 直接 fail；例外仅 `*.d.ts`、纯类型、入口 re-export。
3. **反「为过门禁写垃圾测试」**：新增测试需在 PR 附 fail-before-pass 证据（把被测代码临时改坏，测试变红）；审查者每周抽查 1/3；每周随机抽 3 个新增测试检查断言强度；`/* v8 ignore */` 必须带理由 + 审查确认。
4. **ratchet 本身是主防线**：垃圾测试不增加覆盖，加了也过不了「只升不降」。

### 5.5 `check-coverage.mjs` 增强清单（P0）

现状（已核对源码）：支持 `--max-lines / --max-functions / --json / --zero`；不传阈值永远 exit 0；`branches` 只算不判定；无分区域/文件级/patch/新增文件判定；`--max-*` 实为「最低阈值」。

| # | 能力 | 说明 |
|---|---|---|
| 1 | `--min-lines / --min-functions / --min-branches / --min-statements` | 语义纠正；`--max-*` 保留为 deprecated 别名 |
| 2 | `--thresholds coverage-thresholds.json` | 读取外置阈值（全局/区域/文件/ignore） |
| 3 | `--require-covered-new` | 新增文件零覆盖 → fail（读 `git diff --diff-filter=A`） |
| 4 | `--patch --base=origin/main --min-patch-lines 70` | 改动行覆盖 |
| 5 | `::error::` 注解 | 每条失败一行，格式 `[coverage] path lines 68.2% < 阈值 75%（差 6.8pp）`，日志末尾附 Top 5 + 未覆盖行区间 |
| 6 | `--max-age <minutes>` | 产物 mtime 超阈值视为旧数据，exit 2（`clean:false` 的假绿入口） |

P1：`--per-area`、`--changed-files`、`--github-summary`、`--json` 增加 `uncoveredLines`。P2：不使用 vitest 原生 `coverage.thresholds`（两套阈值会打架）、`--list-zero`。

### 5.6 CI 落点与失败呈现

- **复用 `test-sqlite`**，把 `pnpm test` 改为：
  `pnpm exec vitest run --coverage && node scripts/check-coverage.mjs --thresholds coverage-thresholds.json --patch --base=origin/${{ github.base_ref }}`
  （push 到 main 时 `--patch` 退化为全量，base 用 `HEAD~1`）
- **不新开作业**：覆盖率必须复用同一次 vitest 运行；另起作业要再跑 ~9 分钟且引入环境噪声。
- **timeout**：20m → 25m（v8 插桩 +15~25%）；若实测 >22m，回退方案是拆独立作业但需接受两次运行。
- **失败呈现三层**：① 每条阈值失败一个 `::error::` 注解；② 日志末尾表格（区域/文件数/零覆盖/lines/functions/branches/阈值/结果）；③ 上传 `coverage-summary.json` 为 artifact（14 天）。
- **冷启动**：W1 上线当周若某 PR 本身低于基线，允许其指向 W0 基线文件合并，但同一 PR 内必须把 thresholds 更新到新基线。

### 5.7 E2E / flake 政策

现状评估：`retries: CI 2 / 本地 0`，workers=1，timeout 90s。**保留 retries=2**（单 Worker + 真实浏览器 + Next 编译，抖动客观存在；去掉会让 CI 噪声化进而被 `--no-verify` 绕过），但必须配 flake 台账。

**flake 四条判定**（任一即 flake）：① 同一次运行内失败→重试通过；② 同一测试 7 天内在 ≥2 个无关 PR 失败；③ 本地 `--repeat-each=3` 复现 ≥1 次；④ 失败指向超时/竞态而非断言值不符。

**quarantine 流程**：用 `{ tag: '@quarantine' }` 或标题前缀 `[quarantine]`（不用 `test.fixme`，等于删除）；登记 `e2e/QUARANTINE.md`（测试名/首次 flake 日期/失败签名/归属人/到期日 ≤14 天）；主 E2E 作业加 `--grep-invert @quarantine`，隔离用例进 `test-e2e-quarantine`（`continue-on-error: true`）保证仍在跑；14 天未修复 → 修好或删除并记录能力缺口。

**复活机制**：隔离作业连续 5 次全绿 → 任何人可提 PR 去 tag（附 5 次运行链接）；复活后 7 天内再 flake → 直接删除，降级为 L3 覆盖，不允许二次隔离；每次复活必须写明「当初为什么 flake」。

**7 条 E2E 红线**：① mock 必须带 `/api/hub` 前缀；② 断言「发了什么」而非「显示了什么」；③ toast 双 DOM 用 `.first()`；④ 不得 `reuseExistingServer`、不得复用开发库；⑤ 新 spec 必须 `--repeat-each=3` 全绿；⑥ 自查 mock 是否生效（handler 里 `console.log` 或断言调用次数）；⑦ 禁止固定 `sleep`，用 `expect.poll` / `waitForResponse`。

### 5.8 测试计划模板（7 要素）

1. **风险声明**：这次改动最可能坏什么（数据完整性/鉴权/并发/兼容性），按风险排序。
2. **选层依据表**：事实形态 → 层（字符串级 L1 / 纯逻辑 L2 / 端点契约 L3 / 必须跑起来 L4），逐条列；禁止「都写 E2E」。
3. **用例清单**：ID | 层 | 前置 | 步骤 | 断言（可判定）| 优先级。必含成功路径、≥1 条 4xx（含 reason）、≥1 条鉴权拒绝、≥1 条边界（空值/超长/并发）。
4. **数据准备**：用哪个库、如何清理、是否幂等（迁移类必须连跑两次）。
5. **本地/CI 分工**：PG 用例必须注明「仅 CI 验证」。
6. **准出标准**：新增文件覆盖率目标、是否新开 E2E（flake 风险）、回滚观察点。
7. **不测什么 + 为什么**：显式声明盲区，比假装全覆盖更有价值。

### 5.9 审查者 6 问 + 3 条直接拒

**6 问**：① 层选对了吗（断言行为还是源码字符串）？② 能 fail-before-pass 吗？③ 是假绿吗（`test.skip` / PG 静默 skip / 空分母 / mock 前缀错 / 只断言 truthy）？④ 守卫排除注释了吗（行首锚定正则）？⑤ overlay 同步了吗？⑥ GLOBAL_FILES 跑全量了吗？

**3 条直接拒**：① 跳钩子且 commit message 未写明红灯归属与自测内容；② 为过覆盖率加 `/* v8 ignore */` 且无理由无审查；③ 新增端点没有 L3 集成用例。

---

## 六、门禁集成与运维（Rex 产出）

### 6.1 分层接入表

| 拟新增检查 | 落点 | 理由 | 耗时 |
|---|---|---|---|
| commit 信息规范 | **commit-msg 钩子**（新增） | 原始 message 只有本地拿得到；CI 看到的是 PR 标题/压缩后信息 | <1s |
| 覆盖率门禁 | **CI `test-sqlite` 硬门禁**；`pnpm verify` 只出数 | 覆盖率必须基于全量测试；pre-commit 是子集，算覆盖率是假数字 | +1–2min |
| PR 模板校验 | 阶段 1 只落模板；阶段 2 可选 `pr-hygiene` 作业读 `github.event.pull_request.body` | 先看遵守率再上硬门禁 | 0s / <1min |
| 锁文件一致性 | 已有 `pnpm install --frozen-lockfile` | 无需新增 | — |

覆盖率分阶段：**阶段 A（观察 2 周）** `--coverage` + `continue-on-error: true`，只出数与零覆盖 Top 20；**阶段 B（硬门禁）** 按基线向下取整 5 个点设阈值。禁止把阈值写死在脚本里；本地 `pnpm coverage` 永不判定。

### 6.2 CI 改动「五处联动」checklist（+ 第 6 处文档）

> **适用范围（必须写进文档）**：只在**新增/删除/改名 CI 作业**时全套适用。改既有作业的 steps（如覆盖率接入 `test-sqlite`）**不碰聚合闸门**，只需同步 timeout 与文档。

1. `ci.yml`：作业定义本身（`timeout-minutes` / `runs-on` / `steps`）。
2. `ci.yml`：`ci-passed.needs` 数组加入作业名。
3. `ci.yml`：`ci-passed` 评估脚本加 `[ "${{ needs.<job>.result }}" != "success" ] ||` 分支 + 一行 echo。
4. `scripts/check-ci-gate.mjs`：`REQUIRED_JOBS` 加入作业名。
5. `apps/web/test/ci-gate.test.ts`：正向用例的作业数同步；反向用例的 needs 精确字符串同步；为新作业补一条「删掉它必须变红」。
6. `docs/CI-BRANCH-PROTECTION.md`：聚合树、示例输出、作业数同步。

验证：`pnpm check:ci-gate` → `pnpm exec vitest run apps/web/test/ci-gate.test.ts` → `pnpm verify`。CI 侧验收：故意让新作业红一次，确认 `ci-passed` 红、Merge 被禁用。

**硬约束**：`ci-passed` 把 `skipped` 也算失败。任何「只在 PR 事件跑」的新作业必须设计成 push 事件下也 success（内部判空 exit 0），否则 push 到 main 永久红。

### 6.3 CI 时长预算

| 作业 | timeout | 估计实际 | 长尾原因 |
|---|---|---|---|
| test-sqlite | 20m（→25m） | 10–14m | typecheck + 全量 vitest + build 串行 |
| test-postgres | 20m | 8–12m | pgvector 冷启动 + 两套件 |
| test-web | 25m | 12–18m | `next build` 是最大单项（8–12m） |
| check-web-overlay | 15m | 6–8m | vendor 重建 + 5 项比对 |
| check-isr-live | 30m | 18–25m | 长尾第一：install+vendor+build+双进程+限流四阶段 |
| test-e2e | 30m | 15–25m | 长尾第二：playwright install + 全量 spec |
| docker-smoke | 30m | 8–15m | 两次 docker build，无层缓存时最坏 |
| audit | 10m | 2–3m | 依赖 npmjs 网络 |

优化建议（按收益）：① `docker-smoke` 加 `cache-from/cache-to: type=gha`（8–15m → 3–5m，零联动成本）；② 不建议 vitest `--shard` 拆片（未接近 timeout，只增加 runner 分钟数）；③ `check-isr-live` 短期不动（拆「限流豁免」会新增作业，须走五处联动）。

### 6.4 红灯归因 runbook

| 作业 | 第一反应 | 假红/归因陷阱 |
|---|---|---|
| test-sqlite | 按步骤定位：typecheck → lint:backend（continue-on-error，不会红）→ vendor → vitest → build。`Cannot find package '@/lib/auth'` = 忘了 vendor；build 红 = 声明导出/入口路径坏 | lint:backend 是 warning 级，红了也不是它 |
| test-postgres | 先看是 `test:pg:suite` 还是 `test:pg` 红。suite 报「未设置 NAVHUB_TEST_DATABASE_URL —— 拒绝执行」= 作业配置坏了，不是代码；有 URL 仍红 = 真跨方言缺陷 | 把变量设成 `DATABASE_URL` 是死变量 → 整体 skip → 假绿 |
| test-web | 按步骤序：tsc → eslint（warning 不卡）→ next build → bundle budget → check-isr-routes。budget 红**不许上调** `bundle-budget.json`；ISR 红 = 路由从 ● 退化成 ƒ 或页面读了 `searchParams` | `next.config` 的 `ignoreBuildErrors` 只影响 build，不影响 tsc 步骤 |
| check-web-overlay | 先问「是不是直接改了 `apps/web`」；事实源是 `apps/web-overlay/`，重跑 `node scripts/vendor-web.mjs`；再查 core 镜像漂移与上游 ref 同源 | `apps/web` 是 gitignore 生成物，全新检出必须先 vendor |
| check-isr-live | 读 3 条 `::error::` 做三层归因：判据数字 / 输出尾部 600 字符 / 收录面族计数。族整族归零但抽到的页全绿 = sitemap 生成侧问题；`120s 内没有 /site/*` = 中枢失联或 seed 空 | 限流阶段 `rc=2` = 缺 `NAVHUB_INTERNAL_TOKEN`；「预检失败…是降级壳」先查 3000 端口占用者，别怀疑业务代码；**不要**重启 web 来「修」（凭据是模块顶层常量） |
| test-e2e | 读 annotation 的「失败用例：」清单与「报错抽样」，本地 `playwright test <spec> --grep "<标题>"` 单跑；下载 playwright-report | 全量共享 server，超时类红灯先看是否被前一个 spec 拖慢 |
| docker-smoke | 看是 API 还是 Web 镜像红。API：`--frozen-lockfile` 安装阶段（原生编译依赖 / prepare 钩子）；Web：上游底座拉取失败 | 不要因网络抖动删 `--frozen-lockfile` |
| audit | 必须 `--registry=https://registry.npmjs.org`；已知例外 `GHSA-vfj7-8cjw-p6xm`（braces，dev-only）用 `--ignore` | 改 `.npmrc` 或去掉 `--registry` 会得到假红 |
| 覆盖率（新增） | 退出码 **2 = 找不到产物**（查 `reportsDirectory` / 清理开关）；**1 = 真低于阈值**（`--zero 20` 定位文件） | 禁止在同一 PR 里下调阈值；要么补测，要么单独 PR 说明 |

### 6.5 部署前 Go/No-Go 清单

**Go（发布前，全部勾选）**

- [ ] 部署 commit 的 `ci-passed` 为 success（不是「最近一次大概绿」）。
- [ ] 发布机 `pnpm verify` 绿 + `pnpm verify:web` 绿（前端门禁不在 verify 里）。
- [ ] 镜像用 **SHA 打 tag**：`docker build -f docker/Dockerfile.api -t navhub/api:<sha> .`（当前 compose 写死 `navhub/api:0.1.0`，建议改 `${NAVHUB_IMAGE_TAG:-0.1.0}`，否则回滚无镜像可退）。
- [ ] `node scripts/check-upstream-ref.mjs` 通过（vendor 脚本 / Dockerfile / UPSTREAM.md 三处同源）。
- [ ] 备份：`node scripts/backup.mjs`（默认保留 35 份），输出含 `integrity_check=ok`；**注意 backup 仅支持 SQLite**，PG 部署需 `pg_dump`（当前无脚本，列为缺口）。
- [ ] 数据兼容性：确认迁移无破坏性变更；有则先备份 + 书面 sign-off + 准备回滚脚本。
- [ ] 环境变量：`NAVHUB_SESSION_SECRET` / `NAVHUB_IDENTITY_SECRET` / `NAVHUB_INTERNAL_TOKEN` 两侧同值；`NAVHUB_AUTH_REQUIRED=1` 时 `NAVHUB_IDENTITY_SECRET` 需 ≥32 字符。

**部署顺序（不可颠倒）**：① `node apps/api/src/migrate.ts`（CWD 必须是仓库根，`NAVHUB_SQLITE_PATH` 默认 cwd 相对）→ ② `pnpm seed`（seed 不建表）→ ③ 起 API 并等 `/api/ready` 通过（不是 `/api/health`）→ ④ 起 Web，验证 `/` 与 `/sitemap.xml` 含 `/site/*`。

**回滚**：镜像 `NAVHUB_IMAGE_TAG=<上一 SHA> docker compose up -d`；数据：停容器 → 替换 db → 删 `-wal/-shm` → 起容器（不要在运行中覆盖 db）；回滚后验证 `/api/ready` 200 + 抽查 3 页 + 登录可用。

### 6.6 分支保护差异项（在 `docs/CI-BRANCH-PROTECTION.md` 基础上补）

| 选项 | 建议 | 理由 |
|---|---|---|
| Require a pull request before merging | 勾选 | 已有 |
| → Required approvals | 1（默认） | 小团队可合并；核心路径靠 CODEOWNERS 抬到 2 |
| → Dismiss stale approvals on new commits | **勾选** | 防止「审的是旧代码」 |
| Require status checks → 只加 `CI 整体通过 (All Checks Passed)` | 勾选 | 不逐个勾子作业（新增作业要回来改配置，必漏） |
| → Require branches up to date | 勾选 | 已有 |
| Require review from Code Owners | **暂不勾选**（ADR-3） | 单人/少人仓库会锁死合并；待 ≥2 名常驻审查者再开 |
| Require linear history | **勾选** | 禁 merge commit，统一 squash/rebase |
| Require conversation resolution | **勾选** | 审查意见必须闭环 |
| Do not allow bypassing the above settings | **勾选** | 管理员也不能绕过（事故时临时关规则并留记录） |

**验收两步**：① 沿用 PG 红验收（临时让 `test-postgres` 红 → `ci-passed` 红、Merge 禁用）；② CODEOWNERS 验收（改 `/.github/workflows/ci.yml` 的 PR，未获 owner approve 时 Merge 必须禁用）——第 ② 步在启用强制审查后执行。

### 6.7 可观测性

- **Annotation 三级**：`::error::` 只用于阻断性失败，固定三段（门禁名+rc+关键数字 / 输出尾部 ≤600 字符 / 分层归因），**无条件发送**（不按 grep 匹配行发，脚本抛异常时会一行不剩）；`::warning::` 用于不阻断的漂移；`::notice::` 用于绿灯留证据（如限流豁免四阶段计数）。
- **安全红线**：annotation 里只许出现凭据**长度**，永不打值。
- **Artifact**：一律 `retention-days: 14` + `if-no-files-found: ignore`；新增覆盖率上传 `coverage-summary.json`（`if: always()`）。
- **失败日志**：长驻进程作业末尾加 `if: ${{ failure() }}` 的 `tail -80`（`check-isr-live` 模式）；不要在失败时用 `pgrep -f "next start"` 找进程（Next 会改 `process.title`），要记 PID 文件；CI 一次性环境直接 SIGKILL（SIGTERM 的 30s drain 会超过等待窗口）。

---

## 七、文档结构（Docu 产出）

### 7.1 形态：1 入口 + 3 分册 + 2 模板/机制

| 文件 | 角色 | 来源 | 篇幅 |
|---|---|---|---|
| `docs/REVIEW-TESTING-PROCESS.md` | 入口：一页看懂「我这个 PR 要做什么」 | 三人摘要 | ~200 行 |
| `docs/CODE-REVIEW.md` | 分册：审查流程、域清单、严重度、commit、反模式 | Cody | ~550 行 |
| `docs/TESTING-STRATEGY.md` | 分册：准入准出、覆盖率门禁、防退化、flake | Tessa | ~500 行 |
| `docs/GATES-OPERATIONS.md` | 分册：门禁接入、五处联动、红灯 runbook、Go/No-Go | Rex | ~450 行 |
| `.github/pull_request_template.md` | 模板：PR 正文骨架 | Cody（Docu 润色） | ~80 行 |
| `coverage-thresholds.json` | 机制：阈值外置，改阈值不改代码 | Tessa | ~20 行 |

**为什么不写单文件**：① 读者与触发时机不同（写 PR 的人要清单，CI 红的人要 runbook）；② 更新频率与责任人不同，单文件把每次小改放大成跨域 diff，本仓多会话并行下冲突面积最大；③ 与 `docs/INDEX.md`「我要做什么 → 看哪份」的检索模型一致。

### 7.2 内容归属矩阵（同一事实只有一个现行出处）

| 内容 | 归属 | 其他文档 |
|---|---|---|
| L1–L4 四层定义、实测成本、选层规则 | `TESTING-CONVENTIONS.md` §1–§3 | 测试策略 §1 一句话 + 链接 |
| 本仓具体测试约定（overlay 镜像、`@source`、a11y 范围、守卫排除注释、`/api/hub`、PG skip） | `TESTING-CONVENTIONS.md` §4 | 审查清单只写「触发条件 + 链接」 |
| 分支保护网页端操作步骤 + 验收 | `CI-BRANCH-PROTECTION.md` §2 | 审查分册 §5 / 运维分册 §7 只写差异项 |
| `ci-passed` 聚合关系 | `CI-BRANCH-PROTECTION.md` §1 | 运维分册 §3 写「要改哪五处」+ 链接 |
| PR 模板字段与审查清单 | `.github/pull_request_template.md` | `CODE-REVIEW.md` 附录只放字段说明，**不放第二份清单** |
| 覆盖率阈值数字 | `coverage-thresholds.json` | 文档只写架构与路线图 |
| 文档索引 | `docs/INDEX.md` | 新增 4 行 |
| 项目是什么、怎么跑 | `README.md` | **只加一行**指向入口页 |

### 7.3 落地文件清单（按依赖排序）

| # | 路径 | 动作 | 负责人 | 依赖 |
|---|---|---|---|---|
| 1 | `docs/CODE-REVIEW.md` | 新建 | 文档 / Cody 定稿 | — |
| 2 | `docs/TESTING-STRATEGY.md` | 新建 | 文档 / Tessa 定稿 | — |
| 3 | `docs/GATES-OPERATIONS.md` | 新建 | 文档 / Rex 定稿 | — |
| 4 | `docs/REVIEW-TESTING-PROCESS.md` | 新建（入口，最后写） | 文档 | 1–3 |
| 5 | `.github/pull_request_template.md` | 新建 | 文档 / Cody 定稿 | — |
| 6 | `.github/CODEOWNERS` | 新建（不启用强制，ADR-3） | Cody | — |
| 7 | `coverage-thresholds.json` | 新建（先落 W0 基线） | Tessa | — |
| 8 | `scripts/check-coverage.mjs` | 修改（P0 六项，**新增**而非替换） | Tessa / Rex | 7 |
| 9 | `.github/workflows/ci.yml` | 只改 `test-sqlite` 的 steps + timeout 20→25 | Rex | 7, 8 |
| 10 | `apps/web/test/ci-gate.test.ts` | **不动**（未新增作业） | — | — |
| 11 | `scripts/check-ci-gate.mjs` | **不动**（`REQUIRED_JOBS` 维持 8） | — | — |
| 12 | `docs/CI-BRANCH-PROTECTION.md` | 改时长说明 | Rex | 9 |
| 13 | `scripts/install-git-hooks.mjs` | 扩展：生成 `commit-msg` 钩子（当前不存在） | Rex | 5 |
| 14 | `e2e/QUARANTINE.md` | 新建 | Tessa | — |
| 15 | `docs/INDEX.md` | +4 行 | 文档 | 1–4 |
| 16 | `README.md` | +1 行 | 文档 | 4 |

### 7.4 文档维护规则（触发事件 → 必须同步）

| 触发事件 | 必须同步 |
|---|---|
| 新增 CI 作业 | 五处联动 + `CI-BRANCH-PROTECTION.md` 聚合图 + `GATES-OPERATIONS.md` §3 §4 §5 |
| 调整覆盖率阈值 | 只改 `coverage-thresholds.json`；路线图打勾；上调需在 PR 写「为什么现在能上调」 |
| 新增变更域 | `CODE-REVIEW.md` §3.2 加一节 + `TESTING-STRATEGY.md` §2 加一行 + `TESTING-CONVENTIONS.md` §4 加约定 + 分区域 floor |
| 新增门禁脚本 | `GATES-OPERATIONS.md` §1 加一行 + `guard-recipes.json` 登记反向验证配方；必须有 `*.test.ts` |
| 改 pre-commit 选测逻辑 | `TESTING-CONVENTIONS.md` §4.5 成本表重测 + `GATES-OPERATIONS.md` §4 预算 |
| 分支保护配置变更 | `CI-BRANCH-PROTECTION.md` §2 + `CODE-REVIEW.md` §5 + 一次反向验收 |
| 一次 flake 事故 | `e2e/QUARANTINE.md` 台账 + `TESTING-STRATEGY.md` §7 判定记录 |
| 一次误合并/漏拦 | `CODE-REVIEW.md` §6 反模式加一条（写「本仓发生过的样子」）；补脚本 + 反向用例 |

### 7.5 写作规范（10 条，摘要）

中文短句、术语保留英文原形；给实测数字不给形容词；写「为什么」并附本仓真实例子；禁止「100% 通过/完美/彻底解决」；规则必须可判定（「diff ≤400 行」可判定，「注意代码质量」不可判定）；链接不复制（给章节号不给行号）；命令可直接粘；表格优先于三层嵌套；正反例成对；过时即删或标历史。

---

## 八、关键决策记录（ADR）

| ID | 决策 | 备选方案 | 理由 | 影响 |
|---|---|---|---|---|
| ADR-1 | 覆盖率门禁**复用 `test-sqlite` 的 steps**，不新开作业 | 新开 `coverage` 作业 | 覆盖率必须复用同一次 vitest 运行；另起作业再跑 ~9min 且环境差异引入噪声 | `REQUIRED_JOBS` / `ci-passed.needs` / `ci-gate.test.ts` **三处不动**；只改 steps + timeout |
| ADR-2 | 阈值**外置 `coverage-thresholds.json`**，不用 vitest 原生 `coverage.thresholds` | vitest 原生 thresholds | 原生只支持全局 + glob，覆盖不了 patch 改动行与新增文件拦截；两套阈值会打架 | 单一事实源；改阈值是可 review 的独立 diff |
| ADR-3 | CODEOWNERS **提交文件但暂不启用强制审查** | 立即勾选 Require review from Code Owners | 单人/少人仓库会锁死合并；锁死的门禁必然被绕过（`NAVHUB_SKIP_PRECOMMIT` 使用史是先例） | 启用条件：≥2 名常驻审查者；届时补反向验收 |
| ADR-4 | `seo-audit-prod` **不纳入 `ci-passed.needs`** | 纳入聚合 | 它带 `if: workflow_dispatch && vars.NAVHUB_SITE_URL != ''`，PR 下必然 skipped；而 `ci-passed` 把 skipped 当失败 → 每个 PR 永久红 | `REQUIRED_JOBS` 维持 8；文档需写明「故意不阻塞」 |
| ADR-5 | 文档拆 **1 入口 + 3 分册 + 2 模板/机制** | 单份 1500–1800 行长文 | 读者/触发时机/更新责任人不同；单文件在多会话并行下冲突面积最大；与 INDEX 检索模型一致 | 入口页必须做到「不点开分册就能回答 80% 日常」 |
| ADR-6 | 覆盖率**分阶段**：W0 只出数 → W1 钉住 → 每两周 +N | 一次设到目标值 | 一刀切会让门禁第一天就红 → 团队加 `continue-on-error` → 门禁等于不存在 | 阈值收紧必须是独立 PR；允许回退但必须留痕 |
| ADR-7 | 保留 E2E `retries: 2`，但配 flake 台账 + quarantine | 取消重试 / 提高重试 | 单 Worker + 真实浏览器 + Next 编译，抖动客观存在；取消会让 CI 噪声化进而被绕过 | 必须登记 `e2e/QUARANTINE.md`；14 天 SLA；连续 5 次绿才复活 |

---

## 九、风险与权衡

| 风险 | 影响 | 缓解 |
|---|---|---|
| 覆盖率基线未实测，路线图假设值可能偏离 | W1 阈值可能过松或过紧 | W0 基线周用实测替换；表内数字明确标「待校准」 |
| 门禁收紧过快导致绕过（`--no-verify`） | 流程形同虚设 | 分批 ratchet + 独立阈值 PR + 跳钩子三行声明 + 审查抽查 |
| 单人仓库 CODEOWNERS 锁死合并 | 无法合并 | ADR-3：先不启用强制；启用前做反向验收 |
| 覆盖率接入使 test-sqlite 逼近 timeout | CI 偶发超时红 | timeout 20→25；实测 >22min 再拆作业（走五处联动） |
| 多会话并行编辑导致钩子选测跑到他人改动 | 误红、误提交 | 已有 `--staged` 选测 + `safe-commit.mjs`；PR 模板第 5 项核对 |
| 文档与实现漂移 | 规则失效 | 单一事实源 + 维护规则表（触发事件 → 必须同步） |
| PG 无备份脚本 | PG 部署无法回滚数据 | 列为 P2 缺口，补 `pg_dump` 脚本或在 Go/No-Go 里显式阻断 |
| E2E flake 台账流于形式 | 不稳定用例长期存在 | 14 天 SLA + 独立隔离作业 `continue-on-error` + 连续 5 次绿才复活 |

---

## ✅ 行动清单（按优先级排序）

| # | 行动 | 负责角色 | 紧急度 | 预期完成 |
|---|---|---|---|---|
| 1 | **W0 基线**：跑 `pnpm coverage` + `node scripts/check-coverage.mjs --json --zero 20`，把实测数字回填 `coverage-thresholds.json` | Tessa / Rex | P0 | 10/31 |
| 2 | 提交 `.github/pull_request_template.md` 与 `.github/CODEOWNERS`（不启用强制审查） | Cody / Docu | P0 | 10/31 |
| 3 | 新建 `docs/REVIEW-TESTING-PROCESS.md` 入口页 + 三份分册骨架（先骨架后填充） | Docu | P0 | 11/07 |
| 4 | 扩展 `scripts/install-git-hooks.mjs` 生成 `commit-msg` 钩子（先 warning 两周） | Rex | P0 | 11/07 |
| 5 | `check-coverage.mjs` P0 六项增强（`--min-*` / `--thresholds` / `--require-covered-new` / `--patch` / `::error::` / `--max-age`） | Tessa / Rex | P1 | 11/14 |
| 6 | `test-sqlite` 接入覆盖率阶段 A（`continue-on-error` 观察期，只出数） | Rex | P1 | 11/14 |
| 7 | 分支保护补齐：required approvals=1、dismiss stale、linear history、conversation resolution、禁 bypass | Rex | P1 | 11/14 |
| 8 | 落地 `e2e/QUARANTINE.md` + `@quarantine` 标签 + 独立隔离作业 | Tessa | P1 | 11/21 |
| 9 | 覆盖率阶段 B 硬门禁上线（W1 阈值 = 基线 − 2） | Tessa / Rex | P2 | 11/28 |
| 10 | 部署前 Go/No-Go 清单进 `docs/GATES-OPERATIONS.md`；补 PG 备份脚本缺口 | Rex | P2 | 12/05 |
| 11 | `docker-smoke` 加 `cache-from/cache-to: type=gha`（8–15m → 3–5m） | Rex | P2 | 12/05 |
| 12 | （可选）`pr-hygiene` 作业校验 PR 模板必填项——届时必须走完整五处联动 | Rex | P2 | 12/12 |

---

## ⚠️ 待完善 / 已知局限

1. **覆盖率基线未实测**：路线图里的 50/55/45/50 是假设值，必须由 W0 实测替换；替换前不得当结论使用。
2. **CODEOWNERS owner 名为占位**：`@navhub/*` 需替换为真实 GitHub 账号/团队；替换前提交文件不影响任何行为（未启用强制）。
3. **单人仓库场景**：若团队只有 1 人且无法自我 approve，CODEOWNERS 强制与 required approvals 都会锁死合并——此时只启用 linear history + status checks。
4. **PG 备份脚本缺失**：`scripts/backup.mjs` 仅支持 SQLite；PG 部署的数据回滚当前无脚本，已在 Go/No-Go 中列为阻断项。
5. **三份分册正文未成文**：本报告只给大纲、边界与模板；正文成文是落地阶段的工作（行动项 #3）。
6. **CI 实际耗时未实测**：§6.3 的「估计实际」基于缓存命中的推断，非流水线实测。
7. **成员产出基于静态阅读**：Cody/Tessa/Rex/Docu 均未执行 CI、未跑测试；所有命令与路径经主理人抽样核对（`ci.yml` / `check-ci-gate.mjs` / `check-coverage.mjs` / `vitest.config.ts` / `playwright.config.ts` / `install-git-hooks.mjs` / `verify.mjs` / 脚本存在性），但未做端到端验证。
8. **数字口径**：`ci.yml` 实为 10 个作业定义（8 个聚合必过 + `seo-audit-prod` + `ci-passed`）；`e2e/` 扫描时刻 21 个 `.ts`（19 个 spec + `helpers.ts` + `global-setup.ts`）；仓库有并行会话，文件数可能已增长。
9. **未做的事**：没有创建/修改任何仓库文件（`.github/`、`docs/`、`scripts/`、`ci.yml` 均未动）；模板为「可复制」状态，需人工落地。

---

## 📚 数据来源 & 成员产出索引

**主理人勘察（一手核对）**

- `package.json`（scripts / engines / 覆盖率口径注释）、`vitest.config.ts`（include / coverage / clean:false）、`playwright.config.ts`（workers=1 / retries / 独立库）
- `.github/workflows/ci.yml`（10 作业 / 聚合闸门 / 各作业 steps）、`scripts/check-ci-gate.mjs`（REQUIRED_JOBS=8 / 校验项）、`scripts/check-coverage.mjs`（参数与退出码）、`scripts/verify.mjs`、`scripts/install-git-hooks.mjs`（pre-commit 生成逻辑）
- `docs/TESTING-CONVENTIONS.md`（四层与实测成本）、`docs/CI-BRANCH-PROTECTION.md`（分支保护与验收）、`REPAIR_REPORT.md`（历史修复背景）
- 脚本存在性核对：`verify-guard.mjs`、`safe-commit.mjs`、`e2e-local.mjs`、`guard-recipes.json`、`precommit-select.test.ts` 均存在

**成员产出**

- Cody（代码审查师）：任务 #1 两批产出——《代码审查流程规范》流程设计、PR 模板全文、六域审查清单、严重度分级、commit 规范、CODEOWNERS、15 条反模式
- Tessa（测试专家）：任务 #2 两批产出——《测试保障策略》准入准出矩阵、覆盖率四层阈值与路线图、防退化四机制、check-coverage 增强、CI 落点、E2E/flake 政策、测试计划模板、审查者 6 问
- Rex（SRE 工程师）：任务 #3 两批产出——《门禁集成与运维方案》分层接入表、五处联动 checklist、CI 时长预算、红灯 runbook、Go/No-Go、分支保护差异项、可观测性
- Docu（技术文档师）：任务 #4 两批产出——《流程文档包》文档结构（1+3+2）、内容归属矩阵、16 项落地清单、四份成文模板、新人 5 步、维护规则、写作规范 10 条

**主理人裁决（3 项）**

- 裁决 1：CODEOWNERS 提交但暂不启用强制审查（采纳 Docu 建议）
- 裁决 2：`seo-audit-prod` 确认「故意不阻塞」，不纳入聚合（证据：`if: workflow_dispatch && vars.NAVHUB_SITE_URL != ''`）
- 裁决 3：阈值外置 `coverage-thresholds.json`，不用 vitest 原生 thresholds；覆盖率复用 `test-sqlite`，修正了 Docu 落地清单里「`REQUIRED_JOBS` 8→9」的错误

---

> 本报告由工程保障团队 AI 协作生成，关键决策请由人类工程负责人复核。
