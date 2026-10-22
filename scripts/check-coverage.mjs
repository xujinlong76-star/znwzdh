#!/usr/bin/env node
/**
 * 覆盖率取数脚本（零依赖，只读 vitest 产出的 JSON，自己不跑测试）。
 *
 * 定位：W3「先把不可度量变成可度量」。本轮 **只出数，不定硬门禁** ——
 * 不传 --max-lines / --max-functions 时永远 exit 0，只把实测数字打出来。
 * 等存量摸清、补测到位之后再在 CI 里传阈值收紧。
 *
 * 口径（必须与 vitest.config.ts 的 coverage 段保持一致）：
 *   - provider v8，include = apps/api/src 与 packages 下各包的 src（glob 见 vitest.config.ts）
 *   - apps/web 是 vendored 上游底座，不纳入统计
 *   - all 开启（vitest 默认），因此**没被任何测试 import 到的文件也会以 0% 计入**
 *     ——这正是我们要的信号：上一轮靠人工静态比对才发现的零覆盖写端点，
 *     以后看这个数字就能发现。
 *
 * 用法：
 *   node node_modules/vitest/vitest.mjs run --coverage   # 先产出 coverage/
 *   node scripts/check-coverage.mjs                      # 只打印，不 fail
 *   node scripts/check-coverage.mjs --max-lines 40       # 低于 40% 行覆盖则 fail
 *   node scripts/check-coverage.mjs --max-functions 30
 *   node scripts/check-coverage.mjs --json               # 机器可读（CI 采集）
 *   node scripts/check-coverage.mjs --zero 20            # 列出最差的 N 个零覆盖文件
 *
 * 退出码：0 = 通过（或本轮无阈值）；1 = 未达传入的阈值；2 = 找不到覆盖率产物。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// 唯一的路径常量：必须与 vitest.config.ts 的 coverage.reportsDirectory 一致。
// 改这里或改 config 时，两边要一起改，否则本脚本会误报「找不到产物」。
// ---------------------------------------------------------------------------
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COVERAGE_DIR = resolve(REPO_ROOT, "coverage");
const SUMMARY_FILE = resolve(COVERAGE_DIR, "coverage-summary.json");

/** 覆盖率归属分组：按源码路径前缀切分，顺序即打印顺序 */
const AREAS = [
  { name: "apps/api", prefix: "apps/api/src/" },
  { name: "packages/core", prefix: "packages/core/src/" },
  { name: "packages/store", prefix: "packages/store/src/" },
  { name: "packages/ai", prefix: "packages/ai/src/" },
  { name: "packages/mcp", prefix: "packages/mcp/src/" },
];

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const has = (name) => args.includes(name);

const maxLines = flag("--max-lines") === undefined ? null : Number(flag("--max-lines"));
const maxFunctions = flag("--max-functions") === undefined ? null : Number(flag("--max-functions"));
const zeroLimit = flag("--zero") === undefined ? 0 : Number(flag("--zero"));

if (!existsSync(SUMMARY_FILE)) {
  console.error(`[coverage] 找不到覆盖率产物：${SUMMARY_FILE}`);
  console.error("[coverage] 先跑：node node_modules/vitest/vitest.mjs run --coverage");
  process.exit(2);
}

const summary = JSON.parse(readFileSync(SUMMARY_FILE, "utf8"));

/** summary 的 key 是绝对路径（Windows 上可能是反斜杠），统一成正斜杠再切分 */
const norm = (p) => p.replace(/\\/g, "/");
const rel = (p) => {
  const n = norm(p);
  const at = n.indexOf("/apps/api/") >= 0 ? n.indexOf("/apps/api/") : n.indexOf("/packages/");
  return at >= 0 ? n.slice(at + 1) : n;
};

const pct = (n) => `${n.toFixed(2)}%`;
const empty = () => ({ lines: { total: 0, covered: 0 }, functions: { total: 0, covered: 0 }, branches: { total: 0, covered: 0 }, files: 0, zeroFiles: [] });

const buckets = new Map(AREAS.map((a) => [a.name, empty()]));
const other = empty();
const zeros = [];

for (const [file, data] of Object.entries(summary)) {
  // istanbul 的 summary 会额外带一个 "total" 键（全局合计），它不是文件，必须跳过，
  // 否则会被当成「未归类文件」污染分组。
  if (file === "total") continue;
  const r = rel(file);
  const bucket = AREAS.find((a) => r.startsWith(a.prefix));
  const target = bucket ? buckets.get(bucket.name) : other;

  for (const kind of ["lines", "functions", "branches"]) {
    const t = data[kind];
    if (!t) continue;
    target[kind].total += t.total;
    target[kind].covered += t.covered;
  }
  target.files += 1;
  const covered = data.lines?.covered ?? 0;
  if (covered === 0) {
    target.zeroFiles.push(r);
    zeros.push({ file: r, lines: data.lines?.total ?? 0 });
  }
}

const ratio = (c) => (c.total === 0 ? 100 : (c.covered / c.total) * 100);
const rows = [
  ...AREAS.map((a) => ({ area: a.name, ...buckets.get(a.name) })),
  ...(other.files > 0 ? [{ area: "(其他)", ...other }] : []),
];

const jsonMode = has("--json");
if (jsonMode) {
  console.log(
    JSON.stringify(
      {
        coverageDir: COVERAGE_DIR,
        totals: Object.fromEntries(
          ["lines", "functions", "branches"].map((k) => [
            k,
            {
              pct: Number(ratio({ total: rows.reduce((s, r) => s + r[k].total, 0), covered: rows.reduce((s, r) => s + r[k].covered, 0) }).toFixed(2)),
              total: rows.reduce((s, r) => s + r[k].total, 0),
              covered: rows.reduce((s, r) => s + r[k].covered, 0),
            },
          ]),
        ),
        areas: rows.map((r) => ({
          area: r.area,
          files: r.files,
          zeroFiles: r.zeroFiles.length,
          linesPct: Number(ratio(r.lines).toFixed(2)),
          functionsPct: Number(ratio(r.functions).toFixed(2)),
          branchesPct: Number(ratio(r.branches).toFixed(2)),
        })),
      },
      null,
      2,
    ),
  );
} else {
  console.log(`[coverage] 产物目录：${COVERAGE_DIR}`);
  console.log("[coverage] 口径：apps/api/src + packages/*/src（apps/web 为 vendored 底座，不计入）\n");
  console.log("  区域                 文件数   零覆盖   lines      functions  branches");
  for (const r of rows) {
    console.log(
      `  ${r.area.padEnd(18)} ${String(r.files).padStart(6)} ${String(r.zeroFiles.length).padStart(7)}   ` +
        `${pct(ratio(r.lines)).padStart(8)}   ${pct(ratio(r.functions)).padStart(8)}   ${pct(ratio(r.branches)).padStart(8)}`,
    );
  }
  const totalOf = (k) => ({
    total: rows.reduce((s, r) => s + r[k].total, 0),
    covered: rows.reduce((s, r) => s + r[k].covered, 0),
  });
  const L = totalOf("lines");
  const F = totalOf("functions");
  const B = totalOf("branches");
  console.log(
    `\n  总体                 ${String(rows.reduce((s, r) => s + r.files, 0)).padStart(6)} ` +
      `${String(zeros.length).padStart(7)}   ${pct(ratio(L)).padStart(8)}   ${pct(ratio(F)).padStart(8)}   ${pct(ratio(B)).padStart(8)}`,
  );
  console.log(
    `  （明细：lines ${L.covered}/${L.total}，functions ${F.covered}/${F.total}，branches ${B.covered}/${B.total}）`,
  );

  if (zeroLimit > 0 && zeros.length > 0) {
    zeros.sort((a, b) => b.lines - a.lines);
    console.log(`\n  零覆盖文件 Top ${Math.min(zeroLimit, zeros.length)}（按行数降序，共 ${zeros.length} 个）：`);
    for (const z of zeros.slice(0, zeroLimit)) console.log(`    ${String(z.lines).padStart(5)} 行  ${z.file}`);
  }
}

// ---------------------------------------------------------------------------
// 阈值：只在这两个参数显式传入时才判定。本轮默认不传 —— 先出数，不设门禁。
// ---------------------------------------------------------------------------
const failures = [];
const check = (name, max, key) => {
  if (max === null) return;
  if (Number.isNaN(max)) {
    console.error(`[coverage] --max-${key} 需要一个数字，收到：${flag(`--max-${key}`)}`);
    process.exit(2);
  }
  const c = { total: rows.reduce((s, r) => s + r[key === "lines" ? "lines" : "functions"].total, 0), covered: rows.reduce((s, r) => s + r[key === "lines" ? "lines" : "functions"].covered, 0) };
  const actual = ratio(c);
  if (actual < max) failures.push(`${name} ${pct(actual)} < 阈值 ${pct(max)}`);
};
check("lines", maxLines, "lines");
check("functions", maxFunctions, "functions");

if (failures.length > 0) {
  console.error(`\n[coverage] 未达阈值：\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
if (!jsonMode && maxLines === null && maxFunctions === null) {
  console.log("\n[coverage] 本轮未传阈值 —— 只出数，不判定通过/失败。");
}
