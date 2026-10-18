#!/usr/bin/env node
/**
 * core → 前端运行时镜像同步器。
 *
 * 用法：
 *   node scripts/sync-core-mirrors.mjs           # 生成/刷新 overlay 与 apps/web 的镜像
 *   node scripts/sync-core-mirrors.mjs --check   # 只校验不写盘，有漂移退出 1（给 CI 用）
 *   node scripts/sync-core-mirrors.mjs --list    # 只看清单与当前状态
 *
 * 为什么需要它：apps/web 是独立安装的 vendored 底座，无法 import @navhub/core，
 * 纯算法必须留一份运行时副本。手工同步已经导致 13 个文件里 9 个漂移
 * （见 docs/CODEBASE_OVERVIEW.md §3.2 与 docs/UPGRADE-PROPOSAL-V3-2026-10-19.md）。
 * 本脚本把副本变成「受控生成 + 字节级守门」，adapter 型条目仍允许有意分叉。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkMirrors,
  parseManifest,
  planSync,
  sourcePathOf,
  overlayPathOf,
  webPathOf,
  composeMirror,
} from "./lib/core-mirror.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MANIFEST = join(ROOT, "scripts", "core-mirrors.json");
const args = new Set(process.argv.slice(2));
const CHECK = args.has("--check");
const LIST = args.has("--list");

const manifest = parseManifest(readFileSync(MANIFEST, "utf8"));
const io = {
  exists: (p) => existsSync(join(ROOT, p)),
  read: (p) => readFileSync(join(ROOT, p), "utf8"),
};

function printPlan(plan) {
  const tag = plan.status === "ok" ? "一致" : plan.status === "write" ? "待同步" : "异常";
  console.log(`  [${tag}] ${plan.name}`);
  for (const r of plan.reasons) console.log(`         - ${r}`);
}

if (LIST) {
  console.log("core 镜像清单（scripts/core-mirrors.json）：");
  console.log("\nverbatim（逐字节镜像，自动同步 + 守门）：");
  for (const e of manifest.verbatim) {
    console.log(`  ${e.name.padEnd(28)} ${sourcePathOf(e)} -> ${overlayPathOf(e)}`);
    console.log(`  ${"".padEnd(28)} why: ${e.why}`);
  }
  console.log("\nadapter（有意保留浏览器适配层，需人工复核）：");
  for (const e of manifest.adapter) {
    console.log(`  ${e.name.padEnd(28)} ${e.source ?? sourcePathOf(e)} -> ${e.target ?? overlayPathOf(e)}`);
    console.log(`  ${"".padEnd(28)} why: ${e.why}`);
  }
  console.log("\nexternal（已有独立 parity 测试）：");
  for (const e of manifest.external) {
    console.log(`  ${e.name.padEnd(28)} ${e.source} -> ${e.target}`);
    console.log(`  ${"".padEnd(28)} why: ${e.why}`);
  }
  process.exit(0);
}

if (CHECK) {
  const { ok, plans, failures } = checkMirrors(manifest.verbatim, io);
  for (const p of plans) printPlan(p);
  if (!ok) {
    console.error(
      `\n[core-mirror] ${failures.length} 个镜像与事实源不一致。修复：node scripts/sync-core-mirrors.mjs`
    );
    process.exit(1);
  }
  console.log(`\n[core-mirror] OK：${plans.length} 个 verbatim 镜像与 core 事实源逐字节一致`);
  process.exit(0);
}

// ---- 默认：写盘 ----
const plans = planSync(manifest.verbatim, io);
let written = 0;
for (const plan of plans) {
  if (plan.status === "missing-source" || plan.status === "empty-source") {
    console.error(`[core-mirror] 跳过 ${plan.name}：${plan.reasons.join("；")}`);
    continue;
  }
  if (plan.status === "ok") {
    console.log(`  [一致] ${plan.name}`);
    continue;
  }
  const sourceText = io.read(plan.source);
  const content = composeMirror(sourceText, plan.source);
  for (const rel of [plan.overlay, plan.web]) {
    const abs = join(ROOT, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
    console.log(`  [写入] ${rel}`);
  }
  written++;
}
console.log(
  `\n[core-mirror] 完成：${plans.length} 个条目，写入 ${written} 个。` +
    `\n           校验：node scripts/sync-core-mirrors.mjs --check` +
    `\n           覆盖层镜像一致性：node scripts/check-web-overlay.mjs`
);
