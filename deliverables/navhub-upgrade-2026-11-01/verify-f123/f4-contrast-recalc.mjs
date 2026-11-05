/**
 * verify-f4 独立重算：F4 壁纸可读性兜底对比度（方法独立于实现者）
 *
 * 口径：
 *  - HSL→sRGB（CSS 兼容）；WCAG 2.x 相对亮度 + 对比度公式
 *  - alpha 合成在 sRGB 伽马空间按通道线性混合（CSS/PNG 实际合成口径）
 *  - 卡片底色 = hsl(var(--card)/0.88) 合成在 1×1 纯黑/纯白壁纸上
 *  - 标题 = --foreground（不透明）；描述 = --muted-foreground（F4 归一后不透明）
 *  - 四组合：浅/深主题 × 黑/白壁纸
 */
"use strict";

// ---------- 颜色数学 ----------
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function lin(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(rgb1, rgb2) {
  const l1 = luminance(rgb1);
  const l2 = luminance(rgb2);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// CSS 合成：src over dst，sRGB 逐通道（非预乘线性空间——与浏览器 8-bit 位图结果一致）
function compositeOver(fg, alpha, bg) {
  return fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
}

const hex = ([r, g, b]) =>
  "#" + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("").toUpperCase();

// ---------- Token（取自 globals.css 稳态，verify-f4 2026-11-02 读取） ----------
const TOKENS = {
  light: {
    card: hslToRgb(0, 0, 1.0),            // 0 0% 100%
    foreground: hslToRgb(240, 0.10, 0.039), // 240 10% 3.9%
    mutedForeground: hslToRgb(240, 0.04, 0.40), // 240 4% 40%  (#62626A)
  },
  dark: {
    card: hslToRgb(240, 0.10, 0.039),     // 240 10% 3.9%
    foreground: hslToRgb(0, 0, 0.98),      // 0 0% 98%
    mutedForeground: hslToRgb(240, 0.05, 0.649), // 240 5% 64.9%
  },
};

const WALL_BLACK = [0, 0, 0];
const WALL_WHITE = [255, 255, 255];
const CARD_ALPHA = 0.88;

const rows = [];
for (const theme of ["light", "dark"]) {
  for (const [wallName, wall] of [["黑壁纸", WALL_BLACK], ["白壁纸", WALL_WHITE]]) {
    const cardBg = compositeOver(TOKENS[theme].card, CARD_ALPHA, wall);
    const title = contrast(TOKENS[theme].foreground, cardBg);
    const desc = contrast(TOKENS[theme].mutedForeground, cardBg);
    rows.push({
      组合: `${theme === "light" ? "浅色" : "深色"}+${wallName}`,
      卡片合成色: hex(cardBg),
      标题前景: title.toFixed(2),
      描述muted: desc.toFixed(2),
      min: Math.min(title, desc),
    });
  }
}

// ---------- 主张对照 ----------
const CLAIM = { "浅色+黑壁纸": 4.60, "浅色+白壁纸": 6.04, "深色+黑壁纸": 7.81, "深色+白壁纸": 5.86 };
console.log("=== 四组合独立重算（alpha=0.88 卡片合成） ===");
console.log("组合\t\t卡片合成色\t标题(foreground)\t描述(muted)\t组合min\t主张值(描述)\t差异");
for (const r of rows) {
  const claim = CLAIM[r.组合];
  const diff = (Number(r.描述muted) - claim).toFixed(2);
  const flag = Math.abs(Number(r.描述muted) - claim) > 0.15 ? " ←超出±0.15" : "";
  console.log(
    `${r.组合}\t${r.卡片合成色}\t${r.标题前景}\t\t${r.描述muted}\t\t${r.min.toFixed(2)}\t${claim}\t\t${diff}${flag}`
  );
}
const worst = rows.reduce((a, b) => (a.min <= b.min ? a : b));
console.log(`\n最坏组合: ${worst.组合} min=${worst.min.toFixed(2)}（描述 ${worst.描述muted}）  AA 正文门槛 4.5 → ${worst.min >= 4.5 ? "PASS" : "FAIL"}`);

// ---------- 兜底前对照（描述 /90 透明变体，未归一） ----------
console.log("\n=== 反证锚点：text-muted-foreground/90 未归一时（alpha=0.9 文字合成） ===");
for (const theme of ["light", "dark"]) {
  for (const [wallName, wall] of [["黑壁纸", WALL_BLACK], ["白壁纸", WALL_WHITE]]) {
    const cardBg = compositeOver(TOKENS[theme].card, CARD_ALPHA, wall);
    const text90 = compositeOver(TOKENS[theme].mutedForeground, 0.9, cardBg);
    console.log(
      `${theme === "light" ? "浅色" : "深色"}+${wallName}: muted/90 合成文字 ${hex(text90)} → ${contrast(text90, cardBg).toFixed(2)}:1`
    );
  }
}

// ---------- 任务 f：emerald --primary 对近白 ----------
console.log("\n=== 任务 f：emerald accent --primary vs --primary-foreground（近白） ===");
const emeraldPrimary = hslToRgb(158, 0.84, 0.26);        // 158 84% 26%
const emeraldFg = hslToRgb(210, 0.40, 0.98);              // 210 40% 98%
const emContrast = contrast(emeraldPrimary, emeraldFg);
console.log(`--primary 158 84% 26% = ${hex(emeraldPrimary)}`);
console.log(`--primary-foreground 210 40% 98% = ${hex(emeraldFg)}`);
console.log(`对比度 = ${emContrast.toFixed(3)}:1  （源码注释主张 4.74，另一位复核官 5.12）`);
console.log(`裁决: ${Math.abs(emContrast - 5.12) < 0.05 ? "5.12 系正确（4.74 低报）" : Math.abs(emContrast - 4.74) < 0.05 ? "4.74 系正确" : "两者皆偏离，以本值为准"}`);

// 参考：旧初稿 158 84% 30% 的对比度（源码注释称 4.03）
const draft = hslToRgb(158, 0.84, 0.30);
console.log(`（参考：初稿 158 84% 30% = ${hex(draft)} → ${contrast(draft, emeraldFg).toFixed(2)}:1，注释称 4.03）`);
