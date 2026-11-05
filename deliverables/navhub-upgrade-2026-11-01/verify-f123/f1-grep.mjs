// F1 冷区清扫 grep 复核（verify-officer）：独立扫四类禁令残留，并标注豁免归属。
// 用法: node f1-grep.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = 'C:/Users/许进龙/Desktop/web/apps/web-overlay/src';

// 从测试文件抠 WIP_HOT_EXEMPT（独立对照）
const testSrc = readFileSync('C:/Users/许进龙/Desktop/web/apps/web/test/a11y-token-contrast.test.ts', 'utf8');
const es = testSrc.indexOf('const WIP_HOT_EXEMPT');
const ee = testSrc.indexOf('];', es);
const exempt = new Set();
for (const m of testSrc.slice(es, ee).matchAll(/"([^"]+\.tsx)"/g)) exempt.add(m[1]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const patterns = {
  'muted-fg 透明度变体 text-muted-foreground/N': /text-muted-foreground\/\d+/g,
  'text-destructive 旧类名(非-foreground/-text)': /text-destructive(?!-foreground|-text)/g,
  'bg-destructive/10 旧底色': /bg-destructive\/10\b/g,
  'border-input 残留': /\bborder-input\b/g,
};

for (const [label, re] of Object.entries(patterns)) {
  let cold = 0, hot = 0;
  const hotFiles = new Set(), coldFiles = new Set();
  for (const f of walk(SRC)) {
    const rel = relative(SRC, f).replaceAll('\\', '/');
    const n = [...readFileSync(f, 'utf8').matchAll(re)].length;
    if (!n) continue;
    if (exempt.has(rel)) { hot += n; hotFiles.add(rel); }
    else { cold += n; coldFiles.add(rel); }
  }
  console.log(`\n== ${label} ==`);
  console.log(`冷区(未豁免)命中: ${cold} 处 / ${coldFiles.size} 文件`, cold ? JSON.stringify([...coldFiles]) : '');
  console.log(`豁免清单内命中: ${hot} 处 / ${hotFiles.size} 文件`);
}

// 徽章旧配方 bg-X-500/10 + text-X-600（相邻 或 同一引号串内共现）
function badgeHits(src) {
  const hits = [];
  for (const m of src.matchAll(/\bbg-([a-z]+)-500\/10\s+text-\1-600\b/g)) hits.push(m[0]);
  for (const m of src.matchAll(/(['"`])([^'"`\n]*?)\1/g)) {
    const inner = m[2];
    for (const b of inner.matchAll(/\bbg-([a-z]+)-500\/10\b/g)) {
      const fam = b[1];
      if (new RegExp(`\\btext-${fam}-600\\b`).test(inner)) hits.push(`bg-${fam}-500/10 + text-${fam}-600`);
    }
  }
  return hits;
}
let bcold = 0, bhot = 0;
const bcoldFiles = [], bhotFiles = [];
for (const f of walk(SRC)) {
  const rel = relative(SRC, f).replaceAll('\\', '/');
  const h = badgeHits(readFileSync(f, 'utf8'));
  if (!h.length) continue;
  if (exempt.has(rel)) { bhot += h.length; bhotFiles.push(rel); }
  else { bcold += h.length; bcoldFiles.push(rel); }
}
console.log('\n== 徽章旧配方 bg-*-500/10 + text-*-600 ==');
console.log(`冷区命中: ${bcold} 处`, bcold ? JSON.stringify(bcoldFiles) : '');
console.log(`豁免内命中: ${bhot} 处 / ${bhotFiles.length} 文件`);
console.log('\nWIP_HOT_EXEMPT 条数:', exempt.size);
