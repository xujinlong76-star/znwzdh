#!/usr/bin/env node
/**
 * 依赖审计例外到期校验（C-5）：防止「例外永久化」。
 *
 * 背景：pnpm-workspace.yaml:38-46 的 auditConfig.ignoreGhsas 注释写「无论如何每季度
 * （下次 2026-12-31）复核一次」，ci.yml:841 另有 --ignore 同款硬编码（双份口径）。
 * 全仓只有 scripts/test-telemetry.test.ts 出现过 2026-12-31（测试夹具，不是校验）。
 * 例外没有 expiresAt 自动化 → braces 发布修复版后无人被提醒摘掉 --ignore。
 *
 * 判据：
 *   1) 每条例外必须有 ghsa / reason / owner / expiresAt（ISO 日期）；
 *   2) 今天 > expiresAt → 判红（该复审了，要么续期并写明理由，要么删除例外）；
 *   3) 今天 > expiresAt - reviewCadenceDays → 提醒（不阻断）；
 *   4) 生成 --ignore 参数供 CI 使用（--emit-ignore），让 ci.yml 与 workspace 不再手写两遍。
 *
 * 用法：
 *   node scripts/check-audit-exceptions.mjs                # 校验（默认）
 *   node scripts/check-audit-exceptions.mjs --emit-ignore # 打印 "--ignore GHSA-..."
 *   node scripts/check-audit-exceptions.mjs --json        # 机器可读
 * 退出码：0 通过；1 过期/形状非法；2 清单读不了。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CFG = resolve(ROOT, "scripts/audit-exceptions.json");
const argv = process.argv.slice(2);
const P = "[audit-exceptions] ";
// --today=YYYY-MM-DD 供测试注入日期（做「过期必然判红」的消融，不必改清单文件）
const todayArg = argv.find((a) => a.startsWith("--today="));
const today = todayArg ? new Date(todayArg.slice(8) + "T00:00:00") : new Date();
if (Number.isNaN(today.getTime())) { console.error(P + "--today 日期非法"); process.exit(2); }
today.setHours(0, 0, 0, 0);

if (!existsSync(CFG)) { console.error(P + "找不到 scripts/audit-exceptions.json"); process.exit(2); }
let cfg;
try { cfg = JSON.parse(readFileSync(CFG, "utf8")); }
catch (e) { console.error(P + "清单解析失败：" + e.message); process.exit(2); }
if (!Array.isArray(cfg.exceptions)) { console.error(P + "形状非法：缺 exceptions 数组"); process.exit(2); }

const problems = [];
const notices = [];
const ids = [];
for (const e of cfg.exceptions) {
  for (const k of ["ghsa", "reason", "owner", "expiresAt"]) {
    if (!e[k]) problems.push("例外缺 " + k + "：" + JSON.stringify(e).slice(0, 100));
  }
  if (!/^GHSA-[a-z0-9-]{4,}$/i.test(e.ghsa ?? "")) problems.push("非法 GHSA id：" + e.ghsa);
  ids.push(e.ghsa);
  const exp = new Date(e.expiresAt + "T00:00:00");
  if (Number.isNaN(exp.getTime())) { problems.push("expiresAt 非法：" + e.expiresAt); continue; }
  if (today > exp) {
    problems.push(e.ghsa + "（" + e.package + "）已于 " + e.expiresAt + " 到期：请复核并续期（写明理由）或删除例外");
  } else {
    const cadence = Number(e.reviewCadenceDays ?? 90);
    const reviewAt = new Date(exp.getTime() - cadence * 86400000);
    if (today >= reviewAt) notices.push(e.ghsa + " 将在 " + e.expiresAt + " 到期，进入 " + cadence + " 天复核窗口");
  }
}
if (new Set(ids).size !== ids.length) problems.push("存在重复 GHSA id");

if (argv.includes("--emit-ignore")) {
  console.log(ids.map((g) => "--ignore " + g).join(" "));
  process.exit(0);
}
if (argv.includes("--json")) console.log(JSON.stringify({ count: ids.length, ids, problems, notices }, null, 2));
for (const n of notices) console.log(P + "提醒：" + n);
if (problems.length) {
  for (const p of problems) console.error(P + "❌ " + p);
  console.error(P + "修法：更新 scripts/audit-exceptions.json（续期需写明理由），并同步 pnpm-workspace.yaml 与 ci.yml 的 --ignore");
  process.exit(1);
}
console.log(P + "✅ " + ids.length + " 条例外均在有效期内（" + ids.join(", ") + "）");
process.exit(0);
