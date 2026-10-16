/**
 * 检查 apps/web 工作区与 apps/web-overlay 的一致性。
 *
 * overlay 是部署源（vendor / Docker 用它），apps/web 里的同名文件是本地开发镜像。
 * 改了 apps/web 忘了同步回 overlay -> 重新 vendor 或构建镜像时改动丢失。
 * 本脚本把这种漂移变成显式失败（CI 可加）。
 *
 * 双向检查说明：
 *  - 正向（overlay -> web，严格，失败退出 1）：overlay 每个文件在 web 里必须
 *    存在且内容一致。失败即漂移/缺失，必须修复。
 *  - 反向（web -> overlay，告警，退出 0）：web 里新增但 overlay 没有的文件，
 *    可能是“忘了同步的自研文件”，也可能“与上游一致无需进 overlay”。
 *    不联网拿不到上游 tarball 就无法区分（见 sync-web-overlay.mjs 的 owned 判定），
 *    所以这里只列出候选告警，不判失败；要确诊请跑 `node scripts/sync-web-overlay.mjs`。
 *
 * 用法：node scripts/check-web-overlay.mjs
 *
 * 比对逻辑住在 scripts/lib/overlay-drift.mjs（纯函数、有单测）。
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { diffOverlay, findOwnedOrphans, isExcluded } from "./lib/overlay-drift.mjs";

const ROOT = resolve(".");
const OVERLAY = join(ROOT, "apps", "web-overlay");
const TARGET = join(ROOT, "apps", "web");

function diffHint(rel) {
  return (
    `  diff 定位：diff "apps/web-overlay/${rel}" "apps/web/${rel}"\n` +
    `  修复：把 apps/web 的改动合回 overlay（或跑 node scripts/sync-web-overlay.mjs 重算）`
  );
}

if (!existsSync(OVERLAY)) {
  console.error("[check] overlay 不存在：" + OVERLAY);
  process.exit(1);
}

// ---------- 正向：overlay -> web（严格） ----------
const { overlayFiles, missing, drifted, reverseCandidates } = diffOverlay({
  overlayDir: OVERLAY,
  targetDir: TARGET,
});

// 按 overlay 的文件遍历顺序逐条报（与重构前输出完全一致）
const missingSet = new Set(missing);
const driftByRel = new Map(drifted.map((d) => [d.rel, d.kind]));
for (const rel of overlayFiles) {
  if (missingSet.has(rel)) {
    console.error("[check] apps/web 缺少文件（未同步）: " + rel);
    continue;
  }
  const kind = driftByRel.get(rel);
  if (kind) console.error("[check] 内容漂移: " + rel + "（" + kind + "）\n" + diffHint(rel));
}

// ---------- 硬化：git 跟踪的 apps/web 文件 = 自研，必须进 overlay（失败） ----------
// apps/web 是 gitignore 的 vendored 底座，能被 git 看到的文件（git add -f 过）就是自研。
// 这类文件若不在 overlay，重新 vendor / 构建 Docker 镜像时会被上游 tarball 覆盖丢失
// （真实事故：apps/web/package.json 的 React 19 / TS 5.9 手改被打回上游版本，
//  导致 CI frozen-lockfile 全红）。因此这里按硬失败处理，不依赖联网比对上游。
try {
  const { execFileSync } = await import("node:child_process");
  const tracked = execFileSync("git", ["ls-files", "--", "apps/web"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean)
    .map((f) => f.replace(/^apps\/web\//, "").replaceAll("\\", "/"))
    .filter((rel) => rel && rel !== "UPSTREAM.md" && !isExcluded(rel));
  const orphan = findOwnedOrphans(tracked, overlayFiles);
  if (orphan.length > 0) {
    console.error(`[check] ${orphan.length} 个被 git 跟踪的 apps/web 自研文件不在 overlay 中（vendor/Docker 会丢失）：`);
    for (const rel of orphan) console.error("  - " + rel);
    console.error("[check] 修复：复制到 apps/web-overlay/ 同路径，或跑 node scripts/sync-web-overlay.mjs（需联网）");
    process.exit(1);
  }
  console.log(`[check] OK：${tracked.length} 个 git 跟踪的自研文件全部在 overlay 中`);
} catch {
  // 无 git 环境（Docker 构建上下文）时跳过该项；失败分支在上面已直接 exit(1)
}

// ---------- 反向：web -> overlay（告警，不判失败） ----------
if (reverseCandidates.length > 0) {
  console.warn(`[check] 提示：apps/web 有 ${reverseCandidates.length} 个文件不在 overlay 中。`);
  console.warn("[check] 其中“与上游一致的”本就不该进 overlay；若含自研改动请同步回去。");
  for (const rel of reverseCandidates.slice(0, 30)) console.warn("[check] 反向候选: " + rel);
  if (reverseCandidates.length > 30) console.warn(`[check] ……还有 ${reverseCandidates.length - 30} 个未列出`);
  console.warn("[check] 确诊：node scripts/sync-web-overlay.mjs（需联网拉上游 tarball）");
}

if (drifted.length > 0 || missing.length > 0) {
  console.error(`[check] 失败：${drifted.length} 个漂移，${missing.length} 个缺失。请把 apps/web 的改动同步回 apps/web-overlay。`);
  process.exit(1);
}
console.log(`[check] OK：${overlayFiles.length} 个覆盖层文件与 apps/web 一致（反向候选 ${reverseCandidates.length} 个，仅告警）`);
