#!/usr/bin/env node
/**
 * strip-types 不兼容语法守卫（task-2 / 守卫 2）
 *
 * 扫 apps/api/src 全部 .ts，检测 Node 24 --experimental-strip-types（strip-only
 * 模式）**不支持**、需要生成代码的 TypeScript 语法：
 *   1. enum 声明（含 export enum / const enum）
 *   2. namespace / module X { } 声明
 *   3. 构造函数参数属性：constructor(private/protected/public/readonly x)
 *   4. 装饰器：@Foo 形式的声明前装饰器
 * 任一命中即违规。tsconfig.base.json 已开 erasableSyntaxOnly，但 tsc 全绿 ≠
 * 运行时不抛（vitest 走 esbuild 转换，测不出来），故加静态门禁。
 *
 * 精度要点（避免误报，实测过）：
 *   - 先把「行注释 / 块注释 / 字符串与模板字面量」整体抹成空格（保留换行与
 *     长度，行号不偏移）。否则 z.enum(...)（zod 方法）、注释里的
 *     "参数属性 / enum / namespace" 会被误判成违规。
 *   - enum / namespace 只认「声明」形态：关键字前不是 . 或标识符字符，
 *     并排除 z.enum 这类方法调用。
 *   - 参数属性只认 constructor(...) 形参表里的修饰符，用括号配对取参数段，
 *     不误伤类字段声明（private readonly x: number; 是可擦除的，合法）。
 *
 * 用法：node scripts/check-strip-syntax.mjs [--json] [--update]
 * 退出码：0 通过；1 出现新增违规；2 形状错误（目录缺失 / 参数非法）。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API_SRC = join(ROOT, "apps", "api", "src");
const P = "[strip-syntax] ";
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const UPDATE = argv.includes("--update");
const UNKNOWN = argv.filter((a) => a !== "--json" && a !== "--update");

/** 违规项 ID 形如 "apps/api/src/foo.ts:12:paramProperty"；首次实测基线为空。 */
let BASELINE = [];

function shapeError(msg) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, exitCode: 2, error: "shape", message: msg }, null, 2));
  else console.error(P + "❌ 形状错误：" + msg);
  process.exit(2);
}
if (UNKNOWN.length) shapeError("未知参数：" + UNKNOWN.join(" "));
if (!existsSync(API_SRC)) shapeError("找不到 apps/api/src");
if (!Array.isArray(BASELINE) || BASELINE.some((x) => typeof x !== "string")) shapeError("BASELINE 形状非法");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);
function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}
const files = walk(API_SRC);
if (!files.length) shapeError("apps/api/src 下没有 .ts 文件");

/**
 * 把注释与字符串内容替换为空格，保留换行与字符位置（行号可直接复用）。
 * 支持行注释、块注释、单引号、双引号、反引号模板字面量。
 */
function blankNonCode(src) {
  const out = src.split("");
  const n = src.length;
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " "; };
  let i = 0;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") {
      let j = i + 2; while (j < n && src[j] !== "\n") j++;
      blank(i, j); i = j; continue;
    }
    if (c === "/" && d === "*") {
      let j = i + 2; while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(j + 2, n); blank(i, j); i = j; continue;
    }
    const BT = String.fromCharCode(96);
    if (c === "'" || c === '"' || c === BT) {
      const q = c; let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === q) { j++; break; }
        j++;
      }
      blank(i, j); i = j; continue;
    }
    i++;
  }
  return out.join("");
}

const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;
const lineText = (text, ln) => (text.split("\n")[ln - 1] ?? "").trim().slice(0, 160);

function detect(file) {
  const raw = readFileSync(file, "utf8");
  const code = blankNonCode(raw);
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  const found = [];
  const push = (kind, idx) => {
    const ln = lineOf(raw, idx);
    found.push({ id: rel + ":" + ln + ":" + kind, file: rel, line: ln, kind, snippet: lineText(raw, ln) });
  };

  // 1) enum 声明：关键字前不是标识符/./$；z.enum(...) 前面是 "." → 排除
  const enumRe = /(?<![A-Za-z0-9_$.])(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = enumRe.exec(code))) push("enum", m.index);

  // 2) namespace / module 声明（module X { } / namespace X { }）
  const nsRe = /(?<![A-Za-z0-9_$.])(?:declare\s+)?(namespace|module)\s+([A-Za-z_$][\w$]*)\s*\{/g;
  while ((m = nsRe.exec(code))) push(m[1] === "module" ? "module" : "namespace", m.index);

  // 3) 装饰器：行首（可缩进）@Identifier
  const decRe = /^[ \t]*@([A-Za-z_$][\w$]*)/gm;
  while ((m = decRe.exec(code))) push("decorator", m.index);

  // 4) 构造函数参数属性：括号配对取 constructor(...) 的形参段
  const ctorRe = /\bconstructor\s*\(/g;
  while ((m = ctorRe.exec(code))) {
    let depth = 1, j = m.index + m[0].length;
    const start = j;
    while (j < code.length && depth > 0) {
      if (code[j] === "(") depth++;
      else if (code[j] === ")") depth--;
      j++;
    }
    const params = code.slice(start, Math.max(start, j - 1));
    const paramRe = /\b(readonly|private|protected|public)\b[^,()]*/g;
    let pm;
    while ((pm = paramRe.exec(params))) push("paramProperty", start + pm.index);
  }
  return found;
}

const violations = [];
for (const f of files) violations.push(...detect(f));
violations.sort((a, b) => a.id.localeCompare(b.id));

const known = new Set(BASELINE);
const brandNew = violations.filter((v) => !known.has(v.id));
const stale = BASELINE.filter((id) => !violations.some((v) => v.id === id));

if (UPDATE) {
  console.log(P + "当前违规 ID（复制进 BASELINE 即完成登记，" + violations.length + " 项）：");
  console.log(JSON.stringify(violations.map((v) => v.id), null, 2));
  process.exit(0);
}

const result = {
  ok: brandNew.length === 0,
  exitCode: brandNew.length ? 1 : 0,
  scannedFiles: files.length,
  totalViolations: violations.length,
  baseline: BASELINE,
  brandNew,
  staleBaselineEntries: stale,
  violations,
};
if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(P + "扫描 apps/api/src " + files.length + " 个 .ts，strip-types 违规 " + violations.length + " 处");
  for (const v of violations) console.log(P + (known.has(v.id) ? "· 基线 " : "❌ 新增 ") + v.id + "  " + v.snippet);
  if (stale.length) console.log(P + "ℹ 以下基线项已不再命中，可移出 BASELINE：" + stale.join("、"));
  if (brandNew.length) console.error(P + "❌ 出现 " + brandNew.length + " 处新增违规；Node 24 strip-types 会在运行时抛 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
  else console.log(P + "✅ 无新增 strip-types 违规（基线 " + BASELINE.length + " 项）");
}
process.exit(brandNew.length ? 1 : 0);
