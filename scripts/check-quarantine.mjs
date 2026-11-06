#!/usr/bin/env node
/**
 * E2E 隔离台账校验：把 docs/TESTING-STRATEGY.md §4.3 的「登记」落成机器可判。
 *
 * 政策（§4.3，唯一来源；本脚本不新增规则）：
 *   - 标记：{ tag: '@quarantine' } 或标题前缀 [quarantine]；不用 test.fixme（等于删除）；
 *   - 登记：e2e/QUARANTINE.md，字段 = 测试名 / 首次 flake 日期 / 失败签名 / 归属人 / 到期日（≤14 天）；
 *   - 门禁：主 E2E 作业加 --grep-invert @quarantine；隔离用例进单独作业
 *           test-e2e-quarantine（continue-on-error: true），保证仍在跑、仍留证据；
 *   - SLA：14 天未修复 → 要么修好、要么删除，并在测试计划里记录「能力缺口」；不允许无限期隔离。
 *
 * 判据（只有两条阻断，其余只提醒）：
 *   1) 形状非法 → exit 1：解析标记缺失/顺序错、表头列名或列数不符、缺分隔行、
 *      数据行单元格数 != 5、任一字段空白、日期不是合法 YYYY-MM-DD 真实日历日、
 *      到期日早于首次 flake 日期、测试名重复；
 *   2) 隔离窗口 > 14 天 → exit 1：到期日 - 首次 flake 日期 > 14 天。
 *      这就是 §4.3 的「到期日（≤14 天）」与「14 天 SLA」。用台账里这两个日期互判，
 *      结论不随运行当天漂移，离线可复现、可写正例/反例自测。
 *   3) 空台账（0 条）→ exit 0，并明确打印「当前 0 条」。
 *
 * 不判红：到期日已过 / 临近到期只进 --json 的 notices 与 stderr 提醒。到期后的
 * 「修好或删除」是 §4.3 的流程 SLA，由人在 PR 里执行；把它伪装成脚本判红，
 * 等于给台账加了一条政策里没有的规则。
 *
 * 用法：
 *   node scripts/check-quarantine.mjs                       # 校验（默认）
 *   node scripts/check-quarantine.mjs --json               # 机器可读
 *   node scripts/check-quarantine.mjs --today=2026-11-06    # 注入「今天」（只影响提醒）
 *   node scripts/check-quarantine.mjs --ledger=<path>       # 注入替代台账（自测用，不新建文件）
 * 退出码：0 通过（含空台账）；1 形状非法 / 隔离窗口 > 14 天；2 台账读不了。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const P = "[quarantine] ";
const HEADERS = ["测试名", "首次 flake 日期", "失败签名", "归属人", "到期日"];
const MAX_WINDOW_DAYS = 14; // §4.3：到期日 ≤14 天 / 14 天 SLA
const DAY = 86_400_000;
const START = "<!-- QUARANTINE_TABLE_START -->";
const END = "<!-- QUARANTINE_TABLE_END -->";

/** 严格 YYYY-MM-DD，且必须是真实日历日（挡住 2026-02-30 被 JS 滚到 3 月） */
function parseISO(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return t;
}
const iso = (t) => new Date(t).toISOString().slice(0, 10);

/** 取 Markdown 表格行的单元格（首尾竖线产生的空单元去掉） */
function tableCells(line) {
  const c = line.split("|").map((x) => x.trim());
  if (c.length && c[0] === "") c.shift();
  if (c.length && c[c.length - 1] === "") c.pop();
  return c;
}
function isTableRow(line) {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.length > 1;
}
function isSeparator(cs) {
  return cs.length === HEADERS.length && cs.every((c) => {
    const t = c.replaceAll(":", "");
    return t.length >= 3 && [...t].every((ch) => ch === "-");
  });
}

function main() {
  const ledgerArg = argv.find((a) => a.startsWith("--ledger="));
  const LEDGER = ledgerArg ? resolve(ROOT, ledgerArg.slice(9)) : resolve(ROOT, "e2e/QUARANTINE.md");
  const todayArg = argv.find((a) => a.startsWith("--today="));
  let today;
  if (todayArg) {
    today = parseISO(todayArg.slice(8));
    if (today === null) { console.error(P + "--today 必须是 YYYY-MM-DD 真实日期"); return 2; }
  } else {
    const n = new Date();
    today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  }

  if (!existsSync(LEDGER)) { console.error(P + "找不到台账：" + LEDGER); return 2; }
  let text;
  try { text = readFileSync(LEDGER, "utf8"); }
  catch (e) { console.error(P + "台账读不了：" + e.message); return 2; }

  const problems = [];
  const notices = [];
  const entries = [];
  let rowCount = 0; // 表格数据行数（含形状非法的行），用于如实显示，不与「成功解析条数」混淆
  const lines = text.split(/\r?\n/);
  const s = lines.findIndex((l) => l.trim() === START);
  const e = lines.findIndex((l) => l.trim() === END);
  if (s < 0 || e < 0 || e <= s) {
    problems.push("找不到成对的 " + START + " / " + END + " 解析标记（或顺序颠倒）：台账形状非法");
  }
  let tableLines = [];
  if (s >= 0 && e > s) tableLines = lines.slice(s + 1, e).filter(isTableRow);

  if (tableLines.length < 2) {
    problems.push("台账表格不完整：至少需要表头行 + 分隔行（当前 0 条也要保留这两行）");
  } else {
    const head = tableCells(tableLines[0]);
    if (head.length !== HEADERS.length || head.some((h, i) => h !== HEADERS[i])) {
      problems.push("表头列不符：必须是「" + HEADERS.join(" | ") + "」，实际「" + head.join(" | ") + "」");
    }
    if (!isSeparator(tableCells(tableLines[1]))) {
      problems.push("缺 Markdown 分隔行（|---|---|---|---|---|）或分隔行形状非法");
    }
    const seen = new Set();
    for (let i = 2; i < tableLines.length; i++) {
      rowCount++;
      const cs = tableCells(tableLines[i]);
      const label = "第 " + (i - 1) + " 条（" + (cs[0] || "?").slice(0, 40) + "）";
      if (cs.length !== HEADERS.length) {
        problems.push(label + " 有 " + cs.length + " 列，应为 " + HEADERS.length + " 列");
        continue;
      }
      const [name, first, signature, owner, due] = cs;
      const fields = [["测试名", name], ["首次 flake 日期", first], ["失败签名", signature], ["归属人", owner], ["到期日", due]];
      let blank = false;
      for (const [k, v] of fields) if (!v) { problems.push(label + " 字段「" + k + "」为空"); blank = true; }
      if (seen.has(name)) problems.push(label + " 测试名重复：" + name);
      seen.add(name);
      if (blank) continue;
      const firstMs = parseISO(first);
      const dueMs = parseISO(due);
      if (firstMs === null) problems.push(label + " 首次 flake 日期非法（需 YYYY-MM-DD 真实日期）：" + first);
      if (dueMs === null) problems.push(label + " 到期日非法（需 YYYY-MM-DD 真实日期）：" + due);
      if (firstMs === null || dueMs === null) continue;
      const windowDays = Math.round((dueMs - firstMs) / DAY);
      if (windowDays < 0) {
        problems.push(label + " 到期日 " + due + " 早于首次 flake 日期 " + first + "：形状非法");
      } else if (windowDays > MAX_WINDOW_DAYS) {
        problems.push(label + " 隔离窗口 " + windowDays + " 天 > " + MAX_WINDOW_DAYS + " 天（" + first + " → " + due + "）：§4.3 到期日必须 ≤14 天，请修好或删除该用例");
      }
      const daysRemaining = Math.round((dueMs - today) / DAY);
      entries.push({ testName: name, firstFlake: first, signature, owner, due, windowDays, daysRemaining });
      if (daysRemaining < 0) notices.push(label + " 已过到期日 " + (-daysRemaining) + " 天：按 §4.3 修好或删除，并记录「能力缺口」");
      else if (daysRemaining === 0) notices.push(label + " 今天到期：按 §4.3 修好或删除");
      else if (daysRemaining <= 3) notices.push(label + " 将在 " + daysRemaining + " 天后到期");
    }
  }

  const ok = problems.length === 0;
  const ledgerRel = relative(ROOT, LEDGER).split(sep).join("/");
  if (argv.includes("--json")) {
    console.log(JSON.stringify({
      ledger: ledgerRel,
      today: iso(today),
      maxWindowDays: MAX_WINDOW_DAYS,
      count: rowCount,
      ok,
      entries,
      problems,
      notices,
    }, null, 2));
  } else {
    console.log(P + (rowCount === 0 ? "当前 0 条隔离用例（空台账）" : "表格 " + rowCount + " 条登记") + "；隔离窗口上限 " + MAX_WINDOW_DAYS + " 天（§4.3）");
  }
  for (const n of notices) console.error(P + "提醒：" + n);
  if (!ok) {
    for (const p of problems) console.error(P + "❌ " + p);
    console.error(P + "共 " + problems.length + " 处问题：形状非法或隔离窗口 > " + MAX_WINDOW_DAYS + " 天（政策见 docs/TESTING-STRATEGY.md §4.3）");
    return 1;
  }
  if (!argv.includes("--json")) {
    console.log(P + "✅ " + (rowCount === 0 ? "空台账，无需隔离用例" : rowCount + " 条登记形状合法、隔离窗口均 ≤ " + MAX_WINDOW_DAYS + " 天"));
  }
  return 0;
}

process.exitCode = main();
