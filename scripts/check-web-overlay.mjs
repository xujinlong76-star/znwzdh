/**
 * 检查 apps/web 工作区与 apps/web-overlay 的一致性。
 *
 * overlay 是部署源（vendor / Docker 用它），apps/web 里的同名文件是本地开发镜像。
 * 改了 apps/web 忘了同步回 overlay -> 重新 vendor 或构建镜像时改动丢失。
 * 本脚本把这种漂移变成显式失败（CI 可加）。
 *
 * 用法：node scripts/check-web-overlay.mjs
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(".");
const OVERLAY = join(ROOT, "apps", "web-overlay");
const TARGET = join(ROOT, "apps", "web");

if (!existsSync(OVERLAY)) {
  console.error("[check] overlay 不存在：" + OVERLAY);
  process.exit(1);
}

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".next")) continue;
      walk(p);
    } else {
      files.push(relative(OVERLAY, p));
    }
  }
})(OVERLAY);

let drifted = 0;
let missing = 0;
for (const rel of files) {
  if (rel === "README.md") continue; // 文档不参与镜像
  const overlayPath = join(OVERLAY, rel);
  const targetPath = join(TARGET, rel);
  if (!existsSync(targetPath)) {
    console.error("[check] apps/web 缺少文件（未同步）: " + rel);
    missing++;
    continue;
  }
  const a = readFileSync(overlayPath, "utf8");
  const b = readFileSync(targetPath, "utf8");
  if (a !== b) {
    console.error("[check] 内容漂移: " + rel + "（overlay 与 apps/web 不一致）");
    drifted++;
  }
}

if (drifted > 0 || missing > 0) {
  console.error(`[check] 失败：${drifted} 个漂移，${missing} 个缺失。请把 apps/web 的改动同步回 apps/web-overlay。`);
  process.exit(1);
}
console.log(`[check] OK：${files.length - 1} 个覆盖层文件与 apps/web 一致`);
