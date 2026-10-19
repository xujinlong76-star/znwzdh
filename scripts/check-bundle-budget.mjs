#!/usr/bin/env node
/**
 * 首屏 JS 预算检查（零依赖）。
 *
 * 为什么不用 Lighthouse CI：Lighthouse 需要一个跑起来的服务 + Chrome，
 * 在容器化 CI 里既慢又容易因为网络/字体波动产生假红灯。而「首屏 JS 变大」
 * 这件事完全可以在构建产物上静态判定 —— 它也是我们真正想守住的那条线。
 *
 * 口径（与 docs/UPGRADE-PROPOSAL-2026-10-18.md 一致）：
 *   - 只统计路由的 **初始** chunk（浏览器打开该路由就要下载执行的 JS），
 *     扣除异步 chunk 与只对旧浏览器下发的 polyfills；
 *   - 数值为未压缩字节数（gzip 后约为 1/3）。
 *
 * 两种构建产物的取数方式（Next 16 起 Turbopack 是唯一打包器，产物结构全变）：
 *
 *   A. webpack（Next ≤15，历史兼容）：
 *      app-build-manifest.json 里该路由的 chunk 列表（注意：webpack 会把
 *      framework chunk 一并列进去，所以旧基线数字是**含 React 运行时**的），
 *      减去 react-loadable-manifest.json 里的异步 chunk。
 *
 *   B. Turbopack（Next 16）：
 *      - build-manifest.json 的 rootMainFiles：框架运行时（React/ReactDOM/
 *        Next bootstrap/Turbopack runtime），HTML 直接注入，每个路由都要加载
 *        ——对应 A 里被 webpack 列进 manifest 的 framework chunk，**必须计入**，
 *        否则与旧基线（含 ~344KB React）不可比；
 *      - server/app/<路由>/page_client-reference-manifest.js：该路由客户端
 *        组件树用到的 chunk（含 app-router 外壳与各 vendor 库）；
 *      - server/app/<路由>/react-loadable-manifest.json：该路由的异步 chunk，扣除。
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
const budgetPath = join(root, "scripts", "bundle-budget.json");

const budgets = existsSync(budgetPath)
  ? JSON.parse(readFileSync(budgetPath, "utf8"))
  : { default: 700 * 1024, routes: {} };

const kb = (n) => (n / 1024).toFixed(0) + " KB";

/** 把 manifest 里的 URL 形 chunk 路径（/_next/static/...）转成磁盘相对路径 */
const toDisk = (f) => f.replace(/^\/_next\//, "");

function fileSize(rel) {
  try {
    return statSync(join(appDir, rel)).size;
  } catch {
    // 缺失文件不致命：构建产物可能被裁剪
    return 0;
  }
}

function sumBytes(files, skip) {
  let total = 0;
  for (const f of files) {
    const disk = toDisk(f);
    if (skip?.has(disk)) continue;
    total += fileSize(disk);
  }
  return total;
}

// ---------------------------------------------------------------------------
// 取数：两种产物结构
// ---------------------------------------------------------------------------

/** webpack（Next ≤15）：app-build-manifest + 全局 react-loadable-manifest */
function collectWebpack() {
  const manifestPath = join(appDir, "app-build-manifest.json");
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const loadablePath = join(appDir, "react-loadable-manifest.json");
  const loadable = existsSync(loadablePath)
    ? JSON.parse(readFileSync(loadablePath, "utf8"))
    : {};
  const asyncChunks = new Set();
  for (const key of Object.keys(loadable)) {
    for (const f of loadable[key].files ?? []) asyncChunks.add(toDisk(f));
  }
  const rows = [];
  for (const [route, files] of Object.entries(manifest.pages ?? {})) {
    if (!route.endsWith("/page")) continue;
    const url = route.replace(/^\/app/, "").replace(/\/page$/, "") || "/";
    rows.push({ route: url, bytes: sumBytes(files, asyncChunks) });
  }
  return { bundler: "webpack", rows };
}

/**
 * Turbopack（Next 16）：rootMainFiles（框架）+ 逐路由 client-reference-manifest
 * − 逐路由 react-loadable-manifest（异步）。
 * 路由清单取 build-manifest.json 的 pagesChunkGroupBootstrapParams
 * （Turbopack 已不再产出逐路由的 app-build-manifest.json）。
 */
function collectTurbopack() {
  const manifestPath = join(appDir, "build-manifest.json");
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  // 框架运行时：HTML 直注，每个路由必载（对应 webpack 时代 manifest 内的 framework chunk）
  const framework = (manifest.rootMainFiles ?? []).map(toDisk);

  const loadRscManifest = (routeKey, rel) => {
    const p = join(appDir, "server", "app", rel, "page_client-reference-manifest.js");
    if (!existsSync(p)) return null;
    // 该文件是 `globalThis.__RSC_MANIFEST["/route/page"] = {...}` 赋值脚本，
    // 用 new Function 求值后取回对应路由（CLI 一次性进程，不担心全局污染）。
    const src = readFileSync(p, "utf8");
    const factory = new Function(
      `${src}\nreturn globalThis.__RSC_MANIFEST && globalThis.__RSC_MANIFEST[${JSON.stringify(routeKey)}];`,
    );
    return factory();
  };

  const loadAsyncChunks = (rel) => {
    const p = join(appDir, "server", "app", rel, "react-loadable-manifest.json");
    if (!existsSync(p)) return new Set();
    const j = JSON.parse(readFileSync(p, "utf8"));
    const set = new Set();
    for (const v of Object.values(j)) {
      for (const f of v?.files ?? []) set.add(toDisk(f));
    }
    return set;
  };

  const rows = [];
  for (const routeKey of Object.keys(manifest.pagesChunkGroupBootstrapParams ?? {})) {
    if (!routeKey.endsWith("/page")) continue;
    // '/hot/page' -> 'hot'；'/page'（首页）-> ''（manifest 就在 server/app/ 下）
    const rel = routeKey === "/page" ? "" : routeKey.slice(1, -"/page".length);
    const url = routeKey.replace(/^\/app/, "").replace(/\/page$/, "") || "/";

    const asyncChunks = loadAsyncChunks(rel);
    const chunks = new Set(framework);
    const man = loadRscManifest(routeKey, rel);
    if (man) {
      for (const info of Object.values(man.clientModules ?? {})) {
        if (info.async) continue;
        for (const c of info.chunks ?? []) chunks.add(toDisk(c));
      }
    }
    rows.push({ route: url, bytes: sumBytes([...chunks], asyncChunks) });
  }
  return { bundler: "turbopack", rows };
}

// ---------------------------------------------------------------------------

const collected = collectTurbopack() ?? collectWebpack();
if (!collected) {
  console.error(`[bundle] 找不到构建产物：${join(appDir, "build-manifest.json")}`);
  console.error("[bundle] 先跑 `NEXT_DIST_DIR=" + distDir + " pnpm --filter navsphere build`");
  process.exit(2);
}
const rows = collected.rows;
rows.sort((a, b) => b.bytes - a.bytes);

const violations = [];
for (const r of rows) {
  const limit = budgets.routes?.[r.route] ?? budgets.default;
  if (r.bytes > limit) violations.push({ ...r, limit });
}

const jsonMode = process.argv.includes("--json");
if (jsonMode) {
  console.log(JSON.stringify({ distDir, bundler: collected.bundler, routes: rows, violations }, null, 2));
} else {
  console.log(`[bundle] 构建目录：apps/web/${distDir}（打包器 ${collected.bundler}，未压缩字节）`);
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
if (!jsonMode) console.log("[bundle] 全部路由在预算内");
