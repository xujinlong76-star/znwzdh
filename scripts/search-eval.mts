#!/usr/bin/env node
/**
 * 检索离线评测 CLI。
 *
 * 用法：
 *   node scripts/search-eval.mts [fixture.json] [--k 10] [--json]
 *
 * fixture 可以是 `{ "k": 10, "cases": [...] }`，也可以直接是 cases 数组。
 * 每个 case：{ query, hits: string[], relevance: { siteId: 0-3 } }。
 *
 * 退出码：0 评测完成；1 样本格式不合法（缺 query / hits / relevance）。
 * 只读文件，不连数据库——金标集是版本化资产，不在真实库里维护。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateSearch,
  mrrAtK,
  ndcgAtK,
  recallAtK,
  type SearchEvalCase,
} from "../packages/core/src/search-eval.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv: string[]) {
  const args = { file: "scripts/fixtures/search-eval.sample.json", k: 10, json: false };
  let explicitK = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--k") {
      args.k = Number(argv[++i]);
      explicitK = true;
    } else if (a === "--json") {
      args.json = true;
    } else if (a === "--help" || a === "-h") {
      console.log("用法: node scripts/search-eval.mts [fixture.json] [--k 10] [--json]");
      process.exit(0);
    } else if (!a.startsWith("-")) {
      args.file = a;
    } else {
      console.error("未知参数: " + a + "（--help 查看用法）");
      process.exit(1);
    }
  }
  if (explicitK && (!Number.isFinite(args.k) || args.k <= 0)) {
    console.error("--k 必须是正数");
    process.exit(1);
  }
  return args;
}

function validateCase(value: unknown, index: number): SearchEvalCase {
  const record = value as Partial<SearchEvalCase> | null;
  if (!record || typeof record !== "object") throw new Error("第 " + index + " 条样本不是对象");
  if (typeof record.query !== "string" || record.query.trim() === "") {
    throw new Error("第 " + index + " 条样本缺少 query");
  }
  if (!Array.isArray(record.hits) || record.hits.some((h) => typeof h !== "string")) {
    throw new Error("第 " + index + " 条样本的 hits 必须是字符串数组");
  }
  if (!record.relevance || typeof record.relevance !== "object" || Array.isArray(record.relevance)) {
    throw new Error("第 " + index + " 条样本缺少 relevance 对象");
  }
  for (const [siteId, grade] of Object.entries(record.relevance)) {
    if (typeof grade !== "number" || !Number.isFinite(grade) || grade < 0) {
      throw new Error("第 " + index + " 条样本 relevance['" + siteId + "'] 必须是非负数");
    }
  }
  return {
    query: record.query,
    hits: record.hits,
    relevance: record.relevance,
  };
}

const args = parseArgs(process.argv);
const fullPath = path.resolve(ROOT, args.file);
let raw: unknown;
try {
  raw = JSON.parse(readFileSync(fullPath, "utf8"));
} catch (err) {
  console.error("读取评测样本失败: " + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
}

const container = raw as { k?: number; cases?: unknown } | unknown[];
const casesRaw = Array.isArray(container) ? container : container?.cases;
if (!Array.isArray(casesRaw) || casesRaw.length === 0) {
  console.error("评测样本必须包含非空 cases 数组: " + fullPath);
  process.exit(1);
}

let cases: SearchEvalCase[];
try {
  cases = casesRaw.map((c, i) => validateCase(c, i));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const k = args.k ?? (!Array.isArray(container) ? container?.k : undefined) ?? 10;
const aggregate = evaluateSearch(cases, k);

if (args.json) {
  console.log(JSON.stringify({ file: args.file, k, aggregate, cases: cases.map((c) => ({
    query: c.query,
    ndcgAtK: ndcgAtK(c, k),
    mrrAtK: mrrAtK(c, k),
    recallAtK: recallAtK(c, k),
  })) }, null, 2));
  process.exit(0);
}

console.log("检索离线评测  file=" + args.file + "  k=" + k + "  queries=" + aggregate.queries);
console.log("宏平均  NDCG@" + k + "=" + aggregate.ndcgAtK.toFixed(4) +
  "  MRR@" + k + "=" + aggregate.mrrAtK.toFixed(4) +
  "  Recall@" + k + "=" + aggregate.recallAtK.toFixed(4));
for (const testCase of cases) {
  console.log(
    "  " + testCase.query.padEnd(18) +
    " nDCG=" + ndcgAtK(testCase, k).toFixed(4) +
    " mrr=" + mrrAtK(testCase, k).toFixed(4) +
    " recall=" + recallAtK(testCase, k).toFixed(4),
  );
}
