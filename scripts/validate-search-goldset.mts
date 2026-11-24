#!/usr/bin/env node
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { evaluateSearch } from "../packages/core/src/search-eval.ts";
import { validateSearchGoldSet } from "../packages/core/src/search-gold.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_LINE_BYTES = 256 * 1024;
const MAX_CASES = 10_000;

export function parseSearchGoldJsonl(input: string): unknown[] {
  const lines = input.replace(/^\uFEFF/, "").split(/\r?\n/);
  const cases: unknown[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (!line) continue;
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
      throw new Error("第 " + (index + 1) + " 行超过 256KB 限制");
    }
    try {
      cases.push(JSON.parse(line) as unknown);
    } catch {
      // 不把原始行写入错误日志，避免把潜在个人信息回显到 CI。
      throw new Error("第 " + (index + 1) + " 行不是有效 JSON");
    }
    if (cases.length > MAX_CASES) throw new Error("金标文件最多允许 10000 条样本");
  }
  return cases;
}

export function validateSearchGoldJsonl(input: string, minimumCases = 100) {
  const cases = parseSearchGoldJsonl(input);
  const validation = validateSearchGoldSet(cases, minimumCases);
  return {
    totalCases: validation.totalCases,
    eligibleCases: validation.eligibleCases,
    excludedUnjudgeableCases: validation.excludedUnjudgeableCases,
    datasetVersion: validation.datasetVersion,
    eligibleIntentCounts: validation.eligibleIntentCounts,
    eligibleLocaleCounts: validation.eligibleLocaleCounts,
    errors: validation.errors,
    needsAdjudicationCount: validation.needsAdjudication.length,
    evaluationCases: validation.evaluationCases,
  };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function runCli(): void {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("用法：pnpm validate:search-goldset --input <脱敏 JSONL> [--min-cases 100] [--export <受控路径>]");
    return;
  }
  const inputPath = argument("--input");
  const minimumRaw = argument("--min-cases") ?? "100";
  const minimumCases = Number(minimumRaw);
  if (!inputPath) {
    console.error("缺少 --input；请提供本地脱敏 JSONL 文件路径");
    process.exitCode = 2;
    return;
  }
  if (!Number.isInteger(minimumCases) || minimumCases < 1 || minimumCases > MAX_CASES) {
    console.error("--min-cases 必须是 1–10000 的整数");
    process.exitCode = 2;
    return;
  }

  try {
    const absolutePath = path.resolve(ROOT, inputPath);
    const size = statSync(absolutePath).size;
    if (size > MAX_FILE_BYTES) throw new Error("文件超过 5MB 限制");
    const result = validateSearchGoldJsonl(readFileSync(absolutePath, "utf8"), minimumCases);
    const passed = result.errors.length === 0 && result.needsAdjudicationCount === 0 &&
      result.eligibleCases >= minimumCases;
    const report = {
      schema: "navhub-search-gold-validation-report-v2",
      totalCases: result.totalCases,
      eligibleCases: result.eligibleCases,
      excludedUnjudgeableCases: result.excludedUnjudgeableCases,
      datasetVersion: result.datasetVersion,
      eligibleIntentCounts: result.eligibleIntentCounts,
      eligibleLocaleCounts: result.eligibleLocaleCounts,
      needsAdjudicationCount: result.needsAdjudicationCount,
      errorCount: result.errors.length,
      errors: result.errors.slice(0, 100),
      baselineMetricsAt10: passed ? evaluateSearch(result.evaluationCases, 10) : null,
      rawQueryTextIncluded: false,
      passed,
    };
    const exportPath = argument("--export");
    if (exportPath && passed) {
      const outputPath = path.resolve(ROOT, exportPath);
      writeFileSync(outputPath, JSON.stringify(result.evaluationCases, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
      Object.assign(report, { exportedFixture: path.relative(ROOT, outputPath) });
    }
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (!passed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write("无法校验金标文件：" + (error instanceof Error ? error.message : "未知错误") + "\n");
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runCli();
