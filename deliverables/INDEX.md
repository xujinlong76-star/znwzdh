# deliverables/ 交付物索引（INDEX）

> 本文件是给人读的中文索引：`deliverables/` 下 **15 个顶层子目录**、**20 份 .md 报告**
> （2026-11-06 用 `Get-ChildItem -Directory` / `glob deliverables/**/*.md` 实测）。
> 目录与报告名全部按磁盘真实名称登记，不编造、不凑数。
>
> machine-readable 全量清单见 [`docs/docs-index.json`](../docs/docs-index.json) 的 `deliverables`。
> 本轮治理**只新建本文件 + docs/docs-index.json**，不移动、不修改 `deliverables/` 下任何已有文件。

---

## 口径说明（诚实记录两处差异）

1. **15 个子目录**：`Get-ChildItem -Path deliverables -Directory` 实测 15 个，其中
   `code-scan-2026-11-01/` 是**空目录**（0 个文件），仍按真实存在登记，不删减凑数。
   目录里另有大量 `shots/`、`screenshots/`、`results/`、`harness/` 等下级目录与 PNG/JSON/MJS 产物，
   本索引只列**顶层子目录**与 **.md 报告**，不铺开截图。
2. **20 份报告 vs 任务书的 19 份**：任务描述给的是 19，磁盘实测 `deliverables/**/*.md` 为 **20**。
   差 1 份不强行解释、不删一行去凑 19，按 20 份真实名称全量登记。其中多数是各子目录的 `README.md`
   （任务轮次说明），另有 `REPORT.md` / `phase*.md` / `*report*.md` 等正式报告与中文命名报告。

---

## 15 个顶层子目录

| 子目录 | 性质（按目录名与内含 .md 判断） | 内含 .md 报告 |
|---|---|---|
| [`ai3-stream-2026-10-28/`](./ai3-stream-2026-10-28/) | AI 流式输出（SSE/transcript 恢复）验证轮次 | `README.md` |
| [`ai4a-canvas-2026-10-28/`](./ai4a-canvas-2026-10-28/) | AI Canvas 脏数据 / fallback 验证轮次 | `README.md` |
| [`ai4b-probe-2026-10-28/`](./ai4b-probe-2026-10-28/) | AI 探针（LLM / fallback 双分支）验证轮次 | `README.md` |
| [`ai4c-review-2026-10-29/`](./ai4c-review-2026-10-29/) | AI 审核富化（rich / bare）验证轮次 | `README.md` |
| [`ai5-vector-2026-10-30/`](./ai5-vector-2026-10-30/) | 向量检索阈值标定轮次 | `README.md` |
| [`ai6-cost-2026-10-30/`](./ai6-cost-2026-10-30/) | AI 成本 / 可观测性验证轮次 | `README.md` |
| [`brand-admin-logo-2026-10-30/`](./brand-admin-logo-2026-10-30/) | 后台品牌 Logo（自定义 / fallback）验证轮次 | `README.md` |
| [`code-scan-2026-11-01/`](./code-scan-2026-11-01/) | 代码扫描轮次（**当前为空目录，0 文件**） | — |
| [`e2e-ui-2026-10-26/`](./e2e-ui-2026-10-26/) | E2E UI 全量巡检（00–33 号脚本、shots/、results/） | `REPORT.md`、`results/08-raw-summary.md` |
| [`engineering-assurance/`](./engineering-assurance/) | 工程保障（设计评审 / 测试流程） | `design-review-testing-process-2026-10-25.md` |
| [`navhub-upgrade-2026-11-01/`](./navhub-upgrade-2026-11-01/) | 导航升级（F1–F4 验证、UX 规格） | `REPORT.md`、`phase2-ux-spec.md`、`verify-f123/f4-verification-report.md` |
| [`plugin-health/`](./plugin-health/) | 插件智能体检与 AI 自愈增强 | `设计-插件智能体检与AI自愈增强.md` |
| [`verify-archive-2026-10-30/`](./verify-archive-2026-10-30/) | verify 归档轮次（上午） | `README.md` |
| [`verify-archive-2026-10-30-pm/`](./verify-archive-2026-10-30-pm/) | verify 归档轮次（下午） | `README.md` |
| [`web-audit/`](./web-audit/) | Web 审计（检测报告、ux-review、大量截图与探针脚本） | `检测报告.md`、`ux-review-2026-10-31/phase1-visual.md` |

> 另有 2 份报告直接位于 `deliverables/` 根目录（不属于任何子目录）：
> `deep-scan-report-2026-10-31.md`、`web-overlay-audit-2026-11-06.md`（见下表第 8、20 行）。
> 因此 15 个子目录内含 18 份报告，加根目录 2 份 = 20 份。

---

## 20 份 .md 报告（真实文件名全量）

按 `git ls-files` 与磁盘 `glob` 双重核对，排序按路径：

| # | 报告路径 | 类型 |
|---:|---|---|
| 1 | [`ai3-stream-2026-10-28/README.md`](./ai3-stream-2026-10-28/README.md) | 轮次说明 |
| 2 | [`ai4a-canvas-2026-10-28/README.md`](./ai4a-canvas-2026-10-28/README.md) | 轮次说明 |
| 3 | [`ai4b-probe-2026-10-28/README.md`](./ai4b-probe-2026-10-28/README.md) | 轮次说明 |
| 4 | [`ai4c-review-2026-10-29/README.md`](./ai4c-review-2026-10-29/README.md) | 轮次说明 |
| 5 | [`ai5-vector-2026-10-30/README.md`](./ai5-vector-2026-10-30/README.md) | 轮次说明 |
| 6 | [`ai6-cost-2026-10-30/README.md`](./ai6-cost-2026-10-30/README.md) | 轮次说明 |
| 7 | [`brand-admin-logo-2026-10-30/README.md`](./brand-admin-logo-2026-10-30/README.md) | 轮次说明 |
| 8 | [`deep-scan-report-2026-10-31.md`](./deep-scan-report-2026-10-31.md) | 深度扫描报告（根目录） |
| 9 | [`e2e-ui-2026-10-26/REPORT.md`](./e2e-ui-2026-10-26/REPORT.md) | E2E 正式报告 |
| 10 | [`e2e-ui-2026-10-26/results/08-raw-summary.md`](./e2e-ui-2026-10-26/results/08-raw-summary.md) | 原始汇总 |
| 11 | [`engineering-assurance/design-review-testing-process-2026-10-25.md`](./engineering-assurance/design-review-testing-process-2026-10-25.md) | 流程文档 |
| 12 | [`navhub-upgrade-2026-11-01/REPORT.md`](./navhub-upgrade-2026-11-01/REPORT.md) | 升级正式报告 |
| 13 | [`navhub-upgrade-2026-11-01/phase2-ux-spec.md`](./navhub-upgrade-2026-11-01/phase2-ux-spec.md) | UX 规格 |
| 14 | [`navhub-upgrade-2026-11-01/verify-f123/f4-verification-report.md`](./navhub-upgrade-2026-11-01/verify-f123/f4-verification-report.md) | F4 验证报告 |
| 15 | [`plugin-health/设计-插件智能体检与AI自愈增强.md`](./plugin-health/设计-插件智能体检与AI自愈增强.md) | 中文设计文档 |
| 16 | [`verify-archive-2026-10-30-pm/README.md`](./verify-archive-2026-10-30-pm/README.md) | 归档说明 |
| 17 | [`verify-archive-2026-10-30/README.md`](./verify-archive-2026-10-30/README.md) | 归档说明 |
| 18 | [`web-audit/ux-review-2026-10-31/phase1-visual.md`](./web-audit/ux-review-2026-10-31/phase1-visual.md) | 视觉审计 |
| 19 | [`web-audit/检测报告.md`](./web-audit/检测报告.md) | 中文检测报告 |
| 20 | [`web-overlay-audit-2026-11-06.md`](./web-overlay-audit-2026-11-06.md) | overlay 审计报告（根目录，最新） |

---

## 维护约定

- 新增子目录或 .md 报告时：同步 `docs/docs-index.json` 的 `deliverables` 段
  （由 `scripts/gen-docs-index.mjs` 的 `DELIVERABLES_DIRS` / `DELIVERABLES_REPORTS` 常量维护）与本文件。
- `deliverables/` 下的 PNG 截图、JSON 结果、`*.mjs` 探针脚本是**证据产物**，不进本索引；
  要找证据请进对应子目录的 `shots/`、`screenshots/`、`results/`。
- 本索引不回写历史报告内容（与 `docs/INDEX.md` 同款约定：历史记录当时的事实，不改写）。
- 校验命令：`node scripts/gen-docs-index.mjs --check`（同时检查本文件与另外 3 份人读文档存在）。
