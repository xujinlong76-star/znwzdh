#!/usr/bin/env node
/**
 * 语法快速门禁（不依赖 tsc 项目配置，秒级）。
 *
 * 为什么需要它：
 *   `tsc --noEmit` 已经能发现语法错误，但根 typecheck 约 75s、前端约 19s，
 *   而且只有推到 CI 才跑。2026-10-19 一次缺失右花括号让 main 全红一个修复周期。
 *   本脚本只做「解析」不做类型检查，约 2–5s，适合放在 pre-commit 与 verify 最前面。
 *
 * 为什么用 esbuild 而不是 typescript：
 *   TS 7 native 不再提供 createSourceFile 等 compiler API，若这里 import "typescript"，
 *   升级 TS 7 时语法门禁会先挂（Dependabot PR #89 已实测）。esbuild 已是 devDependency，
 *   vitest 同源使用，解析 TS/TSX 只需毫秒级，且与 TS 版本解耦。
 *
 * 用法：
 *   node scripts/check-syntax.mjs                 # 扫描默认目录
 *   node scripts/check-syntax.mjs --staged        # 只检查 git staged 的 TS/TSX
 *   node scripts/check-syntax.mjs path/a.ts ...   # 只检查指定文件
 *
 * 默认扫描：
 *   apps/api/src、apps/api/test、apps/web-overlay/src、apps/web-overlay/test、packages
 * 刻意不扫描 apps/web（vendored 生成物，由 overlay 的事实源负责）。
 *
 * 另外检查 scripts 下所有 .mjs 的**行尾**：必须是 LF。
 * 原因见 `checkMjsLineEndings` 的注释——CRLF 会让 vite 解析 `.mjs` 时报
 * `SyntaxError: Invalid or unexpected token`，**而且不带行号**，
 * 同时 `node --check` 与 esbuild 都通过，排查成本极高（2026-10-25 实测）。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { transformSync } from "esbuild";

const TS_EXT = /\.(ts|tsx|mts|cts)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "coverage", ".git"]);

function walk(dir, out, extRe = TS_EXT) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out, extRe);
    } else if (entry.isFile() && extRe.test(entry.name)) {
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

function collectStagedFiles(extRe = TS_EXT) {
  const raw = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM"], {
    encoding: "utf8",
  });
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && extRe.test(line))
    .map((line) => resolve(line))
    .filter((file) => existsSync(file));
}

const MJS_EXT = /\.(mjs|mts)$/;

/**
 * scripts 目录下的 ESM 脚本必须用 LF 行尾。
 *
 * 2026-10-25 实测：`scripts/safe-commit.mjs` 被写成 CRLF 后，任何 `import` 它的测试
 * 都报 `SyntaxError: Invalid or unexpected token`——
 *   · **不带行号**，指向的是 importer 而不是真凶；
 *   · `node --check` 通过、esbuild transform 通过，两种常规自检都发现不了；
 *   · 只有 vite 的 module runner 会炸，且报错完全不提行尾。
 * 这类「报错指不向真因」的陷阱，值一条机械检查。
 *
 * 只查 `.mjs`/`.mts`：`.ts` 走 esbuild，CRLF 不影响解析（仓库里现存的 CRLF 的 .ts
 * 都工作正常）。范围收窄是为了让这条守卫能**立刻生效**而不是先欠一笔历史债。
 */
function collectMjsFiles() {
  const files = [];
  walk("scripts", files, MJS_EXT);
  return files;
}

function checkMjsLineEndings(files) {
  const bad = [];
  for (const file of files) {
    const raw = readFileSync(file);
    // 只看前面一段：行尾是全文属性，扫 4KB 足够，也避免大文件拖慢
    const head = raw.subarray(0, 4096);
    if (head.includes("\r\n")) bad.push(relative(process.cwd(), file));
  }
  return bad;
}

const args = process.argv.slice(2);
const explicit = args.filter((a) => !a.startsWith("--"));
const files = args.includes("--staged")
  ? collectStagedFiles()
  : explicit.length > 0
    ? // 显式传参也要过扩展名：否则把 .json/.md 传进来会被当 TS 解析并误报语法错
      explicit.map((f) => resolve(f)).filter((f) => existsSync(f) && TS_EXT.test(f))
    : collectDefaultFiles();

/**
 * 行尾检查放在 TS 语法检查之前，且**不受 files.length === 0 影响**：
 * 只改一个 .mjs 的提交里，TS 文件数是 0，但那条 .mjs 恰恰最需要检查。
 */
const mjsFiles = args.includes("--staged")
  ? collectStagedFiles(MJS_EXT)
  : explicit.length > 0
    ? explicit.map((f) => resolve(f)).filter((f) => existsSync(f) && MJS_EXT.test(f))
    : collectMjsFiles();
const badEndings = checkMjsLineEndings(mjsFiles);
if (badEndings.length > 0) {
  console.error(
    `[syntax] ${badEndings.length} 个 .mjs 用了 CRLF 行尾（必须 LF）。` +
      `\n  vite 解析这类文件会报 SyntaxError 且**不带行号**，node --check 却通过：`,
  );
  for (const f of badEndings) console.error("  " + f);
  console.error("\n  修复：node scripts/fix-line-endings.mjs <file>（或手工转 LF）");
  process.exit(1);
}

if (files.length === 0) {
  console.log("[syntax] 没有需要检查的 TS/TSX 文件");
  process.exit(0);
}

const errors = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  try {
    // transformSync 只解析/转译，不解析 import、不做类型检查；target esnext 避免降级误报。
    transformSync(source, {
      loader: file.endsWith(".tsx") ? "tsx" : "ts",
      format: "esm",
      target: "esnext",
      sourcefile: file,
      logLevel: "silent",
    });
  } catch (error) {
    // esbuild 的 TransformFailure 带 errors 数组，尽量保留每个错误的位置。
    const failures = error && typeof error === "object" && Array.isArray(error.errors) ? error.errors : [];
    if (failures.length === 0) {
      errors.push(`${relative(process.cwd(), file)} ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    for (const failure of failures) {
      const location = failure.location;
      const loc = location
        ? `${relative(process.cwd(), location.file ?? file)}:${location.line}:${location.column + 1}`
        : relative(process.cwd(), file);
      errors.push(`${loc} ${failure.text}`);
    }
  }
}

if (errors.length > 0) {
  console.error(`[syntax] 发现 ${errors.length} 个语法错误（${files.length} 个文件）：`);
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}

console.log(`[syntax] 通过：${files.length} 个文件，0 错误（另查 ${mjsFiles.length} 个 .mjs 行尾）`);
