#!/usr/bin/env node
/**
 * 提交闭包校验：判定「这组文件能不能作为一个完整提交」。
 *
 * ## 为什么需要它
 *
 * 本仓长期有 300+ 个未提交文件、多路会话并行。要提交某个切片时，真正的判据不是
 * 「这个切片改了哪些文件」，而是**「HEAD 缺了哪些符号」**：
 *
 *   - 少一个文件 ⇒ 提交后 HEAD 编译不过或运行期缺依赖；
 *   - 多一个无关文件 ⇒ 把别人的半成品带进历史。
 *
 * 通读 diff 凭感觉两头都会错。首次实测：8 条告警里 7 条是噪音、1 条是真缺口。
 *
 * ## 判据
 *
 * 1. 从候选集出发，沿**相对 import / `export ... from`** 广度遍历；
 * 2. 依赖不在 HEAD ⇒ 必须在候选集内，否则报缺口；
 * 3. 依赖在 HEAD 但工作区也改过（"脏依赖"）⇒ **不要求纳入**，而是逐个核对本次
 *    代码用到的符号（具名导入、`ns.foo` 形式）在 HEAD 版本里是否已存在。
 *    存在 ⇒ 那份脏改动与本提交无关，是噪音；
 * 4. `@navhub/<pkg>` 解析到 `packages/<pkg>/src/index.ts` 后再按同样规则判。
 *
 * 局限：不处理动态 `import()`；`export * from` 只核对目标文件存在，不展开符号。
 *
 * ## 用法
 *
 *   node scripts/check-commit-closure.mjs -- <path> [<path> ...]
 *   node scripts/check-commit-closure.mjs --paths-file .commit-paths.txt
 *
 * 退出码：0 = 闭包完整；1 = 有缺口（逐条打印）；2 = 参数错误。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** `import x from "y"` / `import * as ns from "y"` / `import { a, b as c } from "y"` */
const NAMED_IMPORT_RE = /\bimport\s+(?:\*\s+as\s+(\w+)|\{([^}]*)\}|(\w+))\s*from\s*["']([^"']+)["']/g;
/** `export * from "y"` / `export { a } from "y"` */
const EXPORT_FROM_RE = /\bexport\s+(?:\*|\{[^}]*\})\s*from\s*["']([^"']+)["']/g;
/** `import "y"`（副作用导入） */
const SIDE_EFFECT_RE = /\bimport\s*["']([^"']+)["']/g;

/** 从 `{ a, b as c, type D }` 里取出 a、b、D */
export function namedImports(inner) {
  if (!inner) return [];
  const names = [];
  for (const raw of inner.split(",")) {
    const cleaned = raw.trim().replace(/^type\s+/, "");
    const name = cleaned.split(/\s+as\s+/)[0].trim();
    if (name) names.push(name);
  }
  return names;
}

/** 该符号是否在给定源码里被导出（声明式，或出现在 export {...} 列表里） */
export function declares(src, name) {
  if (!src || !name) return false;
  const decl = new RegExp(
    "export (?:default )?(?:async )?(?:function|const|let|var|class|interface|type|enum) " + name + "\\b",
  );
  if (decl.test(src)) return true;
  for (const block of src.match(/export\s*\{[^}]*\}/g) || []) {
    const inner = block.slice(block.indexOf("{") + 1, block.lastIndexOf("}"));
    for (const raw of inner.split(",")) {
      const parts = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
      // `export { a as b }` 导出的是 b；`export { a }` 导出的是 a
      const exported = (parts.length > 1 ? parts[1] : parts[0]).trim();
      if (exported === name) return true;
    }
  }
  return false;
}

/** 把 import 说明符解析成仓库内的绝对路径；无法解析返回 null */
export function resolveSpecifier(fromFile, spec, root = process.cwd()) {
  if (spec.startsWith("@navhub/")) {
    const pkg = spec.slice("@navhub/".length).split("/")[0];
    return [join(root, "packages", pkg, "src", "index.ts"), join(root, "packages", pkg, "src", "index.tsx")].find((c) =>
      existsSync(c),
    ) ?? null;
  }
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  return [base, base + ".ts", base + ".tsx", join(base, "index.ts"), join(base, "index.tsx")].find((c) =>
    existsSync(c),
  ) ?? null;
}

/** 收集一个文件里所有的依赖说明符 → { spec, namespaceAlias, names } */
export function collectDeps(src) {
  const deps = [];
  const push = (spec, alias, inner) => {
    if (spec) deps.push({ spec, namespaceAlias: alias ?? null, names: namedImports(inner) });
  };
  NAMED_IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = NAMED_IMPORT_RE.exec(src))) push(m[4], m[1], m[2]);
  EXPORT_FROM_RE.lastIndex = 0;
  while ((m = EXPORT_FROM_RE.exec(src))) push(m[1], null, null);
  SIDE_EFFECT_RE.lastIndex = 0;
  while ((m = SIDE_EFFECT_RE.exec(src))) push(m[1], null, null);
  return deps;
}

/** 归一化 posix 风格相对路径（处理 . 与 ..） */
export function posixNormalize(p) {
  const out = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/**
 * HEAD 版本里是否导出了该符号 —— 会穿过 `export * from "./x.ts"` 这类 barrel。
 * 只看 HEAD 内容：脏依赖是否已自带该符号，决定它要不要进本次提交集。
 */
function headDeclares(relPath, name, headOfFile, depth = 0) {
  if (depth > 3) return false;
  const src = headOfFile(relPath);
  if (src === null) return false;
  if (declares(src, name)) return true;
  const dir = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";
  for (const m of src.matchAll(/export\s+\*\s+from\s*["']([^"']+)["']/g)) {
    const spec = m[1];
    if (!spec.startsWith(".")) continue;
    const next = posixNormalize(dir + "/" + spec) + (spec.endsWith(".ts") ? "" : ".ts");
    if (headDeclares(next, name, headOfFile, depth + 1)) return true;
  }
  return false;
}

/** 只读 HEAD 内容；不存在返回 null */
function headOf(relPath) {
  try {
    return execFileSync("git", ["show", "HEAD:" + relPath], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function isDirty(relPath) {
  try {
    return execFileSync("git", ["status", "--porcelain", "--", relPath], { encoding: "utf8" }).trim().length > 0;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const out = [];
  let pathsFile = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--") continue;
    if (argv[i] === "--paths-file") {
      pathsFile = argv[i + 1];
      i += 1;
      continue;
    }
    out.push(argv[i]);
  }
  if (pathsFile) {
    for (const line of readFileSync(pathsFile, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) out.push(trimmed);
    }
  }
  return out.map((p) => p.split(sep).join("/"));
}

/** 纯函数核心：给定候选集与查询函数，返回缺口列表（便于单测） */
export function findGaps({ candidates, root, readFile, headOfFile, dirtyOf }) {
  const relOf = (abs) => (isAbsolute(abs) ? abs.split(sep).join("/").slice(root.length + 1) : abs.split(sep).join("/"));
  const inSet = new Set(candidates);
  const problems = [];
  const queue = [...candidates];
  const visited = new Set();

  while (queue.length) {
    const file = queue.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    let src;
    try {
      src = readFile(file);
    } catch {
      problems.push(file + "：文件不存在");
      continue;
    }
    for (const dep of collectDeps(src)) {
      // 候选集里的路径可能是相对 root 的；resolve 之前先锚到 root，否则会误用 cwd
      const absFile = isAbsolute(file) ? file : join(root, file);
      const target = resolveSpecifier(absFile, dep.spec, root);
      if (!target) {
        if (dep.spec.startsWith(".")) problems.push(file + " → 解析不到 " + dep.spec);
        continue;
      }
      const rel = relOf(target);
      if (inSet.has(rel) || visited.has(rel)) continue;
      const head = headOfFile(rel);
      if (head === null) {
        problems.push(file + " → " + rel + "：不在 HEAD，必须加入本次提交集");
        continue;
      }
      if (!dirtyOf(rel)) continue;
      const names = [...dep.names];
      if (dep.namespaceAlias) {
        const re = new RegExp("\\b" + dep.namespaceAlias + "\\.([A-Za-z_][A-Za-z0-9_]*)", "g");
        let u;
        while ((u = re.exec(src))) names.push(u[1]);
      }
      for (const name of new Set(names)) {
        if (!headDeclares(rel, name, headOfFile)) {
          problems.push(file + " → " + rel + "：用到 " + name + "，但 HEAD 版本没有（提交集必须包含它）");
        }
      }
    }
  }
  return { problems: [...new Set(problems)], fileCount: visited.size };
}

function main() {
  const candidates = parseArgs(process.argv.slice(2));
  if (candidates.length === 0) {
    console.error("用法: node scripts/check-commit-closure.mjs -- <path> [...]  |  --paths-file <file>");
    process.exit(2);
  }
  const { problems, fileCount } = findGaps({
    candidates,
    root: process.cwd(),
    readFile: (p) => readFileSync(p, "utf8"),
    headOfFile: headOf,
    dirtyOf: isDirty,
  });
  if (problems.length > 0) {
    console.error("✗ 闭包不完整（" + problems.length + " 条）：");
    for (const p of problems) console.error("  · " + p);
    process.exit(1);
  }
  console.log("✓ 闭包完整：" + fileCount + " 个文件参与遍历，未发现缺口");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
