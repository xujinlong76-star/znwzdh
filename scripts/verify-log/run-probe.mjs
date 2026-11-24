#!/usr/bin/env node
/**
 * 公开核验日志 PoC — 批量探针 CLI（骨架）。
 *
 * 用法：
 *   node scripts/verify-log/run-probe.mjs --sites scripts/verify-log/poc-sites.json \
 *     --out scripts/verify-log/verification-log.jsonl [--limit N] [--append]
 *
 * 默认写模式为覆盖（首查建新日志）；--append 用于第 2 周重探时追加更正/
 * 复检条目——append-only：旧记录不改写、不删除，结论漂移靠新行体现。
 * 每行写出前都过 validateRecord；非法记录不写入并以非 0 退出。
 * 探针没跑通的站写入 verdict=unknown（未知），不编造“已核实”。
 */
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { probeSite, validateRecord } from "./probe-site.mjs";

function parseArgs(argv) {
  const args = { sites: null, out: null, limit: null, append: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--sites") args.sites = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--limit") args.limit = Number(argv[++i]);
    else if (argv[i] === "--append") args.append = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.sites || !args.out) {
  console.error("用法：node scripts/verify-log/run-probe.mjs --sites <poc-sites.json> --out <verification-log.jsonl> [--limit N] [--append]");
  process.exit(2);
}

const list = JSON.parse(readFileSync(args.sites, "utf8"));
const sites = args.limit ? list.sites.slice(0, args.limit) : list.sites;

const lines = [];
for (const site of sites) {
  const record = await probeSite(site);
  const errors = validateRecord(record);
  if (errors.length > 0) {
    console.error(`记录非法，跳过 ${site.siteId}：${errors.join("；")}`);
    process.exit(1);
  }
  lines.push(JSON.stringify(record));
  console.log(`${record.verdict}\t${site.siteId}\t${site.title}\t${record.evidence.httpStatus ?? record.evidence.httpError}`);
}

const text = lines.join("\n") + "\n";
if (args.append) appendFileSync(args.out, text);
else writeFileSync(args.out, text);
console.log(`已写 ${lines.length} 条记录 → ${args.out}`);
