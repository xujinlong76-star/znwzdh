/**
 * 精确同步 apps/web-overlay（NavHub 自研前端文件的唯一事实源）。
 *
 * 为什么需要这个脚本：多个会话并行开发时都会直接改 apps/web，
 * 手工挑选文件同步 overlay 必然漏。这里下载上游 NavSphere tarball，
 * 逐文件 diff，把「与上游不同或上游没有」的文件精确同步进 overlay——
 * 这正是 vendor-web / Docker 构建需要恢复的完整集合。
 *
 * 规则：
 *   - apps/web 有、上游没有         -> 复制进 overlay（新文件）
 *   - apps/web 与上游内容不同       -> 复制进 overlay（修改过的文件）
 *   - apps/web 与上游内容一致       -> 从 overlay 删除（不再是自研文件）
 *   - 排除：node_modules/.next/构建产物/二进制大文件目录(logos)
 *
 * 用法：node scripts/sync-web-overlay.mjs
 */
import { writeFileSync, existsSync, rmSync, mkdirSync, readdirSync, statSync, readFileSync, cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, relative, dirname } from "node:path";

const ROOT = resolve(".");
const TARGET = join(ROOT, "apps", "web");
const OVERLAY = join(ROOT, "apps", "web-overlay");
const REF = process.argv[2] || "main";

// 不进 overlay 的目录/文件（构建产物、第三方资产、依赖、生成文件）
const EXCLUDE = new Set(["node_modules", "dist", "out", "coverage"]);
const EXCLUDE_PREFIX = ["public/assets/images/logos/", "public/fonts/"];
const EXCLUDE_SUFFIX = [".tsbuildinfo", ".log", ".err"];

function isExcluded(rel) {
  const norm = rel.replaceAll("\\", "/");
  if (norm.startsWith(".vendor")) return true;
  const segments = norm.split("/");
  for (const seg of segments) {
    // .next*（含 .next-pwa2 等验证产物）、.fe.* 等隐藏生成物
    if (seg.startsWith(".next") || seg.startsWith(".fe.") || seg === ".turbo" || seg === ".cache") return true;
  }
  for (const d of EXCLUDE) if (segments.includes(d)) return true;
  for (const p of EXCLUDE_PREFIX) if (norm.startsWith(p)) return true;
  for (const s of EXCLUDE_SUFFIX) if (norm.endsWith(s)) return true;
  if (norm === "next-env.d.ts") return true; // next 生成文件
  return false;
}

// 1) 下载上游 tarball
console.log("[sync] 下载上游 NavSphere@" + REF + " …");
const url = "https://codeload.github.com/tianyaxiang/NavSphere/tar.gz/refs/heads/" + REF;
const res = await fetch(url);
if (!res.ok) { console.error("[sync] 下载失败 HTTP " + res.status); process.exit(1); }
const tgz = join(ROOT, ".vendor-ns.tgz");
writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));

// 2) 解压到暂存目录（相对路径 + cwd：Windows 系统 tar 对反斜杠绝对路径会 status 2）
const stage = join(ROOT, ".vendor-stage");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
execFileSync("tar", ["-xzf", ".vendor-ns.tgz", "-C", ".vendor-stage"], { cwd: ROOT, stdio: "ignore" });
const inner = readdirSync(stage).map((d) => join(stage, d)).find((p) => {
  try { return readdirSync(p).length > 0; } catch { return false; }
});
if (!inner) { console.error("[sync] 解压失败"); process.exit(1); }

// 3) 枚举上游文件（内容 hash）
function walk(dir, base, out = new Map()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(base, full).replaceAll("\\", "/");
    if (isExcluded(rel)) continue;
    if (entry.isDirectory()) walk(full, base, out);
    else out.set(rel, readFileSync(full));
  }
  return out;
}
const upstream = walk(inner, inner);
const local = walk(TARGET, TARGET);

// 4) 计算 NavHub 自有集合并同步 overlay
let added = 0, updated = 0, removed = 0, unchanged = 0;
const owned = [];
for (const [rel, content] of local) {
  const up = upstream.get(rel);
  if (!up || !up.equals(content)) {
    owned.push(rel);
    const dest = join(OVERLAY, rel);
    const cur = existsSync(dest) ? readFileSync(dest) : null;
    if (!cur) added++;
    else if (!cur.equals(content)) updated++;
    mkdirSync(dirname(dest), { recursive: true });
    // 用内存内容写入而非 cpSync：后者在个别文件上会触发 Windows EPERM 怪错。
    // 写入偶发被占用/围栏拦截失败（实测约两次一次），重试一次即可成功。
    try {
      writeFileSync(dest, content);
    } catch (err) {
      try {
        writeFileSync(dest, content);
      } catch {
        console.error("[sync] 写入失败（已重试）：" + rel + " -> " + String(err));
        throw err;
      }
    }
  } else {
    unchanged++;
    // 已与上游一致：不再属于自研文件，从 overlay 移除
    const dest = join(OVERLAY, rel);
    if (existsSync(dest)) { rmSync(dest); removed++; }
  }
}

// 5) overlay 里 apps/web 已删除的文件 -> 同步删除
const overlayFiles = [];
(function walkOverlay(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(OVERLAY, full).replaceAll("\\", "/");
    if (rel === "README.md" || isExcluded(rel)) continue;
    if (entry.isDirectory()) walkOverlay(full);
    else overlayFiles.push(rel);
  }
})(OVERLAY);
let deletedFromOverlay = 0;
for (const rel of overlayFiles) {
  if (!local.has(rel)) { rmSync(join(OVERLAY, rel)); deletedFromOverlay++; }
}

rmSync(tgz, { force: true });
rmSync(stage, { recursive: true, force: true });

console.log(`[sync] 自有文件 ${owned.length} 个：新增 ${added}，更新 ${updated}，清理过期 ${removed}，overlay 删除孤儿 ${deletedFromOverlay}`);
console.log(`[sync] 与上游一致的文件 ${unchanged} 个（不进 overlay）`);
console.log("[sync] 完成。校验一致性：node scripts/check-web-overlay.mjs");
