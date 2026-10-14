/**
 * 生成 PWA 图标（从 SVG 栅格化，任意尺寸都 crisp）。
 *
 * 为什么不用现有 logo.webp：它只有 80x80，放大到 512 会模糊。
 * 这里用品牌色 + 首字母"N"的程序化图标，与站内 LetterAvatar 的视觉语言一致。
 *
 * 用法：node scripts/gen-pwa-icons.mjs
 * 输出：apps/web/public/icons/icon-{192,512}.png、icon-maskable-512.png、apple-touch-icon.png
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const ROOT = resolve(".");
const OUT = join(ROOT, "apps", "web", "public", "icons");
const BRAND = "#378ADD"; // 与 docs/架构图同一设计色

// sharp 是 apps/web 的 devDependency（pnpm 严格布局，根目录解析不到），
// 用 createRequire 锚定 apps/web 来加载。
const webRequire = createRequire(join(ROOT, "apps", "web", "package.json"));
const sharp = webRequire("sharp");

mkdirSync(OUT, { recursive: true });

/** 标准图标：圆角方底 + 白色 N */
function iconSvg(size, { radius = 0.22, glyph = 0.52 } = {}) {
  const r = Math.round(size * radius);
  const fontSize = Math.round(size * glyph);
  const y = Math.round(size * 0.5 + fontSize * 0.35);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="${BRAND}"/>
  <text x="50%" y="${y}" text-anchor="middle" dominant-baseline="middle"
        font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${fontSize}" fill="#ffffff">N</text>
</svg>`;
}

/** maskable：全出血底 + 内容缩到中心 60% 安全区 */
function maskableSvg(size) {
  const inner = Math.round(size * 0.6);
  const pad = Math.round((size - inner) / 2);
  const fontSize = Math.round(inner * 0.62);
  const y = pad + Math.round(inner / 2 + fontSize * 0.35);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BRAND}"/>
  <text x="50%" y="${y}" text-anchor="middle" dominant-baseline="middle"
        font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${fontSize}" fill="#ffffff">N</text>
</svg>`;
}

const jobs = [
  { file: "icon-192.png", svg: iconSvg(192) },
  { file: "icon-512.png", svg: iconSvg(512) },
  { file: "icon-maskable-512.png", svg: maskableSvg(512) },
  { file: "apple-touch-icon.png", svg: iconSvg(180, { radius: 0 }) }, // iOS 自动加圆角，底版不要圆角
];

for (const job of jobs) {
  await sharp(Buffer.from(job.svg)).png().toFile(join(OUT, job.file));
  console.log("[pwa] " + job.file);
}
console.log("[pwa] done -> " + OUT);
