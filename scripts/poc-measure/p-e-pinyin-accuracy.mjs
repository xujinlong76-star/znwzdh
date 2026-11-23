// P-e: 拼音准确率 (04 §1.5/§10) — segmentit 1 vs 2 对照 + 多音字展开后误匹配率
// Usage:
//   node p-e-pinyin-accuracy.mjs --nav <navigation.json> [--impl ref|<path-to-w5-palette-pinyin>]
//     [--out <report.json>] [--pinyin-pro <path>] [--confirmed-fixes <fixes.json>]
//     [--segmentit 1,2]
//
// 测三件事:
//   (1) segmentit 1 vs 2: 每标题的默认 pyFull 在两种分词档位下是否相同; 不同的
//       列出 (pinyin-pro 3.29.5 默认 segmentit:2, 选项值为 1|2, 见类型定义与
//       dist 默认值; 该对照测的是库行为, 与 W5 实现无关, 恒用参考实现跑).
//   (2) 拉丁查询命中率: 每标题生查询——全拼 / 首字母串 / 每个多音读音全拼 /
//       每个多音读音首字母串——用 --impl 的 matchPinyin 判命中 (>0).
//       判定 (§10): >=95% 通过; <90% 判失败 (PoC 失败阈值第 2 条).
//   (3) 多音字展开后误匹配率: 每个次读音查询会同时命中多少个其它标题
//       (cross-hit); 另列出与 segment() 词级读音不一致的标题, 供人工核对.
// 输出:
//   PINYIN_FIXES 修正名单候选: { char, defaultReading, alternativeReading,
//   source: 'segmentit-diff' | 'segment-disagree' | 'polyphonic', titles: [...] }.
//   "误读站名数"以人工确认为准: 未提供 --confirmed-fixes 时报告为"候选数 (待核对)",
//   不把候选数冒充为误读数. 提供 --confirmed-fixes ({"标题": {"字": "拼音"}})
//   后, 以确认数执行 §1.5 判定: <=5 只用 customPinyin 名单; >5 评估 @pinyin-pro/data.
import { loadTitles, isChineseTitle, flags, writeJsonOrStdout, resolvePinyinPro } from './lib.mjs';
import { defaultImpl } from './ref-pinyin.mjs';

const f = flags(process.argv.slice(2));
const navPath = f.nav || 'apps/web-overlay/src/navsphere/content/navigation.json';
const segModes = (f.segmentit || '1,2').split(',').map(Number);
const outPath = f.out || 'scripts/poc-measure/out/p-e-pinyin-accuracy.json';

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
const ref = defaultImpl(f['pinyin-pro']); // segmentit 对照恒用参考实现 (库行为, 与 W5 无关)
const { mod: pp } = resolvePinyinPro(f['pinyin-pro']);
const titles = loadTitles(navPath);
const chinese = titles.filter((t) => isChineseTitle(t.title));

const rows = [];
for (const t of titles) {
  const keys = impl.buildPinyinKeys(t.title);
  // segmentit 对照: 两种档位的默认全拼
  const bySeg = {};
  for (const s of segModes) bySeg[s] = ref.buildPinyinKeys(t.title, { segmentit: s }).pyFull;
  const segDiff = new Set(Object.values(bySeg)).size > 1;
  // segment() 词级读音作第三方意见 (去调后比较; 两边都去调, 否则 ü (lü) vs u (lu)
  // 的写法差异会误报为读音不一致)
  let segReading = null, segDisagree = false;
  try {
    const segs = pp.segment(t.title);
    segReading = segs.map((x) => (x.result || x.origin || '')).join('');
    const detone = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ü/g, 'u').toLowerCase();
    segDisagree = isChineseTitle(t.title) && detone(segReading) !== detone(keys.pyFull);
  } catch { /* segment 不可用时记 null, 不阻塞 */ }
  // 多音字: 任一汉字 polyphonic 长度 > 1
  const polyChars = [];
  try {
    for (const c of pp.pinyin(t.title, { type: 'all' })) {
      if (c.polyphonic && c.polyphonic.length > 1) polyChars.push({ char: c.origin, readings: c.polyphonic });
    }
  } catch { /* ignore */ }
  rows.push({ ...t, keys, bySeg, segDiff, segReading, segDisagree, polyChars, polyphonicTitle: polyChars.length > 0 });
}

// (2) 拉丁查询命中率
const queryTypes = ['full', 'first', 'poly-full', 'poly-first'];
const stats = {};
for (const qt of queryTypes) stats[qt] = { total: 0, hit: 0 };
let total = 0, hit = 0, totalZh = 0, hitZh = 0;
let excludedNonLatin = 0;
const missExamples = [];
for (const r of rows) {
  const queries = [];
  if (r.keys.pyFull) queries.push(['full', r.keys.pyFull]);
  if (r.keys.pyFirst && r.keys.pyFirst !== r.keys.pyFull) queries.push(['first', r.keys.pyFirst]);
  for (const p of r.keys.polyphonic) {
    if (p && p !== r.keys.pyFull) queries.push(['poly-full', p]);
    const fl = p ? p[0] : '';
    if (fl && fl !== r.keys.pyFirst) queries.push(['poly-first', fl]);
  }
  for (const [qt, q] of queries) {
    // 非法拉丁查询 (标题含标点派生, 如 "continue.dev") 按 §1.2 恒返回 0, 不计入命中率
    if (!/^[a-z0-9 ]+$/.test(q)) { excludedNonLatin++; continue; }
    const s = impl.matchPinyin(q, r.keys);
    const h = s > 0;
    stats[qt].total++; total++;
    if (h) { stats[qt].hit++; hit++; }
    else if (missExamples.length < 30) missExamples.push({ title: r.title, queryType: qt, query: q, score: s });
    if (isChineseTitle(r.title)) {
      totalZh++; if (h) hitZh++;
    }
  }
}
const hitRate = (a, b) => (b === 0 ? 100 : +(100 * a / b).toFixed(2));
const perType = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, { ...v, hitRatePct: hitRate(v.hit, v.total) }]));

// (3) 多音展开后误匹配率: 次读音查询命中其它标题的次数.
//     分两档: benign = 它站不用多音展开也会命中 (该音节本就存在于它站默认读音,
//     属正常拼音重音/同音碰撞, 不是展开引入的); expansion-induced = 它站只靠
//     多音展开才命中 (无展开时不命中)——这才是"展开后新增的误匹配".
//     matchWithoutPoly: 与 matchPinyin 同规则但去掉 polyphonic 一项.
function matchWithoutPoly(query, keys) {
  const q = query.trim().toLowerCase();
  if (!/^[a-z0-9 ]+$/.test(q) || q.length === 0) return 0;
  let score = 1;
  for (const t of q.split(/\s+/)) {
    if (t === keys.pyFull || t === keys.pyFirst) continue;
    let best = 0;
    if (keys.pyFull.startsWith(t)) best = Math.max(best, 0.9);
    else if (keys.pyFull.includes(t)) best = Math.max(best, 0.7);
    if (keys.pyFirst.startsWith(t)) best = Math.max(best, 0.8);
    else if (keys.pyFirst.includes(t)) best = Math.max(best, 0.6);
    if (best === 0) return 0;
    score *= best;
  }
  return score;
}
let secondaryTotal = 0, crossHit = 0, expansionInduced = 0;
const crossExamples = [];
const inducedExamples = [];
for (const r of rows) {
  const secondary = [...new Set(r.keys.polyphonic.filter((p) => p && p !== r.keys.pyFull))];
  for (const q of secondary) {
    if (!/^[a-z0-9 ]+$/.test(q)) continue;
    secondaryTotal++;
    const others = rows.filter((o) => o.id !== r.id && impl.matchPinyin(q, o.keys) > 0);
    if (others.length) {
      crossHit++;
      if (crossExamples.length < 20) {
        crossExamples.push({ query: q, fromTitle: r.title, alsoHits: others.slice(0, 5).map((o) => ({ title: o.title, pyFull: o.keys.pyFull, score: impl.matchPinyin(q, o.keys) })) });
      }
    }
    const induced = others.filter((o) => matchWithoutPoly(q, o.keys) === 0);
    if (induced.length) {
      expansionInduced++;
      if (inducedExamples.length < 20) {
        inducedExamples.push({ query: q, fromTitle: r.title, alsoHitsOnlyViaPolyphonic: induced.slice(0, 5).map((o) => ({ title: o.title, pyFull: o.keys.pyFull, polyphonic: o.keys.polyphonic })) });
      }
    }
  }
}

// PINYIN_FIXES 候选: 以字为键聚合
const fixMap = new Map();
function addFix(char, def, alt, source, title) {
  const k = `${char}|${def}|${alt}`;
  if (!fixMap.has(k)) fixMap.set(k, { char, defaultReading: def, alternativeReading: alt, source, titles: [] });
  if (!fixMap.get(k).titles.includes(title)) fixMap.get(k).titles.push(title);
}
for (const r of rows) {
  if (!isChineseTitle(r.title)) continue;
  if (r.segDiff) {
    const chars = [...r.title];
    for (const c of chars) {
      try {
        const r1 = pp.pinyin(c, { toneType: 'none', type: 'array', segmentit: 1 }).join('');
        const r2 = pp.pinyin(c, { toneType: 'none', type: 'array', segmentit: 2 }).join('');
        if (r1 !== r2) addFix(c, r2, r1, 'segmentit-diff', r.title);
      } catch { /* ignore */ }
    }
  }
  if (r.segDisagree) {
    // 词级读音与默认全拼不一致: 只有单字 segment 块才能逐字定位差异字;
    // 多字词块的读音无法机械拆字, 只记整标题候选, 不硬拆 (避免误报).
    try {
      const segChars = pp.segment(r.title);
      const defChars = pp.pinyin(r.title, { type: 'all' });
      let charIdx = 0;
      for (const sc of segChars) {
        const wordLen = [...(sc.origin || '')].length;
        if (wordLen === 1 && sc.result) {
          const dc = defChars[charIdx];
          const detone = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ü/g, 'u').toLowerCase();
          if (dc && detone(sc.result) !== detone(dc.result || dc.pinyin || '')) {
            addFix(dc.origin, detone(dc.result || dc.pinyin || ''), detone(sc.result), 'segment-disagree', r.title);
          }
        }
        charIdx += wordLen;
      }
    } catch { /* ignore */ }
  }
}
const fixCandidates = [...fixMap.values()];

// 人工确认 (可选): --confirmed-fixes {"标题": {"字": "拼音"}}
let confirmed = null;
if (f['confirmed-fixes']) {
  const { readFileSync } = await import('node:fs');
  confirmed = JSON.parse(readFileSync(f['confirmed-fixes'], 'utf8'));
}
const confirmedTitles = confirmed ? Object.keys(confirmed).length : 0;
const misreadCountForDecision = confirmed ? confirmedTitles : null;

const verdict = hitRate(hit, total) >= 95 ? 'pass'
  : hitRate(hit, total) < 90 ? 'fail (PoC 失败阈值第 2 条: 拼音命中率 <90%)' : 'borderline (90-95%, 交协调员裁决)';

const report = {
  tool: 'P-e 拼音准确率',
  scheme: '04 §1.5/§10, 判定: 拉丁查询命中率 >=95% 通过, <90% 判失败',
  impl: impl.name,
  corpus: { navPath, titles: titles.length, chineseTitles: chinese.length },
  segmentitModes: segModes,
  segmentit: {
    diffTitles: rows.filter((r) => r.segDiff).map((r) => ({ title: r.title, ...r.bySeg })),
    diffCount: rows.filter((r) => r.segDiff).length,
    note: 'segmentit 是 pinyin-pro 的分词档位选项 (默认 2); 若两档在本站语料上零差异, 即分词档位不影响本站标题读音, 如实记录即可, 不强行选档.',
  },
  hitRate: {
    overall: { total, hit, hitRatePct: hitRate(hit, total) },
    chineseTitlesOnly: { total: totalZh, hit: hitZh, hitRatePct: hitRate(hitZh, totalZh) },
    perQueryType: perType,
    excludedNonLatinQueries: excludedNonLatin,
    missExamples,
    verdict,
  },
  polyphonicExpansion: {
    polyphonicTitles: rows.filter((r) => r.polyphonicTitle).length,
    polyphonicTitleList: rows.filter((r) => r.polyphonicTitle).map((r) => ({ title: r.title, pyFull: r.keys.pyFull, polyChars: r.polyChars })),
    secondaryQueries: secondaryTotal,
    crossHitQueries: crossHit,
    crossHitRatePct: secondaryTotal ? +(100 * crossHit / secondaryTotal).toFixed(2) : 0,
    crossExamples,
    expansionInducedQueries: expansionInduced,
    expansionInducedRatePct: secondaryTotal ? +(100 * expansionInduced / secondaryTotal).toFixed(2) : 0,
    expansionInducedExamples: inducedExamples,
    segmentDisagreeTitles: rows.filter((r) => r.segDisagree).map((r) => ({ title: r.title, pyFull: r.keys.pyFull, segmentReading: r.segReading })),
    segmentDisagreeCount: rows.filter((r) => r.segDisagree).length,
    note: 'cross-hit 含合法同音/共享音节 (它站默认读音本就含该音节); expansion-induced 才是多音展开新增的碰撞, 以该率为准判断展开是否引入误匹配.',
  },
  pinyinFixesCandidates: fixCandidates,
  misreadDecision: {
    candidateTitles: new Set(fixCandidates.flatMap((c) => c.titles)).size,
    confirmedMisreadTitles: misreadCountForDecision,
    rule: '§1.5: 确认误读站名 <=5 只用 customPinyin 名单; >5 评估 @pinyin-pro/data',
    decision: misreadCountForDecision === null
      ? '待人工核对 (未提供 --confirmed-fixes; 候选数不等于误读数)'
      : misreadCountForDecision <= 5 ? '只用 customPinyin 名单' : '评估引入 @pinyin-pro/data 的体积代价',
  },
};
writeJsonOrStdout(outPath, report);
console.log(JSON.stringify({
  hitRatePct: report.hitRate.overall.hitRatePct, verdict,
  excludedNonLatin: report.hitRate.excludedNonLatinQueries,
  segmentitDiff: report.segmentit.diffCount,
  polyphonicTitles: report.polyphonicExpansion.polyphonicTitles,
  crossHitRatePct: report.polyphonicExpansion.crossHitRatePct,
  expansionInducedRatePct: report.polyphonicExpansion.expansionInducedRatePct,
  segmentDisagree: report.polyphonicExpansion.segmentDisagreeCount,
  fixCandidates: fixCandidates.length,
  misreadDecision: report.misreadDecision.decision,
}, null, 2));
console.log(`\n报告: ${outPath}`);
