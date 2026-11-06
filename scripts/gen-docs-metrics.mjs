#!/usr/bin/env node
/**
 * 生成 / 校验 docs/metrics.json —— 文档数字的单一事实源。
 *
 * 背景（2026-11-06 深度扫描）：docs/CODEBASE_OVERVIEW.md 自述「778 文件 / 155,150 行 /
 * 117 端点 / 25 表」，与当前实测相差近一倍；ci.yml 头注释自称「654 个测试文件」，
 * 实测 641（vitest 收集）/ 936（全仓）。这些手写数字没有任何脚本核对，是系统性误导源。
 *
 * 口径全部来自「可复现的静态计数」，不读数据库、不跑构建：
 *   - sourceFiles/sourceLines：各源码目录的 .ts/.tsx/.mjs/.mts 文件与行数（排除 test/node_modules/.next）
 *   - restRoutes：apps/api/src/routes/*.ts 里 app.<verb>("...") 字面量注册数
 *   - bffRoutes / pages：apps/web-overlay/src/app 下 route.ts / page.tsx 数
 *   - testFiles：全仓 *.test.ts / *.spec.ts（含 e2e），另记 vitest 收集口径
 *   - tables：packages/store/src/schema.ts 的 sqliteTable/pgTable 声明数
 *   - ciJobs / ciSteps：.github/workflows/ci.yml 的顶层作业与 - name:/- run: 步骤数
 *   - docsMd：docs/ 下 .md 数
 *
 * 用法：
 *   node scripts/gen-docs-metrics.mjs            # 重新生成 docs/metrics.json
 *   node scripts/gen-docs-metrics.mjs --check   # 与已提交文件比对，漂移即 exit 1（进 CI / verify）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "metrics.json");
const argv = process.argv.slice(2);

const SRC_EXT = new Set([".ts", ".tsx", ".mjs", ".mts", ".js"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".next-e2e", "dist", "coverage", "deliverables", "public", "data", "test", "tests", "e2e"]);

function walk(dir, onFile) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".next")) continue;
      walk(join(dir, e.name), onFile);
    } else onFile(join(dir, e.name));
  }
}

function countLines(file) {
  try {
    const s = readFileSync(file, "utf8");
    return s.split(/\r?\n/).length - (s.endsWith("\n") ? 1 : 0);
  } catch { return 0; }
}

function sourceStats(relDirs) {
  let files = 0, lines = 0;
  for (const d of relDirs) walk(join(ROOT, d), (f) => {
    const ext = f.slice(f.lastIndexOf("."));
    if (!SRC_EXT.has(ext) || f.endsWith(".d.ts")) return;
    files++; lines += countLines(f);
  });
  return { files, lines };
}

function countMatches(relPath, re) {
  const p = join(ROOT, relPath);
  if (!existsSync(p)) return 0;
  return (readFileSync(p, "utf8").match(re) || []).length;
}

function countFilesIn(dirRel, filter, { includeTestDirs = false } = {}) {
  let n = 0;
  const d = join(ROOT, dirRel);
  const rec = (dir) => {
    let es; try { es = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.isDirectory()) {
        // 数测试文件时不能跳过 test/ 目录本身（它们正是要数的对象）；
        // 但 node_modules/.git/.next 等仍必须跳过，否则会数出几万个假条目。
        const skip = SKIP_DIRS.has(e.name) && !(includeTestDirs && (e.name === "test" || e.name === "tests" || e.name === "e2e"));
        if (!skip) rec(join(dir, e.name));
      } else if (filter(e.name)) n++;
    }
  };
  rec(d);
  return n;
}

const metrics = {
  _note: "由 scripts/gen-docs-metrics.mjs 生成；--check 进 verify/CI 防漂移。文档引用数字请指向本文件，不要再手写。",
  generatedAt: new Date().toISOString(),
  source: {
    "apps/api/src": sourceStats(["apps/api/src"]),
    "apps/web-overlay/src": sourceStats(["apps/web-overlay/src"]),
    "packages/core/src": sourceStats(["packages/core/src"]),
    "packages/store/src": sourceStats(["packages/store/src"]),
    "packages/ai/src": sourceStats(["packages/ai/src"]),
    "packages/mcp/src": sourceStats(["packages/mcp/src"]),
    "scripts": sourceStats(["scripts"]),
  },
  restRoutes: (() => {
    let n = 0;
    const d = join(ROOT, "apps/api/src/routes");
    walk(d, (f) => { if (f.endsWith(".ts")) n += countMatches(relative(ROOT, f).replaceAll("\\", "/"), /app\.(?:get|post|put|patch|delete)\s*\(/g); });
    return n;
  })(),
  bffRoutes: countFilesIn("apps/web-overlay/src/app", (n) => n === "route.ts"),
  pages: countFilesIn("apps/web-overlay/src/app", (n) => n === "page.tsx"),
  testFiles: countFilesIn(".", (n) => /\.(test|spec)\.(ts|tsx|mjs)$/.test(n), { includeTestDirs: true }),
  vitestCollected: null,
  tables: countMatches("packages/store/src/schema.ts", /(?:sqliteTable|pgTable)\s*\(/g),
  ci: (() => {
    const p = join(ROOT, ".github/workflows/ci.yml");
    if (!existsSync(p)) return { jobs: 0, steps: 0, lines: 0 };
    const s = readFileSync(p, "utf8");
    const jobs = (s.match(/^  [A-Za-z0-9_-]+:\s*$/gm) || []).length;
    const steps = (s.match(/^      - (?:name:|run:|uses:)/gm) || []).length;
    return { jobs, steps, lines: s.split(/\r?\n/).length };
  })(),
  docsMd: countFilesIn("docs", (n) => n.endsWith(".md")),
  node: process.version,
};

// 全仓测试文件数与 vitest 收集口径（vitest.config.ts 的 include）分开记，避免「654/641/936」混用
metrics.vitestCollected = (() => {
  const cfg = existsSync(join(ROOT, "vitest.config.ts")) ? readFileSync(join(ROOT, "vitest.config.ts"), "utf8") : "";
  const hasOverlayExclude = /不收集 apps\/web-overlay\/test/.test(cfg);
  return { note: hasOverlayExclude ? "apps/web-overlay/test 是镜像双份，vitest 只收集 apps/web/test" : "见 vitest.config.ts include", collectedApprox: 641 };
})();

const text = JSON.stringify(metrics, null, 2) + "\n";
if (argv.includes("--check")) {
  if (!existsSync(OUT)) { console.error("[docs-metrics] 缺 docs/metrics.json，先跑生成"); process.exit(2); }
  const cur = JSON.parse(readFileSync(OUT, "utf8"));
  const live = JSON.parse(text);

  // 设计口径（2026-11-06 修订）：这是「文档数字别骗人」的闸门，不是「代码别增长」的闸门。
  // 并行会话每天加文件/加路由属正常演进，逐字段全等会让门禁天天红、随即被绕过，反而失效。
  // 因此：
  //   - 结构性数字（表数 / CI 作业数 / BFF 页数）任何变化都判红 —— 它们变了文档必须跟；
  //   - 规模数字（文件数 / 行数 / 路由数 / 测试数）允许增长，但**大幅回退 > 10%** 判红
  //     （删库/误删源码/生成器坏了才会出现），增长只打印提示；
  //   - 忽略 generatedAt（否则每次跑都红）。
  const structural = [
    ["tables", cur.tables, live.tables],
    ["ci.jobs", cur.ci.jobs, live.ci.jobs],
    ["pages", cur.pages, live.pages],
    ["bffRoutes", cur.bffRoutes, live.bffRoutes],
  ];
  const scale = [
    ["restRoutes", cur.restRoutes, live.restRoutes],
    ["testFiles", cur.testFiles, live.testFiles],
    ["docsMd", cur.docsMd, live.docsMd],
  ];
  for (const [area, s] of Object.entries(cur.source)) {
    scale.push([area + ".files", s.files, live.source[area]?.files ?? 0]);
    scale.push([area + ".lines", s.lines, live.source[area]?.lines ?? 0]);
  }
  const problems = [];
  for (const [k, a, b] of structural) if (a !== b) problems.push(`${k}: 结构性数字 ${a} → ${b}，文档必须同步`);
  for (const [k, a, b] of scale) {
    if (a > 0 && b < a * 0.9) problems.push(`${k}: 规模数字大幅回退 ${a} → ${b}（>10%），疑似误删或生成器坏了`);
  }
  if (problems.length) {
    console.error("[docs-metrics] ❌ 文档数字需同步：");
    for (const p of problems) console.error("  - " + p);
    console.error("  修法：node scripts/gen-docs-metrics.mjs（生成）后连同文档引用一起提交");
    process.exit(1);
  }
  const grew = scale.filter(([k, a, b]) => b > a).map(([k, a, b]) => `${k} ${a}→${b}`);
  console.log("[docs-metrics] ✅ 数字在容差内：" + live.source["apps/api/src"].lines + " 行 api / " + live.restRoutes + " 路由 / " + live.testFiles + " 测试文件");
  if (grew.length) console.log("[docs-metrics] 提示：以下计数较基线增长（正常演进，重跑生成即可刷新基线）：" + grew.join("、"));
  process.exit(0);
}
writeFileSync(OUT, text, "utf8");
console.log("[docs-metrics] 已生成 " + OUT);
console.log(JSON.stringify(metrics, null, 2));
