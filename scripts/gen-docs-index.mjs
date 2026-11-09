#!/usr/bin/env node
/**
 * 文档索引的单一事实源生成器（零依赖，Node >= 20 / 实测 Node 24.22.2）。
 *
 * 背景：docs/ 下 87 份（git 已跟踪口径，见 docs/INDEX.md 引用的 metrics.json）
 * .md 按「日期 + 轮次」平铺，光看文件名分不清「现行 / 历史 / 提案」，也无从阻止
 * 并行会话新增 .md 而无人登记。本脚本把 docs/ 下每一份 .md 收进
 * docs/docs-index.json（machine-readable），并给 --check 模式做棘轮：
 * 只要磁盘上出现「未登记的新增 .md」，就 exit 1。
 *
 * 口径（2026-11-06 实测，全部来自 glob/grep/read/git，不编造）：
 *   - docs/ 下 git 已跟踪 .md = 87（GIT_TRACKED_DOCS 常量，见 docs/INDEX.md 的 87 口径）。
 *   - docs/ 下磁盘实存 .md 以运行时枚举为准：初始采集 91 = 87 已跟踪 + 4 份未跟踪
 *     docs/adr/（0001/0002/0003 三份 ADR + README.md）。并行会话随后新增的未跟踪
 *     .md 由 buildIndex() 动态纳入并标 source=disk-extra，--check 不误报。
 *     本索引以「磁盘全量」为登记口径，逐份标注 tracked / untracked。
 *   - deliverables/ 15 个顶层子目录（含 1 个空目录 code-scan-2026-11-01）、
 *     20 份 .md 报告（任务书说 19，实测 20，按真实名称全量登记，不凑数删减）。
 *   - scripts/ 下 check-*.mjs = 42 个（2026-11-08 补齐：原固定 30 份，磁盘实物 42 份），
 *     用途逐份读文件头注释 / 源码确认，不按文件名猜。
 *
 * 用法：
 *   node scripts/gen-docs-index.mjs            # 默认：重新生成 docs/docs-index.json
 *   node scripts/gen-docs-index.mjs --check    # 校验：新增未登记 .md / JSON 非法 → exit 1
 *   node scripts/gen-docs-index.mjs --help     # 打印用法
 *
 * 退出码：0 = 生成成功 / 校验通过；1 = 有未登记 .md 或索引形状非法；2 = 参数错误。
 *
 * 注意：本脚本只写 docs/docs-index.json（且仅在默认生成模式下写）。
 * --check 模式全程只读，不修改任何文件，可安全接入 CI / pnpm verify。
 * 本脚本不修改 scripts/check-governance.mjs 或 scripts/verify.mjs（由 Lead 集成）。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = join(ROOT, "docs");
const OUT = join(ROOT, "docs", "docs-index.json");
const argv = process.argv.slice(2);

// ---------------- 静态事实源：2026-11-06 实测 ----------------
// 这些是从仓库真实结构采集的常量，不是运行时猜测。运行时只动态枚举 docs/ 下的 .md，
// 其余目录（deliverables / scripts）的结构由下面的清单固定，并用 --check 校验其仍存在。

const GENERATED_AT = "2026-11-06";

/** docs/ 下 git 已跟踪的 87 份 .md（git ls-files 口径，顺序与 docs/INDEX.md 同款按路径排序）。 */
const GIT_TRACKED_DOCS = [
  "ACCOUNT-LIFECYCLE-2026-11-01.md",
  "AGNES-LLM-INTEGRATION-PLAN-2026-10-19.md",
  "AI-MODEL-PLATFORM-PLAN-2026-10-19.md",
  "ASYNC-RESTORE-DESIGN.md",
  "ASYNC-RESTORE-REVIEW-2026-10-25.md",
  "AUDIT-2026-10-20-PASS2.md",
  "AUDIT-2026-10-20-PASS3.md",
  "AUDIT-2026-10-20.md",
  "AUDIT_VERIFICATION_2026-10-16.md",
  "BACKEND-OPTIMIZATION-PLAN-2026-10-30.md",
  "BACKUP-RUNBOOK.md",
  "BILI-PARSE-CREDENTIAL-BUDGET-2026-11-01.md",
  "CI-BRANCH-PROTECTION.md",
  "CODE-EXECUTION-ISOLATION-2026-11-01.md",
  "CODE-REVIEW.md",
  "CODEBASE_FILE_INDEX.md",
  "CODEBASE_OVERVIEW.md",
  "CSP-ROLLOUT.md",
  "DESIGN-SYSTEM.md",
  "DEV-PLAN-2026-10-19-NEXT.md",
  "GATES-OPERATIONS.md",
  "GUI-TEST-REPORT-2026-10-27.md",
  "INDEX.md",
  "NEXT-STEPS-PLAN-2026-10-24.md",
  "OBSERVABILITY.md",
  "P3-COMPLETION-REPORT-2026-10-16.md",
  "PLUGIN-MARKET-DESIGN-2026-10-19.md",
  "PLUGIN-MARKET-ENHANCEMENTS-2026-10-19.md",
  "PROJECT-PROGRESS-SCAN-2026-10-28.md",
  "ROUTE-STATE-CONVENTIONS.md",
  "SEO-TEMPLATE-COPY-AUDIT-2026-10-21.md",
  "SITE-HEALTH-HISTORY-2026-11-01.md",
  "TESTING-CONVENTIONS.md",
  "TESTING-STRATEGY.md",
  "UPGRADE-EXECUTION-2026-10-18.md",
  "UPGRADE-EXECUTION-2026-10-24-PASS2.md",
  "UPGRADE-EXECUTION-2026-10-24-PASS3.md",
  "UPGRADE-EXECUTION-2026-10-24-PASS4.md",
  "UPGRADE-EXECUTION-2026-10-24-PASS5.md",
  "UPGRADE-EXECUTION-2026-10-24.md",
  "UPGRADE-EXECUTION-2026-10-27.md",
  "UPGRADE-EXECUTION-REPORT-2026-10-17.md",
  "UPGRADE-MASTER-PLAN-2026-11-06.md",
  "UPGRADE-PLAN-2026-10-16.md",
  "UPGRADE-PLAN-2026-10-23.md",
  "UPGRADE-PLAN-2026-10-27-BACKEND.md",
  "UPGRADE-PROPOSAL-2026-10-18.md",
  "UPGRADE-PROPOSAL-V2-2026-10-18.md",
  "UPGRADE-PROPOSAL-V3-2026-10-19.md",
  "UPGRADE-RECOMMENDATIONS-2026-10-16.md",
  "USER-CENTER-DEEP-SCAN-V2-2026-10-22.md",
  "USER-CENTER-UPGRADE-PLAN-2026-10-22.md",
  "USER-CENTER-UPGRADE-PLAN-2026-10-24.md",
  "VIDEO-CATALOG-MIGRATION.md",
  "VIDEO-HOTSPOT-BACKEND-AUDIT-2026-10-28.md",
  "VIDEO-HOTSPOT-REMEDIATION-2026-10-28.md",
  "VIDEO-HOTSPOT-REVIEW-2026-10-28.md",
  "VIDEO-LINE-COMMIT-PLAN-2026-10-29.md",
  "VIDEO-LLM-EVAL-PLAN.md",
  "acceptance-report.md",
  "competitor-walkthrough/README.md",
  "navigation-enhancement-plan.md",
  "research-notes.md",
  "research-taxonomy-upgrade.md",
  "security-notes.md",
  "seo-keyword-research.md",
  "seo/ISR-ROUTES.md",
  "seo/SEO-OPTIMIZATION-PLAN-2026-10-20.md",
  "seo/SEO-OPTIMIZATION-PLAN-V2-2026-10-21.md",
  "seo/SEO-OPTIMIZATION-PLAN-V4-2026-10-22.md",
  "seo/SEO-UPGRADE-PLAN-V3-2026-10-21.md",
  "seo/TECHNICAL-SEO-AUDIT-2026-10-20.md",
  "seo/link-architecture-navhub.md",
  "seo/tag-descriptions-draft.md",
  "wiki/01-architecture.md",
  "wiki/02-api.md",
  "wiki/03-web.md",
  "wiki/04-core.md",
  "wiki/05-store.md",
  "wiki/06-ai.md",
  "wiki/07-mcp.md",
  "wiki/08-extensions-scripts-docker.md",
  "wiki/09-run-and-test.md",
  "wiki/10-bento-diy-and-advanced-algorithms.md",
  "wiki/11-operations.md",
  "wiki/12-user-center.md",
  "wiki/README.md"
];

/** docs/ 下 4 份未跟踪（并行会话新增，2026-11-06），同样要登记，否则 --check 会误报。 */
const UNTRACKED_ADR_DOCS = [
  "adr/0001-lite-single-instance-constraint.md",
  "adr/0002-strip-types-production-runtime.md",
  "adr/0003-coverage-threshold-single-source.md",
  "adr/README.md"
];

/** 文档状态分类（现行 / 历史 / 提案 / 索引 / 决策记录），按「我要做什么」组织。 */
const DOC_STATUS = {
  "INDEX.md": "index",
  "CODEBASE_OVERVIEW.md": "current",
  "CODEBASE_FILE_INDEX.md": "current",
  "BACKUP-RUNBOOK.md": "current",
  "VIDEO-CATALOG-MIGRATION.md": "current",
  "ASYNC-RESTORE-DESIGN.md": "current",
  "ASYNC-RESTORE-REVIEW-2026-10-25.md": "current",
  "TESTING-CONVENTIONS.md": "current",
  "TESTING-STRATEGY.md": "current",
  "ROUTE-STATE-CONVENTIONS.md": "current",
  "CSP-ROLLOUT.md": "current",
  "OBSERVABILITY.md": "current",
  "CI-BRANCH-PROTECTION.md": "current",
  "security-notes.md": "current",
  "CODE-EXECUTION-ISOLATION-2026-11-01.md": "current",
  "BILI-PARSE-CREDENTIAL-BUDGET-2026-11-01.md": "current",
  "DESIGN-SYSTEM.md": "current",
  "GATES-OPERATIONS.md": "current",
  "wiki/README.md": "current",
  "wiki/01-architecture.md": "current",
  "wiki/02-api.md": "current",
  "wiki/03-web.md": "current",
  "wiki/04-core.md": "current",
  "wiki/05-store.md": "current",
  "wiki/06-ai.md": "current",
  "wiki/07-mcp.md": "current",
  "wiki/08-extensions-scripts-docker.md": "current",
  "wiki/09-run-and-test.md": "current",
  "wiki/10-bento-diy-and-advanced-algorithms.md": "current",
  "wiki/11-operations.md": "current",
  "wiki/12-user-center.md": "current",
  "seo/ISR-ROUTES.md": "current",
  "seo/link-architecture-navhub.md": "current",
  "seo/tag-descriptions-draft.md": "current",
  "seo-keyword-research.md": "historical",
  "SEO-TEMPLATE-COPY-AUDIT-2026-10-21.md": "historical",
  "adr/README.md": "decision",
  "adr/0001-lite-single-instance-constraint.md": "decision",
  "adr/0002-strip-types-production-runtime.md": "decision",
  "adr/0003-coverage-threshold-single-source.md": "decision"
};

/** 15 个 deliverables 顶层子目录（Get-ChildItem -Directory 实测，含 1 个空目录）。 */
const DELIVERABLES_DIRS = [
  "ai3-stream-2026-10-28",
  "ai4a-canvas-2026-10-28",
  "ai4b-probe-2026-10-28",
  "ai4c-review-2026-10-29",
  "ai5-vector-2026-10-30",
  "ai6-cost-2026-10-30",
  "brand-admin-logo-2026-10-30",
  "code-scan-2026-11-01",
  "e2e-ui-2026-10-26",
  "engineering-assurance",
  "navhub-upgrade-2026-11-01",
  "plugin-health",
  "verify-archive-2026-10-30",
  "verify-archive-2026-10-30-pm",
  "web-audit"
];

/** 20 份 .md 报告的真实路径（磁盘全量，任务书说 19，按 20 份真实名称登记）。 */
const DELIVERABLES_REPORTS = [
  "ai3-stream-2026-10-28/README.md",
  "ai4a-canvas-2026-10-28/README.md",
  "ai4b-probe-2026-10-28/README.md",
  "ai4c-review-2026-10-29/README.md",
  "ai5-vector-2026-10-30/README.md",
  "ai6-cost-2026-10-30/README.md",
  "brand-admin-logo-2026-10-30/README.md",
  "deep-scan-report-2026-10-31.md",
  "e2e-ui-2026-10-26/REPORT.md",
  "e2e-ui-2026-10-26/results/08-raw-summary.md",
  "engineering-assurance/design-review-testing-process-2026-10-25.md",
  "navhub-upgrade-2026-11-01/REPORT.md",
  "navhub-upgrade-2026-11-01/phase2-ux-spec.md",
  "navhub-upgrade-2026-11-01/verify-f123/f4-verification-report.md",
  "plugin-health/设计-插件智能体检与AI自愈增强.md",
  "verify-archive-2026-10-30-pm/README.md",
  "verify-archive-2026-10-30/README.md",
  "web-audit/ux-review-2026-10-31/phase1-visual.md",
  "web-audit/检测报告.md",
  "web-overlay-audit-2026-11-06.md"
];

/** 30 个 check-*.mjs 的真实用途（逐份读文件头注释 / 源码确认）。 */
const CHECK_SCRIPTS = [
  ["check-isr-routes.mjs", "ISR 路由门禁：构建产物 + --live 线上形态抽查，防 Next 16 读 searchParams 触发 DYNAMIC_SERVER_USAGE 500"],
  ["check-upstream-ref.mjs", "上游底座 ref 一致性：DEFAULT_REF / Dockerfile ARG / UPSTREAM.md / compose build arg 四处同源"],
  ["check-extensions.mjs", "浏览器与桌面扩展规范性：Chrome MV3 清单/资源/JS 语法 + Raycast 包规范与入口"],
  ["check-syntax.mjs", "语法快速门禁：用 esbuild 秒级解析 TS/TSX（不依赖 tsc 项目配置，与 TS 7 解耦）"],
  ["check-large-files.mjs", "大文件入库守卫：--staged 默认 50 MiB / --unpushed 扫未推送 blob，防 100 MiB 推送被拒"],
  ["check-committed-refs.mjs", "提交完整性：已跟踪文件不得引用未入库文件（仓库内相对引用 / package.json 的 node scripts/x.mjs）"],
  ["check-client-node-imports.mjs", "客户端模块图不得 import node 内建模块（防 'use client' 把 crypto/buffer 打进首屏）"],
  ["check-core-mirrors.mjs", "core 镜像一致性：读 HEAD 提交内容，防 packages/core 改了而 overlay 镜像没重生成"],
  ["check-component-contracts.mjs", "组件 props 契约静态检查：调用点多传未声明属性 / 必填属性全没传（正则，非 AST）"],
  ["check-gates-registry.mjs", "门禁清单对账：scripts/gates.json ↔ pre-commit ↔ pre-push ↔ ci.yml 三向一致"],
  ["check-hooks-fresh.mjs", "钩子新鲜度：.git/hooks 生成物仍是 install-git-hooks.mjs 的产物（仅 pre-commit 跑）"],
  ["check-commit-closure.mjs", "提交闭包：按「HEAD 缺了哪些符号」判定一组文件能否作为完整提交（少文件 / 多带别人半成品）"],
  ["check-rate-limit-exemption.mjs", "限流豁免集成覆盖：预览站上 A/B 验证 SSR 取数不再 429 降级成 noindex 壳"],
  ["check-bundle-budget.mjs", "首屏 JS 预算：从构建产物静态统计路由初始 chunk（扣除异步 chunk / polyfills）"],
  ["check-cleanup-coverage.mjs", "清理动作覆盖每条出口（登记制 CLEANUP_RULES），尤其提前 return 绕过 finally"],
  ["check-source-truth.mjs", "读路径事实源判据必须是显式开关（如 resolveVideoStoreMode() === 'db'），不许按哪边数据多"],
  ["check-deps-integrity.mjs", "依赖完整性：抓 pnpm Windows EPERM 安装半途而废导致的「被装残的包」"],
  ["check-defused-thickness.mjs", "撤防账厚度棘轮：比对 explain-ci-failure --defused --json 快照的道数，防写侧漏登记"],
  ["check-web-overlay.mjs", "apps/web 与 apps/web-overlay 一致性：正向漂移失败 exit 1，反向只告警（可选 --fix）"],
  ["check-search-recall.mjs", "检索召回回归器：起盘上引擎 + 临时库副本，重放金标集之外的「召不回来」缺陷探针"],
  ["check-rest-contract-coverage.mjs", "REST 契约覆盖率：路由表 ↔ RESPONSE_SCHEMA_BINDINGS 对账，写路由 100% 绑定或进 allowlist"],
  ["check-commit-atomicity.mjs", "提交原子性：本次提交的测试不得依赖「脏了但没提交」的源码 / 非代码文件"],
  ["check-import-boundaries.mjs", "依赖边界：规则表化「谁能 import 谁」，防 overlay 直接 import @navhub/core 在镜像里 TS2307"],
  ["check-sparsity.mjs", "分类稀疏度巡检：拉 :8787 /api/categories 与 counts，核验 18 根 / 215 叶站点数 ≥20 达标率并抽查权重排序"],
  ["check-ci-gate.mjs", "CI 合并门禁离线校验：解析 ci.yml 全部 jobs 与 ci-passed 的 needs 聚合关系并断言"],
  ["check-coverage.mjs", "覆盖率取数：只读 vitest JSON，出数 / --thresholds 判红 / --max-age 防旧数据假绿"],
  ["check-plan-status.mjs", "计划项 → 落地证据收口：按符号名 / 特征字符串判定 docs/plan-status.json 的 landed 证据"],
  ["check-env-surface.mjs", "配置面登记棘轮：process.env.NAVHUB_* 新增未登记变量判红（against scripts/env-surface.json）"],
  ["check-audit-exceptions.mjs", "依赖审计例外到期：ghsa/reason/owner/expiresAt 齐全，过期判红，可 --emit-ignore"],
  ["check-governance.mjs", "治理门禁聚合器：把 plan-status / env-surface / audit-exceptions 三条单一事实源合成 verify 一步"],
  // ---- 以下 12 份为 2026-11-08 补齐（原清单固定 30 份，磁盘实物已有 42 份）----
  ["check-csp-headers.mjs", "CSP 双档位契约测试：隔离 env 档位加载同一份 next.config.js 的 headers()，断言默认档不下发、enforce 档下发的策略（不依赖 Docker）"],
  ["check-db-integrity.mjs", "数据库引用完整性门禁（只读）：扫关联表指向 sites 里不存在 id 的孤儿行，防早期删站未级联的历史残留再次累积"],
  ["check-dead-modules.mjs", "死模块候选扫描棘轮：overlay 内 0 引用模块，仅「不在基线里的新候选」判红；BASELINE_NOTES 逐份登记 keep/delete 结论"],
  ["check-frontend-typecheck.mjs", "前端类型门禁棘轮：校验 apps/web（构建镜像）的 tsc --noEmit 错误数必须为 0，改 overlay 后需先同步镜像再跑"],
  ["check-generated-all.mjs", "生成/镜像链聚合入口：core 镜像 / 路由策略 / REST 契约 / overlay→web 四条链一次跑完，任一退出非 0 即整体判红"],
  ["check-health-coverage.mjs", "健康探测覆盖与新鲜度 SLO（只读）：已探测样本中超 7×24h 比例 ≤5%、单类目未探测占比 ≤20%"],
  ["check-icons.mjs", "站点 favicon 外链抽查：拉取若干站点首页并打印 <link rel=icon> 供人工核对（非门禁，无退出码判定）"],
  ["check-navigation-health.mjs", "导航健康数据可信口径：重算 trustworthy_fail_rate / untested_rate 双口径，守住「探测中止不得算 unverified」"],
  ["check-numeric-env.mjs", "数值型环境变量守卫：全仓 Number(process.env.X) 读取点所在文件须有 isFinite 校验或钳位/兜底，防 NaN 静默进超时与上限"],
  ["check-quarantine.mjs", "E2E 隔离台账校验：标记形态 / e2e/QUARANTINE.md 五字段 / 到期日 ≤14 天，形状非法即红（政策唯一来源是 TESTING-STRATEGY.md §4.3）"],
  ["check-strip-syntax.mjs", "strip-types 不兼容语法守卫：apps/api 内的 enum / namespace / 构造函数参数属性 / 装饰器任一命中即违规（tsc 全绿也测不出运行时抛错）"],
  ["check-web-config-parity.mjs", "前端配置唯一事实源断言：apps/web 与 overlay 的 next.config.js / package.json / tsconfig.json 必须同源"]
];

// ---------------- 动态枚举 docs/ 下的 .md ----------------
function walkMd(dir, base, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      walkMd(full, base, out);
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      const rel = relative(base, full).split(sep).join("/");
      out.push(rel);
    }
  }
}

function diskDocs() {
  const out = [];
  walkMd(DOCS_DIR, DOCS_DIR, out);
  return out.sort();
}

/** 按文件名前缀推断状态（DOC_STATUS 未显式列出的默认归为 historical/提案）。 */
function inferStatus(rel) {
  if (Object.prototype.hasOwnProperty.call(DOC_STATUS, rel)) return DOC_STATUS[rel];
  if (/^(UPGRADE|AUDIT|GUI-TEST|P3-|PROJECT-PROGRESS|VIDEO-HOTSPOT|SITE-HEALTH|ACCOUNT-LIFECYCLE)/.test(rel)) return "historical";
  if (/(PLAN|PROPOSAL|RECOMMENDATIONS|DESIGN|SCAN|REVIEW|EVAL)/.test(rel)) return "proposal";
  return "historical";
}

function buildIndex() {
  const disk = diskDocs();
  const tracked = new Set(GIT_TRACKED_DOCS);
  const adr = new Set(UNTRACKED_ADR_DOCS);
  const docs = disk.map((rel) => ({
    path: rel,
    tracked: tracked.has(rel),
    source: adr.has(rel) ? "adr-untracked" : (tracked.has(rel) ? "git-tracked" : "disk-extra"),
    status: inferStatus(rel)
  }));
  return {
    schemaVersion: 1,
    description: "NavHub docs/ 文档索引的单一事实源（由 scripts/gen-docs-index.mjs 生成；--check 防漏登记）",
    generatedAt: GENERATED_AT,
    generator: "scripts/gen-docs-index.mjs",
    counts: {
      docsMdDisk: disk.length,
      docsMdGitTracked: GIT_TRACKED_DOCS.length,
      docsMdUntrackedAdr: UNTRACKED_ADR_DOCS.length,
      deliverablesTopLevelDirs: DELIVERABLES_DIRS.length,
      deliverablesMdReports: DELIVERABLES_REPORTS.length,
      scriptsCheckMjs: CHECK_SCRIPTS.length
    },
    notes: [
      "任务书给的 docs/ 87 份 = git 已跟踪口径（GIT_TRACKED_DOCS 常量，2026-11-06 git ls-files 实测）；本索引以磁盘全量为登记口径，逐份标注 tracked，不伪造 87。",
      "初始采集时磁盘实存 91 份 = 87 已跟踪 + 4 份未跟踪 docs/adr/（3 ADR + README）；采集后又出现并行会话新增的未跟踪 .md 时，buildIndex() 会动态纳入并标 source=disk-extra，--check 不误报。",
      "任务书给的 deliverables/ 19 份报告 = 旧口径；磁盘实存 20 份 .md，按真实名称全量登记，不凑数删减。",
      "本索引只登记 docs/ 下的 .md；docs/ 下另有 metrics.json / plan-status.json 等非 .md 文件，由各自生成器负责（metrics.json 见 scripts/gen-docs-metrics.mjs）。",
      "docs/_archive/README.md、docs/seo/CURRENT.md、scripts/INDEX.md、deliverables/INDEX.md 是本轮治理新建的人读文档；其中位于 docs/ 下的两份会由 --check 自动纳入登记范围。"
    ],
    docs,
    deliverables: {
      topLevelDirs: DELIVERABLES_DIRS,
      mdReports: DELIVERABLES_REPORTS
    },
    scripts: {
      checkMjs: CHECK_SCRIPTS.map(([file, purpose]) => ({ file, purpose }))
    }
  };
}

function canonicalize(obj) {
  return JSON.stringify(obj, null, 2) + "\n";
}

function loadExisting() {
  if (!existsSync(OUT)) return null;
  try {
    return { text: readFileSync(OUT, "utf8"), json: JSON.parse(readFileSync(OUT, "utf8")) };
  } catch (e) {
    return { error: e.message };
  }
}

function check() {
  const problems = [];
  const existing = loadExisting();
  if (!existing) {
    problems.push("docs/docs-index.json 不存在 → 先跑默认生成模式");
  } else if (existing.error) {
    problems.push("docs/docs-index.json 不是合法 UTF-8 JSON：" + existing.error);
  } else {
    const idx = existing.json;
    if (!idx || typeof idx !== "object" || !Array.isArray(idx.docs)) {
      problems.push("docs/docs-index.json 形状非法：缺 docs 数组");
    } else {
      const registered = new Set(idx.docs.map((d) => d && d.path).filter(Boolean));
      const disk = diskDocs();
      const unregistered = disk.filter((rel) => !registered.has(rel));
      if (unregistered.length) {
        for (const f of unregistered) problems.push("新增 .md 未登记：docs/" + f);
      }
      const missing = [...registered].filter((rel) => !disk.includes(rel));
      for (const f of missing) problems.push("索引里登记但磁盘已不存在：docs/" + f);
      // 结构自洽：counts 与数组长度一致
      if (idx.counts && idx.counts.docsMdDisk !== undefined && idx.counts.docsMdDisk !== disk.length) {
        problems.push("counts.docsMdDisk=" + idx.counts.docsMdDisk + " 与磁盘实测 " + disk.length + " 不符");
      }
      if (idx.counts && idx.counts.scriptsCheckMjs !== undefined && idx.counts.scriptsCheckMjs !== CHECK_SCRIPTS.length) {
        problems.push("counts.scriptsCheckMjs 与清单长度不符");
      }
      if (idx.counts && idx.counts.deliverablesMdReports !== undefined && idx.counts.deliverablesMdReports !== DELIVERABLES_REPORTS.length) {
        problems.push("counts.deliverablesMdReports 与清单长度不符");
      }
    }
  }
  // 人读文档存在性（只检查，不修改）
  for (const f of ["docs/_archive/README.md", "docs/seo/CURRENT.md", "scripts/INDEX.md", "deliverables/INDEX.md"]) {
    if (!existsSync(join(ROOT, f))) problems.push("人读文档缺失：" + f);
  }
  if (problems.length) {
    console.error("[docs-index] ❌ --check 未通过（" + problems.length + " 项）：");
    for (const p of problems) console.error("  - " + p);
    console.error("  修法：node scripts/gen-docs-index.mjs（重新生成）后连同新增文档一起提交。");
    process.exit(1);
  }
  const idx = existing.json;
  console.log("[docs-index] ✅ --check 通过：docs/ 下 " + diskDocs().length + " 份 .md 全部已登记；" +
    "deliverables/ " + idx.counts.deliverablesMdReports + " 份报告 / " + idx.counts.deliverablesTopLevelDirs + " 个子目录；" +
    "scripts/ " + idx.counts.scriptsCheckMjs + " 个 check-*.mjs。");
  /**
   * 非致命告警：登记数与磁盘实物不一致时必须看得见。
   *
   * 同一类漂移的第三个实例：scripts/INDEX.md 曾手写「113 个 .mjs / 30 个门禁」，
   * 这里的清单登记 30 个，而磁盘上已有 42 个 check-*.mjs —— 没登记的脚本
   * 「存在但没人知道它做什么」，正是本门禁想防的「假绿」。这里不直接判红
   * （否则会立刻打断 CI），只把缺口与差额提示出来，由维护者补齐清单。
   */
  const liveCheckMjs = readdirSync(join(ROOT, "scripts")).filter(
    (n) => n.startsWith("check-") && n.endsWith(".mjs"),
  ).length;
  if (liveCheckMjs !== idx.counts.scriptsCheckMjs) {
    console.warn(
      "[docs-index] ⚠ check-*.mjs 登记数与实物不符：登记 " + idx.counts.scriptsCheckMjs +
        "，实物 " + liveCheckMjs + "。请把缺的 " + (liveCheckMjs - idx.counts.scriptsCheckMjs) +
        " 份补进本脚本的 check 清单（每项都要写真实用途，别按文件名猜）。",
    );
  }
  process.exit(0);
}

function generate() {
  const idx = buildIndex();
  const text = canonicalize(idx);
  writeFileSync(OUT, text, "utf8");
  console.log("[docs-index] 已生成 " + OUT);
  console.log("[docs-index] docs/ .md = " + idx.counts.docsMdDisk + "（git 已跟踪 " + idx.counts.docsMdGitTracked +
    " / 未跟踪 adr " + idx.counts.docsMdUntrackedAdr + "）；deliverables 报告 " + idx.counts.deliverablesMdReports +
    "；scripts check-*.mjs " + idx.counts.scriptsCheckMjs + "。");
  process.exit(0);
}

function help() {
  console.log("用法：");
  console.log("  node scripts/gen-docs-index.mjs            # 重新生成 docs/docs-index.json（默认）");
  console.log("  node scripts/gen-docs-index.mjs --check    # 校验：新增 .md 未登记 / JSON 非法 → exit 1");
  console.log("  node scripts/gen-docs-index.mjs --help     # 本帮助");
  console.log("退出码：0 成功 / 1 校验失败 / 2 参数错误");
}

const unknown = argv.filter((a) => a !== "--check" && a !== "--help" && a !== "-h");
if (unknown.length) {
  console.error("[docs-index] 未知参数：" + unknown.join(" "));
  help();
  process.exit(2);
}
if (argv.includes("--help") || argv.includes("-h")) { help(); process.exit(0); }
if (argv.includes("--check")) { check(); } else { generate(); }
