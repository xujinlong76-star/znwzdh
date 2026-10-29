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
 * 依赖的两种形态都要认：
 *   1) 模块说明符：`import … from "@/lib/x"` / `../src/x`；
 *   2) 路径字面量：`readFileSync(resolve(ROOT, "src/app/admin/x.ts"))`。
 * 本仓大量门禁测试是第 2 种形态（读源码做钉子断言），只查 import 会漏掉事故里
 * 最典型的一类（admin-category-impact 就是直接读 page.tsx）。
 *
 * 口径：
 *   - 只审**测试文件**（*.test.* / *.spec.*）：普通源码允许依赖脏文件（那是并行开发），
 *     测试不行——测试在 CI 里必然按提交树运行；
 *   - 目标必须真实存在且是文件；解析不到（包名、目录、动态拼接）一律不管；
 *   - `apps/web/src/x` 先归一到 `apps/web-overlay/src/x`（overlay 是事实源，
 *     apps/web/src 是构建期生成物、被 gitignore 覆盖，直接判会永远「不脏」而漏报）。
 */

import { extractSpecifiers, normalizePath, resolveSpecifier, stripComments } from "./source-refs.mjs";

export const TEST_FILE_RE = /\.(?:test|spec)\.(?:ts|tsx|mts|cts)$/;

/**
 * 仓库内路径字面量：必须带已知顶层前缀与源码扩展名。
 *
 * `src/`、`test/` 是相对「测试所属的那棵源码树」，其余按仓库根解析。
 * 不收纳 `public/`、`data/` 等运行期数据：它们是数据不是代码，改动了也未必
 * 属于同一个提交，收进来只会制造假红。
 */
const PATH_LITERAL_RE =
  /["'`]((?:apps\/(?:web-overlay|web|api)\/|packages\/[A-Za-z0-9._-]+\/|scripts\/|e2e\/|src\/|test\/)[^"'`\r\n]*?\.(?:ts|tsx|mts|cts|mjs|cjs|js|jsx|json))["'`]/g;

/** `@/` 别名按「文件所在的那棵源码树」解析（与 check-committed-refs.mjs 同口径） */
export function aliasRootsFor(file) {
  if (file.startsWith("apps/web-overlay/")) return { "@/": "apps/web-overlay/src" };
  if (file.startsWith("apps/web/")) return { "@/": "apps/web/src" };
  return {};
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
    if (m[1]) out.push(m[1]);
  }
  return [...new Set(out)];
}

/** 路径字面量 → 仓库根相对路径；不是仓库内形态返回 null */
export function literalToRepoPath(literal, fromFile) {
  const p = normalizePath(literal);
  if (p.startsWith("apps/") || p.startsWith("packages/") || p.startsWith("scripts/") || p.startsWith("e2e/")) {
    return p;
  }
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
 * 收集一个测试文件依赖的全部仓库内文件。
 * 返回 Map<仓库路径, 首个触发它的说明符>，用于报错时给出人能看懂的来源。
 */
export function collectTestDependencies(source, testFile, { exists }) {
  const deps = new Map();
  const add = (target, spec) => {
    if (!target) return;
    const fact = toFactSource(target, exists);
    if (!deps.has(fact)) deps.set(fact, spec);
  };

  for (const { spec } of extractSpecifiers(source)) {
    add(
      resolveSpecifier(testFile, spec, { aliasRoots: aliasRootsFor(testFile), exists }),
      spec,
    );
  }
  // 注释里的示例路径不是依赖（同 extractSpecifiers 的口径）
  for (const literal of extractPathLiterals(stripComments(source))) {
    const rel = literalToRepoPath(literal, testFile);
    if (rel && exists(rel)) add(rel, literal);
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

    for (const [target, spec] of collectTestDependencies(source, test, { exists })) {
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
