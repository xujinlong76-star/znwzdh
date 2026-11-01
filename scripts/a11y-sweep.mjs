#!/usr/bin/env node
/**
 * a11y-sweep：NavHub a11y 清账常备工具（扫描 → 报告 → 修复 → 豁免维护）
 *
 * 背景：2026-11-01 商用级升级的热区清账靠一次性 codemod（tmp-a11y-cleanup.mjs）完成；
 * 本脚本把它固化为可复用工具，并补齐「豁免清单自动增删」这个最易漂移的环节。
 *
 * 用法（默认只读，不写盘）：
 *   node scripts/a11y-sweep.mjs                       # 扫描并打印报告
 *   node scripts/a11y-sweep.mjs --json                # 机读输出
 *   node scripts/a11y-sweep.mjs --write               # 对「冷区且非豁免」文件应用替换
 *   node scripts/a11y-sweep.mjs --write --only components/foo.tsx,app/bar/page.tsx
 *   node scripts/a11y-sweep.mjs --prune-exemptions    # 清退「零违例」豁免并重写测试数组
 *   node scripts/a11y-sweep.mjs --self-test           # 自检（变换规则 + 豁免解析）
 *
 * 规则（与 apps/web-overlay/test/a11y-token-contrast.test.ts 同配方）：
 *   1. text-<color>-600 → text-<color>-700（浅色档；dark: 变体不动）
 *   2. text-muted-foreground/{40,50,60,70,80,90} → text-muted-foreground（禁透明度变体）
 *   3. text-destructive（不含 -foreground）→ text-destructive-text
 *   4. bg-destructive/10 → bg-destructive/15（错误条底）
 *   5. border-input → border-border-strong（控件边界，对白仅 ~1.2:1）
 *
 * 安全阀：
 *   - --write 默认跳过 git 未提交（WIP）文件与豁免清单文件；--force 才可越过
 *   - 写盘保持 LF，不做行尾转换（本仓 autocrlf 环境下的既有约定）
 *   - --prune-exemptions 只删除「文件存在、git 干净、零违例」的豁免条目，逐条注释保留
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const SRC = resolve(ROOT, "apps/web-overlay/src");
const TEST_FILE = resolve(ROOT, "apps/web-overlay/test/a11y-token-contrast.test.ts");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

// ---------- 规则 ----------
const COLOR_600 = /text-(amber|emerald|rose|sky|blue|indigo|purple|violet|cyan|teal|lime|orange|pink|fuchsia)-600/g;
const MUTED_FADE = /text-muted-foreground\/(?:40|50|60|70|80|90)/g;
const DESTRUCTIVE_TEXT = /text-destructive(?!-)/g;
const DESTRUCTIVE_BG = /bg-destructive\/10(?!\d)/g;
const BORDER_INPUT = /\bborder-input\b/g;

export function transform(src) {
  const counts = { color700: 0, muted: 0, destructive: 0, destructiveBg: 0, borderInput: 0 };
  // 徽章配方：仅当同一行同时出现 bg-*-500/10 彩底时，才把该行 text-*-600 提到 700
  // （与门禁 a11y-token-contrast 的口径一致；裸 -600 文本只报告不自动改，避免大范围视觉漂移）
  let out = src
    .split("\n")
    .map((line) => {
      if (!/bg-[a-z]+-500\/10/.test(line)) return line;
      return line.replace(COLOR_600, (_m, c) => {
        counts.color700++;
        return `text-${c}-700`;
      });
    })
    .join("\n");
  out = out
    .replace(MUTED_FADE, () => { counts.muted++; return "text-muted-foreground"; })
    .replace(DESTRUCTIVE_TEXT, () => { counts.destructive++; return "text-destructive-text"; })
    .replace(DESTRUCTIVE_BG, () => { counts.destructiveBg++; return "bg-destructive/15"; })
    .replace(BORDER_INPUT, () => { counts.borderInput++; return "border-border-strong"; });
  return { out, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

// ---------- 扫描 ----------
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(tsx?|jsx?)$/.test(name)) acc.push(p);
  }
  return acc;
}

function gitDirtySet() {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
    const set = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!line.trim()) continue;
      set.add(line.slice(3).trim().replace(/^"|"$/g, ""));
    }
    return set;
  } catch {
    return new Set();
  }
}

export function parseExemptions(testSrc) {
  const m = testSrc.match(/const WIP_HOT_EXEMPT: string\[\] = \[([\s\S]*?)\n\];/);
  if (!m) throw new Error("未找到 WIP_HOT_EXEMPT 数组");
  const entries = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  return { block: m[0], body: m[1], entries };
}

function scan(exemptSet) {
  const dirty = gitDirtySet();
  const files = walk(SRC);
  const rows = [];
  for (const abs of files) {
    const rel = relative(SRC, abs).replace(/\\/g, "/");
    const src = readFileSync(abs, "utf8");
    const { total, counts } = transform(src);
    if (total === 0) continue;
    rows.push({
      rel,
      total,
      counts,
      dirty: dirty.has(`apps/web-overlay/src/${rel}`),
      exempt: exemptSet.has(rel),
    });
  }
  rows.sort((a, b) => b.total - a.total);
  return rows;
}

// ---------- 报告 ----------
function report(rows) {
  const open = rows.filter((r) => !r.exempt);
  const exempted = rows.filter((r) => r.exempt);
  console.log(`[scan] 有违例文件 ${rows.length} 个 / 总计 ${rows.reduce((a, r) => a + r.total, 0)} 处`);
  console.log(`       未豁免（门禁红灯源）：${open.length} 个 | 豁免内：${exempted.length} 个`);
  if (open.length) {
    console.log("[open] 未豁免违例（必须修或登记豁免）：");
    for (const r of open) console.log(`  ${r.dirty ? "WIP " : "    "}${r.rel}  ×${r.total}  ${JSON.stringify(r.counts)}`);
  }
  const cleanExempt = exempted.filter((r) => !r.dirty);
  console.log(`[prune-candidate] 零 WIP 的豁免文件：${cleanExempt.filter((r) => r.total === 0).length} 条（可清退）`);
}

// ---------- 主流程 ----------
const selfTest = flag("--self-test");
if (selfTest) {
  const t1 = transform('class="text-emerald-600 bg-emerald-500/10 text-muted-foreground/70 text-destructive bg-destructive/10 border-input"');
  const checks = [
    [t1.out.includes("text-emerald-700"), "600→700"],
    [!t1.out.includes("text-muted-foreground/70"), "muted 透明度清零"],
    [t1.out.includes("text-destructive-text"), "destructive-text"],
    [t1.out.includes("bg-destructive/15"), "错误条 /15"],
    [t1.out.includes("border-border-strong"), "border-input→strong"],
    [t1.total === 5, "计数=5，实为 " + t1.total],
    [transform("text-destructive-foreground").total === 0, "不得误伤 destructive-foreground"],
    [parseExemptions('const WIP_HOT_EXEMPT: string[] = [\n  "a/b.tsx", // c\n];').entries[0] === "a/b.tsx", "豁免解析"],
  ];
  let bad = 0;
  for (const [ok, name] of checks) {
    console.log(ok ? `  ✓ ${name}` : `  ✗ ${name}`);
    if (!ok) bad++;
  }
  process.exit(bad ? 1 : 0);
}

const testSrc = readFileSync(TEST_FILE, "utf8");
const { block, entries } = parseExemptions(testSrc);
const exemptSet = new Set(entries);
const rows = scan(exemptSet);

if (flag("--json")) {
  console.log(JSON.stringify({ rows }, null, 2));
  process.exit(0);
}

report(rows);

if (flag("--write")) {
  const only = opt("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
  const dirty = gitDirtySet();
  let changed = 0;
  for (const abs of walk(SRC)) {
    const rel = relative(SRC, abs).replace(/\\/g, "/");
    if (only && !only.includes(rel)) continue;
    if (!only && (exemptSet.has(rel) || dirty.has(`apps/web-overlay/src/${rel}`))) continue;
    const src = readFileSync(abs, "utf8");
    const { out, total } = transform(src);
    if (total === 0) continue;
    if (!flag("--force") && dirty.has(`apps/web-overlay/src/${rel}`)) continue;
    writeFileSync(abs, out, "utf8");
    console.log(`[write] ${rel}  ${total} 处`);
    changed += total;
  }
  console.log(changed ? `[write] 共 ${changed} 处` : "[write] 无可写文件（都被豁免/WIP 保护）");
}

if (flag("--prune-exemptions")) {
  const dirty = gitDirtySet();
  const keep = [];
  const dropped = [];
  for (const rel of entries) {
    const abs = resolve(SRC, rel);
    if (!existsSync(abs)) { dropped.push(rel + "（文件不存在）"); continue; }
    const isDirty = dirty.has(`apps/web-overlay/src/${rel}`);
    const { total } = transform(readFileSync(abs, "utf8"));
    if (!isDirty && total === 0) dropped.push(rel);
    else keep.push(rel);
  }
  if (!dropped.length) {
    console.log("[prune] 无需清退（所有豁免文件仍有违例或处于 WIP）");
  } else {
    // 逐行重写数组：删除被清退条目所在行，保留注释与结构
    const droppedSet = new Set(dropped.map((d) => d.replace(/（.*$/, "")));
    const bodyLines = block.split("\n");
    const newLines = bodyLines.filter((line) => {
      const m = line.match(/"([^"]+)"/);
      return !(m && droppedSet.has(m[1]));
    });
    const newBlock = newLines.join("\n");
    writeFileSync(TEST_FILE, testSrc.replace(block, newBlock), "utf8");
    console.log(`[prune] 清退 ${droppedSet.size} 条：`);
    for (const rel of droppedSet) console.log("  - " + rel);
    console.log("[prune] 已重写 " + relative(ROOT, TEST_FILE).replace(/\\/g, "/") + "，记得 mirror:web 后跑门禁");
  }
}
