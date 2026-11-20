// P-b: Fuse threshold 对照 (04 §6/§10) — 0.2 vs 0.3 vs 0.4
// Usage:
//   node p-b-threshold.mjs --nav <navigation.json> [--impl ref|<path-to-w5-palette-pinyin>]
//     [--thresholds 0.2,0.3,0.4] [--out <report.json>] [--pinyin-pro <path>]
//     [--seed 20261120]
//
// Ground truth (built from the title's own PinyinKeys — no hand-labelled data):
//   应命中查询 (expected hit): pyFull 全拼, pyFirst 首字母串, pyFull 前 2/3 字符前缀,
//     pyFirst 前 2 字符前缀, 每个 polyphonic 读音全拼. (Latin titles: same keys,
//     which for "ChatGPT" are pyFull "chatgpt" / pyFirst "chatgpt".)
//   不应命中查询 (expected miss): 3 个其它标题的 pyFull/pyFirst (确定性抽样) +
//     3 条随机拉丁串 (2-4 字母, 排除掉恰好是本标题 keys 前缀的串).
//   拼音相同的标题对 (如两站同首字母串) 从 negative 集中剔除, 另计为 collision,
//   不算误命中 (它们按 §1.2 本就该命中).
//
// 命中判定: matchPinyin(query, keys) >= τ. 判定 (§10 写死):
//   选漏命中率 <= 5% 且误命中率最低的阈值.
//   漏命中率 = 应命中未命中 / 应命中总数; 误命中率 = 不应命中而命中 / 不应命中总数.
//
// KNOWN DEGENERACY (脚本会实测并报告, 不是假设): §1.2 的分数只有
// {0.6, 0.65, 0.7, 0.8, 0.85, 0.9, 1.0} 七档, 全部 >= 0.6. 因此 τ ∈ {0.2,0.3,0.4}
// 在字面规则下无法区分——三档数字必然相同. 脚本除主表外另出一张诊断表:
// 前缀-only 模式 (score >= 0.8 才算命中, 即只计前缀命中、剔除中间命中), 供协调员
// 判断阈值是否应改释为"前缀/中间命中"的分界. 诊断表不参与 §10 判定.
import { loadTitles, isChineseTitle, rng, flags, writeJsonOrStdout } from './lib.mjs';
import { defaultImpl, makePinyinImpl } from './ref-pinyin.mjs';

const f = flags(process.argv.slice(2));
const navPath = f.nav || 'apps/web-overlay/src/navsphere/content/navigation.json';
const thresholds = (f.thresholds || '0.2,0.3,0.4').split(',').map(Number);
const outPath = f.out || 'scripts/poc-measure/out/p-b-threshold.json';
const seed = Number(f.seed || 20261120);

// --impl: "ref" (default) 或 W5 的 palette-pinyin.ts 编译后/可 require 的模块路径.
// W5 模块是 TS: 段 2 用前先由 W5 提供可运行形态 (vitest 环境内跑或 esbuild 打包);
// 本脚本只要求模块导出 { buildPinyinKeys, matchPinyin }.
async function loadImpl() {
  if (!f.impl || f.impl === 'ref') return { ...defaultImpl(f['pinyin-pro']), name: 'ref (§1.2 参考实现)' };
  const mod = await import(f.impl);
  const impl = mod.default || mod;
  if (typeof impl.buildPinyinKeys !== 'function' || typeof impl.matchPinyin !== 'function') {
    throw new Error(`--impl 模块须导出 buildPinyinKeys + matchPinyin, 实际导出: ${Object.keys(impl).join(',')}`);
  }
  return { buildPinyinKeys: impl.buildPinyinKeys, matchPinyin: impl.matchPinyin, name: `w5:${f.impl}` };
}

const impl = await loadImpl();
const titles = loadTitles(navPath);
const rand = rng(seed);

// Build keys once per title (与 §1.4 一致: 预计算, 不逐键重算).
const keyed = titles.map((t) => ({ ...t, keys: impl.buildPinyinKeys(t.title) }));

// Collision map: query string -> titles it legitimately hits (same keys).
const keyToTitles = new Map();
for (const k of keyed) {
  for (const q of [k.keys.pyFull, k.keys.pyFirst, ...k.keys.polyphonic]) {
    if (!keyToTitles.has(q)) keyToTitles.set(q, []);
    keyToTitles.get(q).push(k.title);
  }
}

function expectedHitQueries(k) {
  const qs = new Set();
  const { pyFull, pyFirst, polyphonic } = k.keys;
  if (pyFull) qs.add(pyFull);
  if (pyFirst && pyFirst !== pyFull) qs.add(pyFirst);
  if (pyFull.length >= 3) qs.add(pyFull.slice(0, 3));
  if (pyFull.length >= 2) qs.add(pyFull.slice(0, 2));
  if (pyFirst.length >= 2) qs.add(pyFirst.slice(0, 2));
  for (const p of polyphonic) if (p && p !== pyFull) qs.add(p);
  // 只保留合法拉丁查询 (isLatinQuery: 仅 [a-z0-9 ]); 含标点的标题派生查询
  // (如 "continue.dev"、"node.js"、"iso/iec biaozhun") 按 §1.2 本就返回 0,
  // 计入"应命中"会虚增漏命中——剔除并计数, 不冒充为拼音漏命中.
  const valid = [...qs].filter((q) => q.length > 0 && /^[a-z0-9 ]+$/.test(q));
  return { queries: valid, excludedNonLatin: [...qs].filter((q) => !/^[a-z0-9 ]+$/.test(q)) };
}

function randomLatin(n) {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < n; i++) s += letters[Math.floor(rand() * 26)];
  return s;
}

function expectedMissQueries(k, idx) {
  const qs = new Set();
  // 3 个其它标题的 pyFull/pyFirst (确定性轮询抽样, 非随机以便复现)
  for (let j = 1; j <= 3; j++) {
    const other = keyed[(idx + j * 97) % keyed.length];
    if (other.title === k.title) continue;
    if (other.keys.pyFull) qs.add(other.keys.pyFull);
    if (other.keys.pyFirst) qs.add(other.keys.pyFirst);
  }
  // 3 条随机拉丁串
  let tries = 0;
  while (qs.size < 9 && tries++ < 50) {
    const s = randomLatin(2 + Math.floor(rand() * 3));
    if (k.keys.pyFull.startsWith(s) || k.keys.pyFirst.startsWith(s) || k.keys.pyFull.includes(s)) continue;
    qs.add(s);
  }
  // 剔除碰撞: 该 query 本就是其它同拼音标题的合法命中键 -> 不算 negative
  // 同样只保留合法拉丁查询 (含标点的它站 keys 按 §1.2 恒返回 0, 计入分母只会稀释误命中率)
  return [...qs].filter((q) => /^[a-z0-9 ]+$/.test(q)).filter((q) => {
    const owners = keyToTitles.get(q) || [];
    return !owners.includes(k.title) && !(owners.length > 0 && (q === k.keys.pyFull || q === k.keys.pyFirst));
  });
}

// Score every (title, query) pair once; thresholds are applied afterwards.
const rows = [];
let excludedNonLatinTotal = 0;
const excludedNonLatinExamples = [];
for (let i = 0; i < keyed.length; i++) {
  const k = keyed[i];
  const { queries: hitQs, excludedNonLatin } = expectedHitQueries(k);
  excludedNonLatinTotal += excludedNonLatin.length;
  for (const q of excludedNonLatin.slice(0, 20 - excludedNonLatinExamples.length)) {
    excludedNonLatinExamples.push({ title: k.title, query: q });
  }
  const hits = hitQs.map((q) => ({ q, score: impl.matchPinyin(q, k.keys), expect: 'hit' }));
  const miss = expectedMissQueries(k, i).map((q) => ({ q, score: impl.matchPinyin(q, k.keys), expect: 'miss' }));
  rows.push({ id: k.id, title: k.title, chinese: isChineseTitle(k.title), keys: k.keys, queries: [...hits, ...miss] });
}

function evaluate(tau, scoreFloor = null) {
  let expTotal = 0, expMissed = 0, negTotal = 0, negHit = 0;
  let expTotalZh = 0, expMissedZh = 0, negTotalZh = 0, negHitZh = 0;
  const missedExamples = [], falseExamples = [];
  for (const r of rows) {
    for (const q of r.queries) {
      const hit = scoreFloor === null ? q.score >= tau : q.score >= scoreFloor;
      if (q.expect === 'hit') {
        expTotal++; if (r.chinese) expTotalZh++;
        if (!hit) {
          expMissed++; if (r.chinese) expMissedZh++;
          if (missedExamples.length < 20) missedExamples.push({ title: r.title, query: q.q, score: q.score });
        }
      } else {
        negTotal++; if (r.chinese) negTotalZh++;
        if (hit) {
          negHit++; if (r.chinese) negHitZh++;
          if (falseExamples.length < 20) falseExamples.push({ title: r.title, query: q.q, score: q.score });
        }
      }
    }
  }
  const rate = (a, b) => (b === 0 ? 0 : +(100 * a / b).toFixed(2));
  return {
    threshold: tau, scoreFloor,
    expectedTotal: expTotal, missed: expMissed, missRatePct: rate(expMissed, expTotal),
    negativeTotal: negTotal, falseHit: negHit, falseRatePct: rate(negHit, negTotal),
    chineseOnly: {
      expectedTotal: expTotalZh, missed: expMissedZh, missRatePct: rate(expMissedZh, expTotalZh),
      negativeTotal: negTotalZh, falseHit: negHitZh, falseRatePct: rate(negHitZh, negTotalZh),
    },
    missedExamples, falseExamples,
  };
}

const mainTable = thresholds.map((t) => evaluate(t));
// 诊断表: 前缀-only (score>=0.8), 不参与 §10 判定.
const diagnostic = [evaluate(null, 0.8)];
const scoreHist = {};
for (const r of rows) for (const q of r.queries) {
  if (q.expect === 'hit') scoreHist[q.score] = (scoreHist[q.score] || 0) + 1;
}

// §10 判定 (写死): 漏命中率 <=5% 且误命中率最低.
const eligible = mainTable.filter((t) => t.missRatePct <= 5);
eligible.sort((a, b) => a.falseRatePct - b.falseRatePct || a.threshold - b.threshold);
const selected = eligible[0] || null;

const report = {
  tool: 'P-b threshold 对照',
  scheme: '04 §6/§10, 判定: 漏命中率<=5% 且误命中率最低',
  impl: impl.name,
  corpus: { navPath, titles: titles.length, chineseTitles: titles.filter((t) => isChineseTitle(t.title)).length, seed },
  thresholds,
  mainTable,
  diagnosticPrefixOnly: diagnostic,
  scoreHistogramExpectedHits: scoreHist,
  excludedNonLatinQueries: { total: excludedNonLatinTotal, examples: excludedNonLatinExamples, note: '标题含标点/斜杠 (如 Continue.dev、Node.js、ISO/IEC) 派生的查询不是合法拉丁查询, 按 §1.2 恒返回 0, 已剔除不计入漏命中.' },
  degeneracyNote: '单 token 分数档只有 {0.6,0.65,0.7,0.8,0.85,0.9,1.0}, 全部>=0.6; 三档阈值的差异只来自多 token 乘积分数 (如混合标题 "Kimi 搜索" 的 pyFull 含空格, 乘积可 <0.4). 若三档主表数字接近相同, 即阈值在字面规则下基本不可区分, 需协调员裁决阈值是否应改释为"前缀/中间命中"分界 (见诊断表).',
  selectedThreshold: selected ? selected.threshold : null,
  selectionReason: selected
    ? `漏命中率 ${selected.missRatePct}% (<=5%) 且三档中误命中率最低 (${selected.falseRatePct}%)`
    : '三档均不满足漏命中率<=5%, 按 §11 R2 回退路径处理 (Fuse 加权回退, 不做加权打分)',
};
writeJsonOrStdout(outPath, report);
console.log(JSON.stringify({ ...report, mainTable: report.mainTable.map((t) => ({ threshold: t.threshold, missRatePct: t.missRatePct, falseRatePct: t.falseRatePct })) }, null, 2));
console.log(`\n选定阈值: ${report.selectedThreshold ?? '无 (三档均不达标)'}  报告: ${outPath}`);
