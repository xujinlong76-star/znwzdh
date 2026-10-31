#!/usr/bin/env node
/**
 * CI 红灯台账 CLI：把「这次的失败集」与跟踪路径上的台账做跨轮对比。
 *
 * 用法：
 *   node scripts/ci-red-ledger.mjs --from <junit.xml ...> [--ledger docs/ci-red-ledger.json]
 *       默认只报告（advisory）；加 --require-no-new 后，出现台账之外的红（含「同用例换因」）即 rc 1。
 *       单分片只能看到自己的失败集，所以 check 模式**不判定已修复**——那是 --update 的事。
 *   node scripts/ci-red-ledger.mjs --from <junit.xml ...> --update
 *       用当前全量失败集重建台账：新红入账（owner + TTL），已知红刷新 lastSeen，修复的移除。
 *   其它：--ttl-days <n>（默认 14）、--owner <name>（新条目兜底责任人）、--max <n>。
 *
 * 退出码：0 = 通过/已写入；1 = 有新增红（--require-no-new）或过期未修（--strict-ttl）；
 *         2 = 台账或产物读不了（不能把「没账」当成「没有新红」）。
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJunit } from "./junit-summary.mjs";
import { diffLedger, renderLedger, updateLedger, validateLedger } from "./lib/ci-red-ledger.mjs";

const P = "[ci-red-ledger] ";
const DEFAULT_LEDGER = "docs/ci-red-ledger.json";

function parseArgs(argv) {
  const opts = {
    files: [],
    ledger: DEFAULT_LEDGER,
    update: false,
    requireNoNew: false,
    strictTtl: false,
    ttlDays: 14,
    owner: "",
    max: 20,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--from") {
      i += 1;
      while (i < argv.length && !argv[i].startsWith("--")) {
        opts.files.push(argv[i]);
        i += 1;
      }
      i -= 1;
      continue;
    }
    if (arg === "--ledger") { opts.ledger = argv[i + 1] ?? ""; i += 1; continue; }
    if (arg === "--update") { opts.update = true; continue; }
    if (arg === "--require-no-new") { opts.requireNoNew = true; continue; }
    if (arg === "--strict-ttl") { opts.strictTtl = true; continue; }
    if (arg === "--ttl-days") { opts.ttlDays = Number.parseInt(argv[i + 1] ?? "", 10); i += 1; continue; }
    if (arg === "--owner") { opts.owner = argv[i + 1] ?? ""; i += 1; continue; }
    if (arg === "--max") { opts.max = Number.parseInt(argv[i + 1] ?? "", 10); i += 1; continue; }
    if (arg.startsWith("--ledger=")) { opts.ledger = arg.slice("--ledger=".length); continue; }
    if (arg.startsWith("--ttl-days=")) { opts.ttlDays = Number.parseInt(arg.slice("--ttl-days=".length), 10); continue; }
    opts.files.push(arg);
  }
  if (!Number.isFinite(opts.ttlDays) || opts.ttlDays <= 0) opts.ttlDays = 14;
  if (!Number.isFinite(opts.max) || opts.max <= 0) opts.max = 20;
  return opts;
}

/** 新条目的责任人：优先提交该测试的作者（台账要能追到人，而不是「有人」） */
function ownerFromGit(testFile) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%an", "--", testFile], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out;
  } catch {
    return "";
  }
}

function emit(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath !== undefined && summaryPath !== "") {
    appendFileSync(summaryPath, markdown + "\n");
    console.log(`${P}已追加到 Step Summary：${summaryPath}`);
  } else {
    console.log(markdown);
  }
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.files.length === 0) {
    console.error(`用法: node scripts/ci-red-ledger.mjs --from <junit.xml ...> [--update] [--require-no-new]`);
    return 2;
  }

  const failures = [];
  let totals = { tests: 0, failures: 0, errors: 0 };
  for (const file of opts.files) {
    if (!existsSync(file)) {
      console.error(`${P}找不到 junit 产物：${file}（产物缺失时不做「没有失败」的推断）`);
      return 2;
    }
    const report = parseJunit(readFileSync(file, "utf8"));
    totals.tests += report.totals.tests;
    totals.failures += report.totals.failures;
    totals.errors += report.totals.errors;
    failures.push(...report.failures);
  }

  const ledgerAbs = resolve(opts.ledger);
  let ledger = null;
  if (existsSync(ledgerAbs)) {
    try {
      ledger = JSON.parse(readFileSync(ledgerAbs, "utf8"));
    } catch (error) {
      console.error(`${P}台账解析不了：${opts.ledger} —— ${error.message}`);
      return 2;
    }
    const problems = validateLedger(ledger);
    if (problems.length > 0) {
      console.error(`${P}台账形状不合法（坏账会把所有红都当已知）：${opts.ledger}`);
      for (const p of problems) console.error(`   - ${p}`);
      return 2;
    }
  } else if (!opts.update) {
    console.error(`${P}台账不存在：${opts.ledger}（先 --update 建账；没有账就不能判定「新红」）`);
    return 2;
  }

  if (opts.update) {
    const { ledger: next, removed, added, renewed } = updateLedger(ledger, failures, {
      ttlDays: opts.ttlDays,
      ownerOf: (f) => (opts.owner ? opts.owner : ownerFromGit(f.file)),
    });
    writeFileSync(ledgerAbs, JSON.stringify(next, null, 2) + "\n");
    console.log(
      `${P}台账已写入 ${opts.ledger}：${failures.length} 条在账（新增 ${added.length}，换因重置 ${renewed.length}，` +
        `修复移除 ${removed.length}，TTL ${opts.ttlDays} 天）`,
    );
    for (const id of added) console.log(`   + ${id}`);
    for (const id of renewed) console.log(`   ~ ${id}（换因，TTL 重置）`);
    for (const id of removed) console.log(`   - ${id}（已修复）`);
    return 0;
  }

  const diff = diffLedger(ledger, failures, {});
  emit(renderLedger(diff, { label: `CI 红灯台账（${opts.files.length} 份产物 / ${totals.tests} 例）`, max: opts.max, ledgerPath: opts.ledger }));
  const aliasHits = diff.persisted.filter((x) => x.matchedAlias).length;
  console.log(
    `${P}新增 ${diff.introduced.length} · 换因 ${diff.changed.length} · 已知 ${diff.persisted.length}` +
      `${aliasHits > 0 ? `（别名 ${aliasHits}）` : ""} · 过期 ${diff.expired.length}`,
  );

  let rc = 0;
  if (opts.requireNoNew && diff.introduced.length + diff.changed.length > 0) {
    console.error(`${P}有 ${diff.introduced.length + diff.changed.length} 条红不在台账里（--require-no-new）`);
    rc = 1;
  }
  if (opts.strictTtl && diff.expired.length > 0) {
    console.error(`${P}有 ${diff.expired.length} 条已知红超过 TTL 仍未修（--strict-ttl）`);
    rc = 1;
  }
  return rc;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
