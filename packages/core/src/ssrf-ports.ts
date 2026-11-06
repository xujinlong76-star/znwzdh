/**
 * SSRF 禁用端口单一事实源（2026-11-06 深扫 P2-2）。
 *
 * 问题：仓库里有两份 SSRF 实现，各自维护一份禁用端口表，且**口径已经漂移**：
 *   - packages/ai/src/ssrf.ts      : Set<string>，38 个端口（含 2181/5601/6380/7002/8086/8500/8600/9092/15672）
 *   - apps/web-overlay/src/lib/ssrf-guard.ts : Set<number>，40 个端口（含 21/111/135/139/512/513/514/2049/4222/5900/7000/27019）
 * 两侧**仅 28 个共有**。同一个 URL 在两套实现里可能得到相反判定——内网探测面因此不一致。
 *
 * 本文件提供「并集」作为应然口径（任一实现禁的，另一实现也应禁），供后续把两侧都改成
 * import 本表使用。之所以先只落数据 + 一致性测试而不直接改两侧：
 *   那两份文件当时正处于并行会话的活跃编辑中（git status = M），
 *   按本仓「热区只报告不改」的纪律，先建立事实源与棘轮，待其冷却后接线。
 *
 * 一致性测试见 apps/web/test + packages/core/test：它锁住「已知差异清单」，
 * 一旦两侧差异**扩大**（有人又单方面加/删端口）立即变红。
 */

/**
 * 应然口径：两份实现的并集（任一实现禁用的端口，另一实现也应禁用）。
 *
 * 本表由实测生成（ai 37 个 ∪ web 40 个 = 48 个），**不要手工增删**：
 * 加端口前先确认两侧实现是否都该禁，加完把 KNOWN_PORT_DRIFT 对应项删掉，
 * 让差异清单逐步归零。apps/web/test/ssrf-ports-drift.test.ts 会校验本表与两侧实测一致。
 */
export const BLOCKED_PORTS_UNION: readonly number[] = Object.freeze([
  21, 22, 23, 25, 110, 111, 135, 139, 143, 445,
  512, 513, 514, 1433, 1521, 2049, 2181, 2375, 2376, 2379,
  2380, 3306, 3389, 4222, 5432, 5601, 5672, 5900, 5984, 6379,
  6380, 6443, 7000, 7001, 7002, 8086, 8500, 8600, 9042, 9092,
  9200, 9300, 10250, 10255, 11211, 15672, 27017, 27018, 27019,
].sort((a, b) => a - b));

/**
 * 已知差异基线（2026-11-06 实测）。
 *
 * 这只是「当前漂移的现状快照」，**不是目标状态**：目标是两侧都等于 BLOCKED_PORTS_UNION，
 * 差异清单归零。测试允许这些差异继续存在（否则每天都红、随即被绕过），
 * 但**不允许新增差异**——新增即红，逼着改动者先想清楚该不该两边一起加。
 */
export const KNOWN_PORT_DRIFT = Object.freeze({
  /** 仅 packages/ai/src/ssrf.ts 禁用 —— 2026-11-06 round 14 已归零 */
  aiOnly: Object.freeze([] as number[]),
  /** 仅 apps/web-overlay/src/lib/ssrf-guard.ts 禁用 —— 2026-11-06 round 14 已归零 */
  webOnly: Object.freeze([] as number[]),
});

/** 规范化端口：接受 number | string | URL.port（空串表示默认端口） */
export function normalizePort(port: number | string | null | undefined): number | null {
  if (port === null || port === undefined || port === "") return null;
  const n = typeof port === "number" ? port : Number(String(port).trim());
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return n;
}

/** 某端口是否应被 SSRF 守卫禁止（并集口径） */
export function isBlockedPortUnion(port: number | string | null | undefined): boolean {
  const n = normalizePort(port);
  return n !== null && BLOCKED_PORTS_UNION.includes(n);
}

/**
 * 差异报告：给定两套端口集合，算出「仅 A」「仅 B」「并集」，
 * 与 KNOWN_PORT_DRIFT 对比即可判断「是否出现新漂移」。
 */
export function diffPortSets(a: Iterable<number | string>, b: Iterable<number | string>): {
  aiOnly: number[];
  webOnly: number[];
  union: number[];
} {
  const sa = new Set([...a].map((p) => normalizePort(p)).filter((p): p is number => p !== null));
  const sb = new Set([...b].map((p) => normalizePort(p)).filter((p): p is number => p !== null));
  const aiOnly = [...sa].filter((p) => !sb.has(p)).sort((x, y) => x - y);
  const webOnly = [...sb].filter((p) => !sa.has(p)).sort((x, y) => x - y);
  const union = [...new Set([...sa, ...sb])].sort((x, y) => x - y);
  return { aiOnly, webOnly, union };
}
