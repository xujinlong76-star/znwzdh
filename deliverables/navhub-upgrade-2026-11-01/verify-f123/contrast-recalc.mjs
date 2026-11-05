// 独立对比度复核脚本（verify-officer）——只读产品文件，自行解析 HSL 并按 WCAG 2.x 公式重算。
// 用法: node contrast-recalc.mjs
import { readFileSync } from 'node:fs';

const CSS_PATH = 'C:/Users/许进龙/Desktop/web/apps/web-overlay/src/styles/globals.css';
const css = readFileSync(CSS_PATH, 'utf8');

// ---------- HSL -> sRGB -> 相对亮度 -> 对比度 ----------
function hslToRgb(h, s, l) {
  // h: 0-360, s/l: 0-100(%)
  const S = s / 100, L = l / 100;
  const C = (1 - Math.abs(2 * L - 1)) * S;
  const Hp = (((h % 360) + 360) % 360) / 60;
  const X = C * (1 - Math.abs((Hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (Hp < 1) [r, g, b] = [C, X, 0];
  else if (Hp < 2) [r, g, b] = [X, C, 0];
  else if (Hp < 3) [r, g, b] = [0, C, X];
  else if (Hp < 4) [r, g, b] = [0, X, C];
  else if (Hp < 5) [r, g, b] = [X, 0, C];
  else [r, g, b] = [C, 0, X];
  const m = L - C / 2;
  return [r + m, g + m, b + m];
}
function relLuminance([r, g, b]) {
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(hsl1, hsl2) {
  const L1 = relLuminance(hslToRgb(...hsl1));
  const L2 = relLuminance(hslToRgb(...hsl2));
  const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------- 从 CSS 解析 token（不抄实现者数字） ----------
function parseBlock(selectorTest) {
  // 粗略但足够：找选择器开头的 { ... } 块，抽 --name: H S% L%;
  const out = {};
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const sel = m[1].trim();
    if (!selectorTest(sel)) continue;
    const body = m[2];
    const tre = /--([\w-]+)\s*:\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/g;
    let t;
    while ((t = tre.exec(body)) !== null) {
      out[t[1]] = [Number(t[2]), Number(t[3]), Number(t[4])];
    }
  }
  return out;
}
const root = parseBlock((s) => s.includes(':root') && !s.includes('data-accent') && !s.includes('.dark'));
const dark = parseBlock((s) => s.split(',').some((p) => p.trim() === '.dark'));
const emerald = parseBlock((s) => s.includes('data-accent="emerald"'));
const rose = parseBlock((s) => s.includes('data-accent="rose"'));
const amber = parseBlock((s) => s.includes('data-accent="amber"'));

const fmt = (v) => `${v[0]} ${v[1]}% ${v[2]}%`;

// ---------- 8 组复算 ----------
const checks = [
  { name: '浅 --ring 对白', fg: root.ring, bg: root.background, claimed: 4.93 },
  { name: '深 --destructive-text 对深底', fg: dark['destructive-text'], bg: dark.background, claimed: 7.07 },
  { name: '浅 --destructive-text 对白', fg: root['destructive-text'], bg: root.background, claimed: 6.41 },
  { name: '浅 --border-strong 对白', fg: root['border-strong'], bg: root.background, claimed: 3.2 },
  { name: '深 --border-strong 对深底', fg: dark['border-strong'], bg: dark.background, claimed: 3.2 },
  { name: '浅 --muted-foreground 对白', fg: root['muted-foreground'], bg: root.background, claimed: 6.05 },
  { name: 'emerald --primary 对近白前景', fg: emerald.primary, bg: emerald['primary-foreground'], claimed: 4.74 },
  { name: 'rose --primary 对近白前景', fg: rose.primary, bg: rose['primary-foreground'], claimed: 5.7 },
  { name: 'amber --ring 对白', fg: amber.ring, bg: root.background, claimed: 3.29 },
];

const TOL = 0.15;
let allPass = true;
const rows = [];
for (const c of checks) {
  if (!c.fg || !c.bg) {
    rows.push({ ...c, computed: NaN, verdict: 'TOKEN-MISSING', fgStr: 'MISSING', bgStr: 'MISSING' });
    allPass = false;
    continue;
  }
  const computed = contrast(c.fg, c.bg);
  const diff = Math.abs(computed - c.claimed);
  const verdict = diff <= TOL ? 'OK' : 'MISMATCH';
  if (verdict === 'MISMATCH') allPass = false;
  rows.push({ ...c, computed, diff, verdict, fgStr: fmt(c.fg), bgStr: fmt(c.bg) });
}

console.log('=== 独立重算对比度（WCAG (L1+0.05)/(L2+0.05)，容差 ±0.15） ===');
for (const r of rows) {
  console.log(
    `${r.verdict.padEnd(10)} | ${r.name.padEnd(28)} | fg(${r.fgStr}) bg(${r.bgStr}) | 计算 ${r.computed.toFixed(3)} vs 主张 ${r.claimed} | Δ ${Number.isFinite(r.diff) ? r.diff.toFixed(3) : 'N/A'}`
  );
}
console.log(allPass ? 'ALL-OK' : 'HAS-MISMATCH');
