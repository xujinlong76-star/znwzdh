#!/usr/bin/env node
/**
 * 前端类型门禁棘轮（2026-11-06，round 20）。
 *
 * 背景：`apps/web-overlay/next.config.js` 一直是 `typescript: { ignoreBuildErrors: true }`，
 * 因为该目录曾有 21600+ 既有类型错误（早期记录），后来逐步收敛。
 * 本会话 round 18 复核：`pnpm --filter navsphere exec tsc --noEmit` 已经 **0 error**（连续两次一致）。
 * 也就是说：**现在既有错误为零，可以上闸了**。
 *
 * 为什么是「棘轮」不是「直接关掉 ignoreBuildErrors」：
 *   关掉 ignoreBuildErrors 会让 `next build` 在类型错误时直接失败——这在 CI 里是好事，
 *   但本地/并行会话开发时一次误改就构不出产物，摩擦太大。
 *   先加独立门禁：错误数 > 0 即红，且能逐条打印。等它稳定运行一段时间，再考虑关 ignoreBuildErrors。
 *
 * 口径：
 *   - 跑 `tsc --noEmit`（apps/web 的 tsconfig），数 `error TS` 行；
 *   - 默认基线 0：任何新增错误即 exit 1；
 *   - `--max=N` 可临时放宽（用于「已知要修一批」的过渡期，但必须在台账登记原因）；
 *   - `--json` 输出机器可读；`--list` 打印全部错误行。
 *
 * 用法：
 *   node scripts/check-frontend-typecheck.mjs           # 默认：0 容忍
 *   node scripts/check-frontend-typecheck.mjs --max=3   # 过渡期放宽
 *   node scripts/check-frontend-typecheck.mjs --list    # 打印全部错误
 *   node scripts/check-frontend-typecheck.mjs --json
 *
 * 退出码：0 达标；1 超阈值；2 执行失败（tsc 起不来等）。
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "apps", "web");
const TSC = join(ROOT, "node_modules", "typescript", "bin", "tsc");
const argv = process.argv.slice(2);
const P = "[frontend-typecheck] ";

const maxArg = argv.find((a) => a.startsWith("--max="));
const maxErrors = maxArg ? Number(maxArg.slice(6)) : 0;
if (!Number.isFinite(maxErrors) || maxErrors < 0) {
  console.error(P + "--max 需要一个 >=0 的数字");
  process.exit(2);
}

if (!existsSync(TSC)) {
  console.error(P + "找不到 tsc：" + TSC);
  process.exit(2);
}
if (!existsSync(join(WEB, "tsconfig.json"))) {
  console.error(P + "找不到 apps/web/tsconfig.json");
  process.exit(2);
}

let raw = "";
let exitCode = 0;
try {
  raw = execFileSync(process.execPath, [TSC, "--noEmit", "-p", join(WEB, "tsconfig.json")], {
    cwd: WEB,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  // tsc 有类型错误时退出码非 0，错误信息在 stdout/stderr 里
  raw = String(err.stdout ?? "") + String(err.stderr ?? "");
  exitCode = typeof err.status === "number" ? err.status : 1;
}

const errorLines = raw
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => /error TS\d+/.test(l));

const count = errorLines.length;

if (argv.includes("--json")) {
  console.log(JSON.stringify({ ok: count <= maxErrors, count, maxErrors, errors: errorLines }, null, 2));
}

if (argv.includes("--list") || count > maxErrors) {
  for (const line of errorLines) console.error(P + line);
}

if (count > maxErrors) {
  console.error(P + "❌ 前端类型错误 " + count + " 个，超过阈值 " + maxErrors);
  console.error(P + "修法：按上面逐条修复；临时放宽用 --max=N（但需在有记录处写明原因）");
  process.exit(1);
}

console.log(P + "✅ 前端 tsc 通过：错误 " + count + " 个（阈值 " + maxErrors + "）");
if (exitCode !== 0 && count === 0) {
  console.error(P + "⚠️ tsc 退出码非 0 但没解析到 error TS 行，可能输出格式变了");
  process.exit(2);
}
process.exit(0);
