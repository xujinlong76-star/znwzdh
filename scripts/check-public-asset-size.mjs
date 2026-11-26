#!/usr/bin/env node
/**
 * P0-5 公共静态资源单文件体积门禁。
 *
 * 防止再次引入 260 KB 级巨型 SVG 图标或未压缩大脚本拖慢首屏：
 *   - public/brand-icons/*.svg  ≤ 50 KB
 *   - public/brand-icons/*      ≤ 120 KB
 *   - public/**\/*.min.js (gzip) ≤ 50 KB
 *   - public/**\/*.json          ≤ 250 KB
 *
 * 用法：node scripts/check-public-asset-size.mjs
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = resolve(process.cwd(), "apps/web-overlay/public");
if (!existsSync(ROOT)) {
  console.error(`✖ 目录不存在: ${ROOT}`);
  process.exit(1);
}

const LIMITS = {
  brandIconSvgKb: 50,
  brandIconAnyKb: 120,
  minJsGzipKb: 50,
  jsonKb: 250,
};

const violations = [];
let scanned = 0;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    scanned += 1;
    const rel = relative(ROOT, full).replace(/\\/g, "/");
    const size = statSync(full).size;
    const kb = Math.round((size / 1024) * 10) / 10;
    const ext = extname(entry.name).toLowerCase();

    if (rel.startsWith("brand-icons/")) {
      if (ext === ".svg" && kb > LIMITS.brandIconSvgKb) {
        violations.push(`${rel}: ${kb} KB > ${LIMITS.brandIconSvgKb} KB (SVG 图标上限)`);
      } else if (kb > LIMITS.brandIconAnyKb) {
        violations.push(`${rel}: ${kb} KB > ${LIMITS.brandIconAnyKb} KB (品牌图标上限)`);
      }
    }

    if (entry.name.endsWith(".min.js")) {
      const gzKb = Math.round((gzipSync(readFileSync(full)).length / 1024) * 10) / 10;
      if (gzKb > LIMITS.minJsGzipKb) {
        violations.push(`${rel}: ${gzKb} KB gzip > ${LIMITS.minJsGzipKb} KB (压缩脚本上限)`);
      }
    }

    if (ext === ".json" && kb > LIMITS.jsonKb) {
      violations.push(`${rel}: ${kb} KB > ${LIMITS.jsonKb} KB (JSON 资源上限)`);
    }
  }
}

walk(ROOT);

if (violations.length > 0) {
  console.error("✖ 公共静态资源体积门禁未通过：");
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log(`✓ 公共静态资源体积门禁通过（已扫描 ${scanned} 个文件，0 项超限）`);
