#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSearch } from "../packages/core/src/search-eval.ts";
import { validateSearchGoldSet } from "../packages/core/src/search-goldset.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let minCases = 100;
  let exportPath: string | null = null;
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--min-cases") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1) throw new Error("--min-cases 必须是正整数");
      minCases = value;
    } else if (arg === "--export") {
      const value = argv[++i];
      if (!value) throw new Error("--export 缺少输出路径");
      exportPath = value;
    } else if (arg === "--help" || arg === "-h") {
      console.log("用法：node scripts/validate-search-goldset.mts <脱敏金标文件.json> [--min-cases 100] [--export <受控路径>]");
      process.exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error("未知参数：" + arg);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) throw new Error("必须提供且只提供一个金标 JSON 文件路径");
  return { inputPath: positional[0]!, minCases, exportPath };
}

try {
  const args = parseArgs(process.argv);
  const inputPath = path.resolve(ROOT, args.inputPath);
  const raw = await readFile(inputPath, "utf8");
  const input = JSON.parse(raw) as unknown;
  const result = validateSearchGoldSet(input);
  const report = {
    schema: "navhub-search-gold-validation-report-v1",
    totalCases: result.totalCases,
    eligibleCases: result.eligibleCases,
    excludedUnjudgeableCases: result.excludedUnjudgeableCases,
    requiredEligibleCases: args.minCases,
    passedMinimum: result.eligibleCases >= args.minCases,
    baselineMetricsAt10: evaluateSearch(result.evaluationCases, 10),
    rawQueryTextIncluded: false,
  };
  if (args.exportPath && report.passedMinimum) {
    const outputPath = path.resolve(ROOT, args.exportPath);
    await writeFile(outputPath, JSON.stringify(result.evaluationCases, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    Object.assign(report, { exportedFixture: path.relative(ROOT, outputPath) });
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (!report.passedMinimum) process.exitCode = 1;
} catch (error) {
  // 不输出原始 query 或输入内容；只报告受控错误文本。
  process.stderr.write((error instanceof Error ? error.message : "金标集校验失败") + "\n");
  process.exitCode = 1;
}
