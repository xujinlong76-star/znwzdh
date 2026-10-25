# 测试保障策略（现行）

> 状态：**现行**。
> 本文只管「什么时候必须写哪一层、门禁怎么卡、退化怎么防」。
> 四层测试的**定义、实测成本、选层规则**见 [`TESTING-CONVENTIONS.md`](TESTING-CONVENTIONS.md)（不重复）。
> 审查流程见 [`CODE-REVIEW.md`](CODE-REVIEW.md)；CI 落点与红灯归因见 [`GATES-OPERATIONS.md`](GATES-OPERATIONS.md)。

---

## 1. 与四层约定的关系

一句话：**四层定义看 `TESTING-CONVENTIONS.md` §1–§3，本文只管准入准出与门禁。**

| 层 | 形态 | 一次耗时 | 本文中的角色 |
|---|---|---|---|
| L1 源码守卫 | vitest 读文件 + 正则断言 | 1–5 秒 | 高频替身：钉住修复后的不变量 |
| L2 纯函数单测 | 直接 import 纯逻辑 | 1–10 秒 | 逻辑边界与缺省值 |
| L3 集成 | `buildServer` + `app.inject` + 临时库 | 10–30 秒 | 端点契约、事务、审计 |
| L4 E2E | Playwright + 整套 dev 栈 | 2–4 分钟 | 必须跑起来才知道的事实 |

---

## 2. 测试准入准出矩阵（10 类变更）

| # | 变更类型（典型路径） | 本地必跑 | CI 必跑 | 审查者必须看到的证据 | 准出条件（不满足即拒） |
|---|---|---|---|---|---|
| 1 | 纯 docs（`docs/**`、`*.md`） | 无测试（钩子打印 SKIP 属正常），typecheck 仍执行 | 全部作业照跑 | PR 注明「仅文档」；暂存集只有 docs | 暂存集无代码文件混入 |
| 2 | 单包源码（`packages/X/src/**`） | `node node_modules/vitest/vitest.mjs run packages/X/test` | `test-sqlite` | 该包测试全绿日志 | 区域覆盖率不低于 floor；改动行 ≥70% |
| 3 | 跨包改动（≥2 包，或 `packages/*` 与 `apps/api` 同时改） | 全量 `node node_modules/vitest/vitest.mjs run` | `test-sqlite` + `test-postgres`（触及 store SQL 时） | 全量日志；列出受影响包与接线点 | 全量绿 + ≥1 条 L3 覆盖新接线 |
| 4 | 全局配置 `GLOBAL_FILES` | 强制全量（钩子已实现） | `test-sqlite` + `test-web`（涉及构建时） | 全量绿；改 `vitest.config.ts` 覆盖率口径附前后对比 | 覆盖率未下降；口径变化显式说明并同步 `coverage-thresholds.json` |
| 5 | 前端 overlay（`apps/web-overlay/**`） | `pnpm check:overlay` + `node node_modules/vitest/vitest.mjs run apps/web/test` | `test-web` + `check-web-overlay` + `test-e2e`（触及交互时） | overlay 字节一致；`@source` 已登记；五条 a11y 守卫绿 | `check-web-overlay` 绿 + 五条守卫绿 |
| 6 | 新增 API 端点 | `apps/api/test`；必须写 L3 | `test-sqlite`；双方言 SQL 加 `test-postgres` | 「三件套」：成功路径 / 4xx 含 reason / 鉴权 401-403 | 三件套缺一不可；端点文件 lines ≥60% |
| 7 | 数据库迁移与 SQL | `packages/store/test` + `apps/api/test`；迁移在临时库跑一次 | `test-sqlite` + `test-postgres`（必须） | 迁移幂等用例（连跑两次）；兼容/回滚说明；PG 注明「仅 CI 验证」 | 幂等用例存在 + `test-postgres` 绿 |
| 8 | 门禁脚本自身（`scripts/*.mjs`） | `node node_modules/vitest/vitest.mjs run scripts` | `test-sqlite` | 正例 + 反例；手工跑真实仓库验证退出码 | 有反向用例；只测 happy path 不接受 |
| 9 | 新增 E2E 场景（`e2e/*.spec.ts`） | 单文件 → 全量；`--repeat-each=3` | `test-e2e` | 遵守 7 条红线 | 3 连跑全绿；mock 前缀正确；断言请求而非文案 |
| 10 | 新增 PG 用例 | 本地 skip 属正常 | `test-postgres`（`test:pg:suite` 有环境守卫） | PR 注明「仅 CI 验证」+ 用例名 | `test-postgres` 绿；不接受「本地 skip 即通过」 |

通用红线：任何 PR 不得以「本地跳过」代替证据；跳过一次 pre-commit 必须按 `CODE-REVIEW.md` §4.2 三行声明。

---

## 3. 覆盖率门禁

### 3.1 统计口径与现状

- 只统计 `apps/api/src/**` 与 `packages/*/src/**`；`apps/web` 是 vendored 上游底座，不纳入。
- `all` 开启：**没被任何测试 import 的文件也以 0% 计入**——这正是「整文件零覆盖的写端点」的信号。
- 产物：`coverage/coverage-summary.json`（脚本读取）与 `coverage-final.json`（逐行明细）。
- 当前阶段：**W0 只出数，不判定**（`coverage-thresholds.json` 的 `stage: "W0"`）。

历史实测（2026-10-23，仅供对照，以 W0 重新实测为准）：

| 区域 | 文件数 | lines | functions | branches |
|---|---|---|---|---|
| 总体 | 263 | 83.93% | 84.52% | 68.36% |
| `apps/api` | 125 | 80.17% | 79.04% | 63.56% |
| `packages/store` | 50 | 87.98% | 89.86% | 72.01% |
| `packages/core` | 65 | 88.58% | 87.50% | 71.37% |
| `packages/mcp` | 15 | 79.55% | 77.52% | 59.77% |
| `packages/ai` | 8 | 72.00% | 79.05% | 71.78% |

> 这组数字远高于「存量覆盖率低」的直觉预期。因此**阈值不能照搬通用经验（如 50%）**，必须按实测基线定；否则门禁形同虚设。

### 3.2 四层阈值架构

| 层 | 内容 | 初始值 | 语义 |
|---|---|---|---|
| A 全局 floor | lines / functions / branches / statements | W0 实测向下取整 1 个点 | ratchet，只升不降 |
| B 分区域 floor | `apps/api`、`packages/store`、`packages/core`、`packages/ai`、`packages/mcp` 各自判定 | 各区域 W0 实测 | 防止高覆盖区域掩盖低覆盖区域 |
| C 关键文件 floor | `packages/store/src/repository.ts`、`apps/api/src/server.ts`、`apps/api/src/auth.ts`、`apps/api/src/config.ts`、`packages/ai/src/ssrf.ts`、`apps/api/src/routes/*.ts` | 各文件 W0 实测（安全边界目标 90%+） | 数据/安全边界必须高 |
| D 改动行覆盖 | patch 改动行 ≥70%；新增文件 ≥50%；新增文件 0% 直接 fail | 固定 | 防「存量不动、新增裸奔」 |

**单一事实源 = 仓库根 `coverage-thresholds.json`**（纳入版本控制）。不使用 vitest 原生 `coverage.thresholds`：它只支持全局 + glob，覆盖不了 patch 覆盖与新增文件拦截，且两套阈值会打架。

### 3.3 分批收紧路线图

为什么不能一步到位：

1. 一刀切会让门禁第一天就红 → 第一反应是加 `continue-on-error` 或 `--no-verify`，门禁从此等于不存在。
2. 低覆盖区域补测是数周工作量，混在功能 PR 里会拖慢交付并催生垃圾测试。
3. ratchet 的正确姿势是「先钉住现状，再按固定节奏抬」：红灯只指向「这次改动让数字掉了」，而不是「历史欠账」。

| 阶段 | 时间 | 全局 lines | 关键文件 | 门禁动作 |
|---|---|---|---|---|
| W0 基线 | 10/25–10/31 | 只出数不判定 | 只记录 | 跑 `pnpm coverage`，基线写入 `coverage-thresholds.json` |
| W1 钉住 | 11/03–11/14 | 基线 − 2（容差） | = 实测 | CI 硬门禁上线 |
| W3 | 11/17–11/28 | 基线 + 2 | 实测 + 3 | patch 覆盖 ≥70% 同步上线 |
| W5 | 12/01–12/12 | 基线 + 4 | 实测 + 6 | 新增零覆盖文件拦截上线 |
| W7 | 12/15–12/26 | 基线 + 6 | 实测 + 9 | 分区域 floor 独立判定 |
| W9 | 12/29–01/09 | 基线 + 8 | 实测 + 12 | 全局 ≥基线+8，关键文件 ≥实测+12 |
| 目标态 | 2027 Q1 末 | 70%（若基线已高于 70 则改为基线+10） | repository 80% / server 75% / auth 85% | 稳定 ratchet |

规则：每两周的收紧必须是**独立 PR**（只改 `coverage-thresholds.json`）；连续 3 个功能 PR 因同一阈值红灯 → 回退 1pp 并留痕；允许回退，但禁止「悄悄调低」。

> 注：若 W0 实测全局 lines 已 ≥80%，目标态不应写死 70%——按「基线 + 10」执行，避免「目标低于现状」的荒谬。

### 3.4 防退化四机制

1. **patch 覆盖**：`node scripts/check-coverage.mjs --patch --base=origin/main --min-patch-lines 70`。用 `git diff --unified=0` 取改动行 + `coverage-final.json` 的 statementMap 映射；分母 <10 行跳过判定；删除行不计；纯 re-export / 类型文件进 ignore 清单（逐条列出，不许通配）。
2. **新增零覆盖文件拦截**：PR 新增的 `apps/api/src/**`、`packages/*/src/**` 文件 lines=0 直接 fail；例外仅 `*.d.ts`、纯类型、入口 re-export。
3. **反「为过门禁写垃圾测试」**：新增测试需在 PR 附 fail-before-pass 证据（`node scripts/verify-guard.mjs`）；审查者每周抽查 1/3；每周随机抽 3 个新增测试检查断言强度；`/* v8 ignore */` 必须带理由 + 审查确认。
4. **ratchet 本身是主防线**：垃圾测试不增加覆盖，加了也过不了「只升不降」。

### 3.5 `check-coverage.mjs` 能力

P0（已实现）：

| 能力 | 说明 |
|---|---|
| `--min-lines / --min-functions / --min-branches / --min-statements` | 语义纠正；`--max-*` 保留为 deprecated 别名 |
| `--thresholds coverage-thresholds.json` | 读取外置阈值（全局/区域/文件/ignore/stage） |
| `--require-covered-new` | 新增文件零覆盖 → fail（读 `git diff --diff-filter=A`） |
| `--patch --base=origin/main --min-patch-lines 70` | 改动行覆盖（需要 `coverage-final.json`） |
| `::error::` 注解 | 每条失败一行，PR 文件页可见；日志末尾附 Top 5 + 未覆盖行区间 |
| `--max-age <minutes>` | 产物 mtime 超阈值视为旧数据，exit 2（`clean:false` 的假绿入口） |

P1（待做）：`--per-area` 独立判定、`--changed-files`、`--github-summary`、`--json` 增加 `uncoveredLines`。
P2（待做）：`--list-zero`、PR 评论机器人。

### 3.6 CI 落点与失败呈现

- **落点**：`test-sqlite` 作业（复用同一次 vitest 运行；另起作业要再跑一遍全量并引入环境噪声）。
- **命令**：
  ```bash
  node node_modules/vitest/vitest.mjs run --coverage
  node scripts/check-coverage.mjs --thresholds coverage-thresholds.json --patch --base=origin/${{ github.base_ref }}
  ```
- **超时**：见 `GATES-OPERATIONS.md` §4。本机实测全量（含覆盖率）约 27 分钟，**不要**按「9 分钟」估；CI 侧需先实测再定 timeout，必要时拆独立作业。
- **失败呈现三层**：① 每条阈值失败一个 `::error::` 注解；② 日志末尾表格（区域/文件数/零覆盖/lines/functions/branches/阈值/结果）；③ 上传 `coverage-summary.json` 为 artifact（14 天）。

---

## 4. E2E 与 flake 政策

### 4.1 现状

`retries: CI 2 / 本地 0`，`workers: 1`，`timeout 90s`。**保留 retries=2**（单 Worker + 真实浏览器 + Next 编译，抖动客观存在；去掉会让 CI 噪声化进而被绕过），但必须配 flake 台账。

### 4.2 flake 四条判定（任一即 flake）

1. 同一次运行内「失败 → 重试通过」（Playwright 标注 flaky）；
2. 同一测试 7 天内在 ≥2 个无关 PR 上失败；
3. 本地 `--repeat-each=3` 复现失败 ≥1 次；
4. 失败信息指向超时/竞态（`Target closed`、`Timeout 30000ms exceeded`）而非断言值不符。

### 4.3 quarantine 流程

- **标记**：用 `{ tag: '@quarantine' }` 或标题前缀 `[quarantine]`；不用 `test.fixme`（等于删除）。
- **登记**：[`../e2e/QUARANTINE.md`](../e2e/QUARANTINE.md)，字段：测试名 / 首次 flake 日期 / 失败签名 / 归属人 / 到期日（≤14 天）。
- **门禁**：主 E2E 作业加 `--grep-invert @quarantine`；隔离用例进单独作业 `test-e2e-quarantine`（`continue-on-error: true`），保证仍在跑、仍留证据。
- **SLA**：14 天未修复 → 要么修好、要么删除，并在测试计划里记录「能力缺口」。不允许无限期隔离。

### 4.4 复活机制

- 隔离作业连续 5 次运行全绿（同一测试）→ 任何人可提 PR 去掉 tag，附 5 次运行链接。
- 复活后 7 天内再 flake → 直接删除该用例，降级为 L3 集成覆盖，不允许二次隔离。
- 每次复活必须写明「当初为什么 flake」。

### 4.5 七条 E2E 红线

1. **mock 路径必须带 `/api/hub` 前缀**（`hubUrl()` 的 BASE 是 `/api/hub`）。写错 = 请求真打后端污染数据，且真实响应文案与 mock 一致 → 「看起来正常」的假绿。
2. **断言「发了什么」，不断言「显示了什么」**：写路径的事实在请求体里。
3. **toast 双 DOM**（可见 + `aria-live`）：`getByText` 会 strict 冲突，用 `.first()`。
4. **不得 `reuseExistingServer`、不得复用开发库**：E2E 库固定 `data/e2e/navhub-e2e.db`；本地跑前先停 `pnpm dev:all`，或用 `NAVHUB_WEB_PORT` / `NAVHUB_API_PORT` 换端口。
5. **新 spec 必须 `--repeat-each=3` 全绿**才提 PR。
6. **自查 mock 是否生效**：handler 里 `console.log`，或断言「本用例应产生 N 次调用」。
7. **禁止固定 `sleep`**：用 `expect.poll` / `waitForResponse`。

---

## 5. 测试计划模板（7 要素）

位置：≤1 天工作量内嵌 PR 描述；>1 天放 `docs/test-plans/YYYY-MM-DD-<feature>.md`。

1. **风险声明**：这次改动最可能坏什么（数据完整性/鉴权/并发/兼容性），按风险排序。
2. **选层依据表**：事实形态 → 层（字符串级 L1 / 纯逻辑 L2 / 端点契约 L3 / 必须跑起来 L4），逐条列；禁止「都写 E2E」。
3. **用例清单**：ID | 层 | 前置 | 步骤 | 断言（可判定）| 优先级（P0 必测 / P1 建议）。必含成功路径、≥1 条 4xx（含 reason）、≥1 条鉴权拒绝（401/403）、≥1 条边界（空值/超长/并发）。
4. **数据准备**：用哪个库（临时库 / seed / e2e 库）、如何清理、是否幂等（迁移类必须连跑两次）。
5. **本地/CI 分工**：哪些本地必跑、哪些仅 CI（PG 用例必须注明「仅 CI 验证」）。
6. **准出标准**：新增文件覆盖率目标、是否新开 E2E（flake 风险）、回滚观察点。
7. **不测什么 + 为什么**：显式声明盲区，比假装全覆盖更有价值。

---

## 6. 审查者视角：6 问 + 3 条直接拒

见 [`CODE-REVIEW.md`](CODE-REVIEW.md) §3.1 与 §3.4（唯一副本，本文不复写）。
