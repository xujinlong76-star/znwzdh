#!/usr/bin/env node
/**
 * 语法快速门禁（不依赖 tsc 项目配置，秒级）。
 *
 * 为什么需要它：
 *   `tsc --noEmit` 已经能发现语法错误，但根 typecheck 约 75s、前端约 19s，
 *   而且只有推到 CI 才跑。2026-10-19 一次缺失右花括号让 main 全红一个修复周期。
 *   本脚本只做「解析」不做类型检查，约 2–5s，适合放在 pre-commit 与 verify 最前面。
 *
 * 用法：
 *   node scripts/check-syntax.mjs                 # 扫描默认目录
 *   node scripts/check-syntax.mjs --staged        # 只检查 git staged 的 TS/TSX
 *   node scripts/check-syntax.mjs path/a.ts ...   # 只检查指定文件
 *
 * 默认扫描：
 *   apps/api/src、apps/api/test、apps/web-overlay/src、apps/web-overlay/test、packages
 * 刻意不扫描 apps/web（vendored 生成物，由 overlay 的事实源负责）。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const TS_EXT = /\.(ts|tsx|mts|cts)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "coverage", ".git"]);

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (entry.isFile() && TS_EXT.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
}

function collectDefaultFiles() {
  const files = [];
  for (const root of ["apps/api/src", "apps/api/test", "apps/web-overlay/src", "apps/web-overlay/test", "packages"]) {
    walk(root, files);
  }
  return files;
}

function collectStagedFiles() {
  const raw = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM"], {
    encoding: "utf8",
  });
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && TS_EXT.test(line))
    .map((line) => resolve(line))
    .filter((file) => existsSync(file));
}

const args = process.argv.slice(2);
const explicit = args.filter((a) => !a.startsWith("--"));
const files = args.includes("--staged")
  ? collectStagedFiles()
  : explicit.length > 0
    ? explicit.map((f) => resolve(f)).filter((f) => existsSync(f))
    : collectDefaultFiles();

if (files.length === 0) {
  console.log("[syntax] 没有需要检查的 TS/TSX 文件");
  process.exit(0);
}

const errors = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  // 只解析、不生成输出：transpileModule 在个别文件上会触发 TS 内部
  // "Output generation failed"（与语法无关），createSourceFile 只做 AST 解析。
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, kind);
  for (const d of sourceFile.parseDiagnostics ?? []) {
    if (d.category !== ts.DiagnosticCategory.Error) continue;
    const pos = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : null;
    const loc = pos ? `${relative(process.cwd(), d.file.fileName)}:${pos.line + 1}:${pos.character + 1}` : relative(process.cwd(), file);
    errors.push(`${loc} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  }
}

if (errors.length > 0) {
  console.error(`[syntax] 发现 ${errors.length} 个语法错误（${files.length} 个文件）：`);
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}

console.log(`[syntax] 通过：${files.length} 个文件，0 错误`);
