#!/usr/bin/env node
/**
 * 计划项 → 落地证据 收口校验（docs 元分析空白 B-1/B-2）。
 *
 * 背景：docs/BACKEND-OPTIMIZATION-PLAN-2026-10-30.md 的 5 P0 + 8 P1 全部已在代码落地，
 * 但文档无一处标注；UPGRADE-EXECUTION-2026-10-27.md §8 的 13 项「未完成」至少 8 项已闭环。
 * 任何 AI/新人按旧方案重做一遍会与已入库代码正面冲突。历史文档不改写（INDEX.md 约定），
 * 用 docs/plan-status.json 集中登记 landed/open，并由本脚本按符号名判定。
 *
 * 判据刻意用**符号名 / 特征字符串**而不是行号：行号随并行会话漂移，符号不会。
 *   - evidence 形如 "path:符号"  → 校验文件存在且包含该符号；
 *   - evidence 形如 "path"      → 只校验文件存在（用于整文件级证据）；
 *   - status=landed 且 evidence 为空 → 判红（「已落地」没有证据比没有登记更糟）。
 *
 * 用法：
 *   node scripts/check-plan-status.mjs              # 校验（默认）
 *   node scripts/check-plan-status.mjs --json      # 机器可读
 * 退出码：0 通过；1 证据缺失/符号消失/形状非法；2 清单读不了。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = resolve(ROOT, "docs/plan-status.json");
const argv = process.argv.slice(2);
const P = "[plan-status] ";

if (!existsSync(LEDGER)) { console.error(P + "找不到清单 docs/plan-status.json"); process.exit(2); }
let ledger;
try { ledger = JSON.parse(readFileSync(LEDGER, "utf8")); }
catch (e) { console.error(P + "清单解析失败：" + e.message); process.exit(2); }
if (!Array.isArray(ledger.plans)) { console.error(P + "清单形状非法：缺 plans 数组"); process.exit(2); }

const problems = [];
let landed = 0, open = 0, checkedSymbols = 0;

for (const plan of ledger.plans) {
  if (!Array.isArray(plan.items)) { problems.push("方案 " + plan.source + " 缺 items"); continue; }
  for (const item of plan.items) {
    if (!item.id || !item.status) { problems.push("条目缺 id/status：" + JSON.stringify(item).slice(0, 100)); continue; }
    if (!["landed", "open", "rejected", "superseded"].includes(item.status)) {
      problems.push(plan.source + " " + item.id + " 非法 status=" + item.status);
      continue;
    }
    if (item.status === "open") { open++; continue; }
    if (item.status !== "landed") continue;
    landed++;
    if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
      problems.push(plan.source + " " + item.id + " 标 landed 但无 evidence");
      continue;
    }
    for (const ev of item.evidence) {
      const at = ev.indexOf(":");
      const rel = at < 0 ? ev : ev.slice(0, at);
      const symbol = at < 0 ? null : ev.slice(at + 1);
      const full = resolve(ROOT, rel);
      if (!existsSync(full)) { problems.push(plan.source + " " + item.id + " 证据文件不存在：" + rel); continue; }
      if (symbol) {
        checkedSymbols++;
        const text = readFileSync(full, "utf8");
        if (!text.includes(symbol)) {
          problems.push(plan.source + " " + item.id + " 证据符号已消失：" + rel + " 中找不到 " + symbol);
        }
      }
    }
  }
}

// openActions 只做形状校验（外部动作无法自动判定），但要求有 owner 与 requiresUi
for (const a of ledger.openActions ?? []) {
  if (!a.action || !a.owner || typeof a.requiresUi !== "boolean") {
    problems.push("openActions 条目缺 action/owner/requiresUi：" + JSON.stringify(a).slice(0, 100));
  }
}

if (argv.includes("--json")) {
  console.log(JSON.stringify({ landed, open, checkedSymbols, problems }, null, 2));
}
if (problems.length) {
  for (const p of problems) console.error(P + "❌ " + p);
  console.error(P + "共 " + problems.length + " 处不一致：历史方案可能已被重新实现或证据文件被改名，请更新 docs/plan-status.json");
  process.exit(1);
}
console.log(P + "✅ " + landed + " 条 landed 证据全部命中（" + checkedSymbols + " 个符号）、" + open + " 条 open、openActions 形状合法");
process.exit(0);
