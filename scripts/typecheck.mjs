#!/usr/bin/env node
/**
 * TS 7 类型检查门禁（P3）：只用 TS 7 native 跑 @navhub/* 的 `tsc --noEmit`。
 *
 * 为什么单独装 `typescript7` 别名：
 *   - TS 7 native 没有 compiler API，typescript-eslint 的 peer 仍要求 <6.1；
 *   - 各包清单继续 pin typescript 5.9.3，lint / Next / 构建工具保持原样；
 *   - 门禁编译器与工具链编译器分离，才能在不牺牲 lint 的前提下拿到 native 提速。
 *
 * 用法：
 *   node scripts/typecheck.mjs          # 逐包 typecheck
 *   node scripts/typecheck.mjs --list   # 只列出发现的 @navhub/* 包（供测试）
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSC = join(ROOT, "node_modules/typescript7/bin/tsc");

if (!existsSync(TSC)) {
  console.error("[typecheck] 未找到 typescript7，请先 pnpm install");
  process.exit(1);
}

function discoverPackages() {
  const found = [];
  for (const parent of ["apps", "packages"]) {
    const base = join(ROOT, parent);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(base, entry.name);
      const pkgPath = join(dir, "package.json");
      const tsconfigPath = join(dir, "tsconfig.json");
      if (!existsSync(pkgPath) || !existsSync(tsconfigPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (typeof pkg.name === "string" && pkg.name.startsWith("@navhub/")) {
        found.push({ dir, name: pkg.name });
      }
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

const packages = discoverPackages();
if (packages.length === 0) {
  console.error("[typecheck] 未发现 @navhub/* 包");
  process.exit(1);
}

if (process.argv.includes("--list")) {
  for (const pkg of packages) console.log(`${pkg.name} ${relative(ROOT, pkg.dir)}`);
  process.exit(0);
}

const started = Date.now();
let failed = 0;
for (const pkg of packages) {
  console.log(`[typecheck] ${pkg.name}（${relative(ROOT, pkg.dir)}）`);
  try {
    execFileSync(process.execPath, [TSC, "--noEmit", "-p", join(pkg.dir, "tsconfig.json")], {
      cwd: ROOT,
      stdio: "inherit",
    });
  } catch {
    failed += 1;
  }
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (failed > 0) {
  console.error(`[typecheck] 失败：${failed}/${packages.length} 个包（${seconds}s）`);
  process.exit(1);
}
console.log(`[typecheck] 通过：${packages.length} 个包（${seconds}s，TypeScript 7.0.2 native）`);
