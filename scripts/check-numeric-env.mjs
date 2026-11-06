#!/usr/bin/env node
/**
 * 数值型环境变量守卫（task-2 / 守卫 3）
 *
 * 扫全仓各 src/ 下 .ts/.tsx/.mts/.cts，找出 Number(process.env.XXX) 的读取点，
 * 且「同一文件」缺少 Number.isFinite 校验或钳位（Math.min / Math.max /
 * Math.floor / Math.ceil / Math.trunc / clamp / ?? 兜底 / || 兜底）的点。
 * 背景：Number(undefined) = NaN、Number("abc") = NaN，未校验直接进超时/上限/
 * 端口会让配置错误变成静默的无限值或 0（运维按 .env.example 配了却永远
 * 取不到预期默认值）。tsconfig.base.json 的注释与 apps/api/src/client-errors.ts
 * 都记过同类事故。
 *
 * 口径：按**文件**判定保护是否到位（同一文件里只要有任何 isFinite / 钳位
 * 或 || / ?? 兜底即视为该文件有防护惯例），输出的是「候选点」而非编译器结论；
 * 命中项 ID 为 "相对路径:行号:变量名"，登记进 BASELINE 的历史项不判红，
 * 只有新增读取点才判红（棘轮，避免一上来把仓库判红后被绕过）。
 *
 * 用法：node scripts/check-numeric-env.mjs [--json] [--update]
 * 退出码：0 通过；1 出现新增未保护读取点；2 形状错误（参数非法 / 无 src 目录）。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const P = "[numeric-env] ";
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const UPDATE = argv.includes("--update");
const UNKNOWN = argv.filter((a) => a !== "--json" && a !== "--update");
const NL = String.fromCharCode(10);

/** 首次实测（2026-11-06）登记的历史读取点；新增项才判红。 */
let BASELINE = [
  "apps/mcp/src/http.ts:19:NAVHUB_MCP_HTTP_PORT",
];

function shapeError(msg) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, exitCode: 2, error: "shape", message: msg }, null, 2));
  else console.error(P + "❌ 形状错误：" + msg);
  process.exit(2);
}
if (UNKNOWN.length) shapeError("未知参数：" + UNKNOWN.join(" "));
if (!Array.isArray(BASELINE) || BASELINE.some((x) => typeof x !== "string")) shapeError("BASELINE 形状非法");

const EXTS = [".ts", ".tsx", ".mts", ".cts"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "coverage", ".vercel", ".turbo", "test-results", "playwright-report"]);
function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else if (EXTS.some((x) => e.name.endsWith(x)) && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

// 只扫根下各 src 目录（apps 下、packages 下、extensions 下，以及根 src）。
function findSrcDirs() {
  const dirs = [];
  const rootSrc = join(ROOT, "src");
  if (existsSync(rootSrc)) dirs.push(rootSrc);
  for (const top of ["apps", "packages", "extensions"]) {
    const base = join(ROOT, top);
    if (!existsSync(base)) continue;
    let entries; try { entries = readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) if (e.isDirectory()) {
      const s = join(base, e.name, "src");
      if (existsSync(s)) dirs.push(s);
    }
  }
  return dirs;
}
const srcDirs = findSrcDirs();
if (!srcDirs.length) shapeError("仓库下找不到任何 src/ 目录");
const files = [];
for (const d of srcDirs) walk(d, files);
files.sort();

/** 同文件保护信号：Number.isFinite 校验 / 数值钳位 / clamp。
 * 刻意不计入 || 与 ?? 兜底：它们只能防 undefined，防不住 Number("abc") = NaN，
 * 而 NaN 进超时/上限/端口正是本守卫要拦的静默故障。 */
const GUARD_RE = /Number\.isFinite|isFinite\s*\(|Math\.(?:min|max|floor|ceil|trunc|round)\s*\(|\bclamp\s*\(/;
/** Number(process.env.XXX) 或 Number(process.env["XXX"])，允许空白与可选链。 */
const NUM_RE = /Number\s*\(\s*process\.env(?:\??\.\s*([A-Za-z_$][\w$]*)|\s*\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\])/g;
const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;

const hits = [];
for (const f of files) {
  let text; try { text = readFileSync(f, "utf8"); } catch { continue; }
  const hasGuard = GUARD_RE.test(text);
  let m; NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(text))) {
    const name = m[1] ?? m[2];
    const ln = lineOf(text, m.index);
    const rel = relative(ROOT, f).replaceAll("\\", "/");
    hits.push({
      id: rel + ":" + ln + ":" + name,
      file: rel, line: ln, variable: name,
      guardedInFile: hasGuard,
      snippet: (text.split("\n")[ln - 1] ?? "").trim().slice(0, 160),
    });
  }
}
// 只把「同文件无任何防护」的点列为需治理候选
const candidates = hits.filter((h) => !h.guardedInFile);
candidates.sort((a, b) => a.id.localeCompare(b.id));

const known = new Set(BASELINE);
const brandNew = candidates.filter((h) => !known.has(h.id));
const stale = BASELINE.filter((id) => !candidates.some((h) => h.id === id));

if (UPDATE) {
  console.log(P + "当前未保护读取点 ID（复制进 BASELINE 即完成登记，" + candidates.length + " 项）：");
  console.log(JSON.stringify(candidates.map((h) => h.id), null, 2));
  process.exit(0);
}

const result = {
  ok: brandNew.length === 0,
  exitCode: brandNew.length ? 1 : 0,
  scanned: { srcDirs: srcDirs.map((d) => relative(ROOT, d).replaceAll("\\", "/")), files: files.length },
  totalNumberEnvReads: hits.length,
  totalUnguarded: candidates.length,
  baseline: BASELINE,
  brandNew,
  staleBaselineEntries: stale,
  unguarded: candidates,
};
if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(P + "扫描 " + files.length + " 个源文件，Number(process.env.*) 读取 " + hits.length + " 处，未保护 " + candidates.length + " 处");
  for (const h of candidates) console.log(P + (known.has(h.id) ? "· 基线 " : "❌ 新增 ") + h.id + "  " + h.snippet);
  if (stale.length) console.log(P + "ℹ 以下基线项已不再命中，可移出 BASELINE：" + stale.join("、"));
  if (brandNew.length) console.error(P + "❌ 出现 " + brandNew.length + " 个新增未保护数值 env 读取点，请补 Number.isFinite / 钳位 / 兜底");
  else console.log(P + "✅ 无新增未保护读取点（基线 " + BASELINE.length + " 项）");
}
process.exit(brandNew.length ? 1 : 0);
