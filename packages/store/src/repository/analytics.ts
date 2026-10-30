import type { Repository } from "../repository.ts";
import {
  type Site,
} from "@navhub/core";
import {
  rowToSite,
} from "./dialect.ts";

export async function topQueries(repo: Repository, days = 30, limit = 20): Promise<Array<{ query: string; count: number }>> {
  const since = Date.now() - days * 86_400_000;
  const rows = await repo.raw(
    "SELECT query, COUNT(*) AS cnt FROM events " +
      "WHERE kind = 'search' AND query IS NOT NULL AND query != '' AND created_at >= ? " +
      "GROUP BY query ORDER BY cnt DESC LIMIT ?",
    [since, limit],
  );
  return rows.map((r) => ({ query: String(r.query), count: Number(r.cnt ?? 0) }));
}

/**
 * 「大家都在搜」门槛：同一个词至少被 **2 个身份**、留下 **2 行**事件，才允许出现在建议位。
 *
 * 为什么不是「按行数排」：本机库 13:21 实测（180 天窗口，前 30 合计 171 行）——
 * 榜首 `react vs vue` 26 行但 **只有 1 个身份**，`{"name":"navhub"}` 21 行同样 1 个身份；
 * 而 `代码` 24 行来自 **16 个身份**。行数榜把「一个人的面板把示例 chip 的同一个词
 * 反复写了 26 次」读成「26 个人在搜它」，再把这个词当作建议贴回面板 ⇒ 自我强化闭环。
 * 门槛用身份数，排序用身份数优先，这两条一起把「机器/单人重复」与「多人需求」分开。
 */
export const SUGGEST_MIN_IDENTITIES = 2;
export const SUGGEST_MIN_EVENTS = 2;

/**
 * 归一后被判为「不像人在搜东西」的形状：代码/JSON 片段、纯符号、URL、色值、
 * 同字符重复、算术串与 ≤3 位纯数字。
 *
 * 每条都有本机库里的真实命中做依据（`{"name":"navhub"}` 21 行、`_` 2 行、`%` 2 行、
 * `zzzzzz` 2 行、`semver: ^1.2.0 vs 1.4.0`、`#3b82f6`、`2^10 * 8`、`418`）。
 * 反过来**不能**误杀长数字站码（`12306`），所以纯数字只在 ≤3 位时淘汰。
 */
const SUGGEST_SHAPE_REJECTS: Array<{ re: RegExp; why: string }> = [
  // 只收「符号与空白」：`- 元数据` 这类以连接符开头的正常中文查询里含汉字，不该被误杀
  { re: /^[\p{P}\p{S}\s]+$/u, why: "纯符号，没有可检索的语义" },
  { re: /[<>{}[\]|\\`^]/, why: "标记/代码字符" },
  { re: /["']/, why: "引号：多为脚本回灌的 JSON 或字符串字面量" },
  { re: /:\/\/|(?:^|\s)www\./i, why: "这是 URL 不是搜索意图" },
  { re: /^[@#]/, why: "@ / # 开头：提及、标签或色值写法" },
  { re: /^(.)\1*$/u, why: "同一字符重复（zzzzzz / ___）" },
  // 必须**同时**含数字和运算符才算算式：`12306`、`3.14` 是正常人搜的号码与版本号，
  // `2^10 * 8`、`1 + 1` 才是探针痕迹。纯数字另交给前面「≤3 位」那条（418 是 chip 痕迹）。
  { re: /^(?=[\d\s+\-*/%^().,]*\d)(?=[\d\s+\-*/%^().,]*[+\-*/%^])[\d\s+\-*/%^().,]+$/, why: "数字与算式" },
];

/** 过取倍数在 JS 侧筛完仍不够时不再二次查询——建议位是附加信息，缺了比多花一次 IO 好。 */
const SUGGEST_OVERFETCH_MIN = 200;
const SUGGEST_OVERFETCH_CAP = 500;
const SUGGEST_QUERY_MAX_LENGTH = 40;

/** 归一：去首尾空白、内部连续空白压成一格（`react  vs  vue` 与 `react vs vue` 是同一个词）。 */
function normalizeSuggestQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** 形状闸的独立出口：纯函数，测试与消融都能直接问「这个词为什么被毙」。 */
export function suggestQueryRejection(query: string): string | null {
  const q = normalizeSuggestQuery(query);
  if (q.length < 2) return "少于 2 个字符（单字命中过宽，等于把首页塞进建议位）";
  if (q.length > SUGGEST_QUERY_MAX_LENGTH) return `超过 ${SUGGEST_QUERY_MAX_LENGTH} 个字符`;
  if (/^\d+$/.test(q) && q.length <= 3) return "≤3 位纯数字（示例 chip 与探针痕迹）";
  for (const { re, why } of SUGGEST_SHAPE_REJECTS) if (re.test(q)) return why;
  return null;
}

export interface SuggestableTopQueriesOptions {
  /**
   * 读取上界（不含）：**一次请求自己刚写下的行不能进这一次的榜单**。
   *
   * 搜索面板每 200ms 防抖发一次 GET，`runSearch` 先 `recordEvent("search")` 再读热榜——
   * 于是「本次输入」当场就能把自己算进「大家都在搜」。传请求开头的时间戳即可切断这条
   * 同请求内回路（run56 已记录该时序，当时没有实施）。
   */
  before?: number;
}

/**
 * 可推荐热榜：给前端「示例/大家都在搜」用，与 `topQueries`（管理后台看真实次数分布）
 * **故意不同口径**。改这里不会影响 `stats.ts:68/:231` 的运维榜，反向亦然。
 */
export async function suggestableTopQueries(
  repo: Repository,
  days = 30,
  limit = 20,
  opts: SuggestableTopQueriesOptions = {},
): Promise<Array<{ query: string; count: number; identities: number }>> {
  const since = Date.now() - days * 86_400_000;
  const upper = opts.before ?? Date.now() + 1;
  const fetchSize = Math.min(SUGGEST_OVERFETCH_CAP, Math.max(SUGGEST_OVERFETCH_MIN, limit * 10));
  const rows = await repo.raw(
    "SELECT query, COUNT(*) AS cnt, COUNT(DISTINCT COALESCE(NULLIF(identity, ''), '~')) AS ids FROM events " +
      "WHERE kind = 'search' AND query IS NOT NULL AND query != '' AND created_at >= ? AND created_at < ? " +
      "GROUP BY query ORDER BY ids DESC, cnt DESC LIMIT ?",
    [since, upper, fetchSize],
  );
  /**
   * 分组在 SQL 里按**原始字符串**做，`github` 与 `GitHub` 因此是两行；这里按归一后的
   * 小写键合并。人数取各变体的**最大值**而不是相加——SQL 只给了去重计数，相加会把
   * 「同一个人搜了两种写法」当成两个人，门槛判定宁保守勿虚高。
   */
  const merged = new Map<string, { query: string; count: number; identities: number }>();
  const winnerRows = new Map<string, number>();
  for (const r of rows) {
    const raw = normalizeSuggestQuery(String(r.query ?? ""));
    if (!raw) continue;
    const key = raw.toLowerCase();
    const entry = { query: raw, count: Number(r.cnt ?? 0), identities: Number(r.ids ?? 0) };
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, entry);
      winnerRows.set(key, entry.count);
      continue;
    }
    prev.count += entry.count;
    prev.identities = Math.max(prev.identities, entry.identities);
    // 外显形式取行数最多的写法，其余变体只贡献计数
    if (entry.count > (winnerRows.get(key) ?? 0)) {
      prev.query = entry.query;
      winnerRows.set(key, entry.count);
    }
  }
  const kept: Array<{ query: string; count: number; identities: number }> = [];
  for (const item of merged.values()) {
    if (suggestQueryRejection(item.query)) continue;
    if (item.identities < SUGGEST_MIN_IDENTITIES || item.count < SUGGEST_MIN_EVENTS) continue;
    kept.push({ query: item.query, count: item.count, identities: item.identities });
  }
  kept.sort((a, b) => b.identities - a.identities || b.count - a.count || a.query.localeCompare(b.query));
  return kept.slice(0, limit);
}

export async function zeroResultQueries(repo: Repository, days = 30, limit = 20): Promise<Array<{ query: string; count: number; lastAt: number }>> {
  const since = Date.now() - days * 86_400_000;
  const rows = await repo.raw(
    "SELECT query, COUNT(*) AS cnt, MAX(created_at) AS lastat FROM events " +
      "WHERE kind = 'zero_result' AND created_at >= ? " +
      "GROUP BY query ORDER BY cnt DESC LIMIT ?",
    [since, limit],
  );
  return rows.map((r) => ({ query: String(r.query), count: Number(r.cnt ?? 0), lastAt: Number(r.lastat ?? 0) }));
}

export async function hotSites(repo: Repository, limit = 20): Promise<Site[]> {
  const rows = await repo.raw(
    repo.selectSitesSql() +
      " WHERE s.enabled = " + repo.enabledLiteral + " AND s.status != 'archived' AND s.deleted_at IS NULL" +
      " GROUP BY s.id ORDER BY s.trend_score DESC, s.visit_count DESC, s.sort ASC LIMIT ?",
    [limit],
  );
  return rows.map(rowToSite);
}

export async function newestSites(repo: Repository, limit = 20): Promise<Site[]> {
  const rows = await repo.raw(
    repo.selectSitesSql() +
      " WHERE s.enabled = " + repo.enabledLiteral + " AND s.status != 'archived' AND s.deleted_at IS NULL" +
      " GROUP BY s.id ORDER BY s.created_at DESC LIMIT ?",
    [limit],
  );
  return rows.map(rowToSite);
}

export async function getEmbedding(repo: Repository, siteId: string): Promise<Float32Array | null> {
  const row = (await repo.raw("SELECT vector FROM embeddings WHERE site_id = ?", [siteId]))[0];
  const raw = row?.vector;
  if (!raw) return null;
  const buf = raw instanceof Uint8Array ? Buffer.from(raw) : Buffer.from(raw as ArrayBuffer);
  if (buf.byteLength < 4) return null;
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}
