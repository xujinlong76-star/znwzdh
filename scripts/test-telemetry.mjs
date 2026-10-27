#!/usr/bin/env node
/**
 * 测试遥测：把 JUnit 结果沉淀成「flake 率」与「隔离清单」。
 *
 * 为什么需要：CI 里 Playwright `retries: 2`，一个用例首次失败、重试通过时
 * 整轮是绿的——于是没人知道它在抖。等到某天重试也救不回来，才当成「新故障」
 * 排查，而它其实已经抖了很久。同理，隔离（quarantine）如果没有到期日，
 * 就会变成永久豁免。
 *
 * 本脚本做三件事：
 *   1. 解析 JUnit XML（vitest 与 Playwright 都产出），识别 flaky
 *      （Playwright 用 `<flakyFailure>` / `<flakyError>` 标记「重试后通过」）；
 *   2. 把每次运行追加进滚动历史（默认保留 20 次），算用例级 flake 率；
 *   3. 校验隔离清单：过期条目必须失败；已被隔离但这次通过的，提示可以移除。
 *
 * 用法：
 *   node scripts/test-telemetry.mjs --junit="junit-*.xml"
 *   node scripts/test-telemetry.mjs --junit=a.xml --junit=b.xml --json
 *   node scripts/test-telemetry.mjs --quarantine-only
 *
 * 退出码：0 正常 / 1 隔离过期或 flake 超阈值 / 2 用法错误
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const HISTORY_LIMIT = 20;

/** 解析 JUnit XML：只取 testcase 级信息，不引第三方 XML 库（门禁要零依赖） */
export function parseJUnit(xml) {
  const cases = [];
  const caseRe = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = caseRe.exec(xml)) !== null) {
    const attrs = m[1] ?? "";
    const inner = m[3] ?? "";
    const name = attr(attrs, "name") ?? "(未命名)";
    const classname = attr(attrs, "classname") ?? "";
    const id = classname ? `${classname} › ${name}` : name;
    const failed = /<failure\b|<error\b/.test(inner);
    // Playwright：重试后通过会写 flakyFailure / flakyError
    const flaky = /<flakyFailure\b|<flakyError\b/.test(inner);
    const skipped = /<skipped\b/.test(inner);
    cases.push({
      id,
      status: failed ? "failed" : skipped ? "skipped" : flaky ? "flaky" : "passed",
      timeMs: Math.round(Number(attr(attrs, "time") ?? 0) * 1000),
    });
  }
  return {
    total: cases.length,
    failed: cases.filter((c) => c.status === "failed").length,
    flaky: cases.filter((c) => c.status === "flaky").map((c) => c.id),
    cases,
  };
}

function attr(attrs, name) {
  // 必须锚定在属性边界：`name` 会命中 `classname="…"` 的尾部
  // （首版就是这么错的：用例名被解析成了 classname 的值）
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`));
  return m ? decodeEntities(m[1]) : null;
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 把一次运行并入历史；同一用例累计 runs / fails / flakes */
export function updateHistory(history, run, limit = HISTORY_LIMIT) {
  const next = {
    version: 1,
    runs: [...(history?.runs ?? []), run].slice(-limit),
    tests: { ...(history?.tests ?? {}) },
  };
  for (const c of run.cases) {
    const prev = next.tests[c.id] ?? { runs: 0, fails: 0, flakes: 0, last: "" };
    next.tests[c.id] = {
      runs: prev.runs + 1,
      fails: prev.fails + (c.status === "failed" ? 1 : 0),
      flakes: prev.flakes + (c.status === "flaky" ? 1 : 0),
      last: c.status,
    };
  }
  return next;
}

/** 用例级 flake 率：flakes / runs（只看历史里有记录的） */
export function flakeRate(history, id) {
  const rec = history?.tests?.[id];
  if (!rec || rec.runs === 0) return 0;
  return rec.flakes / rec.runs;
}

/** 隔离清单里已过期的条目（到期日当天仍有效，次日起失效） */
export function expiredQuarantine(entries, todayISO) {
  const today = todayISO.slice(0, 10);
  return (entries ?? []).filter((e) => typeof e.expiresAt === "string" && e.expiresAt.slice(0, 10) < today);
}

function expandGlobs(patterns) {
  const files = [];
  for (const pattern of patterns) {
    if (!pattern.includes("*")) {
      if (existsSync(pattern)) files.push(pattern);
      continue;
    }
    const dir = dirname(pattern);
    const re = new RegExp("^" + pattern.split("/").pop().replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) if (re.test(name)) files.push(join(dir, name));
  }
  return [...new Set(files.map((f) => resolve(f)))];
}

function parseArgs(argv) {
  const opts = { junit: [], history: ".cache/test-history.json", quarantine: "quarantine.json", maxFlake: 0.02, json: false, quarantineOnly: false };
  for (const arg of argv) {
    if (arg === "--json") opts.json = true;
    else if (arg === "--quarantine-only") opts.quarantineOnly = true;
    else if (arg.startsWith("--junit=")) opts.junit.push(arg.slice("--junit=".length));
    else if (arg.startsWith("--history=")) opts.history = arg.slice("--history=".length);
    else if (arg.startsWith("--quarantine=")) opts.quarantine = arg.slice("--quarantine=".length);
    else if (arg.startsWith("--max-flake=")) opts.maxFlake = Number(arg.slice("--max-flake=".length));
    else {
      console.error(`❌ 未知参数：${arg}`);
      process.exit(2);
    }
  }
  if (Number.isNaN(opts.maxFlake) || opts.maxFlake < 0 || opts.maxFlake > 1) {
    console.error("❌ --max-flake 需为 0~1 之间的小数");
    process.exit(2);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const problems = [];
  const now = new Date().toISOString();

  // 1) 隔离清单到期校验（即使没有 JUnit 也能单独跑）
  let quarantine = { entries: [] };
  if (existsSync(opts.quarantine)) {
    try {
      quarantine = JSON.parse(readFileSync(opts.quarantine, "utf8"));
    } catch (error) {
      problems.push(`${opts.quarantine} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const expired = expiredQuarantine(quarantine.entries, now);
  for (const e of expired) {
    problems.push(`隔离条目已过期：${e.test}（到期 ${e.expiresAt}，owner ${e.owner ?? "未标注"}）——要么修好，要么续期并写明原因`);
  }

  if (opts.quarantineOnly) {
    return finish(problems, { expired: expired.length }, opts);
  }

  // 2) 解析 JUnit
  const files = expandGlobs(opts.junit);
  if (files.length === 0) {
    console.error("❌ 没有找到任何 JUnit 文件（--junit=...）");
    process.exit(2);
  }
  const merged = { total: 0, failed: 0, flaky: [], cases: [] };
  for (const file of files) {
    const parsed = parseJUnit(readFileSync(file, "utf8"));
    merged.total += parsed.total;
    merged.failed += parsed.failed;
    merged.flaky.push(...parsed.flaky);
    merged.cases.push(...parsed.cases);
  }
  if (merged.total === 0) {
    problems.push(`JUnit 里没有任何 testcase（${files.length} 个文件）——分片可能空跑`);
  }

  // 3) 更新历史并算 flake 率
  const historyPath = resolve(opts.history);
  const history = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, "utf8")) : { version: 1, runs: [], tests: {} };
  const next = updateHistory(history, { at: now, files: files.length, ...merged });
  mkdirSync(dirname(historyPath), { recursive: true });
  writeFileSync(historyPath, JSON.stringify(next, null, 2), "utf8");

  const tracked = merged.cases.map((c) => c.id);
  const hot = tracked
    .map((id) => ({ id, rate: flakeRate(next, id), runs: next.tests[id]?.runs ?? 0 }))
    .filter((x) => x.rate > opts.maxFlake && x.runs >= 3)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 10);

  for (const h of hot) {
    problems.push(`flake 率超阈值：${h.id} = ${(h.rate * 100).toFixed(1)}%（${h.runs} 次运行）`);
  }

  // 4) 已隔离但这次通过的用例：提示可以移除
  const quarantined = new Set((quarantine.entries ?? []).map((e) => e.test));
  const passedNow = merged.cases.filter((c) => c.status === "passed" && quarantined.has(c.id)).map((c) => c.id);

  return finish(problems, { total: merged.total, failed: merged.failed, flaky: merged.flaky.length, hot, passedNow, files: files.length }, opts);
}

function finish(problems, summary, opts) {
  if (opts.json) {
    console.log(JSON.stringify({ summary, problems }, null, 2));
  } else {
    console.log(
      `测试遥测：${summary.files ?? 0} 个 JUnit 文件，${summary.total ?? 0} 个用例，` +
        `${summary.failed ?? 0} 失败，${summary.flaky ?? 0} 靠重试通过`,
    );
    if (summary.hot?.length) {
      console.log("  flake 率最高：");
      for (const h of summary.hot) console.log(`   · ${h.id} — ${(h.rate * 100).toFixed(1)}%`);
    }
    if (summary.passedNow?.length) {
      console.log(`  已隔离但本次通过（可移出隔离）：${summary.passedNow.length} 条`);
      for (const id of summary.passedNow.slice(0, 5)) console.log(`   · ${id}`);
    }
  }

  if (problems.length > 0) {
    console.error(`\n❌ 测试遥测发现 ${problems.length} 个问题`);
    for (const p of problems) console.error("   - " + p);
    process.exit(1);
  }
  console.log("\n✅ 测试遥测：无过期隔离、无超阈值 flake");
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();

export { expandGlobs, parseArgs };
