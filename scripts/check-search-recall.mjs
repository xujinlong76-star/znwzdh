#!/usr/bin/env node
/**
 * 检索召回回归器（只读）。
 *
 * 为什么要有它：金标集 packages/core/test/fixtures/search-eval-golden.json 评的是**融合排序**
 * ——喂进去的是已经召回好的候选。「某类查询根本召不回来」这一头没有任何自动检查：
 * 2026-10-31 一天里连找出的三个检索缺陷（拼音首字母跨词乱撞、语义独占端出「最像的噪声」、
 * 巡检被拒的站点整条消失）全靠临时写探针。这个脚本把那种一次性探针变成可重放的账。
 *
 * 口径：
 *   · 直接起盘上的引擎（Repository + SearchEngine），不连中枢进程——在跑的进程可能比磁盘旧。
 *   · 库**复制到临时目录**再打开，绝不碰 data/navhub.db 本体（中枢进程正持有它）。
 *   · 默认关语义通道：语义要加载 bge 模型、结果随向量索引漂移，回归集要可复现的确定性。
 *   · 站点按 host 后缀 / 标题子串匹配，不钉站点 id：钉 id 的话站点一旦被删，
 *     用例不是变红而是静默「通过」。
 *
 * 用法：
 *   node scripts/check-search-recall.mjs [--corpus <json>] [--db <sqlite>] [--k 5] [--json] [--list]
 *
 * 退出码：0 全过；1 有用例失败；2 账本或参数本身有问题（用例为空、库打不开）。
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCase } from "./lib/search-recall.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CORPUS = path.join(ROOT, "scripts", "fixtures", "search-recall-corpus.json");
const DEFAULT_DB = path.join(ROOT, "data", "navhub.db");

function parseArgs(argv) {
  const args = { corpus: DEFAULT_CORPUS, db: DEFAULT_DB, k: 5, json: false, list: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--corpus") args.corpus = path.resolve(ROOT, argv[++i] ?? "");
    else if (a === "--db") args.db = path.resolve(ROOT, argv[++i] ?? "");
    else if (a === "--k") args.k = Number(argv[++i]);
    else if (a === "--json") args.json = true;
    else if (a === "--list") args.list = true;
    else if (a === "--help" || a === "-h") {
      console.log("用法: node scripts/check-search-recall.mjs [--corpus <json>] [--db <sqlite>] [--k 5] [--json] [--list]");
      process.exit(0);
    } else {
      console.error(`未知参数：${a}（--help 看用法）`);
      process.exit(2);
    }
  }
  if (!Number.isInteger(args.k) || args.k < 1 || args.k > 20) {
    console.error("--k 必须是 1..20 的整数");
    process.exit(2);
  }
  return args;
}

/**
 * 语料本身的校验：判据写歪了（既不 expect 也不 forbid）的用例永远不会失败，
 * 那种用例混进回归集比没有更糟——它给「已经有人管这条查询」的假象。
 */
export function loadCorpus(file) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const cases = Array.isArray(raw) ? raw : raw.cases;
  if (!Array.isArray(cases) || cases.length === 0) throw new Error("语料必须包含非空 cases 数组");
  const seen = new Set();
  return cases.map((c, i) => {
    const where = `第 ${i + 1} 条（query=${JSON.stringify(c?.query ?? "")}）`;
    if (!c || typeof c !== "object") throw new Error(`${where} 不是对象`);
    if (typeof c.query !== "string" || !c.query.trim()) throw new Error(`${where} query 不能为空`);
    const hasExpect = Array.isArray(c.expect) && c.expect.length > 0;
    const hasForbid = Array.isArray(c.forbid) && c.forbid.length > 0;
    const hasSuggest = Array.isArray(c.didYouMean) && c.didYouMean.length > 0;
    if (!hasExpect && !hasForbid && !hasSuggest) {
      throw new Error(`${where} 至少声明 expect / forbid / didYouMean 之一，否则这条永远不会失败`);
    }
    for (const kind of ["expect", "forbid"]) {
      for (const m of c[kind] ?? []) {
        if (!String(m?.host ?? "").trim() && !String(m?.title ?? "").trim()) {
          throw new Error(`${where} 的 ${kind} 匹配项必须给 host 或 title`);
        }
      }
    }
    if (typeof c.note !== "string" || !c.note.trim()) throw new Error(`${where} 缺 note：每条用例都要写清它为什么存在`);
    const key = `${c.query.trim().toLowerCase()}|${c.tag ?? ""}|${c.mode ?? ""}`;
    if (seen.has(key)) throw new Error(`${where} 与前面的用例重复（query+tag+mode 同形）`);
    seen.add(key);
    return c;
  });
}

function copyDb(src, dir) {
  const dest = path.join(dir, "recall-copy.db");
  copyFileSync(src, dest);
  // WAL 模式下未落盘的数据在 -wal 里，只拷主文件会读到旧快照
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(src + suffix)) copyFileSync(src + suffix, dest + suffix);
  }
  return dest;
}

const invokedDirectly = process.argv[1] && /check-search-recall\.mjs$/.test(String(process.argv[1]).replace(/\\/g, "/"));

if (invokedDirectly) {
  // 参数解析会 process.exit(2)（未知参数、--k 越界），只能发生在命令行直跑时：
  // 单元测试要 import loadCorpus，模块顶层一解析参数就会把测试进程干掉。
  const args = parseArgs(process.argv);
  let corpus;
  try {
    corpus = loadCorpus(args.corpus);
  } catch (e) {
    console.error(`语料读不了：${e.message}`);
    process.exit(2);
  }

  if (args.list) {
    console.log(`语料 ${corpus.length} 条：`);
    for (const c of corpus) console.log(`  · ${c.tag ? `#${c.tag} ` : ""}${c.query}${c.mode ? ` [mode=${c.mode}]` : ""} — ${c.note}`);
    process.exit(0);
  }

  if (!existsSync(args.db)) {
    console.error(`库不存在：${args.db}`);
    process.exit(2);
  }

  const { openDb } = await import("../packages/store/src/driver.ts");
  const { Repository } = await import("../packages/store/src/repository.ts");
  const { SearchEngine } = await import("../packages/store/src/search.ts");

  const scratch = mkdtempSync(path.join(tmpdir(), "navhub-recall-"));
  const copy = copyDb(args.db, scratch);
  let failed = 0;
  const rows = [];
  try {
    const db = await openDb({ dialect: "sqlite", sqlitePath: copy });
    const repo = new Repository(db);
    const engine = new SearchEngine({ db, repo, fts: null, vectors: null, embed: null });
    const loadSites = async (ids) => repo.getSitesByIds(ids);
    for (const c of corpus) {
      const r = await runCase(engine, loadSites, c, { k: args.k });
      rows.push(r);
      // 带 pending 的用例许红不许拦：它等的那条改动还在途，红是预期状态，
      // 拦下来只会让人把判据改松。绿了则反过来提醒「可以摘 pending 了」。
      if (!r.ok && !r.pending) failed++;
    }
    await db.close();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const pendings = rows.filter((r) => r.pending);
  const plain = rows.filter((r) => !r.pending);

  if (args.json) {
    console.log(
      JSON.stringify(
        { db: args.db, k: args.k, total: rows.length, failed, pendingTotal: pendings.length, pendingRed: pendings.filter((r) => !r.ok).length, rows },
        null,
        2,
      ),
    );
  } else {
    console.log(`检索召回回归 · 库=${path.relative(ROOT, args.db)} · k=${args.k} · 用例=${rows.length}`);
    for (const r of plain) {
      const mark = r.ok ? "✓" : "✗";
      console.log(`${mark} ${r.label.padEnd(18, " ")} n=${String(r.hits).padStart(2)} ${r.expectOk ? "" : `｜${r.expected} `}${r.forbidOk ? "" : `｜越界=${r.violated.join(",")} `}${r.suggestionOk ? "" : `｜建议=${r.didYouMean ?? "无"}`}`);
      if (!r.ok) console.log(`    实际前 ${r.k}：${r.top.join("、") || "（空）"}`);
    }
    if (pendings.length > 0) {
      console.log(`\n在途（等对应改动落地，不计失败）${pendings.length} 条：`);
      for (const r of pendings) {
        console.log(`  ${r.ok ? "已达标·可摘 pending" : "红（符合预期）  "} ${r.label.padEnd(10, " ")} 等：${r.pending}`);
        if (!r.ok) console.log(`      越界=${r.violated.join(", ") || "—"} · 实际前 ${r.k}：${r.top.join("、") || "（空）"}`);
      }
    }
    const zero = rows.filter((r) => r.hits === 0).length;
    console.log(`\n常规通过 ${plain.length - failed}/${plain.length} · 在途 ${pendings.filter((r) => !r.ok).length} 条仍红 · 零结果 ${zero} 条`);
    if (failed > 0) console.log(`有 ${failed} 条常规用例失败：改判据前先确认是检索退步还是库里真没了这个站。`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

export { runCase };
