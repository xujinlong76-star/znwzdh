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
 *   node scripts/check-bundle-budget.mjs            # 用默认预算（门禁）
 *   node scripts/check-bundle-budget.mjs --json     # 只输出 JSON（供 CI 采集）
 *   node scripts/check-bundle-budget.mjs --report   # 只读：从真实产物算建议基线 + 逐路由差异
 *   node scripts/check-bundle-budget.mjs --raise --reason="为什么必须上调"
 *     把 --report 的「上调候选 + 漏配专属预算」写进 bundle-budget.json。
 *   NEXT_DIST_DIR=.next-verify node scripts/...     # 指定构建目录
 *
 * 预算来源：`scripts/bundle-budget.json`。改预算必须同时更新提案文档里的目标值，
 * 否则「预算」会变成给现状背书的数字。
 *
 * 为什么 --raise 要卡「提交可定位 + 工作区干净 + 产物不过期」三条：预算是给未来
 * 提交定的线，而 CI 只认提交。拿未提交的工作区产物定基线，等于把「本地恰好绿」写进
 * 契约——下一轮 CI 照样红，且没人能复现那个数字是哪棵树产出来的。三条里任何一条
 * 不满足都以退出码 2 拒绝写入，并把缺的那条说清楚（这是刻意设计的不方便）。
 */
import { readFileSync, statSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const distDir = process.env.NEXT_DIST_DIR ?? ".next";
const root = process.cwd();
const appDir = join(root, "apps", "web", distDir);
const budgetPath = join(root, "scripts", "bundle-budget.json");

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);
/** `--reason=x` 与 `--reason x` 都认；缺值返回空串，由调用方判定 */
function flagValue(name) {
  const eq = argv.find((a) => a.startsWith(name + "="));
  if (eq !== undefined) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  const next = i >= 0 ? argv[i + 1] : undefined;
  return next !== undefined && !next.startsWith("--") ? next : "";
}
const KNOWN_FLAGS = ["--json", "--report", "--raise", "--reason"];
/** 拼错的旗标不能静默当成门禁跑：那会让人以为 `--rai` 生效了，其实写进去的是老口径 */
for (const a of argv) {
  if (a.startsWith("--") && !KNOWN_FLAGS.some((f) => a === f || a.startsWith(f + "="))) {
    console.error(`[bundle] 不认识的参数：${a}（可用：--json / --report / --raise / --reason=）`);
    process.exit(2);
  }
}


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
// 定基线用的三件事：这份数属于哪棵树、过没过期、建议值怎么算
// ---------------------------------------------------------------------------

/** git 只读查询；仓库外或 git 不可用返回 null，让调用方按「无法定位」处理 */
function gitOut(args) {
  const res = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return res.status === 0 ? res.stdout : null;
}

/**
 * 产物的出处 = sha + 工作区脏文件数。
 * 多会话并行时「这份 .next 是哪棵树产的」直接决定建议基线能不能复现，
 * 所以它必须和字节数一起报出来，而不是让人自己猜。
 */
function treeProvenance() {
  const head = gitOut(["rev-parse", "--short", "HEAD"]);
  if (head === null) return { sha: null, dirty: null };
  const status = gitOut(["status", "--porcelain"]);
  return {
    sha: head.trim() || null,
    dirty: status === null ? null : status.split("\n").filter((l) => l.trim() !== "").length,
  };
}

/** 构建产物的时间：取本次实际命中的那份 manifest（缺失返回 null，不猜） */
function builtAtMs(bundler) {
  const p = join(appDir, bundler === "webpack" ? "app-build-manifest.json" : "build-manifest.json");
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null; // 产物刚被别的任务清掉：调用方按「过期判定不可用」处理
  }
}

/**
 * 源码侧最新 mtime：只走取数真正依赖的那两棵树 + 两个 package.json + 预算文件本身。
 * 不做全仓扫描——「产物比源码旧」这条判定要的是「重跑 build 会不会得到不同的数」，
 * README 改一次不该让人以为基线不可信。
 */
function newestSourceMs() {
  let max = 0;
  const touch = (p) => {
    try {
      const m = statSync(p).mtimeMs;
      if (m > max) max = m;
    } catch {
      // 目录/文件不存在（例如 fixture 里没有 packages/core）：跳过，不是错误
    }
  };
  const walk = (dir, depth) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (depth > 0) walk(p, depth - 1);
        continue;
      }
      touch(p);
    }
  };
  walk(join(root, "apps", "web", "src"), 12);
  walk(join(root, "packages", "core", "src"), 12);
  touch(join(root, "apps", "web", "package.json"));
  touch(join(root, "packages", "core", "package.json"));
  touch(budgetPath);
  return max;
}

const HEADROOM = 1.05;
const kibUp = (n) => Math.ceil(n / 1024) * 1024;
/** 建议阈值口径与文件里历史棘轮一致：实测 ×1.05，向上取整到 KiB */
const proposedLimit = (bytes) => kibUp(bytes * HEADROOM);

/**
 * 逐路由差异，三类各自处理：
 *   - raise：实测超预算，必须显式 --raise 才写；
 *   - addMissing：没配专属预算、正落 default。给它补一条**更紧**的专属阈值
 *     （比 default 松的那些直接排除，否则「补条目」会变成变相上调 default）；
 *   - tighten：实测比预算低 5% 以上。这是收紧，属于人工棘轮的决定，这里只报不写。
 */
function diffBudgets(rows, budgets) {
  const raise = [];
  const addMissing = [];
  const tighten = [];
  for (const r of rows) {
    const listed = Object.hasOwn(budgets.routes ?? {}, r.route);
    const limit = listed ? budgets.routes[r.route] : budgets.default;
    const proposed = proposedLimit(r.bytes);
    if (r.bytes > limit) raise.push({ route: r.route, bytes: r.bytes, limit, proposed, listed });
    else if (!listed) {
      if (proposed < limit) addMissing.push({ route: r.route, bytes: r.bytes, limit, proposed });
    } else if (proposed < limit) tighten.push({ route: r.route, bytes: r.bytes, limit, proposed });
  }
  return { raise, addMissing, tighten };
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

const jsonMode = hasFlag("--json");
const reportMode = hasFlag("--report");
const raiseMode = hasFlag("--raise");
const iso = (ms) => {
  if (ms === null) return "（未知）";
  // 刻意用本地时间：这行要和 `ls -l`、资源管理器里的产物时间对得上，
  // 打印 UTC 会让人以为「构建比源码新」的判断差了 8 小时
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 可追溯性一行 + 过期判定；两条模式都要打印，报告不报出处就等于没跑 */
function provenanceLines() {
  const prov = treeProvenance();
  const built = builtAtMs(collected.bundler);
  const source = newestSourceMs();
  const stale = built !== null && source > built;
  const lines = [
    `[bundle] 产物出处：提交 ${prov.sha ?? "（不在 git 仓库里，无法定位）"} · 工作区${
      prov.dirty === null ? "状态未知" : prov.dirty === 0 ? "干净" : `脏 ${prov.dirty} 个文件`
    } · 构建时间 ${iso(built)}`,
  ];
  if (stale) {
    lines.push(
      `[bundle] ⚠️ 产物比源码旧（最新源文件 ${iso(source)}）：这份数不是当前树产出来的，别拿它定基线，先重跑 build`,
    );
  }
  return { prov, built, source, stale, lines };
}

/** 只读报告：永远退出码 0（哪怕有超限），因为它不是门禁，是给人看「建议基线长什么样」 */
function runReport(meta) {
  const d = diffBudgets(rows, budgets);
  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          distDir,
          bundler: collected.bundler,
          mode: "report",
          provenance: { sha: meta.prov.sha, dirty: meta.prov.dirty, builtAt: meta.built, newestSourceAt: meta.source, stale: meta.stale },
          routes: rows,
          violations,
          report: d,
          headroom: HEADROOM,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(`[bundle] 建议基线（只读，不写文件）：apps/web/${distDir}，打包器 ${collected.bundler}`);
  for (const l of meta.lines) console.log(l);
  const section = (title, items, fmt) => {
    console.log(`\n${title}（${items.length} 条）`);
    if (items.length === 0) console.log("  无");
    for (const item of items) console.log(fmt(item));
  };
  section(
    "上调候选（实测超预算，需要显式 --raise）",
    d.raise,
    (x) => `  - ${x.route}：实测 ${kb(x.bytes)} > 预算 ${kb(x.limit)} → 建议 ${kb(x.proposed)}`,
  );
  section(
    "漏配专属预算（正落 default，建议补一条更紧的阈值）",
    d.addMissing,
    (x) => `  - ${x.route}：实测 ${kb(x.bytes)}，无 routes 条目（default ${kb(x.limit)}）→ 建议 ${kb(x.proposed)}`,
  );
  section(
    "可下调（实测比预算低 5% 以上；棘轮只降不升，这条要人工决定）",
    d.tighten,
    (x) => `  - ${x.route}：实测 ${kb(x.bytes)}，预算 ${kb(x.limit)} → 可收到 ${kb(x.proposed)}`,
  );
  console.log(
    d.raise.length > 0
      ? `\n下一步：提交当前改动 → 重新 build → node scripts/check-bundle-budget.mjs --raise --reason="为什么必须上调"`
      : `\n下一步：没有需要上调的路由；补条目与收紧请按上面的数字手改 bundle-budget.json（一次一批，别和代码改动混在一个提交里）`,
  );
}

/**
 * 写预算。三条硬前置（提交可定位 / 工作区干净 / 产物不过期）任一不满足就退出码 2：
 * 预算是给未来提交定的线，CI 只认提交，拿本地恰好绿的产物定基线等于把不可复现的数字
 * 写进契约。「不允许为了过门禁上调」这条规矩，靠的就是这里的不方便。
 */
function runRaise(meta) {
  const refuse = (msg) => {
    console.error(`[bundle] --raise 拒绝写入：${msg}`);
    process.exit(2);
  };
  const reason = flagValue("--reason");
  if (reason === "") refuse('必须带 --reason="..."：没写明原因的上调一律不认');
  if (meta.prov.sha === null) refuse("当前目录不在 git 仓库里，无法把这份数钉到某个提交");
  if (meta.prov.dirty === null) refuse("git status 查询失败，无法确认工作区干净");
  if (meta.prov.dirty > 0) {
    refuse(
      `工作区有 ${meta.prov.dirty} 个未提交改动，这份产物不是提交 ${meta.prov.sha} 做出来的。` +
        "先提交代码改动、再重新 build，然后才谈得上可复现的基线",
    );
  }
  if (meta.built === null) refuse("拿不到构建产物的时间戳，无法判断它是否过期");
  if (meta.stale) refuse(`构建产物比源码旧（产物 ${iso(meta.built)}，最新源文件 ${iso(meta.source)}）：先重跑 build`);

  const d = diffBudgets(rows, budgets);
  if (d.raise.length === 0 && d.addMissing.length === 0) {
    console.log("[bundle] 没有需要上调或补条目的路由，预算文件未改动");
    return;
  }
  const changes = [...d.raise, ...d.addMissing];
  const next = { ...budgets, routes: { ...(budgets.routes ?? {}) } };
  for (const c of changes) next.routes[c.route] = c.proposed;
  const stamp = new Date().toISOString();
  next._raise_log = [
    {
      at: stamp,
      sha: meta.prov.sha,
      distDir,
      bundler: collected.bundler,
      // 审计记录存 UTC：展示用本地时间（和 ls 对得上），落档要无歧义
      builtAt: meta.built === null ? null : new Date(meta.built).toISOString(),
      reason,
      changes: changes.map((c) => ({ route: c.route, from: c.limit, to: c.proposed, measured: c.bytes })),
    },
    ...(Array.isArray(budgets._raise_log) ? budgets._raise_log : []),
  ];
  const text = JSON.stringify(next, null, 2) + "\n";
  writeFileSync(budgetPath, text);

  // 写完立刻读回比对：写坏一个数就等于把门禁改松了，必须当场发现而不是留给 CI
  const back = JSON.parse(readFileSync(budgetPath, "utf8"));
  const mismatch = changes.filter((c) => back.routes[c.route] !== c.proposed);
  if (mismatch.length > 0) {
    console.error(`[bundle] 写入后校验失败，预算文件可能被并发任务改过：${mismatch.map((c) => c.route).join(", ")}`);
    console.error("[bundle] 请用 git diff 检查 scripts/bundle-budget.json 后再重跑");
    process.exit(2);
  }
  console.log(`[bundle] 已写入 scripts/bundle-budget.json（上调 ${d.raise.length} 条 · 补条目 ${d.addMissing.length} 条）`);
  for (const c of changes) console.log(`  - ${c.route}: ${kb(c.limit)} → ${kb(c.proposed)}（实测 ${kb(c.bytes)}）`);
  console.log(`  审计行 _raise_log[0]：@${meta.prov.sha} · reason="${reason}" · 构建时间 ${iso(meta.built)}`);
  console.log("[bundle] 这条改动要单独提交（不与代码改动混提），CI 会用同一份文件复测");
}

if (reportMode && raiseMode) {
  console.error("[bundle] --report 与 --raise 不能同时给：--raise 会自己重算建议值，不需要 --report");
  process.exit(2);
}
if (reportMode) {
  runReport(provenanceLines());
} else if (raiseMode) {
  runRaise(provenanceLines());
} else if (jsonMode) {
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

// violations 是按「写入前的预算」算的：--raise 成功后再报一遍超限，等于自己否定刚写的基线
if (violations.length > 0 && !reportMode && !raiseMode) {
  console.error(`\n[bundle] ${violations.length} 条路由超出预算：`);
  for (const v of violations) console.error(`  - ${v.route}: ${kb(v.bytes)} > ${kb(v.limit)}`);
  console.error("[bundle] 先看只读建议：node scripts/check-bundle-budget.mjs --report（超了先优化，确需上调再 --raise --reason=）");
  process.exit(1);
}
if (!jsonMode && !reportMode && !raiseMode) console.log("[bundle] 全部路由在预算内");

