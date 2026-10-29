#!/usr/bin/env node
/**
 * 选测可解释性 CLI：回答「为什么这个测试被选中」与「回放最近几次提交，图选得对不对」。
 *
 * 背景：pre-commit 选测已经升级为模块图（scripts/lib/test-impact.mjs），但图给的是
 * 一堆文件名——没有理由。选测是「少跑」的策略，漏选不报错；图错了一眼也看不出来。
 * 两个子命令各自补一个方向：
 *
 *   --why <test> --changed <file...>   改动 → 该测试的**最短依赖链**（链上每一跳都是
 *                                      真实边：import / 路径字面量 / 镜像 / 目录扫描）。
 *   --why <test> --base <ref>          同上，改动集取自 `git diff --name-only <ref>`。
 *
 *   --diff <base> [--limit 6]          回放 <base>..HEAD 最近 N 个**改了图看得见的文件**
 *                                      的提交：每个提交对比「图命中 / 选择器实际会跑 /
 *                                      按词根与整棵会选多少」。**图命中但选择器没跑 = rc1**，
 *                                      那才是真的漏跑（其余差异是词根兜底的宽度，供审阅）。
 *   --stats                            图的规模与耗时。
 *
 * 选择器是生成物（.git/hooks/navhub-precommit-tests.mjs），回放用注入式 dry-run
 * （NAVHUB_PRECOMMIT_FILES + NAVHUB_PRECOMMIT_DRYRUN=1），不跑任何测试；
 * 词根口径靠 NAVHUB_PRECOMMIT_NO_GRAPH=1 让选择器跳过图、只走旧启发式。
 *
 * 「读不到 base」分两种原因报（浅克隆 / ref 不存在）：CI 的 checkout 默认 `fetch-depth: 1`，
 * 那里 `HEAD~1` 是真的不存在，把这句说成 ref 笔误会让人去查一个没写错的参数。
 *
 * 退出码：0 = 可达/一致；1 = 测试不可达、改动文件不在图里、或有「图命中却没被跑」；
 *         2 = 用法错误或 git 读不了。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isShallow, refExists } from "./lib/git-blobs.mjs";
import { canonicalPath, graphFor, graphVisibleFiles, impactedWithPaths } from "./lib/test-impact.mjs";

const P = "[test-impact] ";
const SELECTOR = ".git/hooks/navhub-precommit-tests.mjs";

function git(args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function parseArgs(argv) {
  const opts = {
    why: "",
    changed: [],
    base: "",
    diff: "",
    limit: 6,
    selector: true,
    stats: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--why") { opts.why = argv[i + 1] ?? ""; i += 1; continue; }
    if (arg === "--base") { opts.base = argv[i + 1] ?? ""; i += 1; continue; }
    if (arg === "--diff") { opts.diff = argv[i + 1] ?? ""; i += 1; continue; }
    if (arg === "--limit") { opts.limit = Number.parseInt(argv[i + 1] ?? "", 10); i += 1; continue; }
    if (arg === "--no-selector") { opts.selector = false; continue; }
    if (arg === "--stats") { opts.stats = true; continue; }
    if (arg === "--changed") {
      i += 1;
      while (i < argv.length && !argv[i].startsWith("--")) {
        opts.changed.push(...argv[i].split(",").map((f) => f.trim()).filter(Boolean));
        i += 1;
      }
      i -= 1;
      continue;
    }
    console.error(`${P}未知参数：${arg}`);
    return null;
  }
  if (!Number.isFinite(opts.limit) || opts.limit <= 0) opts.limit = 6;
  return opts;
}

function changedFromBase(base) {
  return git(["diff", "--name-only", base])
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function formatChain(chain) {
  if (chain.length === 1) return "  " + chain[0] + "（改动文件本身就是测试）";
  return chain.map((node, i) => (i === 0 ? "  " : "  → ") + node).join("\n");
}

/** 每个改动文件单独跑一次 BFS（要的是「这条改动为什么能到该测试」，不是任意一条链） */
function chainsFor(graph, changed, test) {
  const out = [];
  for (const file of changed) {
    const { tests, paths } = impactedWithPaths(graph, [file]);
    const canon = canonicalPath(file);
    if (!tests.includes(test)) continue;
    out.push({ file: canon, chain: paths.get(test) });
  }
  return out;
}

function runWhy(graph, opts) {
  const test = canonicalPath(opts.why);
  if (!existsSync(join(process.cwd(), test))) {
    console.error(`${P}测试文件不存在：${test}`);
    return 1;
  }
  if (!graph.testFiles.has(test)) {
    console.error(`${P}${test} 不在图的测试集里（只有 vitest include 的可运行根才入图）`);
    return 1;
  }

  const changed = opts.changed.length > 0 ? opts.changed : opts.base ? changedFromBase(opts.base) : [];
  if (changed.length === 0) {
    console.error(`${P}--why 需要 --changed <file...> 或 --base <ref>（改动集为空时「为什么选中」无从谈起）`);
    return 2;
  }

  const absent = changed.filter((f) => !existsSync(f));
  const hits = impactedWithPaths(graph, changed).tests;
  const chains = chainsFor(graph, changed, test);

  console.log(`${P}改动 ${changed.length} 个文件 → 图命中 ${hits.length} 个测试`);
  if (chains.length === 0) {
    console.error(`${P}${test} 不在影响面内：从这些改动出发沿反向引用走不到它。`);
    if (absent.length > 0) console.error(`${P}其中 ${absent.length} 个改动文件不存在（拼错？已删除？）：\n    ${absent.join("\n    ")}`);
    return 1;
  }
  for (const { file, chain } of chains) {
    console.log(`${P}${test} ← ${file}（${chain.length - 1} 跳）`);
    console.log(formatChain(chain));
  }
  return 0;
}

function runSelector(changed, extraEnv = {}) {
  const out = execFileSync(process.execPath, [SELECTOR], {
    encoding: "utf8",
    env: {
      ...process.env,
      NAVHUB_PRECOMMIT_FILES: changed.join(","),
      NAVHUB_PRECOMMIT_DRYRUN: "1",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const line = out.split(/\r?\n/).find((l) => l.startsWith("DRYRUN_FILES="));
  return line ? JSON.parse(line.slice("DRYRUN_FILES=".length)) : [];
}

function commitsSince(base, want) {
  const raw = git(["log", "--no-merges", "--format=%H%x1f%s", "-n", String(Math.max(want * 8, 40)), `${base}..HEAD`]);
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [sha, subject] = line.split("\x1f");
    const changed = git(["show", "--pretty=format:", "--name-only", sha])
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const source = graphVisibleFiles(changed);
    if (source.length === 0) continue;
    out.push({ sha, subject, changed, source });
    if (out.length >= want) break;
  }
  return out;
}

function runDiff(graph, opts) {
  if (!refExists(opts.diff)) {
    // 两种「读不到」的下一步完全不同，所以不能共用一句报错。
    if (isShallow()) {
      console.error(
        `${P}${opts.diff} 读不到，而这个仓库是浅克隆（git rev-parse --is-shallow-repository = true）：` +
          "CI 的 actions/checkout 默认 fetch-depth: 1，历史里只有一个提交，`HEAD~1` 真的不存在。" +
          "要在这里回放就给那一步加 fetch-depth（不是改这条断言）",
      );
    } else {
      console.error(`${P}${opts.diff} 不是本仓库里真实存在的 ref（拼错、或还没 fetch）`);
    }
    return 2;
  }
  let commits;
  try {
    commits = commitsSince(opts.diff, opts.limit);
  } catch (error) {
    console.error(`${P}读提交失败（${opts.diff}..HEAD）：${error.message}`);
    return 2;
  }
  if (commits.length === 0) {
    console.log(`${P}${opts.diff}..HEAD 没有改动图看得见的文件（前缀表之外的东西，如锁文件、data/）`);
    return 0;
  }

  const selectorReady = opts.selector && existsSync(SELECTOR);
  const stemReady = selectorReady && /NAVHUB_PRECOMMIT_NO_GRAPH/.test(readSelectorSource());
  if (opts.selector && !existsSync(SELECTOR)) {
    console.log(`${P}选择器未安装（${SELECTOR}），只报图的结果；先跑 node scripts/install-git-hooks.mjs 可对比`);
  }
  console.log(`${P}回放 ${commits.length} 个提交；整棵（vitest include）= ${graph.testFiles.size} 个测试` +
    (selectorReady ? "；对比选择器实际选测" : "") + (stemReady ? "与词根口径" : ""));

  let graphNotRun = 0;
  let stemOnlyTotal = 0;
  for (const { sha, subject, changed, source } of commits) {
    const hits = impactedWithPaths(graph, changed).tests;
    const short = sha.slice(0, 8);
    let line = `${short} ${subject.slice(0, 36)} | 改动 ${source.length} 图可见文件 → 图 ${hits.length}`;
    if (selectorReady) {
      const picked = runSelector(changed);
      const notRun = hits.filter((t) => !picked.includes(t));
      graphNotRun += notRun.length;
      line += ` | 选择器 ${picked.length}`;
      if (stemReady) {
        const stem = runSelector(changed, { NAVHUB_PRECOMMIT_NO_GRAPH: "1" });
        const stemOnly = stem.filter((t) => !hits.includes(t));
        stemOnlyTotal += stemOnly.length;
        line += `（仅词根/整棵 ${stemOnly.length}${stemOnly.length > 0 ? "，例 " + stemOnly.slice(0, 2).join("、") : ""}）`;
      }
      if (notRun.length > 0) line += ` | ❌ 图命中却没跑 ${notRun.length}：${notRun.slice(0, 3).join("、")}`;
    }
    console.log(`${P}${line}`);
  }

  console.log(`${P}汇总：图命中却未被选择器纳入 ${graphNotRun} 个` +
    (selectorReady && stemReady ? `；词根/整棵额外选 ${stemOnlyTotal} 个（兜底宽度，供审阅）` : ""));
  if (graphNotRun > 0) {
    console.error(`${P}存在「图选中但选择器不会跑」的测试——选测接线坏了`);
    return 1;
  }
  return 0;
}

let selectorText = null;
function readSelectorSource() {
  if (selectorText === null) {
    try {
      selectorText = readFileSync(SELECTOR, "utf8");
    } catch {
      selectorText = "";
    }
  }
  return selectorText;
}

function rootOfTest(test) {
  if (test.startsWith("packages/")) return "packages/*/test/";
  const m = test.match(/^(apps\/[^/]+\/(?:test|scripts))\//);
  if (m) return m[1] + "/";
  if (test.startsWith("scripts/")) return "scripts/";
  return "(其它)";
}

function runStats(graph) {
  const byRoot = new Map();
  for (const test of graph.testFiles) {
    const root = rootOfTest(test);
    byRoot.set(root, (byRoot.get(root) ?? 0) + 1);
  }
  console.log(`${P}扫描 ${graph.stats.scanned} 文件 · 测试 ${graph.stats.testFiles} · 引用边 ${graph.stats.edges}`);
  const top = [...byRoot.entries()].sort((a, b) => b[1] - a[1]);
  console.log("    根 -> 测试数：" + top.map(([r, n]) => `${r} ${n}`).join("；"));
  return 0;
}

function main(argv) {
  const opts = parseArgs(argv);
  if (!opts) return 2;
  if (!opts.why && !opts.diff && !opts.stats) {
    console.error(
      "用法：\n" +
        "  node scripts/test-impact.mjs --why <test> --changed <file...>\n" +
        "  node scripts/test-impact.mjs --why <test> --base <ref>\n" +
        "  node scripts/test-impact.mjs --diff <base> [--limit 6] [--no-selector]\n" +
        "  node scripts/test-impact.mjs --stats",
    );
    return 2;
  }

  const started = Date.now();
  const graph = graphFor(process.cwd());
  if (opts.diff) return runDiff(graph, opts);
  if (opts.why) return runWhy(graph, opts);
  console.log(`${P}建图 ${Date.now() - started}ms`);
  return runStats(graph);
}

process.exit(main(process.argv.slice(2)));
