/**
 * 定点同步：overlay → apps/web（只补齐/覆盖有差异的同名文件）。
 *
 * 什么时候用它：
 *   - `node scripts/check-web-overlay.mjs` 报「内容漂移 / 缺少文件」，但只涉及少数几个文件
 *     → 用本脚本秒级修好，无需联网，也不动正在运行的 dev 服务。
 *   - 需要刷新上游底座本身（拉 tarball、重建整个 apps/web）→ 仍用官方路径：
 *     `node scripts/vendor-web.mjs` / `node scripts/sync-web-overlay.mjs`（需联网）。
 *
 * 口径一致性：与 check-web-overlay.mjs 复用同一份漂移判定（scripts/lib/overlay-drift.mjs），
 * 因此「检查报什么、这里就同步什么」；方向恒为 overlay（部署事实源）→ apps/web（本地镜像），
 * 与 check 脚本头部声明的单向语义一致。
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { diffOverlay } from "./lib/overlay-drift.mjs";

const ROOT = resolve(".");
const OVERLAY = join(ROOT, "apps", "web-overlay");
const TARGET = join(ROOT, "apps", "web");

const { drifted, missing } = diffOverlay({ overlayDir: OVERLAY, targetDir: TARGET });

console.log(`overlay -> apps/web 定点同步：内容漂移 ${drifted.length} 个，缺失 ${missing.length} 个`);
for (const d of drifted) console.log(`  差异: ${d.rel}（${d.kind}）`);
for (const rel of missing) console.log(`  缺失: ${rel}`);

const jobs = [
  ...drifted.map((d) => ({ rel: d.rel, action: "覆盖" })),
  ...missing.map((rel) => ({ rel, action: "补齐" })),
];

for (const job of jobs) {
  const from = join(OVERLAY, job.rel);
  const to = join(TARGET, job.rel);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`  已${job.action}: ${job.rel}`);
}

console.log(jobs.length === 0 ? "两侧已逐文件一致，无需写入任何内容。" : `\n共写入 ${jobs.length} 个文件。`);
