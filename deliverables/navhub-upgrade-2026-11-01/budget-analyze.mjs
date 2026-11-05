#!/usr/bin/env node
/**
 * 首页 HTML 预算解剖：把 4.6MB 拆成「RSC flight / class 属性 / 文本 / 结构」四份，
 * 并给出「重复最长 class 串」排行，为瘦身提供可执行靶点。
 *
 * 用法：node deliverables/navhub-upgrade-2026-11-01/budget-analyze.mjs --url=http://localhost:3109 [--json]
 */
const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("--url="))?.slice(6) ?? "http://localhost:3109";
const asJson = args.includes("--json");

const t0 = Date.now();
const res = await fetch(url, { headers: { "accept-encoding": "gzip, br" } });
const html = await res.text();
const bytes = Buffer.byteLength(html, "utf8");

// 1. RSC flight：Next 把序列化 payload 塞进 self.__next_f.push([...]) 的 <script> 里
let flightBytes = 0;
const scriptRe = /<script>([\s\S]*?)<\/script>/g;
let sm;
while ((sm = scriptRe.exec(html))) {
  if (sm[1].includes("__next_f")) flightBytes += Buffer.byteLength(sm[1], "utf8");
}

// 2. class 属性
const classRe = /class="([^"]*)"/g;
let classBytes = 0;
let classCount = 0;
const perClass = new Map();
let cm;
while ((cm = classRe.exec(html))) {
  const v = cm[1];
  const b = Buffer.byteLength(v, "utf8") + 9; // class="" 的开销
  classBytes += b;
  classCount++;
  perClass.set(v, (perClass.get(v) ?? 0) + 1);
}

// 3. 结构统计
const tagCount = (html.match(/<[a-z][a-z0-9-]*/g) || []).length;
const scriptTotal = (html.match(/<script/g) || []).length;
const svgCount = (html.match(/<svg/g) || []).length;
const pathCount = (html.match(/<path/g) || []).length;

// 4. Top 重复 class 串（按 总字节 = 单次长度 × 次数 排序）
const top = [...perClass.entries()]
  .map(([v, n]) => ({ cls: v, n, unit: Buffer.byteLength(v, "utf8") + 9, totalKb: +(((Buffer.byteLength(v, "utf8") + 9) * n) / 1024).toFixed(1) }))
  .sort((a, b) => b.totalKb - a.totalKb)
  .slice(0, 15);

const out = {
  url,
  totalKb: +(bytes / 1024).toFixed(1),
  flightKb: +(flightBytes / 1024).toFixed(1),
  classAttrKb: +(classBytes / 1024).toFixed(1),
  classCount,
  classShare: +((classBytes / bytes) * 100).toFixed(1) + "%",
  flightShare: +((flightBytes / bytes) * 100).toFixed(1) + "%",
  tags: tagCount,
  scripts: scriptTotal,
  svgs: svgCount,
  paths: pathCount,
  elapsedMs: Date.now() - t0,
  topClassStrings: top,
};

if (asJson) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(`[analyze] ${out.url}`);
  console.log(`  总字节 ${out.totalKb} KB | RSC flight ${out.flightKb} KB (${out.flightShare}) | class 属性 ${out.classAttrKb} KB (${out.classShare}, ${out.classCount} 处)`);
  console.log(`  标签 ${out.tags} 个 | script ${out.scripts} | svg ${out.svgs} | path ${out.paths}`);
  console.log(`  Top 重复 class 串（总 KB）：`);
  for (const t of out.topClassStrings) {
    console.log(`    ${String(t.totalKb).padStart(7)} KB ×${String(t.n).padStart(4)}  (${t.unit}B/次)  ${t.cls.slice(0, 90)}${t.cls.length > 90 ? "…" : ""}`);
  }
}
