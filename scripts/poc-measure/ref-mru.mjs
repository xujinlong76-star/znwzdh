// Reference implementation of 04-command-palette §3.2–3.3 (offline-recent.ts: mruScore).
// PURPOSE: independent re-check harness for W8, NOT product code. In segment 2 the
// same scripts run against W6's real `mruScore` (via --impl) and diff the two on
// the §9 C1 hand-computed cases (tolerance < 0.01); divergence is reported.
//
// Formula (copied verbatim from §3.2 / Wox calculateMRUScore):
//   score = log(count) * 15 + fibBonus + min(count / 库天数 * 10, 50)
//   fib = [5, 8, 13, 21, 34, 55, 89]; daysAgo = ceil((now - visitedAt) / 86400000)
//   daysAgo<=7 -> fib[7 - daysAgo] (当天 89, 7 天前 5); 7-30 天 -> +3; >30 天 -> +0
//   库天数 = max(1, ceil((now - 最早一条 visit 的 visitedAt) / 86400000)); 空列表 -> 频率分 0
//   count 缺失按 1 计. MRU_MIN_USES_FOR_BOOST = 3.
export const MRU_MIN_USES_FOR_BOOST = 3;
export const FIB = [5, 8, 13, 21, 34, 55, 89];
export const DAY_MS = 86400000;

export function fibBonus(visitedAt, now) {
  const daysAgo = Math.ceil((now - visitedAt) / DAY_MS);
  if (daysAgo <= 0) return 89; // future/now counts as "today"; ceil of a negative is <=0
  if (daysAgo <= 7) return FIB[7 - daysAgo];
  if (daysAgo <= 30) return 3;
  return 0;
}

export function mruScore(visit, now, earliestVisitedAt) {
  const count = visit.count ?? 1;
  const days = earliestVisitedAt === undefined
    ? 1
    : Math.max(1, Math.ceil((now - earliestVisitedAt) / DAY_MS));
  const freq = earliestVisitedAt === undefined ? 0 : Math.min((count / days) * 10, 50);
  return Math.log(count) * 15 + fibBonus(visit.visitedAt, now) + freq;
}

/** Score a whole list with the shared 建库天数 (earliest visitedAt in the list). */
export function scoreList(list, now) {
  if (!list.length) return [];
  const earliest = Math.min(...list.map((v) => v.visitedAt));
  return list.map((v) => ({ ...v, score: mruScore(v, now, earliest) }));
}

/** §9 C1 hand-computed cases. `days` = 建库天数 used for the frequency term.
 *  Case 1: count=1 当天 -> 0 + 89 + min(1/days*10, 50)
 *  Case 2: count=3 七天前 -> log(3)*15 + 5 + min(3/days*10, 50)
 *  Case 3: count=50 三十天前 -> log(50)*15 + 3 + 50 (frequency capped)
 */
export const C1_CASES = [
  { name: 'count=1 当天', visit: { count: 1, daysAgo: 0 }, libDays: 10, expected: 0 + 89 + Math.min((1 / 10) * 10, 50) },
  { name: 'count=3 七天前', visit: { count: 3, daysAgo: 7 }, libDays: 10, expected: Math.log(3) * 15 + 5 + Math.min((3 / 10) * 10, 50) },
  { name: 'count=50 三十天前', visit: { count: 50, daysAgo: 30 }, libDays: 10, expected: Math.log(50) * 15 + 3 + 50 },
];

/** Run the C1 cases against an implementation's mruScore(visit, now).
 *  The impl receives visits shaped { count, visitedAt }; `now` is fixed by the caller.
 *  Returns [{ name, expected, got, diff, pass }] with pass = diff < 0.01. */
export function runC1(implScore, now) {
  return C1_CASES.map(({ name, visit, libDays, expected }) => {
    const visitedAt = now - visit.daysAgo * DAY_MS;
    const earliest = now - libDays * DAY_MS;
    const got = implScore({ count: visit.count, visitedAt }, now, earliest);
    const diff = Math.abs(got - expected);
    return { name, expected: +expected.toFixed(4), got: +got.toFixed(4), diff: +diff.toFixed(4), pass: diff < 0.01 };
  });
}
