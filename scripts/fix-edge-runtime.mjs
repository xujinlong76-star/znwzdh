#!/usr/bin/env node
/**
 * Edge Runtime → nodejs 迁移（幂等，可在 vendor 重建后重放）。
 *
 * 背景（2026-11-07 九维评审后的完整构建实测）：
 *   Next.js 16.4.2 已废弃 Edge Runtime，并在构建日志里建议改用 nodejs。
 *   本仓 apps/web-overlay/src/lib/github.ts 顶层 import 了 @/lib/auth，
 *   而后者第一行是 node:crypto；任何声明了 Edge 的路由/页面都会把该模块
 *   打进 Edge 编译图，构建时报 `Native module not found: node:crypto`，
 *   表现为 `Failed to collect configuration / page data for /...`。
 *   把这些声明统一改为 nodejs 后，完整 `next build` 实测 EXIT=0。
 *
 * 为什么要一个可重放脚本而不是只写进补丁：
 *   apps/web/src 下多数文件是 .gitignore 的 vendored 生成物（仅 10 个入库），
 *   `scripts/vendor-web.mjs` / `generate-web-mirror.mjs` 重建时会把上游原样写回，
 *   手工改动既进不了 git diff，也会在下次重建后丢失。故把迁移固化为幂等脚本，
 *   在 vendor/mirror 之后重跑一次即可；`--check` 可接进 CI 作为漂移哨兵。
 *
 * 用法（仓库根）：
 *   node scripts/fix-edge-runtime.mjs            # 迁移并打印改动清单
 *   node scripts/fix-edge-runtime.mjs --check    # 只读：有残留 EXIT=1，否则 0
 *
 * 只匹配行首真实声明；注释里回顾历史的 `export const runtime = 'edge'` 不会被改。
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const SCAN_ROOTS = ["apps/web-overlay/src", "apps/web/src"];
const SOURCE_EXT = /\.(ts|tsx|mts|mjs)$/;
const EDGE_DECL = /^export const runtime = ['"]edge['"]\s*$/m;
const NOTE =
  "// 2026-11-07：Next 16 已废弃 Edge Runtime，且 @/lib/auth 顶层引入 node:crypto 在 Edge 图不可用。\n" +
  "// 统一改用官方推荐的 nodejs runtime（行为不变）。由 scripts/fix-edge-runtime.mjs 维护。\n";

const checkOnly = process.argv.includes("--check");

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      walk(abs, out);
    } else if (SOURCE_EXT.test(name)) {
      out.push(abs);
    }
  }
  return out;
}

const files = SCAN_ROOTS.flatMap((d) => walk(join(ROOT, d)));
const hits = [];
for (const abs of files) {
  const src = readFileSync(abs, "utf8");
  if (EDGE_DECL.test(src)) hits.push({ abs, src });
}

if (checkOnly) {
  for (const h of hits) console.log(`[edge-runtime] 残留：${relative(ROOT, h.abs).replace(/\\/g, "/")}`);
  console.log(`[edge-runtime] ${hits.length} 处 Edge 声明残留；扫描 ${files.length} 个源文件`);
  process.exit(hits.length > 0 ? 1 : 0);
}

for (const h of hits) {
  const next = h.src.replace(EDGE_DECL, NOTE + "export const runtime = 'nodejs'");
  writeFileSync(h.abs, next);
  console.log(`[edge-runtime] 迁移：${relative(ROOT, h.abs).replace(/\\/g, "/")}`);
}
console.log(`[edge-runtime] 完成：迁移 ${hits.length} 处；扫描 ${files.length} 个源文件`);
process.exit(0);
