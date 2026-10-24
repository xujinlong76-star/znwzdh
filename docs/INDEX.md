# docs/ 索引

> 目的：`docs/` 下有 40+ 份报告，文件名按「日期 + 轮次」平铺，光看名字分不清
> **哪份描述当前行为、哪份只是某一轮的记录**。这份索引按「我要做什么」组织。
>
> 维护约定：新增文档时在对应分组加一行；**删改代码导致某份「现行」文档过实时，
> 同一次提交里改掉它**。历史文档不要回头改写（它们记录的是当时的事实）。

## 状态标记

| 标记 | 含义 | 代码改动时要不要同步 |
|---|---|---|
| **现行** | 描述当前行为 / 当前约定 | **要**，否则文档会骗人 |
| **历史** | 某一轮的执行记录、当时的判断 | 不要，保留原样 |
| **提案** | 方案与取舍，可能只落地了一部分 | 落地时把结论挪进「现行」 |

## 我要做什么 → 看哪份

| 任务 | 文档 | 状态 |
|---|---|---|
| 备份、恢复、演练 | [`BACKUP-RUNBOOK.md`](BACKUP-RUNBOOK.md) | 现行 |
| 恢复的异步化设计（为什么分批、为什么 staging 落文件） | [`ASYNC-RESTORE-DESIGN.md`](ASYNC-RESTORE-DESIGN.md) | 现行 |
| 恢复方案的深度审阅与后续 11 项改进（A1–A11） | [`ASYNC-RESTORE-REVIEW-2026-10-25.md`](ASYNC-RESTORE-REVIEW-2026-10-25.md) | 现行 |
| 写测试：该写守卫还是 E2E | [`TESTING-CONVENTIONS.md`](TESTING-CONVENTIONS.md) | 现行 |
| 上/回滚 CSP | [`CSP-ROLLOUT.md`](CSP-ROLLOUT.md) | 现行 |
| 接 Prometheus 指标 | [`OBSERVABILITY.md`](OBSERVABILITY.md) | 现行 |
| 合并门禁、分支保护 | [`CI-BRANCH-PROTECTION.md`](CI-BRANCH-PROTECTION.md) | 现行 |
| 安全事件与已知风险 | [`security-notes.md`](security-notes.md) | 现行 |
| 代码在哪、模块怎么分 | [`CODEBASE_OVERVIEW.md`](CODEBASE_OVERVIEW.md)、[`CODEBASE_FILE_INDEX.md`](CODEBASE_FILE_INDEX.md)、[`wiki/`](wiki/) | 现行 |
| UI 颜色/间距/组件用法 | [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) | 现行 |

## 架构与代码地图（现行）

| 文档 | 内容 |
|---|---|
| [`CODEBASE_OVERVIEW.md`](CODEBASE_OVERVIEW.md) | 五层结构、包边界、数据流总览。**新人第一份** |
| [`CODEBASE_FILE_INDEX.md`](CODEBASE_FILE_INDEX.md) | 995 行全量文件索引，按目录列出每个文件的职责 |
| [`wiki/01-architecture.md`](wiki/01-architecture.md) | 分层与依赖方向 |
| [`wiki/02-api.md`](wiki/02-api.md) | API 路由、鉴权、scope |
| [`wiki/03-web.md`](wiki/03-web.md) | 前端路由与组件结构 |
| [`wiki/04-core.md`](wiki/04-core.md) | 领域模型与插件契约 |
| [`wiki/05-store.md`](wiki/05-store.md) | 仓储、方言、迁移 |
| [`wiki/06-ai.md`](wiki/06-ai.md) | 向量检索与模型调用 |
| [`wiki/07-mcp.md`](wiki/07-mcp.md) | MCP 服务端 |
| [`wiki/08-extensions-scripts-docker.md`](wiki/08-extensions-scripts-docker.md) | 扩展、脚本、容器 |

## 运维手册（现行）

| 文档 | 何时用 |
|---|---|
| [`BACKUP-RUNBOOK.md`](BACKUP-RUNBOOK.md) | 整库文件替换 vs 应用级恢复（两者不是一回事，别混） |
| [`ASYNC-RESTORE-DESIGN.md`](ASYNC-RESTORE-DESIGN.md) | 恢复为什么分片、为什么进度存 `jobs` 两列、失败为什么不清 staging |
| [`CSP-ROLLOUT.md`](CSP-ROLLOUT.md) | report-only → enforce 的两段式上线 |
| [`OBSERVABILITY.md`](OBSERVABILITY.md) | `/metrics` 暴露了什么、哪些告警值得配 |
| [`CI-BRANCH-PROTECTION.md`](CI-BRANCH-PROTECTION.md) | 必需检查项、合并前清单 |

## 执行报告（历史，按时间倒序）

同一天的多份报告用 `PASS2/3/4/5` 区分**轮次**，不是版本号。**最新一份在最上**。

| 文档 | 那一轮做了什么 |
|---|---|
| [`UPGRADE-EXECUTION-2026-10-24-PASS5.md`](UPGRADE-EXECUTION-2026-10-24-PASS5.md) | 审计遗留项与多会话提交协作 |
| [`UPGRADE-EXECUTION-2026-10-24-PASS4.md`](UPGRADE-EXECUTION-2026-10-24-PASS4.md) | 执行上一轮的全部建议 |
| [`UPGRADE-EXECUTION-2026-10-24-PASS3.md`](UPGRADE-EXECUTION-2026-10-24-PASS3.md) | 执行全部后续方案 |
| [`UPGRADE-EXECUTION-2026-10-24-PASS2.md`](UPGRADE-EXECUTION-2026-10-24-PASS2.md) | 安全 P0 与恢复 `enabled` 缺陷 |
| [`UPGRADE-EXECUTION-2026-10-24.md`](UPGRADE-EXECUTION-2026-10-24.md) | 当天主报告（653 行，改动清单 + 未执行项 + 回滚） |
| [`UPGRADE-EXECUTION-2026-10-18.md`](UPGRADE-EXECUTION-2026-10-18.md) | 10-18 全天 |
| [`UPGRADE-EXECUTION-REPORT-2026-10-17.md`](UPGRADE-EXECUTION-REPORT-2026-10-17.md) | 10-17 全天 |
| [`P3-COMPLETION-REPORT-2026-10-16.md`](P3-COMPLETION-REPORT-2026-10-16.md) | 前端现代化收尾 |
| [`acceptance-report.md`](acceptance-report.md) | 784 行实测验收（**看「实测」而非「设计意图」那段**） |

## 计划与提案（提案：先看结论是否已被执行报告覆盖）

| 文档 | 主题 |
|---|---|
| [`UPGRADE-PLAN-2026-10-23.md`](UPGRADE-PLAN-2026-10-23.md) | 四路扫描合成的全仓方案，**最完整的一份** |
| [`NEXT-STEPS-PLAN-2026-10-24.md`](NEXT-STEPS-PLAN-2026-10-24.md) | 第五批候选（部分已执行） |
| [`UPGRADE-PLAN-2026-10-16.md`](UPGRADE-PLAN-2026-10-16.md) | 最早的改造方案 |
| [`UPGRADE-RECOMMENDATIONS-2026-10-16.md`](UPGRADE-RECOMMENDATIONS-2026-10-16.md) | 第一轮调研建议 |
| [`UPGRADE-PROPOSAL-2026-10-18.md`](UPGRADE-PROPOSAL-2026-10-18.md) / [`V2`](UPGRADE-PROPOSAL-V2-2026-10-18.md) / [`V3`](UPGRADE-PROPOSAL-V3-2026-10-19.md) | 三天内三次迭代，**看 V3 即可，前两份只有历史价值** |
| [`DEV-PLAN-2026-10-19-NEXT.md`](DEV-PLAN-2026-10-19-NEXT.md) | 10-19 的下一步排期 |
| [`navigation-enhancement-plan.md`](navigation-enhancement-plan.md) | 导航功能增强（600 行） |

## 专题

| 专题 | 文档 |
|---|---|
| 用户中心 | [`USER-CENTER-DEEP-SCAN-V2-2026-10-22.md`](USER-CENTER-DEEP-SCAN-V2-2026-10-22.md)、[`UPGRADE-PLAN-2026-10-22`](USER-CENTER-UPGRADE-PLAN-2026-10-22.md)、[`UPGRADE-PLAN-2026-10-24`](USER-CENTER-UPGRADE-PLAN-2026-10-24.md)（第四批，最新） |
| 插件市场 | [`PLUGIN-MARKET-DESIGN-2026-10-19.md`](PLUGIN-MARKET-DESIGN-2026-10-19.md)、[`PLUGIN-MARKET-ENHANCEMENTS-2026-10-19.md`](PLUGIN-MARKET-ENHANCEMENTS-2026-10-19.md) |
| SEO | [`seo/`](seo/)：优化方案 V2/V3/V4、技术审计、ISR 路由、链接架构、站点描述工单 |
| AI | [`AI-MODEL-PLATFORM-PLAN-2026-10-19.md`](AI-MODEL-PLATFORM-PLAN-2026-10-19.md)、[`AGNES-LLM-INTEGRATION-PLAN-2026-10-19.md`](AGNES-LLM-INTEGRATION-PLAN-2026-10-19.md) |
| 分类体系 | [`research-taxonomy-upgrade.md`](research-taxonomy-upgrade.md) |
| 竞品与视觉证据 | [`competitor-walkthrough/`](competitor-walkthrough/)（截图 + README）、[`upgrade-evidence/`](upgrade-evidence/) |

## 审计（历史）

| 文档 | 范围 |
|---|---|
| [`AUDIT-2026-10-20-PASS3.md`](AUDIT-2026-10-20-PASS3.md) | 863 行，最细的一次深扫 |
| [`AUDIT-2026-10-20-PASS2.md`](AUDIT-2026-10-20-PASS2.md) | 第二轮 |
| [`AUDIT-2026-10-20.md`](AUDIT-2026-10-20.md) | 第一轮摘要 |
| [`AUDIT_VERIFICATION_2026-10-16.md`](AUDIT_VERIFICATION_2026-10-16.md) | 外部审计逐条核验（哪些成立、哪些是误报） |
| [`SEO-TEMPLATE-COPY-AUDIT-2026-10-21.md`](SEO-TEMPLATE-COPY-AUDIT-2026-10-21.md) | 模板文案与薄内容风险 |

## 素材（不是文档，是证据）

| 路径 | 内容 |
|---|---|
| `docs/anchor-text-categories.csv` | 锚文本按分类的统计 |
| `docs/anchor-text-tags.csv` | 锚文本按标签的统计 |
| `docs/seo/site-description-worklist.csv` | 站点描述待办工单 |
| `docs/codebase-index.html` / `docs/upgrade-roadmap.html` | 可视化版本（浏览器打开） |

## 一份文档该放哪

- **描述当前事实**（怎么运维、约定是什么、架构长什么样）→ 顶层，用能直接读懂的名字（`TESTING-CONVENTIONS.md`），状态标「现行」。
- **某一轮的记录** → `UPGRADE-EXECUTION-<日期>.md`，同日多轮加 `-PASSn`，状态「历史」。
- **方案与取舍** → `UPGRADE-PLAN/PROPOSAL-<日期>.md`，状态「提案」；落地后把结论补进对应「现行」文档，而不是留在提案里。
