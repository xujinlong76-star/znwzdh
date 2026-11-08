#!/usr/bin/env node
/**
 * check-navigation-health —— 导航健康数据的「可信口径」校验（2026-11-07 九维评审 4-1）。
 *
 * 问题：navigation-live.json 用 health.ok:boolean 一个维度承载三种语义
 *   - 从未探测（httpStatus / error / lastCheckedAt 全 null）
 *   - 探测被中止（httpStatus=null，但有 error / lastCheckedAt / latencyMs）
 *   - 确认 HTTP 失败（有 httpStatus 且 ok=false）
 * 于是名义失败率 1005/1365=73.63%，而可信失败率只有 24/429=5.59%，
 * 相差约 13 倍；告警与排期若照名义值走，会把 1005 条当成待修死链。
 *
 * 本脚本**只读**，做两件事：
 *   1. 重算并输出双口径指标（trustworthy_fail_rate / untested_rate）；
 *   2. --check 断言数值自洽，并守住「探测中止不得归类为 unverified」这条语义边界。
 *
 * 它不修改快照，也不替业务决定 status/active —— 经核实假红不直接影响
 * sitemap 收录（apps/web-overlay/src/lib/seo/sitemap-entries.ts:17-25 的
 * SiteRef 无 health 字段），所以这里的定位是「告警与排期口径」而非收录事故。
 *
 * 用法（在仓库根运行）：
 *   node scripts/check-navigation-health.mjs
 *   node scripts/check-navigation-health.mjs --json
 *   node scripts/check-navigation-health.mjs --check
 *   node scripts/check-navigation-health.mjs --file=/path/to/navigation-live.json
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
const argv = process.argv.slice(2);
const fileArg = argv.find((a) => a.startsWith("--file="));
const file = fileArg
  ? resolve(fileArg.slice("--file=".length))
  : resolve(ROOT, "..", "navigation-live.json");
const asJson = argv.includes("--json");
const asCheck = argv.includes("--check");

if (!existsSync(file)) {
  console.error(`[nav-health] 找不到快照：${file}（用 --file=<path> 指定）`);
  process.exit(2);
}

const data = JSON.parse(readFileSync(file, "utf8"));
const items = (data.navigationItems ?? []).flatMap((c) =>
  (c.subCategories ?? []).flatMap((s) => s.items ?? []),
);
const isNull = (v) => v === null || v === undefined;

let okTrue = 0;
let okFalse = 0;
let httpNull = 0;
let untested = 0;
let fetchAbort = 0;
let httpFailed = 0;
let probed = 0;
let triState = 0;
const misclassified = [];

for (const it of items) {
  const h = it.health ?? {};
  if (h.ok === true) okTrue += 1;
  else okFalse += 1;
  if (isNull(h.httpStatus)) httpNull += 1;
  if (!isNull(h.lastCheckedAt)) probed += 1;
  if (typeof h.status === "string") triState += 1;

  const allNull = isNull(h.httpStatus) && isNull(h.error) && isNull(h.lastCheckedAt);
  if (allNull) {
    untested += 1;
  } else if (isNull(h.httpStatus) && !isNull(h.error)) {
    fetchAbort += 1;
    // 语义边界：探测中止是「试过但没取到状态」，不能被当成从未探测。
    // 一旦三态字段落地，这类记录标成 unverified 就是把已知失败抹成未知。
    if (h.status === "unverified") misclassified.push(it.title ?? it.id ?? "<无标题>");
  } else if (h.ok === false && !isNull(h.httpStatus)) {
    httpFailed += 1;
  }
}

const total = items.length;
const rate = (n, d) => (d > 0 ? Number(((n / d) * 100).toFixed(2)) : 0);
const metrics = {
  total,
  okTrue,
  okFalse,
  nominalFailRatePct: rate(okFalse, total),
  httpStatusNull: httpNull,
  untested,
  untestedRatePct: rate(untested, total),
  fetchAbort,
  httpFailed,
  probed,
  trustworthyFailRatePct: rate(httpFailed, probed),
  triStateCoveragePct: rate(triState, total),
};

if (asJson) {
  console.log(JSON.stringify({ file, metrics, misclassified }, null, 2));
} else {
  console.log(`[nav-health] 快照：${file}`);
  console.log(`[nav-health] 条目 ${total}｜ok=false ${okFalse}（名义失败率 ${metrics.nominalFailRatePct}%）`);
  console.log(`[nav-health] 其中 httpStatus=null ${httpNull} = 从未探测 ${untested} + 探测中止 ${fetchAbort}`);
  console.log(`[nav-health] 已探测样本 ${probed}｜确认 HTTP 失败 ${httpFailed}｜可信失败率 ${metrics.trustworthyFailRatePct}%`);
  console.log(`[nav-health] 未探测占比 ${metrics.untestedRatePct}%｜三态字段覆盖率 ${metrics.triStateCoveragePct}%`);
  if (triState === 0) {
    console.log("[nav-health] 提示：快照尚无三态字段，health.ok 仍为布尔二态；本脚本当前只校验口径自洽，不改写数据。");
  }
}

if (!asCheck) process.exit(0);

const problems = [];
if (okFalse !== untested + fetchAbort + httpFailed) {
  problems.push(`ok=false(${okFalse}) ≠ 从未探测(${untested}) + 探测中止(${fetchAbort}) + 确认失败(${httpFailed})：语义分类有漏项`);
}
if (httpNull !== untested + fetchAbort) {
  problems.push(`httpStatus=null(${httpNull}) ≠ 从未探测(${untested}) + 探测中止(${fetchAbort})`);
}
if (misclassified.length) {
  problems.push(`${misclassified.length} 条「探测中止」被标成 unverified：${misclassified.slice(0, 5).join("、")}`);
}
if (problems.length) {
  console.error("[nav-health] ❌ 口径校验未通过：");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("[nav-health] ✅ 口径自洽：三种语义可分离，可信失败率可复算");
process.exit(0);
