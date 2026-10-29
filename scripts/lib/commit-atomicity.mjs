/**
 * 提交原子性判定：本次提交里的**测试**，依赖的源码不能停在「脏了但没提交」的状态。
 *
 * 为什么需要（2026-10-29 真实事故）：并行会话先把测试提交（89a20b42），源码还留在
 * 自己的暂存区。本地跑测试时读的是工作区（新源码），全绿；CI 检出的是提交树
 * （旧源码），26 个用例同时红。判据错位的根因不是测试写得不对，而是**提交不原子**：
 * 测试与它断言的源码版本不在同一个提交里。
 *
 * 与 check-committed-refs.mjs 的分工：
 *   - 那枚管「引用了从未入库的文件」（磁盘有、git 索引没有）；
 *   - 这枚管「引用了入库过的文件，但工作区版本与 HEAD 不同、且不在本次提交集」。
 *   两者互补：前者的目标根本没进过 HEAD，后者的目标在 HEAD 里只是旧版本。
 *
 * 依赖的三种形态都要认：
 *   1) 模块说明符：`import … from "@/lib/x"` / `../src/x`；
 *   2) 路径字面量：`readFileSync(resolve(ROOT, "src/app/admin/x.ts"))`，
 *      以及**非代码**目标 `readFileSync(join(ROOT, ".github/workflows/ci.yml"))`；
 *   3) 分段拼接：`const SCRIPT = resolve(ROOT, "scripts", "check-large-files.mjs")`
 *      再 `readFileSync(SCRIPT)`——每段都不带 `/`，第 2 路的整串正则抽不出来。
 * 本仓大量门禁测试是第 2/3 种形态（读源码/接线做钉子断言），只查 import 会漏掉事故里
 * 最典型的一类（admin-category-impact 就是直接读 page.tsx）。
 *
 * 第 3 路的取舍（2026-10-30 实测）：**只否写入，不要求读到调用名**。
 * 「真实存在且受版本控制」的分段边全仓只有 23 条（其余是夹具里的假路径，永远不会脏），
 * 而按 `isReadArgument` 筛会砍掉 17 条、其中 16 条是真依赖——先拼后读是本仓主流写法。
 *
 * 口径：
 *   - 测试：只审**测试文件**（*.test.* / *.spec.*）：普通源码允许依赖脏文件（那是并行开发），
 *     测试不行——测试在 CI 里必然按提交树运行；
 *   - 源码：只审「导出签名被改写且本次源码真的用到该符号」的依赖（见 findSourceCompanionViolations），
 *     闭包里有脏文件本身不算——共享工作区里那样会把无关提交全部拦下；
 *   - 依赖解析要穿两跳：`@navhub/store` 这类 barrel 先展开**再导出闭包**，否则签名变化
 *     藏在 `packages/store/src/repository/*.ts` 第二跳就漏检（2026-10-29 事故正是如此）；
 *   - 目标必须真实存在且是文件；解析不到（外部包名、目录、动态拼接）一律不管；
 *   - `apps/web/src/x` 先归一到 `apps/web-overlay/src/x`（overlay 是事实源，
 *     apps/web/src 是构建期生成物、被 gitignore 覆盖，直接判会永远「不脏」而漏报）。
 */

import {
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

export const TEST_FILE_RE = /\.(?:test|spec)\.(?:ts|tsx|mts|cts)$/;

/**
 * 仓库内路径字面量：必须带已知顶层前缀，且后缀说明它是个**被读的文件**。
 *
 * `src/`、`test/` 是相对「测试所属的那棵源码树」，其余按仓库根解析。
 *
 * 为什么认非代码文件（2026-10-29 补）：本仓的门禁测试大量直接读 `.github/workflows/ci.yml`
 * （check-ci-gate / check-gates-registry / check-rate-limit-exemption / ci-red-ledger /
 * lib/workflow-actions）与 `docs/ci-red-ledger.json`。此前只认代码后缀，于是「只提交测试、
 * 把 ci.yml 留在工作区」这条**同一种不原子**的形状完全看不见——而它恰恰是最常见的一种：
 * 当天 P0 那笔提交就是测试 + ci.yml 同批。前缀表与选测同源（source-refs.mjs），
 * 不再分两处写。
 *
 * 仍不收纳 `public/`、`data/`：它们是数据不是断言对象，改动了也未必属于同一个提交，
 * 收进来只会制造假红。
 *
 * **非代码目标要求「被当作输入读取」**（见 isReadArgument）。为什么只对非代码加这条：
 * 代码文件的名字几乎只出现在真读取处（守卫测试就是读源码做断言），而非代码路径名会被当成
 * **例子**大量写进夹具——`makeRepo({ ".github/workflows/ci.yml": "jobs:" })`（对象键）、
 * `graphVisibleFiles(["docs/GATES-OPERATIONS.md"])`（数组元素）、`const p = "…ci.yml"`（赋值）。
 * 不加这条，热区文件 `.github/workflows/ci.yml` 会让每个只是「举了个例」的测试
 * 都对它的脏状态敏感——噪音门禁最后的去处是被人 `--no-verify` 绕过，等于没有门禁。
 * 实测本仓真读者的形态只有三种：`readFileSync(resolve(ROOT, "…"))` / `join(REPO_ROOT, "…")` /
 * 自研 helper `overlayFile("…")`，外加 `prepareClosureProblems({ dockerfilePath: "…" })`
 * 这种「键名说明它是个文件」的配置对象——四种都在，其余全是夹具举例。
 * 前提仍是「夹具路径不得撞真实路径」（docs/TESTING-CONVENTIONS.md）：撞了就退化成假红。
 */
const CODE_EXT = "ts|tsx|mts|cts|mjs|cjs|js|jsx|json";
/** 门禁测试断言的「内容契约」文件：接线、文档、样式、脚本，都不是代码但会被读 */
const NON_CODE_EXT = "md|ya?ml|xml|css|txt|sql|sh";
const TREE_PREFIXES = ["src", "test"];
const PREFIX_ALT = [...REPO_RELATIVE_PREFIXES, ...TREE_PREFIXES].map(escapeRegExp).join("|");
const PATH_LITERAL_RE = new RegExp(
  `["'\`]((?:${PREFIX_ALT})/[^"'\`\r\n]*?\\.(?:${CODE_EXT}|${NON_CODE_EXT})` +
    `|(?:${PREFIX_ALT})/[^"'\`\r\n]*?Dockerfile(?:\\.[A-Za-z0-9_-]+)?)["'\`]`,
  "g",
);
const CODE_SUFFIX_RE = new RegExp(`\\.(?:${CODE_EXT})$`);

/**
 * 写字类调用：它们的目标几乎都在临时目录（夹具自己造的树），不算「读了仓库里的文件」。
 * 只按**被调用名**判断，所以 `overlayFile("…")`、`read("…")` 这类自研读取 helper 不受影响。
 */
const WRITE_CALLEE_RE =
  /^(?:write|writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|rm|rmSync|rimraf|unlink|unlinkSync|cp|cpSync|copyFile|copyFileSync|mv|rename|utimes|utimesSync)$/;

/** 字面量前面的文本以「某调用的左括号（最多再加一个实参和逗号）」结尾 ⇒ 它是这个调用的实参。
 * 实参文本里**不许出现方括号/花括号**：`.toEqual(["x", ".github/workflows/ci.yml"])` 里第二个
 * 元素是数组成员（数据），不是第二个实参——只按「前面有逗号」判会把集合断言读成依赖。 */
const CALL_ARG_RE = /[\w$)\]]\s*\(\s*(?:[^\s(),[\]{}][^(),[\]{}]*?\s*,\s*)?$/;
/**
 * 属性值形态：`{ dockerfilePath: "docker/Dockerfile.api", readFile, exists }`。
 * 只有**键名说明它是个文件/目录目标**（以 Path/File/Dir 结尾）才算读取——
 * 否则 `{ name: "docs/x.md" }` 这种拿路径当数据的夹具会凭空制造敏感边。
 * 真实形状来自 scripts/check-hooks-fresh.test.ts：它把 Dockerfile 路径按配置对象传进
 * 闭包检查器，而那条断言确实依赖真实的 `docker/Dockerfile.api`（间接经 spawn 的同一枚门禁）。
 */
const PROP_VALUE_RE = /([A-Za-z_$][\w$]*(?:Path|File|Dir))\s*:\s*$/;
/** 从同样的位置把被调用名捞出来，用来排除写字类 */
const CALLEE_RE = /([\w$]+)\s*\(\s*(?:[^\s(),[\]{}][^(),[\]{}]*?\s*,\s*)?$/;

/**
 * 「这一处是不是写字类调用的目标」：被调用名（或配置键名）落在写字族里。
 * 分段拼接那一路只用它做**否决**，不反过来要求「必须是读」——
 * 实测本仓门禁测试的主流写法是 `const SCRIPT = resolve(ROOT, "scripts", "x.mjs")`
 * 先拼后读，按「必须读到调用名」筛会砍掉 17/26 条真实存在的边，其中 16 条是真依赖。
 */
export function isWriteTarget(textBefore) {
  const callee = CALLEE_RE.exec(textBefore)?.[1];
  if (callee && WRITE_CALLEE_RE.test(callee)) return true;
  const key = PROP_VALUE_RE.exec(textBefore)?.[1];
  return !!key && WRITE_CALLEE_RE.test(key);
}

/**
 * 「这一处字面量是不是被当作输入读的」——只看字面量之前的文本，不跨行找左括号。
 * 代价：`readFileSync(\n  ".github/workflows/ci.yml"\n)` 这种把路径单独起一行的写法读不出来；
 * 本仓没有这种形态，且漏判的方向是「不拦」，不会假红。
 */
export function isReadArgument(textBeforeLiteral) {
  if (isWriteTarget(textBeforeLiteral)) return false;
  if (CALL_ARG_RE.test(textBeforeLiteral)) return true;
  // 键名形态：`{ dockerfilePath: "…" }` 算读取目标
  return PROP_VALUE_RE.test(textBeforeLiteral);
}

/**
 * 别名：`@/` 按「文件所在的那棵源码树」解析（与 check-committed-refs.mjs 同口径），
 * `@navhub/<pkg>` 是工作区包别名（与模块图共用同一份 WORKSPACE_ALIAS_ROOTS——
 * 少一份就会漏掉 2026-10-29 那种 `from "@navhub/store"` 的跨包依赖）。
 */
export function aliasRootsFor(file) {
  const tree = file.startsWith("apps/web-overlay/")
    ? { "@/": "apps/web-overlay/src" }
    : file.startsWith("apps/web/")
      ? { "@/": "apps/web/src" }
      : {};
  return { ...tree, ...WORKSPACE_ALIAS_ROOTS };
}

/** `src/…`、`test/…` 这类相对字面量的锚点树 */
export function treeRootOf(file) {
  if (file.startsWith("apps/web-overlay/")) return "apps/web-overlay";
  if (file.startsWith("apps/web/")) return "apps/web";
  return "";
}

/** 抽出测试里的路径字面量（已剥注释；无法解析的动态拼接由后续 exists 过滤） */
export function extractPathLiterals(code) {
  const out = [];
  PATH_LITERAL_RE.lastIndex = 0;
  let m;
  while ((m = PATH_LITERAL_RE.exec(code)) !== null) {
    const lit = m[1];
    if (!lit) continue;
    // 代码后缀直接收；非代码目标要求「在本次出现处是被当实参读的」，否则只是夹具举的例子
    if (CODE_SUFFIX_RE.test(lit) || isReadArgument(code.slice(0, m.index))) out.push(lit);
  }
  return [...new Set(out)];
}

/** 路径字面量 → 仓库根相对路径；不是仓库内形态返回 null */
export function literalToRepoPath(literal, fromFile) {
  const p = normalizePath(literal);
  if (isRepoRelativePath(p)) return p;
  if (p.startsWith("src/") || p.startsWith("test/")) {
    const root = treeRootOf(fromFile);
    return root ? root + "/" + p : p;
  }
  return null;
}

/**
 * 把镜像路径归一到事实源。
 * overlay 是源真相；`apps/web/src` 是 vendor-web 的产物，被 gitignore 覆盖，
 * 用它判「脏不脏」永远是否——必须换成 overlay 同名文件。
 */
export function toFactSource(relPath, exists) {
  const p = normalizePath(relPath);
  if (p.startsWith("apps/web/src/")) {
    const overlay = "apps/web-overlay/src/" + p.slice("apps/web/src/".length);
    if (exists(overlay)) return overlay;
  }
  return p;
}

/**
 * 收集一个文件依赖的全部仓库内文件。
 * 返回 Map<仓库路径, 首个触发它的说明符>，用于报错时给出人能看懂的来源。
 *
 * `pathLiterals` 默认开：测试会 readFileSync/spawn 源码，路径字符串就是真依赖。
 * 源码侧关掉（见 findSourceCompanionViolations）：源码之间的依赖是 import，
 * 路径字符串多半是文案/日志/文档注释里的例子；且 stripComments 对「含引号的
 * 正则字面量」并不可靠（会把后面的块注释当成字符串而不剥离），放进源码侧
 * 只会把注释里的示例路径读成依赖，制造假红。
 */
export function collectDependencies(source, file, { exists, pathLiterals = true }) {
  const deps = new Map();
  const add = (target, spec) => {
    if (!target) return;
    const fact = toFactSource(target, exists);
    if (!deps.has(fact)) deps.set(fact, spec);
  };

  for (const { spec } of extractSpecifiers(source)) {
    add(resolveSpecifier(file, spec, { aliasRoots: aliasRootsFor(file), exists }), spec);
  }
  if (!pathLiterals) return deps;
  // 注释里的示例路径不是依赖（同 extractSpecifiers 的口径）
  const code = stripComments(source);
  for (const literal of extractPathLiterals(code)) {
    const rel = literalToRepoPath(literal, file);
    if (rel && exists(rel)) add(rel, literal);
  }
  // 分段拼接：`resolve(ROOT, "scripts", "x.mjs")` 每段都不带 `/`，上面那一路抽不出来。
  // 只否掉写字类调用（夹具往临时目录写时拼出的仓库同名路径是假依赖），不要求「读到调用名」
  // ——先拼成变量再 read 是本仓主流写法，加读取门槛会把 17/26 条真边一起砍掉。
  for (const { path, before } of joinedPathLiterals(code)) {
    if (isWriteTarget(before)) continue;
    if (exists(path)) add(path, path);
  }
  return deps;
}

/**
 * 纯函数核心。
 *
 * @param {object} io
 * @param {string[]} io.commitSet   本次提交集（仓库路径）
 * @param {(rel:string)=>string|null} io.readCommitted 读取提交版本内容（索引 blob）
 * @param {(rel:string)=>boolean} io.exists
 * @param {(rel:string)=>boolean} io.isDirty 工作区版本与 HEAD 不同，或未入库且未被忽略
 * @returns {{test:string,spec:string,target:string}[]}
 */
export function findAtomicityViolations({ commitSet, readCommitted, exists, isDirty }) {
  const committed = new Set(commitSet.map(normalizePath));
  const violations = [];
  const seen = new Set();

  for (const test of [...committed].sort()) {
    if (!TEST_FILE_RE.test(test)) continue;
    let source;
    try {
      source = readCommitted(test);
    } catch {
      continue;
    }
    if (typeof source !== "string") continue;

    for (const [target, spec] of collectDependencies(source, test, { exists })) {
      if (committed.has(target)) continue;
      if (!isDirty(target)) continue;
      const key = `${test}\0${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push({ test, spec, target });
    }
  }
  return violations;
}

/**
 * 源码 → 源码的伴随改动：staged 源码依赖的另一个源文件「导出签名改过、却没随本次提交」。
 *
 * 为什么要这条（2026-10-29 真实事故）：并行会话先提交路由（`7de79c31`），它调用的
 * `countVideoItems(repo, filter)` 对象重载还留在 `packages/store/src/repository/videos.ts`
 * 的工作区改动里。本机 typecheck 读工作区 → 全绿；CI 检出提交树（旧签名 `categoryId?: string`）
 * → 三个 SQLite 分片全部红在 typecheck，连带红灯光谱/台账/上传/聚合，一次根因五片红。
 *
 * 为什么不能像测试那样「闭包里只要脏就报」：共享工作区里另一条线天天有未提交的改动，
 * 闭包级判定会把无关提交全部拦下（噪音门禁最终会被人 --no-verify 绕过）。这里的判据收紧到
 * **符号级**：
 *   1. 目标文件的 HEAD→工作区 diff 里，有**被删除/改写的导出声明**（纯新增导出不算）；
 *   2. staged 源码的提交版本里**真的出现了那个符号名**。
 * 两个条件同时成立才拦——也就是「你调的那个 API，它在你没提交的另一半里变了」。
 */
export const SOURCE_FILE_RE =
  /^(?:apps\/api\/|packages\/[A-Za-z0-9._-]+\/src\/|apps\/web-overlay\/src\/|scripts\/).*\.(?:ts|tsx|mts|cts|mjs|cjs)$/;

const DECL_RE =
  /^\s*(?:export\s+)?(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const EXPORTED_DECL_RE =
  /^\s*export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const EXPORT_LIST_RE = /^\s*export\s+(?:type\s*)?\{([^}]*)\}/;

/**
 * 从 `git diff` 里抽「签名/实现被改过的导出符号」。
 *
 * 两种形态：
 *   1. 导出声明行本身被删（`-export async function foo(...)`）；
 *   2. 删除行落在某个导出声明的**参数/实现体内**（`-  opts: {…}`）——
 *      2026-10-29 的 `listVideoItems` 就是这种：函数名那行没动，签名类型行改了。
 *      靠 hunk 上下文里最近出现的声明头归属；非导出声明会清空归属，避免张冠李戴。
 *
 * 纯新增导出不算（`+` 行），那是「多了一个能力」，HEAD 的旧文件仍满足调用方。
 */
export function changedExportNames(diffText) {
  const names = new Set();
  let current = null;
  for (const raw of String(diffText).split(/\r?\n/)) {
    if (raw.startsWith("diff ") || raw.startsWith("index ") || raw.startsWith("---") || raw.startsWith("+++")) {
      continue;
    }
    if (raw.startsWith("@@")) {
      current = null;
      continue;
    }
    const sign = raw[0];
    if (sign !== " " && sign !== "+" && sign !== "-") continue;
    const line = raw.slice(1);
    const decl = EXPORTED_DECL_RE.exec(line);
    if (decl) {
      current = decl[1];
      if (sign === "-") names.add(current);
      continue;
    }
    if (DECL_RE.test(line)) {
      current = null;
      continue;
    }
    const list = EXPORT_LIST_RE.exec(line);
    if (list) {
      current = null;
      if (sign !== "-") continue;
      for (const item of list[1].split(",")) {
        const name = item.trim().split(/\s+as\s+/)[0]?.trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name ?? "")) names.add(name);
      }
      continue;
    }
    if (sign !== "-" || current === null) continue;
    // 删掉一行注释/空行不算签名变化
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;
    names.add(current);
  }
  return names;
}

/** 符号是否在源码里出现（词边界；`ns.foo` 与 `foo(` 都算） */
export function mentionsSymbol(source, symbol) {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w$])${escaped}([^\\w$]|$)`).test(String(source));
}

const REEXPORT_RE = /^\s*export\s+(?:\*|\{[^}]*\})\s+from\s*["']([^"']+)["']/;

/** 一个文件的「再导出」说明符（`export * from` / `export {x} from`），已解析成仓库路径 */
export function reexportTargets(source, file, { exists }) {
  const out = [];
  for (const line of stripComments(source).split(/\r?\n/)) {
    const m = REEXPORT_RE.exec(line);
    if (!m) continue;
    const target = resolveSpecifier(file, m[1], { aliasRoots: aliasRootsFor(file), exists });
    if (target) out.push(target);
  }
  return [...new Set(out)];
}

/**
 * 依赖目标的「再导出闭包」：`packages/store/src/index.ts` 里的 `export * from
 * "./repository/videos.ts"` 要把 videos.ts 也纳进来。
 *
 * 为什么必须展开：事故里路由 import 的是 barrel（`@navhub/store`），真正改签名的
 * 是 barrel 深处的 `repository/videos.ts`。只看直接依赖，签名变化藏在第二跳就漏了。
 * 只沿**再导出**走（不沿普通 import），否则等于遍历整包，噪声与开销都失控。
 */
export function reexportClosure(target, { readCommitted, exists, maxFiles = 200 }) {
  const out = [];
  const seen = new Set([target]);
  const queue = [target];
  while (queue.length > 0 && out.length < maxFiles) {
    const file = queue.shift();
    let source;
    try {
      source = readCommitted(file);
    } catch {
      continue;
    }
    if (typeof source !== "string") continue;
    for (const next of reexportTargets(source, file, { exists })) {
      if (seen.has(next)) continue;
      seen.add(next);
      out.push(next);
      queue.push(next);
    }
  }
  return out;
}

/**
 * @param {object} io
 * @param {(rel:string)=>Set<string>} io.changedExportsOf
 *        目标文件 HEAD→工作区被改写/删除的导出符号；干净文件返回空集。
 * @param {(rel:string)=>boolean} io.isDirty  先过脏集再算 diff，避免每个依赖都起一次 git
 * @returns {{file:string,spec:string,target:string,symbols:string[]}[]}
 */
export function findSourceCompanionViolations({
  commitSet,
  readCommitted,
  exists,
  isDirty,
  changedExportsOf,
}) {
  const committed = new Set(commitSet.map(normalizePath));
  const violations = [];
  const exportsCache = new Map();
  const changedOf = (rel) => {
    if (!exportsCache.has(rel)) exportsCache.set(rel, changedExportsOf(rel) ?? new Set());
    return exportsCache.get(rel);
  };

  for (const file of [...committed].sort()) {
    if (TEST_FILE_RE.test(file)) continue;
    if (!SOURCE_FILE_RE.test(file)) continue;
    // apps/web 是 vendor 生成物（gitignore），事实源在 overlay；对它判「脏」永远是否
    if (file.startsWith("apps/web/")) continue;
    let source;
    try {
      source = readCommitted(file);
    } catch {
      continue;
    }
    if (typeof source !== "string") continue;

    const bare = stripComments(source);
    const seenTargets = new Set();
    for (const [dep, spec] of collectDependencies(bare, file, { exists, pathLiterals: false })) {
      for (const target of [dep, ...reexportClosure(dep, { readCommitted, exists })]) {
        if (seenTargets.has(target)) continue;
        seenTargets.add(target);
        if (committed.has(target)) continue;
        if (!isDirty(target)) continue;
        const changed = changedOf(target);
        if (changed.size === 0) continue;
        const symbols = [...changed].filter((name) => mentionsSymbol(bare, name)).sort();
        if (symbols.length === 0) continue;
        violations.push({ file, spec, target, symbols });
      }
    }
  }
  return violations;
}

/**
 * HEAD 自洽性（字段级、方向翻转）——「提交树里的消费者」读的是「只存在于工作区的字段」。
 *
 * 为什么既有两路都看不见（2026-10-30 实测）：
 *   - `findAtomicityViolations` 只审**测试文件**，普通源码当消费者时不管；
 *   - `findSourceCompanionViolations` 的方向是「本次提交集 → 脏目标」，且粒度是**导出声明**
 *     （`changedExportNames` 只认被删/改的 `export function|const|interface …`）。
 *   真实形状是 `context.ts`（已提交）读 `config.search.semanticMinSimilarity`，而生产者
 *   `apps/api/src/config.ts` 里那个字段只在工作区：接口名那行没动，只是**成员表多了一行**，
 *   导出级判据永远返回空集 → 本地 typecheck 读工作区绿，CI 检出提交树红在 TS2353/TypeError。
 *   10-29→10-30 那批常驻红（3 片 SQLite typecheck + PG + ISR live + 2 片 E2E）全是这一型，
 *   当时是靠人读 annotation 反推出来的。
 *
 * 于是这里把两件事都反过来：
 *   1. 方向：遍历**脏的生产者**（工作区 ≠ 索引），看**提交树里的消费者**是否已在读它新加的字段；
 *   2. 粒度：补到**成员名**（对象字面量键 / 接口与类型成员）。
 *
 * 为什么默认只报不拦：共享工作区常年有在途脏源码，做成硬闸门会把无关提交永久锁死
 * （同 findSourceCompanionViolations 拒绝「闭包里有脏文件就拦」的理由）。它的价值是
 * **当场点名缺的那一半**，省掉「红灯归属」这一整轮排查。
 */
const MEMBER_STOPWORDS = new Set([
  "case",
  "default",
  "else",
  "return",
  "break",
  "continue",
  "do",
  "if",
  "for",
  "while",
  "switch",
  "try",
  "catch",
  "finally",
  "await",
  "yield",
  "new",
  "typeof",
  "keyof",
  "extends",
  "import",
  "export",
  "function",
  "const",
  "let",
  "var",
  "class",
  "interface",
  "type",
  "enum",
]);

/**
 * 逐行抽「成员名」：`foo:` / `foo?:` / `readonly foo:`（对象字面量键与接口/类型成员）。
 *
 * 刻意宽松到键名粒度——字段级判据要的就是「多出来的那个名字」。
 * 假阳性由调用侧两道闸收住：`\.name` 必须真出现在别的文件里，且那个文件得**依赖**生产者。
 */
export function memberNamesOf(text) {
  const names = new Set();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;
    const m = /^(?:(?:readonly|public|private|protected|override|static|abstract)\s+)*([A-Za-z_$][\w$]*)\s*\??\s*:(?![:=])/.exec(
      line,
    );
    if (!m) continue;
    if (MEMBER_STOPWORDS.has(m[1])) continue;
    names.add(m[1]);
  }
  return names;
}

/** `git diff` 里**新增行**带来的成员名（`+` 行；文件头 `+++` 不算正文） */
export function addedMemberNames(diffText) {
  const names = new Set();
  for (const raw of String(diffText).split(/\r?\n/)) {
    if (!raw.startsWith("+") || raw.startsWith("+++")) continue;
    for (const n of memberNamesOf(raw.slice(1))) names.add(n);
  }
  return names;
}

function isCommentBody(text) {
  const t = String(text).trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("#");
}

/** `.name` 的词边界引用（`?.name` 也算：`?` 不是词字符） */

/**
 * @param {object} io
 * @param {{file:string, unstagedDiff:string}[]} io.producers
 *        脏生产者：`unstagedDiff` = 工作区相对**索引**的 diff。用「相对索引」而不是「相对 HEAD」
 *        是刻意的：文件进了本次提交集但字段没暂存，同样是不自洽的提交树。
 * @param {(file:string)=>Set<string>} io.committedMembersOf
 *        该文件**提交版本**里已有的成员名（惰性问：只有 grep 到引用的生产者才需要读它的 blob——
 *        批量预读 40 个生产者实测 1.4s，惰性只读 3 个是 0.1s）。已有同名成员 → 提交树能满足消费者，不算孤儿。
 * @param {(tokens:string[])=>{file:string,line:number,text:string}[]} io.grepCommitted
 *        在提交树里批量搜 `.token`（一次 `git grep --cached`，不是每 token 起一次进程）
 * @param {(consumer:string, producer:string)=>boolean} io.dependsOn
 *        消费者是否（经 import / 再导出闭包）依赖生产者——没有这条边就不是它少提交的那一半
 * @param {number} [io.maxHitFiles]
 *        「可归因」的门槛：某个字段名的引用点散落在太多文件时，逐文件算依赖边的成本失控
 *        （每换一个消费者都要读它的提交版本）。默认 12——泛名字（`title`、`id`）落不进这一档，
 *        于是**故意不报**，宁可漏报也不把门禁做成几十秒。漏掉的那批经 `onSkip` 记账。
 * @param {(member:string, files:number)=>void} [io.onSkip]
 * @returns {{producer:string, member:string, consumers:{file:string,line:number,text:string}[], consumerCount:number}[]}
 */
export function findHeadConsumerOrphans({
  producers,
  committedMembersOf,
  grepCommitted,
  dependsOn,
  maxConsumers = 8,
  maxHitFiles = 12,
  onSkip,
}) {
  const candidates = [];
  const seenCandidate = new Set();
  for (const p of [...producers].sort((a, b) => a.file.localeCompare(b.file))) {
    if (!SOURCE_FILE_RE.test(p.file) || TEST_FILE_RE.test(p.file)) continue;
    if (typeof p.unstagedDiff !== "string") continue;
    for (const member of [...addedMemberNames(p.unstagedDiff)].sort()) {
      const key = `${p.file}\0${member}`;
      if (seenCandidate.has(key)) continue;
      seenCandidate.add(key);
      candidates.push({ producer: p.file, member });
    }
  }
  if (candidates.length === 0) return [];

  const hits = grepCommitted([...new Set(candidates.map((c) => `.${c.member}`))]) ?? [];
  /**
   * 把引用点按「成员名」分桶，一次扫描完成。
   *
   * 为什么不在这里对每个候选跑一遍 `hits.filter(re.test)`：候选 × 引用行是 95 × 1 万 =
   * 百万次正则（实测 1s+，全花在这）。改成从每行里抽出所有 `.标识符`，桶查表一次到位。
   */
  const byMember = new Map();
  for (const h of hits) {
    if (isCommentBody(h.text)) continue;
    for (const m of String(h.text).matchAll(/\.[A-Za-z_$][\w$]*/g)) {
      const name = m[0].slice(1);
      if (!byMember.has(name)) byMember.set(name, []);
      byMember.get(name).push(h);
    }
  }

  const out = [];
  const membersCache = new Map();
  for (const c of candidates) {
    // 提交版本里已有同名成员 → 消费者读得到，不是「少提交的那一半」
    if (!membersCache.has(c.producer)) {
      let already = new Set();
      try {
        already = committedMembersOf?.(c.producer) ?? new Set();
      } catch {
        already = new Set();
      }
      membersCache.set(c.producer, new Set([...already].map((n) => String(n))));
    }
    if (membersCache.get(c.producer).has(c.member)) continue;

    const matched = (byMember.get(c.member) ?? []).filter((h) => h.file !== c.producer);
    if (matched.length === 0) continue;
    const hitFiles = new Set(matched.map((h) => h.file));
    if (hitFiles.size > maxHitFiles) {
      onSkip?.(c.member, hitFiles.size);
      continue;
    }
    const consumers = [];
    const seenHit = new Set();
    for (const h of matched) {
      const hk = `${h.file}:${h.line}`;
      if (seenHit.has(hk)) continue;
      seenHit.add(hk);
      if (!dependsOn(h.file, c.producer)) continue;
      consumers.push(h);
    }
    if (consumers.length === 0) continue;
    consumers.sort((a, b) =>
      `${a.file}:${String(a.line).padStart(6, "0")}`.localeCompare(`${b.file}:${String(b.line).padStart(6, "0")}`),
    );
    out.push({
      producer: c.producer,
      member: c.member,
      consumers: consumers.slice(0, maxConsumers),
      consumerCount: consumers.length,
    });
  }
  return out.sort((a, b) => `${a.producer}#${a.member}`.localeCompare(`${b.producer}#${b.member}`));
}
