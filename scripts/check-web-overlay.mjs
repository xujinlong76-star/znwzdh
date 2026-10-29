/**
 * 检查 apps/web 工作区与 apps/web-overlay 的一致性（可选 --fix 定点修复）。
 *
 * overlay 是部署源（vendor / Docker 用它），apps/web 里的同名文件是本地开发镜像。
 * 两侧内容分叉即「漂移」：重新 vendor / 构建镜像时，无论哪一侧的新改动都会被另一边覆盖丢失。
 * 本脚本把这种漂移变成显式失败（CI 用）。
 *
 * 双向检查说明：
 *  - 正向（overlay -> web，严格，失败退出 1）：overlay 每个文件在 web 里必须
 *    存在且内容一致。失败即漂移/缺失，必须修复。
 *  - 反向（web -> overlay，告警，退出 0）：web 里新增但 overlay 没有的文件，
 *    可能是“忘了同步的自研文件”，也可能“与上游一致无需进 overlay”。
 *    不联网拿不到上游 tarball 就无法区分（见 sync-web-overlay.mjs 的 owned 判定），
 *    所以这里只列出候选告警，不判失败；要确诊请跑 `node scripts/sync-web-overlay.mjs`。
 *
 * 用法：
 *   node scripts/check-web-overlay.mjs          # 只检查（全仓库）
 *   node scripts/check-web-overlay.mjs --staged # 只对「本次提交涉及的文件」判失败（pre-commit 用）
 *   node scripts/check-web-overlay.mjs --fix    # 检查 + 定点修复（overlay -> apps/web）+ 复查
 *
 * --staged 为什么存在：pre-commit 钩子若跑全仓库判定，多会话并行时会被「别人正在编辑的文件」
 * 的漂移挡住提交（本仓库真实发生过：并发会话在改 overlay，本会话连续两次提交中止）。
 * 全仓库判定交给 CI 的 check-web-overlay 作业；本地只对「你这次要提交的东西」把关。
 * 口径与 scripts/check-syntax.mjs --staged 一致。
 *
 * --fix 的方向提醒：它以 overlay 为事实源，**会用 overlay 版覆盖 apps/web 的差异文件**。
 * 若这次的改动本来就在 apps/web 侧（还没回移植到 overlay），请先把改动合回
 * apps/web-overlay/ 同路径，否则 --fix 会把它盖掉。git 跟踪的自研文件缺失仍需人工处理
 * （那属于「overlay 少文件」，方向相反，--fix 不代劳）。
 *
 * 四个工具的分工（避免重复造轮子）：
 *   - 本脚本（+ --fix）              检查 / 检查+定点修复，单一入口
 *   - scripts/sync-overlay-drift.mjs 定点同步：只写有差异/缺失的文件，秒级、无需联网、不动 dev 服务
 *   - scripts/apply-web-overlay.mjs  无差别覆盖全部 overlay 文件（判定本身存疑时的兜底）
 *   - scripts/sync-web-overlay.mjs   上游口径确诊：联网拉上游 tarball，按「与上游不同」重算自研集合并回写 overlay
 *                                    （默认 DRY RUN 只打印计划；要落盘必须显式 --apply）
 *
 * 比对逻辑住在 scripts/lib/overlay-drift.mjs（纯函数、有单测）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  diffOverlay,
  findOwnedOrphans,
  findUnbaselinedMirrorFiles,
  isExcluded,
  walkTree,
} from "./lib/overlay-drift.mjs";

const ROOT = resolve(".");
const OVERLAY = join(ROOT, "apps", "web-overlay");
const TARGET = join(ROOT, "apps", "web");
const FIX = process.argv.includes("--fix");
const STAGED = process.argv.includes("--staged");

/**
 * `--staged` 模式：只把「本次提交涉及的文件」纳入判定范围（见头部注释）。
 * 返回 null 表示拿不到 git（Docker 构建上下文）——此时退回全仓库判定，与历史行为一致。
 */
function collectStagedRels() {
  try {
    const out = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const rels = new Set();
    for (const raw of out.split(/\r?\n/)) {
      const p = raw.trim().replaceAll("\\", "/");
      if (!p) continue;
      if (p.startsWith("apps/web-overlay/")) rels.add(p.slice("apps/web-overlay/".length));
      else if (p.startsWith("apps/web/")) rels.add(p.slice("apps/web/".length));
    }
    return rels;
  } catch {
    return null;
  }
}
const stagedRels = STAGED ? collectStagedRels() : null;
const inScope = (rel) => !STAGED || stagedRels === null || stagedRels.has(rel);

function diffHint(rel) {
  return (
    `  diff 定位：diff "apps/web-overlay/${rel}" "apps/web/${rel}"\n` +
    `  修复（方向二选一，先判断这次改动在哪一侧）：\n` +
    `    · 改动在 overlay 侧：node scripts/check-web-overlay.mjs --fix（overlay -> apps/web 定点同步）\n` +
    `    · 改动在 apps/web 侧：把该文件的内容合回 apps/web-overlay/${rel} 同路径`
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

// 全仓库判定结果先算全，--staged 时只对本次提交涉及的文件判失败
const scopedDrifted = drifted.filter((d) => inScope(d.rel));
const scopedMissing = missing.filter((rel) => inScope(rel));
const outOfScope = STAGED ? drifted.length - scopedDrifted.length + (missing.length - scopedMissing.length) : 0;

// 按 overlay 的文件遍历顺序逐条报（非 --staged 时与重构前输出完全一致）
const missingSet = new Set(scopedMissing);
const driftByRel = new Map(scopedDrifted.map((d) => [d.rel, d.kind]));
const relsToReport = STAGED
  ? overlayFiles.filter((rel) => missingSet.has(rel) || driftByRel.has(rel))
  : overlayFiles;
for (const rel of relsToReport) {
  if (missingSet.has(rel)) {
    console.error("[check] apps/web 缺少文件（未同步）: " + rel);
    continue;
  }
  const kind = driftByRel.get(rel);
  if (kind) console.error("[check] 内容漂移: " + rel + "（" + kind + "）\n" + diffHint(rel));
}
if (STAGED) {
  console.log(
    `[check] --staged：本次提交涉及 ${stagedRels === null ? "（无 git，按全仓库处理）" : stagedRels.size} 个 overlay/web 路径，` +
      `其中漂移 ${scopedDrifted.length} 个、缺失 ${scopedMissing.length} 个`,
  );
  if (outOfScope > 0) {
    console.log(`[check] 另有 ${outOfScope} 个仓库级漂移不在本次提交范围（留给 CI 与对应会话处理，不阻断本次提交）`);
  }
}

// ---------- 硬化：git 跟踪的 apps/web 文件 = 自研，必须进 overlay（失败） ----------
// apps/web 是 gitignore 的 vendored 底座，能被 git 看到的文件（git add -f 过）就是自研。
// 这类文件若不在 overlay，重新 vendor / 构建 Docker 镜像时会被上游 tarball 覆盖丢失
// （真实事故：apps/web/package.json 的 React 19 / TS 5.9 手改被打回上游版本，
//  导致 CI frozen-lockfile 全红）。因此这里按硬失败处理，不依赖联网比对上游。
try {
  const tracked = execFileSync("git", ["ls-files", "--", "apps/web"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean)
    .map((f) => f.replace(/^apps\/web\//, "").replaceAll("\\", "/"))
    .filter((rel) => rel && rel !== "UPSTREAM.md" && !isExcluded(rel));
  // --staged 下同样只对本次提交涉及的文件判失败（别人未提交的自研文件不该挡住你）
  const orphan = findOwnedOrphans(tracked, overlayFiles).filter((rel) => inScope(rel));
  if (orphan.length > 0) {
    console.error(`[check] ${orphan.length} 个被 git 跟踪的 apps/web 自研文件不在 overlay 中（vendor/Docker 会丢失）：`);
    for (const rel of orphan) console.error("  - " + rel);
    console.error("[check] 修复：复制到 apps/web-overlay/ 同路径，或跑 node scripts/sync-web-overlay.mjs --apply（需联网）");
    process.exit(1);
  }
  console.log(`[check] OK：${tracked.length} 个 git 跟踪的自研文件全部在 overlay 中`);
} catch {
  // 无 git 环境（Docker 构建上下文）时跳过该项；失败分支在上面已直接 exit(1)
}

// ---------- 第三向：镜像关键路径新增文件必须显式决策（失败） ----------
// 上游派生文件不受 git 跟踪，前两向都看不见它们。这里用 upstream-baseline.json
// 登记已知的上游关键面（投稿审核 / 数据管理 / 图标下载 / 层级管理 / 4 条 BFF），
// 任何**新增**的关键路径文件都要么收编进 overlay、要么更新基线，避免又一次
// 「能跑、能改、下次 vendor 就没了」。
const BASELINE_FILE = join(OVERLAY, "upstream-baseline.json");
if (existsSync(BASELINE_FILE)) {
  try {
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
    const mirrorFiles = existsSync(TARGET) ? walkTree(TARGET) : [];
    const fresh = findUnbaselinedMirrorFiles({
      mirrorRelPaths: mirrorFiles,
      overlayRelPaths: overlayFiles,
      baselineFiles: baseline.files ?? [],
      criticalPrefixes: baseline.criticalPrefixes ?? [],
    }).filter(inScope);

    const mirrorSet = new Set(mirrorFiles);
    const stale = (baseline.files ?? []).filter((rel) => !mirrorSet.has(rel) && !overlayFiles.includes(rel));

    if (fresh.length > 0) {
      console.error(`[check] ${fresh.length} 个关键路径新增文件既不在 overlay、也不在上游基线中：`);
      for (const rel of fresh) console.error("  - " + rel);
      console.error("[check] 二选一：");
      console.error("  · 要维护它（会改代码）→ 复制到 apps/web-overlay/ 同路径收编");
      console.error("  · 确认是上游原样文件 → node scripts/gen-overlay-baseline.mjs --update 登记");
      process.exit(1);
    }
    if (stale.length > 0 && !STAGED) {
      console.warn(`[check] 提示：基线里有 ${stale.length} 条已不存在（上游升级/已收编），可跑 gen-overlay-baseline.mjs --update 清理`);
    }
    console.log(`[check] OK：关键路径无新增未登记文件（基线 ${(baseline.files ?? []).length} 条）`);
  } catch (error) {
    console.error("[check] 上游基线读取失败（upstream-baseline.json 不是合法 JSON）：" + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

// ---------- 反向：web -> overlay（告警，不判失败） ----------
if (reverseCandidates.length > 0) {
  if (STAGED) {
    console.log(`[check] （--staged 模式）仓库级反向候选 ${reverseCandidates.length} 个，仅告警，交给 CI 全量检查`);
  } else {
    console.warn(`[check] 提示：apps/web 有 ${reverseCandidates.length} 个文件不在 overlay 中。`);
    console.warn("[check] 其中“与上游一致的”本就不该进 overlay；若含自研改动请同步回去。");
    for (const rel of reverseCandidates.slice(0, 30)) console.warn("[check] 反向候选: " + rel);
    if (reverseCandidates.length > 30) console.warn(`[check] ……还有 ${reverseCandidates.length - 30} 个未列出`);
    console.warn("[check] 确诊：node scripts/sync-web-overlay.mjs（需联网拉上游 tarball）");
  }
}

if (scopedDrifted.length > 0 || scopedMissing.length > 0) {
  console.error(`[check] 失败：${scopedDrifted.length} 个漂移，${scopedMissing.length} 个缺失${STAGED ? "（本次提交范围内）" : ""}。`);
  console.error("[check] 修复：node scripts/check-web-overlay.mjs --fix（overlay -> apps/web 定点同步）；若改动本在 apps/web 侧，请先合回 overlay");
  if (!FIX) process.exit(1);

  // --fix：交给定点同步脚本执行写盘（单一实现，避免两处维护同一套覆盖逻辑）
  console.error("[check] --fix：调用 scripts/sync-overlay-drift.mjs（只写差异/缺失文件，方向 overlay -> apps/web）");
  const { spawnSync } = await import("node:child_process");
  const res = spawnSync(process.execPath, ["scripts/sync-overlay-drift.mjs"], { cwd: ROOT, stdio: "inherit" });
  if (res.status !== 0) {
    console.error(`[check] --fix 失败：同步脚本退出码 ${res.status ?? "null"}`);
    process.exit(res.status ?? 1);
  }

  const after = diffOverlay({ overlayDir: OVERLAY, targetDir: TARGET });
  const afterDrift = after.drifted.filter((d) => inScope(d.rel)).length;
  const afterMissing = after.missing.filter((rel) => inScope(rel)).length;
  if (afterDrift > 0 || afterMissing > 0) {
    console.error(`[check] --fix 后仍有 ${afterDrift} 个漂移、${afterMissing} 个缺失（方向可能反了，请人工确认）`);
    process.exit(1);
  }
  console.log(`[check] OK（--fix 已修复）：${after.overlayFiles.length} 个覆盖层文件与 apps/web 一致${STAGED ? "（--staged 范围）" : ""}`);
  process.exit(0);
}
console.log(`[check] OK：${overlayFiles.length} 个覆盖层文件与 apps/web 一致（反向候选 ${reverseCandidates.length} 个，仅告警）`);
