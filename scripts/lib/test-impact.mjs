/**
 * 测试影响面：改动文件 → 会被它影响到的测试（模块图倒排）。
 *
 * 为什么需要：pre-commit 的选测此前只有「词根匹配」——改动文件的名字出现在测试
 * 文件名/内容里才算相关。它有两个盲区，且**都不报错**：
 *   1. 漏选：改 `packages/core/src/x.ts` 时，名字里没有 x 的测试其实全都依赖它
 *      （经 `@navhub/core` 或 overlay 的再导出模块）。
 *   2. 误选：改 `scripts/check-foo.mjs` 时，词根 check 把同前缀族整族拖进来。
 * 模块图直接回答「谁（传递地）引用了它」，两个方向都能修。
 *
 * 三条边，缺一不可：
 *   - **import 边**：静态说明符（import / export … from / require / import()），
 *     由 scripts/lib/source-refs.mjs 解析（含 `@/`、`@navhub/<pkg>` 别名与扩展名回退）。
 *   - **路径字面量边**：守卫型测试不 import 源码，而是 readFileSync / spawn 它。
 *     真实例子：`apps/web/test/restore-page-guard.test.ts` 里 `"src/app/…/page.tsx"`
 *     （相对 overlay 根）、`scripts/check-bundle-budget.test.ts` 里 spawn 的脚本路径、
 *     `scripts/check-ci-gate.test.ts` 里读的 `.github/workflows/ci.yml`（非代码文件也是节点）。
 *     只从测试文件里抽（源码里的路径字符串多半是文案，抽了全是噪声）。
 *   - **镜像边**：`scripts/core-mirrors.json` 登记的 core ↔ overlay 逐字节镜像。
 *     两侧是同一份实现的两个落点，改任一侧，消费另一侧的测试都会受影响。
 *
 * 口径（保守优先，漏跑由 CI 全量兜底，误跑只浪费本机时间）：
 *   - `apps/web/src/**` 视为 `apps/web-overlay/src/**` 的同一节点（vendored 镜像，
 *     gitignore 生成物）；否则本地有没有 vendor 会改变选测结果。
 *   - `apps/web-overlay/test/**` 不是可运行测试（没有自己的 node_modules，见
 *     vitest.config.ts），不进结果；改动 overlay 测试由选测器映射到 apps/web/test 镜像。
 *   - 解析不了/读不了的文件跳过，不抛错——选测器必须永远能给出一个结果。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  dirnameOf,
  escapeRegExp,
  extractSpecifiers,
  isRepoRelativePath,
  joinedPathLiterals,
  normalizePath,
  REPO_RELATIVE_PREFIXES,
  resolveSpecifier,
  stripComments,
  WORKSPACE_ALIAS_ROOTS,
} from "./source-refs.mjs";

export const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|mts|cts)$/;
const SOURCE_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "coverage", ".git", "tmp", "deliverables", "public", "out", ".turbo"]);

/** 扫描目录：够得着测试的源码树。apps/web/src 不扫——它是 overlay 的镜像，统一按 overlay 记账 */
const BASE_SCAN_DIRS = [
  "apps/api/src",
  "apps/api/test",
  "apps/web-overlay/src",
  "apps/web-overlay/test",
  "apps/web-overlay/scripts",
  "apps/web/test",
  "scripts",
  "types",
  "e2e",
];

/**
 * 能出现在选测结果里的测试根（= vitest.config.ts 的 include，去掉不可运行的 overlay/test）。
 * `packages/*\/test` 也在其中：CI 的 `vitest run --shard` 会跑它们。漏在图外时，改 core
 * 源码只能靠词根兜底选 core 自己的测试——兜底不报错，也不保证覆盖。
 */
const RESULT_TEST_ROOTS = ["apps/api/test/", "apps/web/test/", "apps/web-overlay/scripts/", "scripts/"];
const PACKAGES_TEST_RE = /^packages\/[^/]+\/test\//;

function isResultTestFile(file) {
  if (!TEST_FILE_RE.test(file)) return false;
  return PACKAGES_TEST_RE.test(file) || RESULT_TEST_ROOTS.some((prefix) => file.startsWith(prefix));
}

const ALIAS_ROOTS = {
  "@/": "apps/web-overlay/src",
  ...WORKSPACE_ALIAS_ROOTS,
};

/**
 * 路径字面量：测试里 readFileSync / spawn 的目标。
 * 两种写法都要认：
 *   - 仓库相对（`scripts/check-x.mjs`、`packages/core/src/x.ts`、`.github/workflows/ci.yml`）；
 *   - overlay 相对（`src/app/.../page.tsx`）——守卫型测试普遍用 `join(overlayRoot, "src/…")`。
 *
 * 仓库根前缀表在 scripts/lib/source-refs.mjs（`REPO_RELATIVE_PREFIXES`）：那三类非代码目录
 * （`.github/`、`docker/`、`docs/`）是 2026-10-29 补的盲区，选测与提交原子性两道门禁共用同一张表。
 */
const OVERLAY_RELATIVE_PREFIXES = ["src", "app"];
const escapeRe = escapeRegExp;
const PATH_LITERAL_RE = new RegExp(
  `["'\`]((?:${[...REPO_RELATIVE_PREFIXES, ...OVERLAY_RELATIVE_PREFIXES]
    .map(escapeRe)
    .join("|")})/[A-Za-z0-9_@./[\\]-]+)["'\`]`,
  "g",
);
const FILE_LIKE_RE = /\.(tsx?|mts|cts|mjs|cjs|jsx?|json|md|ya?ml|xml|css|txt)$/;

const isRepoRelative = isRepoRelativePath;

/**
 * 一笔提交里「图可能有节点」的那些路径 = 回放的可见集。
 *
 * 与前缀表同源，所以 `--diff` 不再按代码后缀筛：只改 `.github/workflows/ci.yml`
 * 或 `docker/Dockerfile.api` 的提交此前在回放里等于没改（2026-10-29 实测：
 * 一笔 ci.yml-only 提交把「--diff HEAD~1 该给出图命中数」打红）。
 * 一张表三处用（抽取正则 / 仓库相对判定 / 回放可见集）——分处写迟早只加一半。
 */
export function graphVisibleFiles(files) {
  return files.filter((f) => isRepoRelative(String(f).replace(/\\/g, "/")));
}

/**
 * 分段拼接路径的抽取口径与提交原子性共用一份（`source-refs.joinedPathLiterals`）。
 * 图侧不需要「这次是读还是写」，所以把 before 丢掉只留路径。
 */
function joinedLiteralDeps(text) {
  return new Set(joinedPathLiterals(text).map(({ path }) => path));
}

/** apps/web/src ↔ apps/web-overlay/src 视为同一节点（镜像） */
export function canonicalPath(p) {
  const norm = normalizePath(String(p ?? ""));
  if (norm === "apps/web/src") return "apps/web-overlay/src";
  if (norm.startsWith("apps/web/src/")) return "apps/web-overlay/src/" + norm.slice("apps/web/src/".length);
  return norm;
}

function ancestorDirs(file) {
  const out = [];
  let cur = dirnameOf(file);
  while (cur && cur !== "." && cur !== "/") {
    out.push(cur);
    const next = dirnameOf(cur);
    if (next === cur) break;
    cur = next;
  }
  return out;
}

/** 目录 / 文件大小写不敏感的实际存在性（Windows 上 statSync 本身不敏感，这里只做归一） */
function isFile(root, rel) {
  try {
    return statSync(join(root, rel)).isFile();
  } catch {
    return false;
  }
}

function walk(root, relDir, out) {
  const abs = join(root, relDir);
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(root, relDir + "/" + entry.name, out);
    } else if (entry.isFile() && SOURCE_RE.test(entry.name)) {
      out.push(relDir + "/" + entry.name);
    }
  }
}

function scanDirs(root) {
  const dirs = BASE_SCAN_DIRS.slice();
  try {
    for (const name of readdirSync(join(root, "packages"))) {
      for (const sub of ["src", "test"]) {
        const rel = `packages/${name}/${sub}`;
        if (existsSync(join(root, rel))) dirs.push(rel);
      }
    }
  } catch {
    // 没有 packages/ 也不影响其它树
  }
  if (existsSync(join(root, "packages/core/src"))) dirs.push("packages/core/src");
  return [...new Set(dirs.filter((d) => existsSync(join(root, d))))];
}

/** core ↔ overlay 镜像对（来自登记清单；目录型的 source 记成目录边） */
export function mirrorPairs(root) {
  const pairs = [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, "scripts/core-mirrors.json"), "utf8"));
  } catch {
    return pairs;
  }
  for (const group of ["verbatim", "adapter", "external"]) {
    for (const entry of manifest[group] ?? []) {
      if (!entry?.name) continue;
      const source = normalizePath(entry.source ?? `packages/core/src/${entry.name}.ts`);
      const target = normalizePath(entry.target ?? `apps/web-overlay/src/lib/${entry.name}.ts`);
      pairs.push([source, target]);
    }
  }
  return pairs;
}

/** 测试里出现的路径字面量 → 依赖（文件或目录） */
export function pathLiteralDeps(text) {
  const deps = new Set();
  for (const m of String(text).matchAll(PATH_LITERAL_RE)) {
    const lit = m[1].replace(/\/+$/, "");
    if (!lit) continue;
    // overlay 相对写法（"src/app/…"）只在裸 src/ 开头时成立；仓库相对写法原样使用
    if (!isRepoRelative(lit)) {
      deps.add("apps/web-overlay/" + lit);
      continue;
    }
    deps.add(lit);
  }
  for (const dep of joinedLiteralDeps(text)) deps.add(dep);
  return deps;
}

/**
 * 建图。成本在「读一遍源码树 + 正则抽说明符」；调用方应按 root 缓存。
 * @returns {{root:string, testFiles:Set<string>, reverse:Map<string,Set<string>>, stats:object}}
 */
export function buildGraph({ root = process.cwd() } = {}) {
  const dirs = scanDirs(root);
  const files = [];
  for (const dir of dirs) walk(root, dir, files);

  const testFiles = new Set();
  const reverse = new Map();
  let edges = 0;
  const addEdge = (from, to) => {
    const canon = canonicalPath(to);
    let set = reverse.get(canon);
    if (!set) {
      set = new Set();
      reverse.set(canon, set);
    }
    if (!set.has(from)) {
      set.add(from);
      edges += 1;
    }
  };

  for (const file of files) {
    const canon = canonicalPath(file);
    if (isResultTestFile(file)) testFiles.add(canon);

    let text;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }

    const deps = new Set();
    for (const { spec } of extractSpecifiers(text)) {
      const resolved = resolveSpecifier(canon, spec, {
        aliasRoots: ALIAS_ROOTS,
        exists: (p) => isFile(root, canonicalPath(p)),
      });
      if (resolved) deps.add(canonicalPath(resolved));
    }

    // 路径字面量只从测试里抽，且先剥注释：
    //   - 源码里的路径字符串多是文案/示例（客户端图门禁踩过同类坑）；
    //   - 注释里「与 check-x 同一套环境变量」这类提及是弱证据，按它选测试会把
    //     无关文件拖进来（实测：改 install-git-hooks.mjs 时 4 个 web 测试仅因注释提及入选）。
    if (TEST_FILE_RE.test(file)) {
      for (const dep of pathLiteralDeps(stripComments(text))) {
        const canon = canonicalPath(dep);
        // 有没有后缀不能用来判「文件还是目录」：`docker/Dockerfile.api` 没有后缀，
        // 落到 dir: 分支后这条边永远匹配不上（改动文件只会以自身路径命中文件节点）。
        // 用真实存在性兜底——存在就是文件，不存在才按「测试扫这个目录」记账。
        if (FILE_LIKE_RE.test(canon) || isFile(root, canon)) deps.add(canon);
        else deps.add("dir:" + canon);
      }
    }

    for (const dep of deps) addEdge(canon, dep);
  }

  // 镜像边：双向（两侧同源，改哪侧都影响消费另一侧的测试）
  for (const [source, target] of mirrorPairs(root)) {
    if (!isFile(root, canonicalPath(source))) {
      // 目录型 source（如 diy-layout/）：消费方依赖「这个目录」
      if (source.endsWith("/")) addEdge(canonicalPath(target), "dir:" + source.replace(/\/+$/, ""));
      continue;
    }
    if (!isFile(root, canonicalPath(target))) continue;
    addEdge(canonicalPath(source), canonicalPath(target));
    addEdge(canonicalPath(target), canonicalPath(source));
  }

  return { root, testFiles, reverse, stats: { scanned: files.length, testFiles: testFiles.size, edges } };
}

let cached = null;
/** 进程内缓存（选测器一次提交只建一次图） */
export function graphFor(root = process.cwd()) {
  if (cached && cached.root === root) return cached;
  cached = buildGraph({ root });
  return cached;
}

/**
 * 哪些测试（传递地）依赖 changedFiles，以及「为什么」。
 *
 * 纯反向 BFS：从改动文件出发，沿「谁引用了我」走到底。BFS 先到先得 ⇒ 父指针给出的
 * 是一条**边数最短**的依赖链（链首是改动文件，链尾是测试）。目录依赖的父指针指向
 * 触发它的那个真实改动文件，否则链会以 `dir:apps/api/test` 这种合成节点开头，
 * 「为什么选这条」就没法读了。
 *
 * @returns {{tests:string[], paths:Map<string,string[]>}}
 */
export function impactedWithPaths(graph, changedFiles) {
  const start = [...new Set((changedFiles ?? []).map(canonicalPath).filter(Boolean))];
  const visited = new Set(start);
  const parent = new Map();
  const queue = start.slice();
  const hits = new Set();

  /**
   * 目录依赖只对**起点**生效，不参与传递。
   *
   * 语义：「这个测试会扫描某个目录」。它成立的条件是**改动的文件**落在该目录里，
   * 而不是「某个被连累的中间文件」落在里面。不这么切会传染：
   * 改 apps/api/src/routes/backup.ts → 命中整批 api 测试 → 它们的祖先目录
   * apps/api/test 连带命中「扫 apps/api/test 目录」的 mock-hygiene →
   * 一个 api 源码改动把 web 测试也拖进来（实测就是这么串味的）。
   */
  for (const file of start) {
    for (const dir of ancestorDirs(file)) {
      for (const dep of graph.reverse.get("dir:" + dir) ?? []) {
        if (visited.has(dep)) continue;
        visited.add(dep);
        parent.set(dep, file);
        queue.push(dep);
      }
    }
  }

  while (queue.length > 0) {
    const node = queue.shift();
    if (graph.testFiles.has(node)) hits.add(node);
    for (const dep of graph.reverse.get(node) ?? []) {
      if (visited.has(dep)) continue;
      visited.add(dep);
      parent.set(dep, node);
      queue.push(dep);
    }
  }

  const tests = [...hits].sort();
  const paths = new Map();
  for (const test of tests) {
    const chain = [];
    const guard = new Set();
    let cur = test;
    while (cur !== undefined && !guard.has(cur)) {
      guard.add(cur);
      chain.push(cur);
      cur = parent.get(cur);
    }
    paths.set(test, chain.reverse());
  }
  return { tests, paths };
}

/**
 * 哪些测试（传递地）依赖 changedFiles。
 * @returns {string[]} 仓库相对、posix、排好序
 */
export function impactedTests(graph, changedFiles) {
  return impactedWithPaths(graph, changedFiles).tests;
}
