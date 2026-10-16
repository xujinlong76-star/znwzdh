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
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(".");
const OVERLAY = join(ROOT, "apps", "web-overlay");
const TARGET = join(ROOT, "apps", "web");

// ---- 排除规则：与 scripts/sync-web-overlay.mjs 的 isExcluded() 保持一致 ----
// （不能直接 import 它：sync 脚本顶层就会下载上游 tarball 有副作用。
//  改了那边的规则，记得同步改这里。）
// 不进 overlay 的目录/文件（构建产物、第三方资产、依赖、生成文件）
const EXCLUDE = new Set(["node_modules", "dist", "out", "coverage"]);
const EXCLUDE_PREFIX = ["public/assets/images/logos/", "public/fonts/"];
const EXCLUDE_SUFFIX = [".tsbuildinfo", ".log", ".err", "build-log.txt"];

function isExcluded(rel) {
  const norm = rel.replaceAll("\\", "/");
  if (norm.startsWith(".vendor")) return true;
  if (norm.includes("debug-sync") || norm.endsWith("build-log.txt")) return true;
  const segments = norm.split("/");
  for (const seg of segments) {
    // .next*（含 .next-pwa2 等验证产物）、.fe.* 等隐藏生成物
    if (seg.startsWith(".next") || seg.startsWith(".fe.") || seg === ".turbo" || seg === ".cache") return true;
  }
  for (const d of EXCLUDE) if (segments.includes(d)) return true;
  for (const p of EXCLUDE_PREFIX) if (norm.startsWith(p)) return true;
  for (const s of EXCLUDE_SUFFIX) if (norm.endsWith(s)) return true;
  if (norm === "next-env.d.ts") return true; // next 生成文件
  if (norm === "UPSTREAM.md") return true; // vendor-web 生成的元数据（每次带时间戳/commit，不参与镜像比对）
  return false;
}
// ---- 排除规则结束 ----

/** 二进制判定：前 8KB 含 NUL 字节即按二进制处理 */
function isBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** 文本归一化：CRLF -> LF 后比较（跨平台换行不算漂移） */
function normText(buf) {
  return buf.toString("utf8").replace(/\r\n/g, "\n");
}

/** 内容一致：二进制比 sha256，文本比 CRLF 归一后的字符串 */
function sameContent(a, b) {
  if (isBinary(a) || isBinary(b)) return sha256(a) === sha256(b);
  return normText(a) === normText(b);
}

function diffHint(rel) {
  return (
    `  diff 定位：diff "apps/web-overlay/${rel}" "apps/web/${rel}"\n` +
    `  修复：把 apps/web 的改动合回 overlay（或跑 node scripts/sync-web-overlay.mjs 重算）`
  );
}

function walk(dir, base) {
  const out = [];
  (function rec(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      const rel = relative(base, p).replaceAll("\\", "/");
      if (isExcluded(rel)) continue;
      if (entry.isDirectory()) rec(p);
      else out.push(rel);
    }
  })(dir);
  return out;
}

if (!existsSync(OVERLAY)) {
  console.error("[check] overlay 不存在：" + OVERLAY);
  process.exit(1);
}

// ---------- 正向：overlay -> web（严格） ----------
const overlayFiles = walk(OVERLAY, OVERLAY).filter((rel) => rel !== "README.md"); // 文档不参与镜像

let drifted = 0;
let missing = 0;
for (const rel of overlayFiles) {
  const overlayPath = join(OVERLAY, rel);
  const targetPath = join(TARGET, rel);
  if (!existsSync(targetPath)) {
    console.error("[check] apps/web 缺少文件（未同步）: " + rel);
    missing++;
    continue;
  }
  const a = readFileSync(overlayPath);
  const b = readFileSync(targetPath);
  if (!sameContent(a, b)) {
    const kind = isBinary(a) || isBinary(b)
      ? `二进制不一致（sha256 overlay=${sha256(a).slice(0, 12)}… web=${sha256(b).slice(0, 12)}…）`
      : "文本内容漂移（已做 CRLF 归一，仍不一致）";
    console.error("[check] 内容漂移: " + rel + "（" + kind + "）\n" + diffHint(rel));
    drifted++;
  }
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
  const known = new Set(overlayFiles);
  const orphan = tracked.filter((rel) => !known.has(rel));
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
const overlaySet = new Set(overlayFiles);
const webFiles = existsSync(TARGET) ? walk(TARGET, TARGET) : [];
const candidates = webFiles.filter((rel) => rel !== "README.md" && !overlaySet.has(rel));
if (candidates.length > 0) {
  console.warn(`[check] 提示：apps/web 有 ${candidates.length} 个文件不在 overlay 中。`);
  console.warn("[check] 其中“与上游一致的”本就不该进 overlay；若含自研改动请同步回去。");
  for (const rel of candidates.slice(0, 30)) console.warn("[check] 反向候选: " + rel);
  if (candidates.length > 30) console.warn(`[check] ……还有 ${candidates.length - 30} 个未列出`);
  console.warn("[check] 确诊：node scripts/sync-web-overlay.mjs（需联网拉上游 tarball）");
}

if (drifted > 0 || missing > 0) {
  console.error(`[check] 失败：${drifted} 个漂移，${missing} 个缺失。请把 apps/web 的改动同步回 apps/web-overlay。`);
  process.exit(1);
}
console.log(`[check] OK：${overlayFiles.length} 个覆盖层文件与 apps/web 一致（反向候选 ${candidates.length} 个，仅告警）`);
