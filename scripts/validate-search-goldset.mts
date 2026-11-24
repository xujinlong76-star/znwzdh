import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateSearchGoldSet } from "../packages/core/src/search-gold.ts";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_CASES = 10_000;
const MAX_LINE_BYTES = 256 * 1024;

export function parseSearchGoldJsonl(input: string): unknown[] {
  const lines = input.replace(/^\uFEFF/, "").split(/\r?\n/);
  const cases: unknown[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (!line) continue;
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
      throw new Error(`第 ${index + 1} 行超过 256KB 限制`);
    }
    try {
      cases.push(JSON.parse(line) as unknown);
    } catch {
      // 不把原始行写入错误日志，避免把潜在个人信息回显到 CI。
      throw new Error(`第 ${index + 1} 行不是有效 JSON`);
    }
    if (cases.length > MAX_CASES) throw new Error(`金标文件最多允许 ${MAX_CASES} 条样本`);
  }
  return cases;
}

export function validateSearchGoldJsonl(input: string, minimumCases = 100) {
  const cases = parseSearchGoldJsonl(input);
  const validation = validateSearchGoldSet(cases, minimumCases);
  const first = cases[0] as Record<string, unknown> | undefined;
  return {
    count: cases.length,
    datasetVersion: typeof first?.datasetVersion === "string" ? first.datasetVersion : null,
    validation,
  };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function runCli(): void {
  if (process.argv.includes("--help")) {
    console.log("用法：pnpm tsx scripts/validate-search-goldset.mts --input <脱敏 JSONL> [--min-cases 100]");
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
  const absolutePath = resolve(inputPath);
  try {
    const size = statSync(absolutePath).size;
    if (size > MAX_FILE_BYTES) throw new Error("文件超过 5MB 限制");
    const result = validateSearchGoldJsonl(readFileSync(absolutePath, "utf8"), minimumCases);
    console.log(`样本数：${result.count}；datasetVersion：${result.datasetVersion ?? "缺失"}`);
    if (result.validation.valid) {
      console.log("搜索金标校验通过；未输出查询文本或网页内容。");
      return;
    }
    console.error(`校验未通过：${result.validation.errors.length} 个错误，${result.validation.needsAdjudication.length} 条待仲裁`);
    for (const error of result.validation.errors) console.error("- " + error);
    for (const item of result.validation.needsAdjudication) console.error("- 待仲裁：" + item);
    process.exitCode = 1;
  } catch (error) {
    console.error("无法校验金标文件：" + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runCli();
