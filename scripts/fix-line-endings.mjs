#!/usr/bin/env node
/**
 * 把文件行尾统一成 LF。
 *
 * 为什么需要它：`scripts/check-syntax.mjs` 会拒绝 CRLF 的 `.mjs`，而这类文件的
 * 报错形态极其误导——vite 报 `SyntaxError: Invalid or unexpected token` **不带行号**，
 * 指向 importer 而不是真凶，而 `node --check` 与 esbuild 都通过。
 * 手工转换容易只改一半（编辑器设置各异），所以给个机械工具。
 *
 * 用法：
 *   node scripts/fix-line-endings.mjs              # 修 scripts 下所有 CRLF 的 .mjs
 *   node scripts/fix-line-endings.mjs a.mjs b.ts   # 修指定文件
 *
 * 注意：本文件自己也必须是 LF —— 否则它会拒绝自己（`check-syntax` 会先报它）。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "coverage", ".git"]);

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (entry.isFile() && /\.(mjs|mts|ts|tsx|json|md)$/.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
}

const args = process.argv.slice(2);
const targets = args.length > 0 ? args : (() => {
  const out = [];
  walk("scripts", out);
  return out.filter((f) => /\.mjs$/.test(f));
})();

let fixed = 0;
let skipped = 0;
for (const file of targets) {
  if (!existsSync(file)) {
    console.error(`  跳过（不存在）：${file}`);
    skipped += 1;
    continue;
  }
  const raw = readFileSync(file, "utf8");
  if (!raw.includes("\r\n")) {
    skipped += 1;
    continue;
  }
  // 只动行尾，不碰内容；末尾换行保持原样（有就保留、没有也不擅自加）
  writeFileSync(file, raw.replace(/\r\n/g, "\n"), "utf8");
  console.log(`  已转 LF：${relative(process.cwd(), file)}`);
  fixed += 1;
}

console.log(`[fix-line-endings] 转换 ${fixed} 个，跳过 ${skipped} 个（已是 LF 或不存在）`);
