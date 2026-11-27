#!/usr/bin/env node
/**
 * Validate double-annotated real search telemetry JSONL and export a privacy-safe eval fixture.
 * Usage: node scripts/import-search-golden.mts input.jsonl output.json [--min-samples 100] [--allow-below-target]
 *
 * Raw de-identified queries are never copied to the output fixture or printed to stdout.
 * This tool validates provenance and human judgments; it does not generate or infer labels.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSearchEvalCase, validateSearchGoldenRecord, type SearchGoldenRecord } from "../packages/core/src/search-golden.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let minSamples = 100;
  let allowBelowTarget = false;
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--min-samples") {
      minSamples = Number(argv[++i]);
      if (!Number.isInteger(minSamples) || minSamples < 1) {
        console.error("--min-samples 必须是正整数");
        process.exit(1);
      }
    } else if (arg === "--allow-below-target") {
      allowBelowTarget = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log("用法: node scripts/import-search-golden.mts input.jsonl output.json [--min-samples 100] [--allow-below-target]");
      process.exit(0);
    } else if (arg?.startsWith("-")) {
      console.error("未知参数: " + arg);
      process.exit(1);
    } else if (arg) positional.push(arg);
  }
  if (positional.length !== 2) {
    console.error("必须指定输入 JSONL 与输出 JSON 文件路径");
    process.exit(1);
  }
  return { input: path.resolve(ROOT, positional[0]!), output: path.resolve(ROOT, positional[1]!), minSamples, allowBelowTarget };
}

const args = parseArgs(process.argv);
let source: string;
try {
  source = readFileSync(args.input, "utf8");
} catch (error) {
  console.error("读取输入文件失败: " + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
}
const lines = source.split(/\r?\n/).filter((line) => line.trim() !== "");
if (lines.length === 0) {
  console.error("输入 JSONL 不能为空");
  process.exit(1);
}

const records: SearchGoldenRecord[] = [];
const ids = new Set<string>();
for (let i = 0; i < lines.length; i++) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[i]!);
  } catch {
    console.error("第 " + (i + 1) + " 行 JSON 格式无效");
    process.exit(1);
  }
  try {
    const record = validateSearchGoldenRecord(parsed, i);
    if (ids.has(record.sampleId)) throw new Error("sampleId 重复");
    ids.add(record.sampleId);
    records.push(record);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "样本校验失败");
    process.exit(1);
  }
}

if (records.length < args.minSamples && !args.allowBelowTarget) {
  console.error("有效样本仅 " + records.length + " 条，未达到目标 " + args.minSamples + " 条；不会生成正式金标文件");
  process.exit(1);
}

const cases = records.map(toSearchEvalCase);
const output = {
  schemaVersion: "navhub-search-eval-v1",
  generatedAt: new Date().toISOString(),
  sampleCount: cases.length,
  queryTextIncluded: false,
  cases,
};
try {
  writeFileSync(args.output, JSON.stringify(output, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
} catch (error) {
  console.error("写入输出文件失败（不会覆盖已有文件）: " + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
}
console.log("金标校验通过：样本数=" + records.length + "；输出不包含原始 query 文本。");
if (records.length < args.minSamples) {
  console.log("注意：当前为预览导出，尚未达到正式目标 " + args.minSamples + " 条。");
}
