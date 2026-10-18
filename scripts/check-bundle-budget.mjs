#!/usr/bin/env node
/**
 * 首屏 JS 预算检查（零依赖）。
 *
 * 为什么不用 Lighthouse CI：Lighthouse 需要一个跑起来的服务 + Chrome，
 * 在容器化 CI 里既慢又容易因为网络/字体波动产生假红灯。而「首屏 JS 变大」
 * 这件事完全可以在构建产物上静态判定 —— 它也是我们真正想守住的那条线。
 *
 * 口径（与 docs/UPGRADE-PROPOSAL-2026-10-18.md 一致）：
 *   - 只统计路由的 **初始** chunk：`app-build-manifest.json` 里该路由的 chunk
 *     列表，减去 `react-loadable-manifest.json` 里的异步 chunk；
 *   - 不含 Next 的 framework/main（它们由 HTML 直接注入，不在路由 manifest 内），
 *     也不含只对旧浏览器下发的 polyfills；
 *   - 数值为未压缩字节数（gzip 后约为 1/3）。
 *
 * 用法：
 *   node scripts/check-bundle-budget.mjs            # 用默认预算
 *   node scripts/check-bundle-budget.mjs --json     # 只输出 JSON（供 CI 采集）
 *   NEXT_DIST_DIR=.next-verify node scripts/...     # 指定构建目录
 *
 * 预算来源：`scripts/bundle-budget.json`。改预算必须同时更新提案文档里的目标值，
 * 否则「预算」会变成给现状背书的数字。
 */
import { readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const distDir = process.env.NEXT_DIST_DIR ?? ".next";
const root = process.cwd();
const appDir = join(root, "apps", "web", distDir);
const manifestPath = join(appDir, "app-build-manifest.json");
const budgetPath = join(root, "scripts", "bundle-budget.json");

if (!existsSync(manifestPath)) {
  console.error(`[bundle] 找不到构建产物：${manifestPath}`);
  console.error("[bundle] 先跑 `NEXT_DIST_DIR=" + distDir + " pnpm --filter navsphere build`");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const loadablePath = join(appDir, "react-loadable-manifest.json");
const loadable = existsSync(loadablePath) ? JSON.parse(readFileSync(loadablePath, "utf8")) : {};

const asyncChunks = new Set();
for (const key of Object.keys(loadable)) {
  for (const f of loadable[key].files ?? []) asyncChunks.add(f);
}

const budgets = existsSync(budgetPath)
  ? JSON.parse(readFileSync(budgetPath, "utf8"))
  : { default: 700 * 1024, routes: {} };

function initialBytes(files) {
  let total = 0;
  for (const f of files) {
    if (asyncChunks.has(f)) continue;
    try {
      total += statSync(join(appDir, f)).size;
    } catch {
      // 缺失文件不致命：构建产物可能被裁剪
    }
  }
  return total;
}

const rows = [];
for (const [route, files] of Object.entries(manifest.pages ?? {})) {
  // 只看页面路由，跳过 layout 与纯 API
  if (!route.endsWith("/page")) continue;
  const url = route.replace(/^\/app/, "").replace(/\/page$/, "") || "/";
  rows.push({ route: url, bytes: initialBytes(files) });
}
rows.sort((a, b) => b.bytes - a.bytes);

const kb = (n) => (n / 1024).toFixed(0) + " KB";
const violations = [];
for (const r of rows) {
  const limit = budgets.routes?.[r.route] ?? budgets.default;
  if (r.bytes > limit) violations.push({ ...r, limit });
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ distDir, routes: rows, violations }, null, 2));
} else {
  console.log(`[bundle] 构建目录：apps/web/${distDir}（未压缩字节）`);
  for (const r of rows.slice(0, 10)) {
    const limit = budgets.routes?.[r.route] ?? budgets.default;
    const flag = r.bytes > limit ? "✗" : "✓";
    console.log(`  ${flag} ${kb(r.bytes).padStart(8)}  ${r.route}  (预算 ${kb(limit)})`);
  }
  if (rows.length > 10) console.log(`  … 其余 ${rows.length - 10} 条路由见 --json`);
}

if (violations.length > 0) {
  console.error(`\n[bundle] ${violations.length} 条路由超出预算：`);
  for (const v of violations) console.error(`  - ${v.route}: ${kb(v.bytes)} > ${kb(v.limit)}`);
  process.exit(1);
}
console.log("[bundle] 全部路由在预算内");
