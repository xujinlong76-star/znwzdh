// P-c: MRU 权重对照 (04 §3.3/§10) — 0.1 / 0.15 / 0.25
// Usage:
//   node p-c-mru.mjs --records <records.json> [--impl ref|<path-to-w6-offline-recent>]
//     [--weights 0.1,0.15,0.25] [--now <ISO | ms>] [--out <report.json>]
//     [--topn 6]
//
// 记录格式 (JSON): { "now": "<ISO>", "records": [{ "id", "title", "count", "visitedAt": "<ISO>" }] }
//   visitedAt 缺失 -> 当作 1 次访问; count 缺失按 1 计 (§3.2 口径).
//   默认 fixture 见 fixtures/mru-20-records.json. 协调员可用真实访问记录导出替换
//   (同 schema), 脚本不挑来源, 只认 schema.
//
// 两类失效 (§10 写死, 各档都要判):
//   F1 误点站上榜: count=1 的误点站在某档权重下进入置顶区 (top N).
//   F2 旧重度站压新站: 3 天前重度站 (高 count, 3 天前) 在某档权重下排在
//      新站 (昨天/今天, 同等匹配分) 之前.
// 两条路径都测:
//   (a) 空查询 MRU 分区: 门槛 MRU_MIN_USES_FOR_BOOST=3 + mruScore 降序, 取 top N.
//       (按 §3.3, count<3 不参与置顶; 此路径与权重无关, 但 F2 仍可能在此出现.)
//   (b) 有查询加分路径: 本地行总分 = matchScore + mruNorm * w, mruNorm = mruScore/100.
//       matchScore 取记录自带的 matchScore 字段 (同一情景查询下的本地匹配分;
//       缺失时默认 0.9 并在报告中注明). 注意: 若所有行的 matchScore 相等, 总分
//       排序与 w 无关 (w 只缩放分差), 对照将失去区分度——fixture 因此给三类
//        archetype 设定了近乎打平的匹配分 (fresh 0.90 / heavy-old 0.88 /
//       accidental 0.85), 让权重真正决定排序. 段 2 可用真实 matchPinyin 分替换.
// 判定 (§10 写死): 选两类失效均不出现的最小权重; 三档均失效则权重降为 0.
//   (权重 0 = MRU 只做平局打破, 见 §11 R4.)
// 另: 脚本扫描 w ∈ [0, 1] (步长 0.01) 找出 F1/F2 各自首次出现的权重 (安全边际);
//   扫描到 1.0 仍不出现记为 never.
// 另: --impl 为 W6 实现时, 先跑 §9 C1 三例手算对照 (误差 < 0.01), 并报告
// W6 mruScore 与参考实现的逐条差值; 分歧不静默通过.
import { readFileSync } from 'node:fs';
import { flags, writeJsonOrStdout } from './lib.mjs';
import { MRU_MIN_USES_FOR_BOOST, scoreList, runC1 } from './ref-mru.mjs';
import * as refMru from './ref-mru.mjs';

const f = flags(process.argv.slice(2));
const recordsPath = f.records || 'scripts/poc-measure/fixtures/mru-20-records.json';
const weights = (f.weights || '0.1,0.15,0.25').split(',').map(Number);
const topN = Number(f.topn || 6);
const outPath = f.out || 'scripts/poc-measure/out/p-c-mru.json';

const raw = JSON.parse(readFileSync(recordsPath, 'utf8'));
const now = f.now ? new Date(f.now).getTime() : (raw.now ? new Date(raw.now).getTime() : Date.now());
const records = raw.records.map((r) => ({
  id: r.id, title: r.title, count: r.count ?? 1,
  visitedAt: typeof r.visitedAt === 'number' ? r.visitedAt : new Date(r.visitedAt).getTime(),
  role: r.role || 'filler', // accidental-click | heavy-old | fresh | filler
  matchScore: r.matchScore ?? 0.9, // 同一情景查询下的本地匹配分; 缺失默认 0.9 (见报告注明)
  matchScoreDefaulted: r.matchScore === undefined,
}));

// --impl: "ref" (default) 或 W6 的 offline-recent 可 require 模块 (须导出 mruScore,
// 可选 MRU_MIN_USES_FOR_BOOST). W6 模块是 TS: 段 2 用前先由 W6 提供可运行形态.
async function loadImpl() {
  if (!f.impl || f.impl === 'ref') {
    return { name: 'ref (§3.2 参考实现)', score: (v, n, e) => refMru.mruScore(v, n, e), arity: 3, minUses: MRU_MIN_USES_FOR_BOOST };
  }
  const mod = await import(f.impl);
  const impl = mod.default || mod;
  if (typeof impl.mruScore !== 'function') throw new Error(`--impl 模块须导出 mruScore, 实际导出: ${Object.keys(impl).join(',')}`);
  return { name: `w6:${f.impl}`, score: impl.mruScore, arity: impl.mruScore.length, minUses: impl.MRU_MIN_USES_FOR_BOOST ?? MRU_MIN_USES_FOR_BOOST };
}
const impl = await loadImpl();
const earliest = Math.min(...records.map((r) => r.visitedAt));
const scored = records.map((r) => ({ ...r, score: impl.score(r, now, earliest) }));

// C1 手算对照: 参考实现必过 (自洽检查); W6 实现的逐条差值如实记录.
// 注意: §3.2 的 mruScore(visit, now) 是二参, 建库天数来自"当前 MRU 列表最早一条".
// 本 harness 以三参调用 (visit, now, earliest); 若 W6 实现声明为二参, 其频率分
// 无法感知列表, C1 差值会如实暴露该分歧 (见报告 implNotes).
const c1 = runC1((v, n, e) => impl.score(v, n, e), now);
const c1Ref = runC1((v, n, e) => refMru.mruScore(v, n, e), now);
const refScored = new Map(scoreList(records, now).map((r) => [r.id, r.score]));
const scoreDiffVsRef = scored.map((r) => ({ id: r.id, title: r.title, impl: +r.score.toFixed(2), ref: +refScored.get(r.id).toFixed(2), diff: +(r.score - refScored.get(r.id)).toFixed(2) }));

const accidental = scored.find((r) => r.role === 'accidental-click');
const heavyOld = scored.find((r) => r.role === 'heavy-old');
const fresh = scored.find((r) => r.role === 'fresh');
if (!accidental || !heavyOld || !fresh) {
  throw new Error(`fixture 须标注 role: accidental-click / heavy-old / fresh 各 1 条, 缺失: accidental=${!!accidental} heavy-old=${!!heavyOld} fresh=${!!fresh}`);
}

// (a) 空查询 MRU 分区: count>=3 按 mruScore 降序置顶; count<3 只按时间排后段.
const boosted = scored.filter((r) => (r.count ?? 1) >= impl.minUses).sort((a, b) => b.score - a.score || b.visitedAt - a.visitedAt);
const rest = scored.filter((r) => (r.count ?? 1) < impl.minUses).sort((a, b) => b.visitedAt - a.visitedAt);
const emptyQueryTop = [...boosted, ...rest].slice(0, topN);
const emptyQueryFail = {
  F1_accidentalInTop: emptyQueryTop.some((r) => r.id === accidental.id),
  F2_heavyOldAboveFresh: (() => {
    const iH = emptyQueryTop.findIndex((r) => r.id === heavyOld.id);
    const iF = emptyQueryTop.findIndex((r) => r.id === fresh.id);
    return iH !== -1 && iF !== -1 && iH < iF;
  })(),
};

// (b) 有查询加分路径: matchScore 取记录自带值, 总分 = matchScore + (mruScore/100) * w.
function queryRanking(w) {
  return scored
    .map((r) => ({ ...r, total: r.matchScore + (r.score / 100) * w }))
    .sort((a, b) => b.total - a.total || b.visitedAt - a.visitedAt)
    .slice(0, topN);
}
function failuresAt(w) {
  const top = queryRanking(w);
  const f1 = top.some((r) => r.id === accidental.id);
  const iH = top.findIndex((r) => r.id === heavyOld.id);
  const iF = top.findIndex((r) => r.id === fresh.id);
  const f2 = iH !== -1 && iF !== -1 && iH < iF;
  return { f1, f2 };
}
// 安全边际扫描: w 从 0 到 1 (步长 0.01), 各失效首次出现的权重.
function firstAppearance(check) {
  for (let i = 0; i <= 100; i++) {
    const w = +(i * 0.01).toFixed(2);
    if (check(failuresAt(w))) return w;
  }
  return 'never (w<=1.0 未出现)';
}
const margin = {
  F1_firstAppearsAtWeight: firstAppearance((x) => x.f1),
  F2_firstAppearsAtWeight: firstAppearance((x) => x.f2),
};
const perWeight = weights.map((w) => {
  const top = queryRanking(w);
  const { f1, f2 } = failuresAt(w);
  return {
    weight: w,
    top: top.map((r) => ({ title: r.title, count: r.count, matchScore: r.matchScore, score: +r.score.toFixed(1), total: +r.total.toFixed(3) })),
    F1_accidentalInTop: f1,
    F2_heavyOldAboveFresh: f2,
    fail: f1 || f2,
  };
});

const okWeights = perWeight.filter((p) => !p.fail).map((p) => p.weight);
const selectedWeight = okWeights.length ? Math.min(...okWeights) : 0;

const report = {
  tool: 'P-c MRU 权重对照',
  scheme: '04 §3.3/§10, 判定: 选两类失效均不出现的最小权重; 三档均失效则权重降为 0',
  impl: impl.name,
  implNotes: {
    declaredArity: impl.arity,
    minUsesForBoost: impl.minUses,
    arityNote: impl.arity === 2
      ? 'W6 mruScore 声明为二参 (visit, now), 与 §3.2 签名一致, 但频率分的"建库天数"需列表最早一条记录——二参实现无法从单条 visit 得出该值, C1 差值与本对照的三参调用结果以实测为准, 分歧须协调员/W6 确认'
      : '三参调用 (visit, now, earliest), 建库天数由列表最早一条得出, 与 §3.2 定义一致',
  },
  corpus: { recordsPath, records: records.length, now: new Date(now).toISOString(), topN, weights },
  c1HandCases: c1,
  c1ReferenceSelfCheck: c1Ref,
  scoreDiffVsRef,
  scores: scored.map((r) => ({ id: r.id, title: r.title, role: r.role, count: r.count, matchScore: r.matchScore, matchScoreDefaulted: r.matchScoreDefaulted, daysAgo: Math.ceil((now - r.visitedAt) / 86400000), score: +r.score.toFixed(2) })),
  safetyMarginScan: margin,
  emptyQueryPartition: {
    top: emptyQueryTop.map((r) => ({ title: r.title, count: r.count, score: +r.score.toFixed(1) })),
    ...emptyQueryFail,
    fail: emptyQueryFail.F1_accidentalInTop || emptyQueryFail.F2_heavyOldAboveFresh,
    note: '空查询分区与权重无关; 若此路径已失效, 即 §3.3 门槛/公式本身在本站分布上不成立 (见 §11 R4)',
  },
  perWeight,
  selectedWeight,
  selectionReason: okWeights.length
    ? `权重 ${selectedWeight} 是两类失效均不出现的最小权重`
    : '三档权重在有查询加分路径上均出现失效, 按 §10 权重降为 0 (MRU 只做平局打破)',
};
writeJsonOrStdout(outPath, report);
console.log(JSON.stringify({ perWeight: perWeight.map((p) => ({ w: p.weight, F1: p.F1_accidentalInTop, F2: p.F2_heavyOldAboveFresh })), emptyQueryFail, selectedWeight, c1Pass: c1.every((c) => c.pass) }, null, 2));
console.log(`\n选定权重: ${selectedWeight}  报告: ${outPath}`);
