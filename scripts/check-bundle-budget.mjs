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
 * 为什么 --raise 要卡「提交可定位 + 首屏源码干净 + 产物不过期」三条：预算是给未来
 * 提交定的线，而 CI 只认提交。拿未提交的工作区产物定基线，等于把「本地恰好绿」写进
 * 契约——下一轮 CI 照样红，且没人能复现那个数字是哪棵树产出来的。三条里任何一条
 * 不满足都以退出码 2 拒绝写入，并把缺的那条说清楚（这是刻意设计的不方便）。
 *
 * 「首屏源码干净」而不是「工作区干净」：本仓库是多会话共用的同一个工作区，实测
 * 一次提交期就有 287 个脏文件，其中只有约 77 个落在能改变首屏产物的路径里。用全仓
 * 计数当判据的后果不是更安全，而是 --raise 在这里永远不可用——一条永远满足不了的
 * 前置等于没有前置，人最终会绕过它手改预算文件，把这条线真正的规矩（必须写明原因、
 * 必须来自真实产物）一起丢掉。所以判据按 BUNDLE_SOURCE_PATHS 收窄，其余脏文件照样
 * 报数，只是不挡路。
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
const KNOWN_FLAGS = ["--json", "--report", "--raise", "--reason", "--from"];
const fromGiven = hasFlag("--from") || argv.some((a) => a.startsWith("--from="));
/** 拼错的旗标不能静默当成门禁跑：那会让人以为 `--rai` 生效了，其实写进去的是老口径 */
for (const a of argv) {
  if (a.startsWith("--") && !KNOWN_FLAGS.some((f) => a === f || a.startsWith(f + "="))) {
    console.error(`[bundle] 不认识的参数：${a}（可用：--json / --report / --raise / --reason= / --from=）`);
    process.exit(2);
  }
}
if (fromGiven && !hasFlag("--raise")) {
  console.error("[bundle] --from 只和 --raise 搭配：它提供的是要写进预算的数字，报告模式请直接跑 --report");
  process.exit(2);
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

/**
 * 能改变首屏产物的路径集。判据只有两条：会不会进入 web 的构建输入、会不会换掉依赖版本。
 *   - apps/web/src        Next 的 app 路由树（少一个文件就多一条路由，路由集会变）；
 *   - apps/web/next.config.js 打包配置（transpilePackages、实验开关直接影响 chunk）；
 *   - apps/web/package.json / packages/core/package.json 声明与入口解析；
 *   - apps/web-overlay/src 覆盖层事实源，build 前会被 apply 进 apps/web/src；
 *   - packages/core/src  纯算法（含镜像），前端直接 import；
 *   - pnpm-lock.yaml     锁住 React/Next 版本，版本一动首屏字节数就动。
 * 刻意排除：docs/、scripts/、tmp/、deliverables/、apps/api、packages/store 与
 * packages/ai（服务端与工具链，不参与浏览器首屏）。
 */
const BUNDLE_SOURCE_PATHS = [
  "apps/web/src",
  "apps/web/next.config.js",
  "apps/web/package.json",
  "apps/web-overlay/src",
  "packages/core/src",
  "packages/core/package.json",
  "pnpm-lock.yaml",
];

/** git 只读查询；仓库外或 git 不可用返回 null，让调用方按「无法定位」处理 */
function gitOut(args) {
  const res = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return res.status === 0 ? res.stdout : null;
}

/** 带 stdin 的批量 git 查询：脏文件可能几十个，逐个起子进程没人受得了 */
function gitIn(args, input) {
  const res = spawnSync("git", args, { cwd: root, encoding: "utf8", input, maxBuffer: 32 * 1024 * 1024 });
  return res.status === 0 ? res.stdout : null;
}

const MIRROR_PREFIX = "apps/web/src/";
const FACT_PREFIX = "apps/web-overlay/src/";

/**
 * apps/web/src/** 是 vendor-web 从 apps/web-overlay 逐文件覆写出来的派生镜像
 * （见 scripts/vendor-web.mjs：walkAndCopy(OVERLAY, TARGET)，「overlay always wins」）。
 * 于是 `--raise` 的「首屏源码干净」前置在 CI 里是**结构性不可能**：test-web 第 6 步就是
 * vendor-web，它必然重写这些镜像；只要 HEAD 里跟踪的镜像落后于已提交的事实源，
 * `git status` 就永远报脏。2026-10-28 实测 tip 1a21763 的账 bundleDirty=3，三条全是这一类
 * （videos/page.tsx、lib/github.ts、lib/storage-adapter.ts），没有一个来自人的未提交改动。
 *
 * 判据必须是「镜像的工作区内容 == HEAD 里对应事实源的 blob」，不能是路径白名单：
 * 白名单会把「有人手改派生文件」这类漂移一起放过，而那正是 check-web-overlay 要拦的东西。
 * 相等 → 这份脏不携带任何信息，产物仍可从提交完全复现；不等（含 HEAD 里根本没有事实源，
 * 即新文件直接落在 apps/web/src）→ 继续拦。
 */
/** 批量取 HEAD 里的 blob id；不存在的路径那一项为 null（不猜、也不让整批失败） */
function headBlobs(specs) {
  if (specs.length === 0) return [];
  const out = gitIn(["cat-file", "--batch-check=%(objectname) %(objecttype)"], specs.join("\n") + "\n");
  const lines = out === null ? [] : out.split("\n").filter((l) => l.trim() !== "");
  return specs.map((_, i) => {
    const [oid, type] = (lines[i] ?? "").split(" ");
    return type === "blob" ? oid : null;
  });
}

/** 这些镜像在 HEAD 里是否已与事实源同步：--from 判断「账是否还属于当前树」时要用 */
function mirrorsInSyncAtHead(paths) {
  const mirrors = paths.filter((p) => p.startsWith(MIRROR_PREFIX));
  if (mirrors.length === 0) return new Set();
  const at = headBlobs(mirrors.map((p) => "HEAD:" + p));
  const fact = headBlobs(mirrors.map((p) => "HEAD:" + FACT_PREFIX + p.slice(MIRROR_PREFIX.length)));
  const sync = new Set();
  mirrors.forEach((p, i) => {
    if (at[i] !== null && at[i] === fact[i]) sync.add(p);
  });
  return sync;
}

function partitionGeneratedMirrors(paths) {
  const others = paths.filter((p) => !p.startsWith(MIRROR_PREFIX));
  const mirrors = paths.filter((p) => p.startsWith(MIRROR_PREFIX));
  if (mirrors.length === 0) return { neutral: new Set(), handEdited: others };
  const wt = gitIn(["hash-object", "--stdin-paths"], mirrors.join("\n") + "\n");
  const wtLines = wt === null ? [] : wt.split("\n").filter((l) => l.trim() !== "");
  if (wtLines.length !== mirrors.length) return { neutral: new Set(), handEdited: [...others, ...mirrors] };
  const fact = headBlobs(mirrors.map((p) => "HEAD:" + FACT_PREFIX + p.slice(MIRROR_PREFIX.length)));
  const neutral = new Set();
  const unmatched = [];
  mirrors.forEach((p, i) => {
    if (fact[i] !== null && fact[i] === wtLines[i].trim()) neutral.add(p);
    else unmatched.push(p);
  });
  return { neutral, handEdited: [...others, ...unmatched] };
}

/**
 * 产物的出处 = sha + 工作区脏文件数（全仓计数与「能改变首屏的那部分」分开算）。
 * 多会话并行时「这份 .next 是哪棵树产的」直接决定建议基线能不能复现，
 * 所以它必须和字节数一起报出来，而不是让人自己猜。
 */
function treeProvenance() {
  const head = gitOut(["rev-parse", "--short", "HEAD"]);
  if (head === null) return { sha: null, dirty: null, bundleDirty: null, bundleDirtyPaths: [] };
  const count = (out) => (out === null ? null : out.split("\n").filter((l) => l.trim() !== "").length);
  const status = gitOut(["status", "--porcelain"]);
  // -uall：默认会把整目录折成一行，「脏 1 个」实际可能是 200 个文件。
  // 判据要点名到具体源文件，折行就没法说清"到底是哪几个改动挡住定基线"。
  const bundleStatus = gitOut(["status", "--porcelain", "--untracked-files=all", "--", ...BUNDLE_SOURCE_PATHS]);
  // porcelain 每行形如 ` M path` / `?? path/`；重命名是 `R  old -> new`，取新路径
  const bundleDirtyPaths =
    bundleStatus === null
      ? []
      : bundleStatus
          .split("\n")
          .filter((l) => l.trim() !== "")
          .map((l) => (l.includes(" -> ") ? l.slice(3).split(" -> ")[1] : l.slice(3).trim()));
  const { neutral, handEdited } = partitionGeneratedMirrors(bundleDirtyPaths);
  return {
    sha: head.trim() || null,
    dirty: count(status),
    bundleDirty: bundleStatus === null ? null : handEdited.length,
    bundleDirtyPaths: handEdited,
    // 单独立一项：中性化不等于看不见，报数照报，只是不挡路
    mirrorNeutral: bundleStatus === null ? 0 : neutral.size,
    mirrorNeutralPaths: [...neutral],
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
 * 源码侧最新 mtime：走 BUNDLE_SOURCE_PATHS 这一个集合。
 * 不做全仓扫描——「产物比源码旧」这条判定要的是「重跑 build 会不会得到不同的数」，
 * README 改一次不该让人以为基线不可信。
 *
 * 必须和脏树判据用**同一个集合**：两处口径不一致时，会出现「判据 A 点名这个文件挡路、
 * 判据 B 却说它影响不了产物」的自相矛盾，而覆盖层恰恰是最常被改的那部分。
 * 预算文件本身不在集合里——它改变的是阈值不是产物，写完预算不该把产物判成过期。
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
  const isDir = (p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
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
  for (const rel of BUNDLE_SOURCE_PATHS) {
    const abs = join(root, rel);
    if (isDir(abs)) walk(abs, 12);
    else touch(abs);
  }
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

const jsonMode = hasFlag("--json");
const reportMode = hasFlag("--report");
const raiseMode = hasFlag("--raise");

const collected = collectTurbopack() ?? collectWebpack();
if (!collected) {
  // --raise --from 要的数字是别处（CI）产的：本地没有 build 也得能定基线，
  // 否则「干净的树只存在于 CI」这条前提就和「先本地 build」自相矛盾了
  if (!(raiseMode && hasFlag("--from"))) {
    console.error(`[bundle] 找不到构建产物：${join(appDir, "build-manifest.json")}`);
    console.error("[bundle] 先跑 `NEXT_DIST_DIR=" + distDir + " pnpm --filter navsphere build`");
    process.exit(2);
  }
}
const rows = collected?.rows ?? [];
rows.sort((a, b) => b.bytes - a.bytes);

const violations = [];
for (const r of rows) {
  const limit = budgets.routes?.[r.route] ?? budgets.default;
  if (r.bytes > limit) violations.push({ ...r, limit });
}

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
  const built = collected === null ? null : builtAtMs(collected.bundler);
  const source = newestSourceMs();
  const stale = built !== null && source > built;
  const dirtyText =
    prov.dirty === null
      ? "工作区状态未知"
      : prov.bundleDirty === 0
        ? prov.dirty === 0
          ? "工作区干净"
          : `首屏源码干净（全仓另有 ${prov.dirty} 个与产物无关的改动）`
        : `首屏源码脏 ${prov.bundleDirty} 个文件（全仓 ${prov.dirty} 个）`;
  const lines = [
    `[bundle] 产物出处：提交 ${prov.sha ?? "（不在 git 仓库里，无法定位）"} · ${dirtyText} · 构建时间 ${iso(built)}`,
  ];
  if (prov.mirrorNeutral > 0) {
    lines.push(
      `[bundle] 其中 ${prov.mirrorNeutral} 个是 vendor-web 从已提交事实源重写的 apps/web 镜像` +
        `（内容 == HEAD 的 overlay blob，产物可完全复现）：照报，但不挡定基线`,
    );
  }
  if (prov.bundleDirty > 0) {
    const shown = prov.bundleDirtyPaths.slice(0, 8).join("、");
    lines.push(
      `[bundle] 挡路的是这些：${shown}${prov.bundleDirtyPaths.length > 8 ? ` 等 ${prov.bundleDirtyPaths.length} 个` : ""}`,
    );
  }
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
          provenance: {
            sha: meta.prov.sha,
            dirty: meta.prov.dirty,
            bundleDirty: meta.prov.bundleDirty,
            bundleDirtyPaths: meta.prov.bundleDirtyPaths,
            mirrorNeutral: meta.prov.mirrorNeutral,
            mirrorNeutralPaths: meta.prov.mirrorNeutralPaths,
            builtAt: meta.built,
            newestSourceAt: meta.source,
            stale: meta.stale,
          },
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
 * 写预算。三条硬前置（提交可定位 / 首屏源码干净 / 产物不过期）任一不满足就退出码 2：
 * 预算是给未来提交定的线，CI 只认提交，拿本地恰好绿的产物定基线等于把不可复现的数字
 * 写进契约。「不允许为了过门禁上调」这条规矩，靠的就是这里的不方便。
 * 脏树判据只看 BUNDLE_SOURCE_PATHS——全仓计数在多会话工作区里永远非零，
 * 那样这条前置会因为无法达成而被整体绕过，反而丢掉它真正要守的两样东西。
 */
/**
 * --from：吃一份「别处已经算好的账」（CI artifact 里的 bundle-budget-report.json）。
 * 为什么需要：干净的树只存在于 CI——本地工作区常年有别人的未提交改动（实测 300+ 个脏文件），
 * 拿本地 .next 定基线，等于把「我这一棵树恰好多大」写进契约。
 *
 * 换来的代价是要多回答一个本地路径不需要回答的问题：**这份账还属于当前 HEAD 吗**。
 * 三条判据缺一即拒：报告自称干净且不过期（stale=false 且 bundleDirty=0）、报告的提交是本仓库
 * HEAD 的祖先、从那枚提交到 HEAD 之间「能改变首屏」的源码一行未动。已与事实源同步的
 * apps/web 镜像是例外——它们的权威在 overlay，overlay 真变了会自己出现在 diff 里。
 */
function reportSource(fromPath, refuse) {
  let raw;
  try {
    raw = readFileSync(fromPath, "utf8");
  } catch {
    refuse(`读不到 --from 指定的报告：${fromPath}`);
  }
  let r;
  try {
    r = JSON.parse(raw);
  } catch {
    refuse(`--from 不是合法 JSON：${fromPath}`);
  }
  const d = r?.report;
  if (!d || !Array.isArray(d.raise) || !Array.isArray(d.addMissing)) {
    refuse("--from 里没有 report.raise/addMissing：这不是 `--report --json` 的输出");
  }
  const p = r.provenance ?? {};
  if (!p.sha) refuse("--from 的报告没有 provenance.sha：无法定位它是哪棵树产的");
  if (p.stale !== false) refuse(`--from 的报告无法确认产物新鲜（stale=${String(p.stale)}）：先让 CI 重跑`);
  if (p.bundleDirty !== 0) refuse(`--from 的报告首屏源码脏 ${String(p.bundleDirty)} 个：不可用作基线`);
  if (gitOut(["cat-file", "-e", `${p.sha}^{commit}`]) === null) refuse(`--from 的提交 ${p.sha} 不在本仓库里`);
  if (gitOut(["merge-base", "--is-ancestor", p.sha, "HEAD"]) === null) {
    refuse(`--from 的提交 ${p.sha} 不是 HEAD 的祖先：这份账来自另一条历史`);
  }
  const changed = gitOut(["diff", "--name-only", p.sha, "HEAD", "--", ...BUNDLE_SOURCE_PATHS]);
  if (changed === null) refuse(`无法比较 ${p.sha}..HEAD 的首屏源码差异`);
  const all = changed.split("\n").map((s) => s.trim()).filter(Boolean);
  const synced = mirrorsInSyncAtHead(all);
  const drift = all.filter((x) => !synced.has(x));
  if (drift.length > 0) {
    refuse(
      `从 ${p.sha} 到现在（HEAD）首屏源码变了 ${drift.length} 个（${drift.slice(0, 8).join("、")}${
        drift.length > 8 ? " 等" : ""
      }）：这份账属于旧树，先让 CI 对当前 HEAD 出账`,
    );
  }
  return {
    kind: "report",
    sha: p.sha,
    builtAt: typeof p.builtAt === "number" ? p.builtAt : null,
    bundler: r.bundler ?? "unknown",
    diff: d,
  };
}

function runRaise(meta) {
  const refuse = (msg) => {
    console.error(`[bundle] --raise 拒绝写入：${msg}`);
    process.exit(2);
  };
  const reason = flagValue("--reason");
  if (reason === "") refuse('必须带 --reason="..."：没写明原因的上调一律不认');
  const fromPath = flagValue("--from");
  if (fromGiven && fromPath === "") {
    refuse("--from 后面要跟报告路径（CI artifact 里的 bundle-budget-report.json），空值不等于没用");
  }
  let src;
  if (fromPath !== "") {
    src = reportSource(fromPath, refuse);
    console.log(`[bundle] 数字来自 --from 的报告：提交 ${src.sha} · 构建时间 ${iso(src.builtAt)}`);
  } else {
    if (meta.prov.sha === null) refuse("当前目录不在 git 仓库里，无法把这份数钉到某个提交");
    if (meta.prov.bundleDirty === null) refuse("git status 查询失败，无法确认首屏源码干净");
    if (meta.prov.bundleDirty > 0) {
      const shown = meta.prov.bundleDirtyPaths.slice(0, 8).join("、");
      refuse(
        `首屏源码有 ${meta.prov.bundleDirty} 个未提交改动（${shown}${
          meta.prov.bundleDirtyPaths.length > 8 ? " 等" : ""
        }），这份产物不属于提交 ${meta.prov.sha}。` +
          "先提交这些改动、再重新 build，然后才谈得上可复现的基线",
      );
    }
    if (meta.built === null) refuse("拿不到构建产物的时间戳，无法判断它是否过期");
    if (meta.stale) refuse(`构建产物比源码旧（产物 ${iso(meta.built)}，最新源文件 ${iso(meta.source)}）：先重跑 build`);
    src = {
      kind: "local",
      sha: meta.prov.sha,
      builtAt: meta.built,
      bundler: collected.bundler,
      diff: diffBudgets(rows, budgets),
    };
  }

  const d = src.diff;
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
      sha: src.sha,
      source: src.kind,
      distDir,
      bundler: src.bundler,
      // 审计记录存 UTC：展示用本地时间（和 ls 对得上），落档要无歧义
      builtAt: src.builtAt === null ? null : new Date(src.builtAt).toISOString(),
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
  console.log(`  审计行 _raise_log[0]：@${src.sha}（${src.kind === "report" ? "--from 报告" : "本地产物"}）· reason="${reason}" · 构建时间 ${iso(src.builtAt)}`);
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

