#!/usr/bin/env node
/**
 * 治理门禁聚合器：把若干轻量「单一事实源」校验合成 verify 的**一步**。
 *
 * 为什么不各占一步：scripts/verify.mjs 默认档已有 16 步，本仓 227 个护栏脚本、
 * 21,773 行护栏 + 16,306 行自测，再加 3 步就是「护栏膨胀」（见 8 维度方案 T-1/T-2）。
 * 聚合后 verify 只多 1 步，失败时仍逐条打印是哪个子门禁红。
 *
 * 子门禁：
 *   - check-plan-status.mjs     计划项 landed 证据按符号名判定（防「按旧方案重做已实现的功能」）
 *   - check-env-surface.mjs     process.env.NAVHUB_* 登记棘轮（新增未登记变量即红）
 *   - check-audit-exceptions.mjs 审计例外到期判红（防例外永久化）
 *   - check-quarantine.mjs        E2E 隔离台账形状与 14 天 SLA（e2e/QUARANTINE.md）
 *   - gen-docs-index.mjs --check  docs/ 全量 .md 登记棘轮（新增未登记即红）
 *   - check-dead-modules.mjs      前端 0 引用模块棘轮（9 项基线）
 *   - check-strip-syntax.mjs       Node 24 strip-types 不可擦除语法棘轮（基线 0）
 *   - check-numeric-env.mjs        Number(process.env.*) 未保护点棘轮（1 项基线）
 *   - check-web-config-parity.mjs 两份前端配置 sha256 一致（1-2）
 *   - check-csp-headers.mjs       CSP 双档位契约，无需 Docker（2-1）
 *
 * 退出码：任一子门禁非 0 即 1；清单缺失/形状非法由子门禁给 2。
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GATES = [
  { name: "计划项落地证据", script: "scripts/check-plan-status.mjs" },
  { name: "配置面登记棘轮", script: "scripts/check-env-surface.mjs" },
  { name: "审计例外到期", script: "scripts/check-audit-exceptions.mjs" },
  { name: "E2E 隔离台账", script: "scripts/check-quarantine.mjs" },
  { name: "文档索引登记", script: "scripts/gen-docs-index.mjs", args: ["--check"] },
  { name: "死模块棘轮", script: "scripts/check-dead-modules.mjs" },
  { name: "strip 语法棘轮", script: "scripts/check-strip-syntax.mjs" },
  { name: "数值 env 棘轮", script: "scripts/check-numeric-env.mjs" },
  // 2026-11-07 九维评审 1-2：四条构建路径读的是两份物理配置，漂移时
  // CSP / ignoreBuildErrors 会在宿主机、verify:web、CI、Docker 上各读一份。
  // 并入聚合器而非 verify 新增一步，避免护栏膨胀。
  { name: "前端配置事实源一致性", script: "scripts/check-web-config-parity.mjs" },
  // 2026-11-07 九维评审 2-1：本机无 Docker 也能验 CSP 的 enforce / report-only
  // 双档位契约；并入聚合器，verify 默认档项数不变。
  { name: "CSP 双档位契约", script: "scripts/check-csp-headers.mjs" },
];
let failed = 0;
for (const g of GATES) {
  const r = spawnSync(process.execPath, [resolve(ROOT, g.script), ...(g.args ?? [])], { cwd: ROOT, encoding: "utf8" });
  const out = ((r.stdout ?? "") + (r.stderr ?? "")).trim();
  if (r.status === 0) {
    const last = out.split(/\r?\n/).filter(Boolean).pop() ?? "OK";
    console.log("[governance] ✅ " + g.name + "：" + last);
  } else {
    failed++;
    console.error("[governance] ❌ " + g.name + "（exit " + r.status + "）：");
    for (const line of out.split(/\r?\n/)) if (line.trim()) console.error("    " + line);
  }
}
if (failed) { console.error("[governance] " + failed + " 个子门禁未通过"); process.exit(1); }
console.log("[governance] " + GATES.length + " 个子门禁全部通过");
process.exit(0);