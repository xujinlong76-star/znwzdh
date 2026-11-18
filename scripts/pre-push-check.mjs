#!/usr/bin/env node
/**
 * pre-push 检查：只对“本次要推出去的改动”跑恰好够用的检查，任一失败即挡住推送。
 *
 * 设计：`~/workspace/.jarvis/idea-executions/78701de9-6aa0-4d91-9256-aee6a561a5cb/scratch/w2-prepush-design.md`
 * （W2 设计稿）。用法：
 *   node scripts/pre-push-check.mjs [--base <ref>] [--full] [--dry-run] [--json]
 * 作为 pre-push 钩子时由 git 经 stdin 传入 `<local ref> <local sha> <remote ref> <remote sha>`。
 *
 * 不变量（设计 §0，逐条落实）：
 *   1. 绝不执行 `git push` / `git commit` / `git add` / `git reset` / `git checkout` /
 *      `git clean`，绝不 pkill/kill 任何 node/next 进程。唯一允许的写操作是镜像生成
 *      （`node scripts/generate-web-mirror.mjs`，写 apps/web 下 gitignore 的生成物）
 *      与 junit XML（写 os.tmpdir() 下的临时目录）。
 *   2. 任何一步“没跑成”（跳过、超时、工具缺失、基底取不到）都在输出里显式列为
 *      SKIPPED / ERROR，不得静默当成通过；超时 = 失败，不是跳过。
 *   3. 退出码：0 = 全部必查通过（或豁免情形）；1 = 任一必查失败/超时/无法完成判定；
 *      2 = 用法/环境错误（未知参数、--base 无法解析）。
 *   4. 本脚本自身不设任何跳过环境变量（设计 §5）：跳过只由 pre-push 钩子层的
 *      NAVHUB_SKIP_PREPUSH=1 控制，不在本脚本里。
 *
 * 与设计稿的差异（设计稿文件在 §2.7 表中途截断，§3–§8 缺失；以下按实测与仓库惯例补齐，
 * 每条都有实测依据，见文件末尾的“核实记录”注释）：
 *   D1. 检查顺序与每项准确命令（设计 §3 缺失）：见 `planChecks()` 的步骤表。顺序是
 *      镜像 → overlay 一致性 → 语法 → 显式 any 棘轮 → vitest 选测 → 前端 typecheck →
 *      后端 typecheck → 后端 lint → 前端 lint → CI 门禁脚本。先跑便宜的、失败即停。
 *   D2. 输出格式（设计 §4 缺失）：人读行以 `[pre-push-check]` 开头；结论行固定为
 *      `PREPUSH: PASS (...)` / `PREPUSH: FAIL (...)`，括号里带 vitest 统计、
 *      `e2e: deferred-to-CI (n specs)`（有 e2e 改动时）、`working-tree-dirty: n files`
 *      （有脏交集时）；`--json` 时只输出一份 JSON 摘要。
 *   D3. mock 卫生与依赖完整性不在本脚本里跑：`scripts/prepush-gates.mjs`（钩子同链）
 *      已全量跑 `fix-mock-hygiene.mjs --head`（HEAD 全量，比设计 §2.7 的
 *      `--changed` 更广）与 `check-deps-integrity.mjs`（全量）。本脚本把这两枚列为
 *      SKIPPED 并写明原因，不重复跑。
 *   D4. `check-no-explicit-any.mjs` 只有全量与 `--staged` 两种口径（实测）：
 *      `--staged` 读索引 blob，判的是“暂存内容”不是“推送内容”，pre-push 用它是错的；
 *      因此 overlay 源码有改动时跑全量（实测 4s），无改动时跳过。
 *   D5. `check-syntax.mjs` 默认扫描不含仓库根 `.ts`（如 playwright.config.ts）与
 *      `scripts/*.ts`（实测），但接受显式文件参数；因此按本次推送的改动文件显式传参，
 *      不用默认全量口径。
 *   D6. 后端 lint 的无 pnpm 等价命令是 `node node_modules/.bin/eslint . --max-warnings 0`
 *      （cwd=包目录，apps/api 与 packages/store 各跑一次）；`scripts/verify.mjs` 里
 *      的 `node_modules/eslint/bin/eslint.js` 路径在本仓库 pnpm 布局下不存在
 *      （eslint 只活在 `node_modules/.pnpm/eslint@…`，根只剩 `.bin` 垫片），
 *      且各包的 eslint 配置要 import `typescript-eslint`，必须有包自己的
 *      `node_modules`（pnpm 隔离布局）才能解析。
 *   D7. 后端 typecheck 的口径是 `node scripts/typecheck.mjs`（TS 7 native，逐包跑
 *      @navhub/* 的 `tsc --noEmit`），不是对 apps/api 单独跑 tsc。
 *   D8. 前端 lint：改动 overlay 源码时只对改动文件跑 scoped eslint
 *      （`eslint <改动文件...> --max-warnings 316`，cwd=apps/web-overlay）；
 *      只有改了 `apps/web-overlay/eslint.config.mjs` 或全局档文件时才跑全量。
 *   D9. 模块图的召回是“宁多勿少”的：实测 `exam-calendar.ts` 图命中 99 个测试、
 *      `site-favicon.tsx` 图命中 204 个（经 `home-exam-strip → app/page.tsx` 等
 *      真实传递边），设计 §2.4 的最小集只是下限（图命中不足时补齐），不是上限。
 *      本脚本按设计 M1 原样采用图结果，不做二次收窄。
 *  D10. 钩子模式下 remote sha 全零且 local sha 非零（新建分支首次推送）时，基底取
 *      `merge-base origin/main <local sha>` 再 diff；全零行（删分支）直接 PASS。
 *
 * 核实记录（2026-11-18，本机实测，见提交信息）：
 *   - 镜像生成 ~2s；overlay 全量检查 ~15s；语法全量 ~15s；显式 any 全量 ~4s；
 *   - 前端 typecheck ~79s；后端 typecheck（TS7 全包）~25s；后端 lint api ~13s / store ~9s；
 *   - 前端 lint 全量（316 警告阈值）~181s；依赖完整性 ~3s；CI 门禁脚本 <1s；
 *   - mock 卫生 --head ~4s；模块图构建空闲时 ~3–7s，但三路并行 I/O 争抢时实测 101s——
 *     图构建是纯读文件，耗时随磁盘争抢剧烈波动，属环境因素，脚本不另设超时（同步建图无法中断）。
 *   - 7 文件 vitest 选测 ~2–3s；exam-calendar 图命中 99 个测试，site-favicon 图命中 204 个。
 *   - 依赖：全新克隆无 node_modules 时本脚本无法运行（vitest/tsc/eslint 都缺失），
 *     必须先备好依赖（本克隆借 `~/workspace/znwzdh-evolve-git` 的 node_modules
 *     做符号链接：根 + apps/各包 + packages/各包的 node_modules 均需链；只链根不够——
 *     pnpm 隔离布局下各包的 eslint 配置要 import typescript-eslint、测试要 import react，
 *     都只在各包自己的 node_modules 里。链是临时的，不进 git）。
 *     工具缺失时对应步骤报 ERROR（判 FAIL），绝不静默跳过。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const P = "[pre-push-check] ";
const ZERO_SHA = "0".repeat(40);
const FETCH_TIMEOUT_MS = 20_000;
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|mts|cts)$/;
const TS_FILE_RE = /\.(ts|tsx)$/;
const MJS_FILE_RE = /\.(mjs|mts)$/;
const SYNTAX_FILE_RE = /\.(ts|tsx|mjs|mts)$/;

const TIMEOUTS = {
  mirror: 120_000,
  overlay: 180_000,
  syntax: 120_000,
  any: 180_000,
  vitest: 600_000,
  vitestFull: 900_000,
  frontendTypecheck: 300_000,
  backendTypecheck: 600_000,
  lint: 300_000,
  ciGate: 120_000,
};

/** 与 pre-commit 选测器（scripts/install-git-hooks.mjs 内嵌）一致的口径，原样复用。 */
const ROUTES = [
  ["apps/web-overlay/scripts/", "apps/web-overlay/scripts"],
  ["apps/web-overlay/", "apps/web/test"],
  ["apps/web/", "apps/web/test"],
  ["apps/api/", "apps/api/test"],
  ["scripts/", "scripts"],
];
const GLOBAL_FILES = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "vitest.config.ts", "tsconfig.base.json", "scripts/worker-budget.ts"];
const GLOBAL_DIRS = ["types/"];
const GLOBAL_GATE_TESTS = ["apps/web/test/field-names.test.ts", "apps/web/test/keyboard-activation.test.ts"];
const GENERIC_STEMS = new Set([
  "page", "index", "types", "utils", "util", "server", "config",
  "layout", "route", "routes", "hooks", "hook", "lib", "main", "test", "spec", "apps",
  "packages", "data", "admin", "components", "repository", "helpers", "index.test",
]);

/** 设计 §2.4：exam-calendar 的最小集（图命中不足时补齐的下限）。 */
const EXAM_CALENDAR_MIN_SET = [
  "apps/web/test/exam-page.test.ts",
  "apps/web/test/exam-admission-reminder.test.ts",
  "apps/web/test/exam-urgency.test.ts",
  "apps/web/test/home-exam-entry.test.ts",
  "apps/web/test/home-today-zone.test.ts",
  "apps/web/test/my-exams.test.ts",
  "apps/web/test/use-my-exams.test.ts",
];

/** 设计 §2.7：改动 CI/门禁接线文件时要跑的“守门人的守门人”。 */
const CI_GATE_FILES = [
  ".github/workflows/ci.yml",
  "scripts/gates.json",
  "scripts/install-git-hooks.mjs",
  "scripts/prepush-gates.mjs",
];

function posix(p) {
  return String(p).split(sep).join("/");
}

function sortUnique(files) {
  return [...new Set((files ?? []).map((f) => posix(f)).filter(Boolean))].sort();
}

/** 仓库根：优先 git 判定（可在仓库任意子目录运行），退回脚本所在位置的上级。 */
export function repoRoot(cwd = process.cwd()) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
  } catch {
    return resolve(dirname(fileURLToPath(import.meta.url)), "..");
  }
}

function gitOut(root, args, { timeout = 30_000 } = {}) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
}

// ---------------------------------------------------------------------------
// 参数与钩子 stdin
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = { base: null, full: false, dryRun: false, json: false, help: false };
  for (const arg of argv) {
    if (arg === "--full") opts.full = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg.startsWith("--base=")) opts.base = arg.slice("--base=".length);
    else if (arg === "--base") throw new Error("--base 需要一个值（--base=<ref>）");
    else throw new Error(`未知参数：${arg}`);
  }
  return opts;
}

export const USAGE = `用法：node scripts/pre-push-check.mjs [--base <ref>] [--full] [--dry-run] [--json]
  --base <ref>  手动模式的基底覆盖（默认 merge-base origin/main HEAD）
  --full        跳过改动检测，跑全量受影响套件（全部测试根 + 两档 typecheck + 两档 lint）
  --dry-run     只打印改动集与映射表，不跑任何检查，退出 0
  --json        只输出一份 JSON 摘要（供机器读取）
  作为 pre-push 钩子时，git 经 stdin 传入 <local ref> <local sha> <remote ref> <remote sha>。`;

export function isZeroSha(sha) {
  return typeof sha === "string" && /^0+$/.test(sha.trim());
}

/**
 * 解析 pre-push 钩子 stdin。返回 { lines, allDeletes }。
 * 每行：`<local ref> <local sha> <remote ref> <remote sha>`。
 */
export function parseHookStdin(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
      return { localRef, localSha, remoteRef, remoteSha };
    })
    .filter((l) => l.localRef && l.localSha && l.remoteRef && l.remoteSha);
  const allDeletes = lines.length > 0 && lines.every((l) => isZeroSha(l.localSha) || isZeroSha(l.remoteSha));
  return { lines, allDeletes };
}

// ---------------------------------------------------------------------------
// 改动检测（设计 §1：四组取并集）
// ---------------------------------------------------------------------------

/** 解析 `git diff --name-status` 输出：A/M/D 单路径，R100 old new 双路径。 */
export function parseNameStatus(text) {
  const files = [];
  const renames = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0] ?? "";
    if (status.startsWith("R") && parts.length >= 3) {
      renames.push({ from: parts[1], to: parts[2] });
      files.push(parts[1], parts[2]);
    } else if (parts.length >= 2) {
      files.push(parts[1]);
    }
  }
  return { files: sortUnique(files), renames };
}

export function parseNameOnly(text) {
  return sortUnique(String(text ?? "").split(/\r?\n/));
}

function diffNameStatus(root, args) {
  try {
    return parseNameStatus(gitOut(root, ["diff", "--name-status", "--diff-filter=ACMRD", "-M", "--find-renames=50%", ...args]));
  } catch {
    // 降级：极旧 git 不支持 --name-status 组合时退回 --name-only（重命名配对丢失，但集合仍对）。
    return { files: parseNameOnly(gitOut(root, ["diff", "--name-only", "--diff-filter=ACMRD", ...args])), renames: [] };
  }
}

/**
 * 四组取并集。`range` 为钩子模式的 { from, to }（remote sha → local sha）或
 * 手动模式的 { base, head: "HEAD" }；`base` 仅用于报告。
 * 返回 { pushed, staged, unstaged, untracked, renames, base }，路径均为 POSIX 排序去重。
 */
export function collectChanged(root, range) {
  const { from, to } = range;
  const a = diffNameStatus(root, [from, to]);
  const b = diffNameStatus(root, ["--cached"]);
  const c = diffNameStatus(root, []);
  const untracked = parseNameOnly(gitOut(root, ["ls-files", "--others", "--exclude-standard"]));
  return {
    pushed: a.files,
    staged: b.files,
    unstaged: c.files,
    untracked,
    renames: a.renames,
    base: from,
  };
}

/** 工作区（B/C/D）与“推送受影响路径”的交集：只做 DIRTY-WARNING，永不单独判 FAIL。 */
export function dirtyIntersection(affectedPaths, staged, unstaged, untracked) {
  const affected = new Set(affectedPaths ?? []);
  const out = [];
  for (const f of [...(staged ?? []), ...(unstaged ?? []), ...(untracked ?? [])]) {
    if (affected.has(f) && !out.includes(f)) out.push(f);
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// 词根收窄（设计 M2：与 install-git-hooks.mjs 内嵌选测器同款，原样复用）
// ---------------------------------------------------------------------------

export function stemsOf(file) {
  const parts = file.split("/");
  const base = (parts[parts.length - 1] || "").replace(/\.(tsx?|mts|cts)$/, "");
  const parent = parts.length > 1 ? parts[parts.length - 2] : "";
  const out = [];
  for (const raw of [base, parent]) {
    for (const token of String(raw).split(/[-_.]/)) {
      const t = token.toLowerCase();
      if (t.length >= 4 && !GENERIC_STEMS.has(t) && out.indexOf(t) === -1) out.push(t);
    }
  }
  return out;
}

export function stemHit(stem, name) {
  if (name.indexOf(stem) !== -1) return true;
  // 复数归一：plugins -> plugin、jobs -> job。单数形式允许 3 字符。
  const singular = stem.endsWith("s") ? stem.slice(0, -1) : "";
  return singular.length >= 3 && name.indexOf(singular) !== -1;
}

/** 挑出「有判别力」的词根：命中面过宽的词根不提供收窄信息。通用词需同时满足 >5 个且 >25%。 */
export function filterSharp(stems, countOf, total) {
  const floor = Math.ceil(total * 0.25);
  return stems.filter((t) => {
    const hits = countOf(t);
    return hits <= 5 || hits <= floor;
  });
}

/** 递归列出某目录（仓库相对）下的测试文件，返回仓库相对 POSIX 路径。 */
export function listTestFiles(root, dirRel) {
  const abs = join(root, dirRel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return TEST_FILE_RE.test(abs) ? [posix(dirRel)] : [];
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const p = join(dir, entry.name);
      const r = rel ? rel + "/" + entry.name : entry.name;
      if (entry.isDirectory()) walk(p, r);
      else if (TEST_FILE_RE.test(entry.name)) out.push(r);
    }
  };
  walk(abs, dirRel);
  return out.sort();
}

/** 全部测试根（= vitest.config.ts 的 include，去掉不可运行的 overlay/test）。 */
export function allTestRoots(root) {
  const roots = [];
  if (existsSync(join(root, "packages"))) {
    for (const name of readdirSync(join(root, "packages"))) {
      const dir = "packages/" + name + "/test";
      if (existsSync(join(root, dir))) roots.push(dir);
    }
  }
  for (const dir of ["apps/api/test", "apps/web/test", "scripts", "apps/web-overlay/scripts"]) {
    if (existsSync(join(root, dir))) roots.push(dir);
  }
  return roots;
}

/** 返回 [] 表示「收窄不了」，调用方应退回整棵（宁可多跑，不可漏跑）。 */
export function narrowTests(root, targetRel, sources) {
  if (sources.length === 0 || sources.length > 3) return [];
  const all = listTestFiles(root, targetRel);
  if (all.length === 0) return [];
  const stems = [];
  for (const s of sources) for (const t of stemsOf(s)) if (stems.indexOf(t) === -1) stems.push(t);
  if (stems.length === 0) return [];
  const names = all.map((f) => f.split("/").pop().toLowerCase());
  const pickByName = (list) =>
    all.filter((f) => {
      const name = f.split("/").pop().toLowerCase();
      return list.some((t) => stemHit(t, name));
    });
  const nameHits = (t) => names.reduce((n, name) => n + (stemHit(t, name) ? 1 : 0), 0);
  let texts = null;
  const readTexts = () => {
    if (texts === null) {
      texts = all.map((f) => {
        try {
          return readFileSync(join(root, f), "utf8").toLowerCase();
        } catch {
          return "";
        }
      });
    }
    return texts;
  };
  const contentHits = (t) => readTexts().reduce((n, x) => n + (x.indexOf(t) !== -1 ? 1 : 0), 0);
  const pickByContent = (list) => {
    const tx = readTexts();
    return all.filter((f, i) => list.some((t) => tx[i].indexOf(t) !== -1));
  };
  const wide = (files) => files.length > Math.ceil(all.length * 0.6);
  const sharpNames = filterSharp(stems, nameHits, names.length);
  for (const tier of [sharpNames, stems]) {
    if (tier.length === 0) continue;
    const byName = pickByName(tier);
    if (byName.length > 0) return byName;
    const sharpTexts = filterSharp(tier, contentHits, all.length);
    if (sharpTexts.length === 0) continue;
    const hits = pickByContent(sharpTexts);
    if (hits.length > 0 && !wide(hits)) return hits;
  }
  return [];
}

// ---------------------------------------------------------------------------
// 映射（设计 §2：M0 换算 → M1 图 → M2 词根 → M3 自身 → M4 目录回退，M5/M6 叠加）
// ---------------------------------------------------------------------------

/** 单个改动文件 → 测试目标。返回 { target } / { global } / { e2e } / { reason }。 */
export function mapFile(file) {
  if (GLOBAL_FILES.indexOf(file) !== -1) return { global: true };
  if (file.startsWith("e2e/")) return { e2e: true };
  for (const dir of GLOBAL_DIRS) if (file.startsWith(dir)) return { global: true };
  if (TEST_FILE_RE.test(file)) {
    const target = file.startsWith("apps/web-overlay/test/")
      ? "apps/web/test/" + file.slice("apps/web-overlay/test/".length)
      : file;
    return { target };
  }
  for (const [prefix, target] of ROUTES) if (file.startsWith(prefix)) return { target };
  if (file.startsWith("packages/")) {
    const pkg = file.slice("packages/".length).split("/")[0];
    return { target: "packages/" + pkg + "/test" };
  }
  return { reason: "不属于任何带测试的工作区（packages/*、apps/api、apps/web、scripts）" };
}

/** M0：改动的测试文件 → 可运行路径；overlay 测试换算到 apps/web/test 镜像。 */
export function toRunnableTest(file) {
  if (!TEST_FILE_RE.test(file)) return null;
  if (file.startsWith("apps/web-overlay/test/")) return "apps/web/test/" + file.slice("apps/web-overlay/test/".length);
  return file;
}

function siteFaviconFamily(root) {
  const dir = join(root, "apps/web/test");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith("site-favicon-") && f.endsWith(".test.ts"))
    .map((f) => "apps/web/test/" + f)
    .sort();
}

function isFullTierFile(file) {
  return GLOBAL_FILES.indexOf(file) !== -1 || GLOBAL_DIRS.some((d) => file.startsWith(d));
}

/**
 * 推送文件集 → 要跑的测试。`graph` 为 test-impact 模块（{ graphFor, impactedWithPaths }）
 * 或 null（库缺失时降级到词根，并记 WARN）。
 * 返回 { tests, reasons, e2e, e2eConfig, full, fullReason, skipped, warnings, graphAvailable }。
 * reasons: Map<测试路径, "graph"|"stem"|"self"|"min-set"|"global-gate"|"dir-fallback"|"full">。
 */
export function mapToTests(pushed, { root, graph = null, full = false } = {}) {
  const tests = new Map();
  const e2e = [];
  const skipped = [];
  const warnings = [];
  let e2eConfig = false;
  let graphAvailable = Boolean(graph);
  const add = (t, reason) => {
    if (!tests.has(t)) tests.set(t, reason);
  };

  for (const f of pushed) if (f.startsWith("e2e/")) e2e.push(f);
  if (pushed.includes("playwright.config.ts")) e2eConfig = true;

  // M6：全局档（F）——改动“会改变所有测试行为”的文件，直接全量。
  let fullMode = full;
  let fullReason = full ? "--full" : "";
  if (!fullMode) {
    const trigger = pushed.find((f) => isFullTierFile(f));
    if (trigger) {
      fullMode = true;
      fullReason = `全局文件 ${trigger}`;
    }
  }
  if (fullMode) {
    for (const r of allTestRoots(root)) for (const t of listTestFiles(root, r)) add(t, "full");
    return {
      tests: [...tests.keys()].sort(),
      reasons: tests,
      e2e: sortUnique(e2e),
      e2eConfig,
      full: true,
      fullReason,
      skipped,
      warnings,
      graphAvailable,
    };
  }

  // 具名最小集（设计 §2.4）：图命中不足时的下限，先放进来，图多命中不减。
  for (const f of pushed) {
    if (f.endsWith("/lib/exam-calendar.ts") && (f.startsWith("apps/web-overlay/src/") || f.startsWith("apps/web/src/"))) {
      for (const t of EXAM_CALENDAR_MIN_SET) if (existsSync(join(root, t))) add(t, "min-set");
    }
    if (f === "apps/web-overlay/src/components/site-favicon.tsx" || f === "apps/web/src/components/site-favicon.tsx") {
      for (const t of siteFaviconFamily(root)) add(t, "min-set");
    }
  }

  const byRoot = new Map(); // target root -> 改动源文件（词根收窄用）
  const graphInputs = [];
  for (const f of pushed) {
    if (f.startsWith("e2e/") || f === "playwright.config.ts") continue;
    if (TEST_FILE_RE.test(f)) {
      // M3：测试文件自身（换算到可运行路径）。
      const target = toRunnableTest(f);
      if (target && existsSync(join(root, target))) add(target, "self");
      else skipped.push({ file: f, reason: "测试文件没有可运行的镜像副本（改 overlay 测试后需先生成镜像）" });
      continue;
    }
    graphInputs.push(f);
    const mapped = mapFile(f);
    if (mapped.global) continue; // 全局档已在上面处理
    if (mapped.target) {
      if (!byRoot.has(mapped.target)) byRoot.set(mapped.target, []);
      byRoot.get(mapped.target).push(f);
    } else {
      skipped.push({ file: f, reason: mapped.reason ?? "无映射" });
    }
  }

  // M1：模块图（主规则）。图建失败 → 降级到 M2，不得静默返回空集。
  const graphHitsByRoot = new Map();
  if (graph && graphInputs.length > 0) {
    try {
      const g = graph.graphFor(root);
      const impacted = graph.impactedWithPaths(g, graphInputs);
      const roots = allTestRoots(root);
      for (const file of impacted.tests) {
        const r = roots.filter((x) => file.startsWith(x + "/")).sort((a, b) => b.length - a.length)[0];
        if (!r) continue;
        if (!graphHitsByRoot.has(r)) graphHitsByRoot.set(r, new Set());
        graphHitsByRoot.get(r).add(file);
      }
    } catch {
      graphAvailable = false;
      warnings.push("WARN: 模块图不可用，已降级到词根映射");
    }
  } else if (!graph && graphInputs.length > 0) {
    warnings.push("WARN: 模块图不可用，已降级到词根映射");
  }

  // 每棵根：图命中 → 词根收窄 → 整棵（M4 保底，宁可多跑）。
  // 图命中的根即使不直接对应改动文件也要跑：改 packages/core 会连累 apps/web 的测试，
  // 只按“改动在哪个包”选根是看不见的（pre-commit 选测器同款处理）。
  const allRoots = new Set([...byRoot.keys(), ...graphHitsByRoot.keys()]);
  for (const target of allRoots) {
    const hits = graphHitsByRoot.get(target);
    if (hits && hits.size > 0) {
      for (const t of [...hits].sort()) add(t, "graph");
      continue;
    }
    const narrowed = narrowTests(root, target, byRoot.get(target) ?? []);
    if (narrowed.length > 0) {
      for (const t of narrowed) add(t, "stem");
      continue;
    }
    for (const t of listTestFiles(root, target)) add(t, "dir-fallback");
  }

  // M5：全局守卫测试（叠加，不替代）——任一 overlay/web 源码改动都带上。
  const uiTouched = pushed.some((f) => f.startsWith("apps/web-overlay/src/") || f.startsWith("apps/web/src/"));
  if (uiTouched) {
    for (const gate of GLOBAL_GATE_TESTS) if (existsSync(join(root, gate))) add(gate, "global-gate");
  }

  return {
    tests: [...tests.keys()].sort(),
    reasons: tests,
    e2e: sortUnique(e2e),
    e2eConfig,
    full: false,
    fullReason: "",
    skipped,
    warnings,
    graphAvailable,
  };
}

// ---------------------------------------------------------------------------
// 检查计划（设计 §3 的补齐：顺序 = 便宜在先，失败即停；每项给准确命令）
// ---------------------------------------------------------------------------

function eslintBin(root) {
  return join(root, "node_modules", ".bin", "eslint");
}

/**
 * 映射 + 改动集 → 有序检查步骤。每步 { id, title, run, skipReason, cmd, cwd, timeoutMs, kind }。
 * cmd 以 [程序, ...参数] 形式给出，程序为 "node" 时相对仓库根；cwd 为仓库相对目录或 ""。
 * 不跑的步骤也保留在表里（SKIPPED + 原因），不得静默。
 */
export function planChecks(mapping, changed, { root, full = false } = {}) {
  const pushed = changed.pushed ?? [];
  const has = (pred) => pushed.some(pred);
  const overlayChanged = has((f) => f.startsWith("apps/web-overlay/"));
  const overlaySrcChanged = has((f) => f.startsWith("apps/web-overlay/src/") && TS_FILE_RE.test(f));
  const apiChanged = has((f) => f.startsWith("apps/api/"));
  const storeChanged = has((f) => f.startsWith("packages/store/"));
  const pkgChanged = has((f) => f.startsWith("packages/"));
  const ciChanged = has((f) => CI_GATE_FILES.includes(f));
  const eslintConfigChanged = pushed.includes("apps/web-overlay/eslint.config.mjs");
  const frontendConfigChanged = has((f) => f === "apps/web-overlay/tsconfig.json" || f === "apps/web/tsconfig.json");
  const fTier = mapping.full === true;

  // 语法：显式传改动文件（apps/web/ 下是生成物镜像，不单独查；已删除的文件不存在，跳过）。
  const syntaxFiles = pushed.filter(
    (f) => SYNTAX_FILE_RE.test(f) && !f.startsWith("apps/web/") && existsSync(join(root, f)),
  );

  // 前端 lint：scoped（改动文件，相对 apps/web-overlay）或全量（配置变了）。
  const frontendLintFiles = pushed
    .filter((f) => f.startsWith("apps/web-overlay/") && /\.(ts|tsx|mjs|mts)$/.test(f) && existsSync(join(root, f)))
    .map((f) => f.slice("apps/web-overlay/".length));

  const steps = [
    {
      id: "mirror",
      title: "生成 web 镜像（overlay → apps/web）",
      run: overlayChanged || full,
      skipReason: overlayChanged || full ? "" : "本次推送未改动 apps/web-overlay/",
      cmd: ["node", "scripts/generate-web-mirror.mjs"],
      cwd: "",
      timeoutMs: TIMEOUTS.mirror,
      kind: "node",
    },
    {
      id: "overlay-check",
      title: "overlay 与 web 镜像一致性",
      run: overlayChanged || full,
      skipReason: overlayChanged || full ? "" : "本次推送未改动 apps/web-overlay/",
      cmd: ["node", "scripts/check-web-overlay.mjs"],
      cwd: "",
      timeoutMs: TIMEOUTS.overlay,
      kind: "node",
    },
    {
      id: "syntax",
      title: "语法速查（esbuild 解析 + .mjs 行尾）",
      run: syntaxFiles.length > 0,
      skipReason: syntaxFiles.length > 0 ? "" : "本次推送无 TS/TSX/.mjs 改动文件",
      cmd: ["node", "scripts/check-syntax.mjs", ...syntaxFiles],
      cwd: "",
      timeoutMs: TIMEOUTS.syntax,
      kind: "node",
    },
    {
      id: "no-explicit-any",
      title: "显式 any 棘轮（全量对照基线）",
      run: overlaySrcChanged || fTier,
      skipReason: overlaySrcChanged || fTier ? "" : "本次推送未改动 apps/web-overlay/src 下的 .ts/.tsx",
      cmd: ["node", "scripts/check-no-explicit-any.mjs"],
      cwd: "",
      timeoutMs: TIMEOUTS.any,
      kind: "node",
    },
    {
      id: "vitest",
      title: "受影响的 vitest 套件",
      run: mapping.tests.length > 0,
      skipReason: mapping.tests.length > 0 ? "" : "没有映射到任何可运行测试（见 SKIP 清单）",
      cmd: null, // 运行时填（需 junit 临时文件路径）
      cwd: "",
      timeoutMs: mapping.full ? TIMEOUTS.vitestFull : TIMEOUTS.vitest,
      kind: "vitest",
    },
    {
      id: "frontend-typecheck",
      title: "前端类型检查（tsc --noEmit，整棵）",
      run: overlayChanged || frontendConfigChanged || fTier,
      skipReason: overlayChanged || frontendConfigChanged || fTier ? "" : "本次推送未改动前端文件",
      cmd: ["node", "scripts/check-frontend-typecheck.mjs"],
      cwd: "",
      timeoutMs: TIMEOUTS.frontendTypecheck,
      kind: "node",
    },
    {
      id: "backend-typecheck",
      title: "后端类型检查（TS 7，逐包 @navhub/*）",
      run: apiChanged || pkgChanged || fTier,
      skipReason: apiChanged || pkgChanged || fTier ? "" : "本次推送未改动 apps/api/、packages/",
      cmd: ["node", "scripts/typecheck.mjs"],
      cwd: "",
      timeoutMs: TIMEOUTS.backendTypecheck,
      kind: "node",
    },
    {
      id: "backend-lint-api",
      title: "后端 lint（apps/api，--max-warnings 0）",
      run: apiChanged || fTier,
      skipReason: apiChanged || fTier ? "" : "本次推送未改动 apps/api/",
      cmd: ["node", eslintBin(root), ".", "--max-warnings", "0"],
      cwd: "apps/api",
      timeoutMs: TIMEOUTS.lint,
      kind: "node",
    },
    {
      id: "backend-lint-store",
      title: "后端 lint（packages/store，--max-warnings 0）",
      run: storeChanged || fTier,
      skipReason: storeChanged || fTier ? "" : "本次推送未改动 packages/store/",
      cmd: ["node", eslintBin(root), ".", "--max-warnings", "0"],
      cwd: "packages/store",
      timeoutMs: TIMEOUTS.lint,
      kind: "node",
    },
    {
      id: "frontend-lint",
      title: eslintConfigChanged || fTier ? "前端 lint（全量，--max-warnings 316）" : "前端 lint（仅改动文件，--max-warnings 316）",
      run: overlaySrcChanged || eslintConfigChanged || fTier,
      skipReason: overlaySrcChanged || eslintConfigChanged || fTier ? "" : "本次推送未改动 apps/web-overlay/src/",
      cmd:
        eslintConfigChanged || fTier
          ? ["node", eslintBin(root), ".", "--max-warnings", "316"]
          : ["node", eslintBin(root), ...frontendLintFiles, "--max-warnings", "316"],
      cwd: "apps/web-overlay",
      timeoutMs: TIMEOUTS.lint,
      kind: "node",
    },
    {
      id: "ci-gate",
      title: "CI 合并门禁离线校验",
      run: ciChanged,
      skipReason: ciChanged ? "" : "本次推送未改动 ci.yml / gates 登记 / 钩子接线",
      cmd: ["node", "scripts/check-ci-gate.mjs"],
      cwd: "",
      timeoutMs: TIMEOUTS.ciGate,
      kind: "node",
    },
    {
      id: "gates-registry",
      title: "门禁登记与接线一致性",
      run: ciChanged,
      skipReason: ciChanged ? "" : "本次推送未改动 ci.yml / gates 登记 / 钩子接线",
      cmd: ["node", "scripts/check-gates-registry.mjs"],
      cwd: "",
      timeoutMs: TIMEOUTS.ciGate,
      kind: "node",
    },
    {
      id: "deps-integrity",
      title: "依赖完整性",
      run: false,
      skipReason: "由 scripts/prepush-gates.mjs 全量覆盖（pre-push 钩子同链），本脚本不重复跑",
      cmd: null,
      cwd: "",
      timeoutMs: TIMEOUTS.ciGate,
      kind: "covered-elsewhere",
    },
    {
      id: "mock-hygiene",
      title: "mock 卫生（跨模块 vi.mock 兜底）",
      run: false,
      skipReason: "由 scripts/prepush-gates.mjs --head（HEAD 全量，比 --changed 更广）覆盖，本脚本不重复跑",
      cmd: null,
      cwd: "",
      timeoutMs: TIMEOUTS.ciGate,
      kind: "covered-elsewhere",
    },
  ];
  return steps;
}

// ---------------------------------------------------------------------------
// 运行与失败提取
// ---------------------------------------------------------------------------

/** 从 junit XML 里提取含 <failure> 的 testcase 的 classname（即测试文件）。 */
export function parseJunitFailures(xml) {
  const failed = new Set();
  const re = /<testcase\b[^>]*classname="([^"]+)"[^>]*>([\s\S]*?)<\/testcase>/g;
  let m;
  while ((m = re.exec(String(xml ?? ""))) !== null) {
    if (/<failure[\s/>]/.test(m[2])) failed.add(m[1]);
  }
  return [...failed].sort();
}

/** 从 vitest stdout 里提取 FAIL 行（junit 文件缺失时的回退）。 */
export function extractStdoutFailures(stdout) {
  const failed = new Set();
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const m = line.match(/FAIL\s+(\S+\.test\.(?:ts|tsx|mts|cts|mjs))\b/);
    if (m) failed.add(m[1]);
  }
  return [...failed].sort();
}

function tailLines(text, n = 25) {
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.trim() !== "");
  return lines.slice(-n).join("\n");
}

/**
 * 跑一步。返回 { id, title, status: "pass"|"fail"|"skipped"|"error", durationMs, detail }。
 * status 语义：pass 通过；fail 检查失败或超时；skipped 按规则跳过；error 工具缺失/无法执行
 * （error 同样判 FAIL——“没跑成”不得当成通过）。
 */
export function runStep(step, { root, junitFile = null, tests = [] } = {}) {
  const started = Date.now();
  if (!step.run) {
    return { id: step.id, title: step.title, status: "skipped", durationMs: 0, detail: step.skipReason };
  }
  let cmd;
  if (step.kind === "vitest") {
    const vitestEntry = join(root, "node_modules", "vitest", "vitest.mjs");
    if (!existsSync(vitestEntry)) {
      return {
        id: step.id, title: step.title, status: "error", durationMs: Date.now() - started,
        detail: `找不到 vitest 入口 ${vitestEntry}（请先装好依赖）；不做“什么都没跑就算通过”的降级`,
      };
    }
    cmd = [vitestEntry, "run", ...tests, "--reporter=dot", "--reporter=junit", "--outputFile=" + junitFile];
  } else {
    cmd = step.cmd;
    // 只对“文件型”第二个参数做存在性判定（-e 这类标志不算文件）。
    const looksLikeFile = typeof cmd[1] === "string" && /\.(mjs|cjs|js|ts|mts|cts)$/.test(cmd[1]);
    if (cmd[0] === "node" && looksLikeFile && !cmd[1].startsWith("/") && !existsSync(join(root, cmd[1]))) {
      // eslint 垫片是 node_modules/.bin 下的真实文件；scripts/*.mjs 也按此判定。
      return {
        id: step.id, title: step.title, status: "error", durationMs: Date.now() - started,
        detail: `找不到 ${cmd[1]}（请先装好依赖）；不做“什么都没跑就算通过”的降级`,
      };
    }
    // cmd[0] 是 "node" 占位：真正传给 process.execPath 的是后面的参数。
    cmd = cmd.slice(1);
  }
  const cwd = step.cwd ? join(root, step.cwd) : root;
  let res;
  try {
    res = spawnSync(process.execPath, cmd, {
      cwd,
      encoding: "utf8",
      timeout: step.timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    return { id: step.id, title: step.title, status: "error", durationMs: Date.now() - started, detail: String(error?.message ?? error) };
  }
  const durationMs = Date.now() - started;
  const out = (res.stdout ?? "") + (res.stderr ?? "");
  if (res.error && res.error.code === "ETIMEDOUT") {
    return { id: step.id, title: step.title, status: "fail", durationMs, detail: `超时 ${Math.round(step.timeoutMs / 1000)}s（超时按失败计）\n${tailLines(out)}` };
  }
  if (res.error) {
    return { id: step.id, title: step.title, status: "error", durationMs, detail: `${res.error.message}\n${tailLines(out)}` };
  }
  if (res.status === 0) {
    return { id: step.id, title: step.title, status: "pass", durationMs, detail: "" };
  }
  return { id: step.id, title: step.title, status: "fail", durationMs, detail: tailLines(out) };
}

/** 任一必查失败/超时/无法完成判定 → 1；否则 0。skipped 不判红。 */
export function decideExit(results) {
  return (results ?? []).some((r) => r.status === "fail" || r.status === "error") ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

/**
 * 读钩子 stdin（仅非 TTY 时）。带超时：stdin 是被攥着不关闭的管道时（如某些
 * 执行器环境）不能无限等——git 调钩子时数据会立刻到并 EOF，1s 足够；超时按空处理。
 */
function readStdinIfPiped(timeoutMs = 1000) {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        process.stdin.pause();
      } catch {
        // 忽略
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(""), timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => finish(data));
    process.stdin.on("error", () => finish(data));
    process.stdin.resume();
  });
}

function tryFetch(root) {
  try {
    const res = spawnSync("git", ["-C", root, "fetch", "origin", "main", "--quiet"], {
      encoding: "utf8",
      timeout: FETCH_TIMEOUT_MS,
    });
    if (res.error || res.status !== 0) return false;
    return true;
  } catch {
    return false;
  }
}

function mergeChanged(list) {
  const out = { pushed: [], staged: [], unstaged: [], untracked: [], renames: [], base: "" };
  for (const c of list) {
    out.pushed.push(...c.pushed);
    out.staged.push(...c.staged);
    out.unstaged.push(...c.unstaged);
    out.untracked.push(...c.untracked);
    out.renames.push(...c.renames);
  }
  out.pushed = sortUnique(out.pushed);
  out.staged = sortUnique(out.staged);
  out.unstaged = sortUnique(out.unstaged);
  out.untracked = sortUnique(out.untracked);
  return out;
}

function countE2eSpecs(root) {
  try {
    return readdirSync(join(root, "e2e")).filter((f) => f.endsWith(".spec.ts")).length;
  } catch {
    return 0;
  }
}

async function loadGraphLib(root) {
  try {
    const { pathToFileURL } = await import("node:url");
    return await import(pathToFileURL(join(root, "scripts", "lib", "test-impact.mjs")).href);
  } catch {
    return null;
  }
}

function printHeader(lines) {
  for (const l of lines) console.log(P + l);
}

export async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    console.error(P + error.message);
    console.error(USAGE);
    return 2;
  }
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }

  const root = repoRoot();
  const tmpDir = mkdtempSync(join(tmpdir(), "pre-push-check-"));
  const junitFile = join(tmpDir, "junit.xml");
  try {
    return await runMain(opts, { root, junitFile });
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // 临时目录清理失败不影响结论
    }
  }
}

async function runMain(opts, { root, junitFile }) {
  const jsonMode = opts.json;
  const log = (...lines) => {
    if (!jsonMode) printHeader(lines);
  };

  // ---- 1. 改动检测：注入 > 钩子 stdin > 手动 merge-base -------------------
  let mode = "";
  let baseLabel = "";
  let changed;
  const warnings = [];
  const injected = process.env.NAVHUB_PREPUSH_FILES;
  if (injected !== undefined) {
    mode = "manual (injected NAVHUB_PREPUSH_FILES)";
    baseLabel = "injected";
    changed = {
      pushed: sortUnique(injected.split(",").map((f) => f.trim()).filter(Boolean)),
      staged: [],
      unstaged: [],
      untracked: [],
      renames: [],
      base: "injected",
    };
  } else {
    const stdinText = await readStdinIfPiped();
    const hook = parseHookStdin(stdinText);
    if (hook.lines.length > 0) {
      mode = "hook (base=<remote sha>)";
      const live = hook.lines.filter((l) => !isZeroSha(l.localSha) && !isZeroSha(l.remoteSha));
      const newBranch = hook.lines.filter((l) => !isZeroSha(l.localSha) && isZeroSha(l.remoteSha));
      if (live.length === 0 && newBranch.length === 0) {
        console.log("PREPUSH: PASS (DELETE-REMOTE-BRANCH, no checks)");
        return 0;
      }
      const parts = [];
      for (const l of live) {
        parts.push(collectChanged(root, { from: l.remoteSha, to: l.localSha }));
      }
      for (const l of newBranch) {
        let base;
        try {
          base = gitOut(root, ["merge-base", "origin/main", l.localSha]).trim();
        } catch {
          console.error(P + "ERROR: 无法确定基底（新建分支，merge-base origin/main 失败）");
          console.log("PREPUSH: FAIL (cannot-determine-base)");
          return 1;
        }
        parts.push(collectChanged(root, { from: base, to: l.localSha }));
      }
      changed = mergeChanged(parts);
      baseLabel = hook.lines.map((l) => l.remoteSha.slice(0, 10)).join(",");
    } else {
      mode = "manual (base=merge-base origin/main HEAD)";
      const fetched = tryFetch(root);
      if (!fetched) {
        let localSha = "";
        try {
          localSha = gitOut(root, ["rev-parse", "--short", "origin/main"]).trim();
        } catch {
          localSha = "未知";
        }
        warnings.push(`WARN: fetch origin/main 失败，使用本地副本（${localSha}），基底可能过期`);
      }
      let base;
      if (opts.base) {
        try {
          base = gitOut(root, ["rev-parse", "--verify", `${opts.base}^{commit}`]).trim();
        } catch {
          console.error(P + `ERROR: --base 无法解析：${opts.base}`);
          return 2;
        }
        baseLabel = `${opts.base} (${base.slice(0, 10)})`;
      } else {
        try {
          base = gitOut(root, ["merge-base", "origin/main", "HEAD"]).trim();
        } catch {
          console.error(P + "ERROR: 无法确定基底（无 origin/main、浅克隆或无共同祖先；可用 --base <ref> 显式指定）");
          console.log("PREPUSH: FAIL (cannot-determine-base)");
          return 1;
        }
        baseLabel = `merge-base origin/main HEAD (${base.slice(0, 10)})`;
      }
      changed = collectChanged(root, { from: base, to: "HEAD" });
      changed.base = base;
    }
  }

  // ---- 2. 映射 -------------------------------------------------------------
  const graphLib = await loadGraphLib(root);
  const mapping = mapToTests(changed.pushed, { root, graph: graphLib, full: opts.full });
  for (const w of mapping.warnings) warnings.push(w);
  if (!graphLib) warnings.push("WARN: 模块图库加载失败，已降级到词根映射");

  // 未跟踪的新测试文件（§1.3）：不在推送里，仍可跑，但失败不判 FAIL。
  // 只有本次推送非空时才纳入——空推送（已是最新）不应被一个未跟踪文件拖进一次 vitest。
  const untrackedTests =
    changed.pushed.length > 0
      ? (changed.untracked ?? [])
          .filter((f) => TEST_FILE_RE.test(f))
          .map((f) => toRunnableTest(f))
          .filter((t) => t && existsSync(join(root, t)))
      : [];
  const untrackedOnly = new Set(untrackedTests);
  const vitestTests = sortUnique([...mapping.tests, ...untrackedTests]);

  const steps = planChecks(mapping, changed, { root, full: opts.full });
  const vitestStep = steps.find((s) => s.id === "vitest");
  if (vitestStep) vitestStep.run = vitestTests.length > 0;

  // 脏检测：B/C/D 与“推送受影响路径”（推送文件 + 推送映射出的测试）的交集。
  // 未跟踪-only 的测试不计入（它们不在推送里，不能反过来把自己算成“脏交集”）。
  const dirty = dirtyIntersection(
    [...changed.pushed, ...mapping.tests],
    changed.staged,
    changed.unstaged,
    changed.untracked,
  );

  // ---- 3. --dry-run：只打印，不跑 ------------------------------------------------
  if (opts.dryRun) {
    if (jsonMode) {
      console.log(JSON.stringify({ mode, base: baseLabel, changed, mapping: { ...mapping, reasons: Object.fromEntries(mapping.reasons) }, steps: steps.map((s) => ({ id: s.id, run: s.run, skipReason: s.skipReason })), dirty, untrackedTests }, null, 2));
    } else {
      console.log(`DRYRUN_TESTS=${JSON.stringify(vitestTests)}`);
      console.log(`DRYRUN_CHANGED=${JSON.stringify(changed.pushed)}`);
      log(`mode: ${mode}`, `base: ${baseLabel}`);
      log(`pushed: ${changed.pushed.length} files`);
      for (const f of changed.pushed) log(`  + ${f}`);
      log(`worktree-only（不在本次推送内）: staged ${changed.staged.length} / unstaged ${changed.unstaged.length} / untracked ${changed.untracked.length}`);
      if (dirty.length > 0) log(`DIRTY-WARNING: ${dirty.length} files overlap the pushed change: ${dirty.join(", ")}`);
      log(`vitest: ${vitestTests.length} files${mapping.full ? `（全量：${mapping.fullReason}）` : ""}`);
      for (const t of vitestTests) log(`  - ${t} (${mapping.reasons.get(t) ?? "untracked-only"})`);
      if (mapping.e2e.length > 0) log(`e2e: deferred-to-CI (${mapping.e2e.length} specs)`);
      if (mapping.e2eConfig) log(`E2E-CONFIG: CI-ONLY（playwright.config.ts 改动）`);
      for (const s of steps) log(`${s.run ? "RUN " : "SKIP"} ${s.id}${s.run ? "" : " — " + s.skipReason}`);
      for (const s of mapping.skipped) log(`SKIP: ${s.file} — ${s.reason}`);
      for (const w of warnings) log(w);
      console.log("PREPUSH: DRY-RUN (no checks executed)");
    }
    return 0;
  }

  // ---- 4. 跑检查（不 fail-fast：一次给完整清单；mirror 失败则后续免跑）------
  const results = [];
  let aborted = false;
  for (const step of steps) {
    if (aborted) {
      results.push({ id: step.id, title: step.title, status: "skipped", durationMs: 0, detail: "上游 mirror 步骤未通过，后续未跑" });
      continue;
    }
    const res = runStep(step, { root, junitFile, tests: vitestTests });
    if (step.id === "vitest" && res.status === "fail") {
      // 失败文件提取：junit 优先，stdout 回退；只挂未跟踪测试时不判 FAIL。
      let failedFiles = [];
      try {
        if (existsSync(junitFile)) failedFiles = parseJunitFailures(readFileSync(junitFile, "utf8"));
      } catch {
        failedFiles = [];
      }
      if (failedFiles.length === 0) failedFiles = extractStdoutFailures(res.detail);
      res.failedFiles = failedFiles;
      const onlyUntracked = failedFiles.length > 0 && failedFiles.every((f) => untrackedOnly.has(f));
      if (onlyUntracked) {
        res.status = "pass";
        res.detail = `仅未跟踪测试失败（不在本次推送内，不判 FAIL）：${failedFiles.join(", ")}`;
        warnings.push(`WARN: 未跟踪测试失败（UNTRACKED-ONLY，不在本次推送内）：${failedFiles.join(", ")}`);
      } else if (failedFiles.length > 0) {
        res.detail = `失败文件：${failedFiles.join(", ")}\n${res.detail}`;
      }
    }
    results.push(res);
    if (!jsonMode) {
      const secs = (res.durationMs / 1000).toFixed(1);
      const line = `${res.status.toUpperCase()} ${step.id} (${secs}s)${res.detail ? ": " + res.detail.split("\n")[0] : ""}`;
      console.log(P + line);
      if (res.status === "fail" || res.status === "error") {
        for (const extra of res.detail.split("\n").slice(1)) console.log(P + "  " + extra);
      }
    }
    if (step.id === "mirror" && (res.status === "fail" || res.status === "error")) aborted = true;
  }

  // ---- 5. 结论 -----------------------------------------------------------------
  const exitCode = decideExit(results);
  const failed = results.filter((r) => r.status === "fail" || r.status === "error");
  const vitestRes = results.find((r) => r.id === "vitest");
  const vitestSummary = vitestRes
    ? vitestRes.status === "pass"
      ? `${vitestTests.length} files passed`
      : vitestRes.status === "skipped"
        ? "skipped"
        : `${(vitestRes.failedFiles ?? []).length} files failed${vitestRes.failedFiles?.length ? ": " + vitestRes.failedFiles.join(", ") : ""}`
    : "n/a";
  const bits = [`vitest: ${vitestSummary}`];
  if (mapping.e2e.length > 0) bits.push(`e2e: deferred-to-CI (${mapping.e2e.length} specs)`);
  if (mapping.e2eConfig) bits.push("e2e-config: deferred-to-CI");
  if (dirty.length > 0) bits.push(`working-tree-dirty: ${dirty.length} files`);
  if (failed.length > 0) bits.push(`failed: ${failed.map((f) => f.id).join(", ")}`);
  const conclusion = exitCode === 0 ? "PASS" : "FAIL";

  if (jsonMode) {
    console.log(JSON.stringify({
      mode,
      base: baseLabel,
      changed,
      mapping: { ...mapping, reasons: Object.fromEntries(mapping.reasons) },
      dirty,
      untrackedTests,
      warnings,
      steps: results,
      conclusion,
      exitCode,
    }, null, 2));
    return exitCode;
  }

  log(`mode: ${mode}`, `base: ${baseLabel}`);
  log(`pushed: ${changed.pushed.length} files`);
  log(`worktree-only（不在本次推送内）: staged ${changed.staged.length} / unstaged ${changed.unstaged.length} / untracked ${changed.untracked.length}`);
  if (dirty.length > 0) {
    log(`DIRTY-WARNING: ${dirty.length} 个工作区文件与本次推送的受影响路径重叠（只警告，不挡推送）：`);
    for (const f of dirty) log(`  ! ${f}`);
  }
  if (mapping.e2e.length > 0 || mapping.e2eConfig) {
    log("E2E: CI-ONLY — 本地未运行（Playwright 需 channel chrome + 独占 dev 服务器，本地环境跑不了）");
    for (const f of mapping.e2e) log(`  - ${f}（本次推送改动）`);
    if (mapping.e2eConfig) {
      log(`  - playwright.config.ts（本次推送改动；e2e/*.spec.ts 共 ${countE2eSpecs(root)} 个）`);
    }
    log("  → 由 CI test-e2e 作业（2 分片）验证；推送后以 CI 结论为准。");
  }
  for (const s of mapping.skipped) log(`SKIP: ${s.file} — ${s.reason}`);
  for (const w of warnings) log(w);
  console.log(`PREPUSH: ${conclusion} (${bits.join("; ")})`);
  return exitCode;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  // 注意：不得用 process.exit(code) 直接退——stdout 是管道时 console.log 是异步写，
  // 大输出（全量干跑的千行清单）还没刷完就会被截断（实测 DRYRUN_TESTS 行丢失）。
  // 置 process.exitCode 让事件循环排空后再自然退出。
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(P + "脚本自身异常：" + (error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    },
  );
}
