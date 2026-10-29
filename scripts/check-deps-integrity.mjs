#!/usr/bin/env node
/**
 * 依赖完整性门禁：抓「被装残的包」。
 *
 * ## 为什么需要它
 *
 * 2026-10-29 实测过两次同一类事故：pnpm 的自动安装在 Windows 上要**原子重命名**
 * 包目录，而目标目录正被测试进程占用 → `ERR_PNPM_EPERM`，安装半途而废，
 * 包被截断成「只剩 README / prebuilds / src」。症状极其误导：
 *
 *   - better-sqlite3 少了 package.json 与 lib → 154 个测试套件同时报
 *     `Cannot find module 'better-sqlite3'`，看起来像代码全坏了；
 *   - lucide-react 少了整个 dist/cjs → vite 报
 *     `Failed to resolve entry for package "lucide-react"`，指向一行再正常不过的 import。
 *
 * 这类问题与代码无关，越早认出「是依赖残了」越好。本脚本 30 秒内给出结论，
 * 而不是让 500+ 测试套件一起红了再来猜。
 *
 * ## 判据
 *
 *   1. `.pnpm` 下每个包目录都要有可解析的 `package.json`（`*_tmp_*` 是失败重命名的残留）；
 *   2. `main` / `module` / `types` 指向的文件必须真的存在；
 *   3. 上游包自身的已知例外进白名单（例如 `@humanfs/*` 的 `main` 冗余、真入口走 `exports`）。
 *
 * ## 用法
 *
 *   node scripts/check-deps-integrity.mjs            # 人读报告
 *   node scripts/check-deps-integrity.mjs --json     # 机器可读
 *   node scripts/check-deps-integrity.mjs --root <dir>
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AS_JSON = process.argv.includes("--json");

/**
 * 上游包自身的已知例外。
 *
 * 键是包名（不含版本），值是「可以缺的入口字段」。这些不是我们装残的——
 * 上游 tarball 里本来就没有那个文件，运行时走的是 `exports` 映射。
 * 加进来之前必须自己解包核对过，别把「我们装残了」误记成例外。
 */
const UPSTREAM_ENTRY_EXCEPTIONS = new Map([
  // @humanfs/core 与 @humanfs/node 的 `main` 都指向 dist/index.js，但 tarball 里
  // 只有 dist/*.d.ts 与 src/*.js；真入口是 exports.import.default = ./src/index.js。
  ["@humanfs/core", new Set(["main"])],
  ["@humanfs/node", new Set(["main"])],
]);

/** 解析 `node_modules/.pnpm` 下的真实包目录（含 scope），返回绝对路径列表 */
export function listPnpmPackages(pnpmDir) {
  const out = [];
  if (!existsSync(pnpmDir)) return out;
  const isTmpLeftover = (name) => /_tmp_\d+_\d+$/.test(name);
  for (const entry of readdirSync(pnpmDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // 失败的原子重命名会留下 `<name>_tmp_<pid>_<n>` 这种目录，没有任何包内容。
    // 它可能出现在两层：.pnpm 顶层，或某实例的 node_modules 里（实测两者都见过）。
    if (isTmpLeftover(entry.name)) {
      out.push({ path: join(pnpmDir, entry.name), tmpLeftover: true, name: entry.name });
      continue;
    }
    const inner = join(pnpmDir, entry.name, "node_modules");
    if (!existsSync(inner)) continue;
    for (const pkgEntry of readdirSync(inner, { withFileTypes: true })) {
      if (!pkgEntry.isDirectory()) continue;
      const pkgDir = join(inner, pkgEntry.name);
      if (isTmpLeftover(pkgEntry.name)) {
        out.push({ path: pkgDir, tmpLeftover: true, name: pkgEntry.name });
        continue;
      }
      if (pkgEntry.name.startsWith("@")) {
        for (const scoped of readdirSync(pkgDir, { withFileTypes: true })) {
          if (!scoped.isDirectory()) continue;
          if (isTmpLeftover(scoped.name)) {
            out.push({ path: join(pkgDir, scoped.name), tmpLeftover: true, name: `${pkgEntry.name}/${scoped.name}` });
            continue;
          }
          out.push({ path: join(pkgDir, scoped.name), tmpLeftover: false, name: `${pkgEntry.name}/${scoped.name}` });
        }
      } else {
        out.push({ path: pkgDir, tmpLeftover: false, name: pkgEntry.name });
      }
    }
  }
  return out;
}

/**
 * 检查单个包目录。返回问题数组（空数组 = 健康）。
 * 纯函数，便于用合成目录做回归。
 */
export function inspectPackage(pkgDir, name, exceptions = UPSTREAM_ENTRY_EXCEPTIONS) {
  const problems = [];
  const manifestPath = join(pkgDir, "package.json");
  if (!existsSync(manifestPath)) {
    problems.push({ kind: "missing-manifest", detail: "缺 package.json（多半是安装被中断）" });
    return problems;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    problems.push({ kind: "broken-manifest", detail: `package.json 解析失败：${err?.message ?? err}` });
    return problems;
  }
  const allowed = exceptions.get(name) ?? new Set();
  for (const field of ["main", "module", "types"]) {
    const entry = manifest[field];
    if (typeof entry !== "string" || entry.length === 0) continue;
    // 目录式入口（如 "lib"）交给运行时的目录解析，这里不判
    if (!/\.(js|mjs|cjs|ts|d\.ts)$/.test(entry)) continue;
    if (allowed.has(field)) continue;
    const target = join(pkgDir, ...entry.split("/"));
    if (!existsSync(target)) {
      problems.push({ kind: "missing-entry", detail: `${field} → ${entry} 但文件不存在` });
    }
    // 刻意**不判 0 字节**：上游 tarball 里就有合法的空文件——
    // `client-only/index.js` 是空标记包（只有 error.js 有内容），
    // `@standard-schema/spec/dist/index.js` 是类型占位（真身在 dist/index.cjs）。
    // 2026-10-29 首版把它们误报成「写入被打断」，白查一轮。
    // 真正的残缺表现为**文件整个缺失**（better-sqlite3 少 package.json/lib、
    // lucide-react 少整个 dist/cjs），那才是要抓的信号。
  }
  return problems;
}

function main() {
  const rootArgIdx = process.argv.indexOf("--root");
  const root = rootArgIdx !== -1 ? resolve(process.argv[rootArgIdx + 1]) : ROOT;
  const pnpmDir = join(root, "node_modules", ".pnpm");

  const pkgs = listPnpmPackages(pnpmDir);
  const findings = [];
  for (const pkg of pkgs) {
    if (pkg.tmpLeftover) {
      findings.push({ name: pkg.name, path: pkg.path, problems: [{ kind: "tmp-leftover", detail: "失败的原子重命名残留目录（可安全删除）" }] });
      continue;
    }
    const problems = inspectPackage(pkg.path, pkg.name);
    if (problems.length > 0) findings.push({ name: pkg.name, path: pkg.path, problems });
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ scanned: pkgs.length, broken: findings.length, findings }, null, 2));
    process.exit(findings.length > 0 ? 1 : 0);
  }

  if (findings.length === 0) {
    console.log(`✅ 依赖完整性：${pkgs.length} 个包全部入口可解析`);
    return;
  }
  console.error(`❌ 依赖完整性：${pkgs.length} 个包里有 ${findings.length} 个残缺`);
  for (const f of findings) {
    for (const p of f.problems) console.error(`   [${p.kind}] ${f.name}  ${p.detail}`);
    console.error(`      ${f.path}`);
  }
  console.error(`
处理：这类问题与代码无关，是安装被中断留下的。
  1) 先看有没有进程占着这些目录（Windows 下 pnpm 的原子重命名会被占用挡住）；
  2) 单包补：npm pack <name>@<version> 解压后只补缺失/空文件，别覆盖占用中的 .node；
  3) 全量：确认无安装进程后 pnpm install --frozen-lockfile。
`);
  process.exit(1);
}

// 只在直接执行时跑 main，便于测试 import 上面的纯函数
const invokedDirectly = process.argv[1] && /check-deps-integrity\.mjs$/.test(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
