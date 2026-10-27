#!/usr/bin/env node
/**
 * 生成/更新「上游派生文件基线」（apps/web-overlay/upstream-baseline.json）。
 *
 * 背景：apps/web 里有一批上游页面/路由不在 overlay 中——它们能正常工作，
 * 但处在所有权盲区：改动会在下次 vendor 时消失，且没有任何检查会报警。
 * 基线把「已知的、确实来自上游」的文件登记下来，check-web-overlay（第三向）
 * 只对**关键路径下新增**的文件报错，避免把逐次 vendor 的全部上游文件都变成噪音。
 *
 * 用法：
 *   node scripts/gen-overlay-baseline.mjs           # 打印将写入的内容（DRY RUN）
 *   node scripts/gen-overlay-baseline.mjs --update  # 落盘
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { isExcluded, walkTree } from "./lib/overlay-drift.mjs";

const ROOT = resolve(".");
const OVERLAY = join(ROOT, "apps", "web-overlay");
const TARGET = join(ROOT, "apps", "web");
const OUT = join(OVERLAY, "upstream-baseline.json");
const UPDATE = process.argv.includes("--update");

/**
 * 这些前缀下的文件承载运营闭环（审核、数据、图标、层级），
 * 一页丢失就是一条流程断掉，因此新增文件必须显式决策。
 */
const CRITICAL_PREFIXES = [
  "src/app/admin/submissions/",
  "src/app/admin/data/",
  "src/app/admin/resources/download/",
  "src/app/admin/navigation/[id]/",
  "src/app/api/favicon/",
  "src/app/api/favicon-im/",
  "src/app/api/resource/check-references/",
  "src/app/api/site-config/",
];

function upstreamRef() {
  const file = join(OVERLAY, "UPSTREAM.md");
  if (!existsSync(file)) return "unknown";
  const m = readFileSync(file, "utf8").match(/\b([0-9a-f]{40})\b/);
  return m ? m[1] : "unknown";
}

const overlayFiles = new Set(walkTree(OVERLAY));
const mirrorOnly = walkTree(TARGET).filter((rel) => !overlayFiles.has(rel) && !isExcluded(rel));
const baselineFiles = mirrorOnly.filter((rel) => CRITICAL_PREFIXES.some((p) => rel.startsWith(p))).sort();

const next = {
  $comment:
    "自动生成，请勿手改。登记『上游派生、不在 overlay』的关键路径文件；check-web-overlay 第三向据此识别新增文件。更新：node scripts/gen-overlay-baseline.mjs --update",
  upstreamRef: upstreamRef(),
  criticalPrefixes: CRITICAL_PREFIXES,
  files: baselineFiles,
};

const text = JSON.stringify(next, null, 2) + "\n";
if (!UPDATE) {
  console.log(`[overlay-baseline] DRY RUN：关键路径下上游派生文件 ${baselineFiles.length} 个`);
  for (const rel of baselineFiles) console.log("  - " + rel);
  console.log("[overlay-baseline] 落盘请加 --update");
} else {
  writeFileSync(OUT, text, "utf8");
  console.log(`[overlay-baseline] 写入 ${baselineFiles.length} 个文件 -> ${OUT}`);
}
