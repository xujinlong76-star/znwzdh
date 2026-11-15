/**
 * 待找（wanted_searches）：零结果的出口一 ——「存为待找」。
 *
 * 用户搜不到站时把查询存下来；投稿审核通过（新站变 active）时跑
 * matchWantedSearches：命中则站内通知一次（幂等键 + 状态机双保险，
 * 一条待找只通知一次），行变 notified，保留到用户删除。
 *
 * 身份口径与 custom-sites 相同（resolveCanonicalIdentity 后的规范身份）。
 * 匿名用户不进这张表：前端走 localStorage（navhub.wanted.v1）只存查询串，
 * 界面明示「登录后才能在收录时通知你」。
 *
 * 匹配范围（协调人决定 8）：v1 只钩投稿审核通过；经导入/种子/管理员
 * 直接建站进来的新站不触发。
 */
import { randomUUID } from "node:crypto";
import { buildCorrectionKeys, matchSiteKeys } from "@navhub/core";
import type { Repository } from "../repository.ts";

export interface WantedSearchRecord {
  id: string;
  identity: string;
  query: string;
  correctedQuery: string | null;
  status: "open" | "notified";
  notifiedSiteId: string | null;
  notifiedAt: number | null;
  createdAt: number;
}

/** 每人 open 状态上限（仿 CUSTOM_SITES_MAX_PER_USER 的模式） */
export const WANTED_SEARCHES_MAX_OPEN_PER_USER = 20;
/** 查询归一化上限，与 MAX_SEARCH_QUERY_LENGTH 同值 */
export const WANTED_QUERY_MAX_LENGTH = 256;

export function normalizeWantedQuery(raw: string): string {
  return (raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, WANTED_QUERY_MAX_LENGTH).trim();
}

function rowToWantedSearch(row: Record<string, unknown>): WantedSearchRecord {
  return {
    id: String(row.id),
    identity: String(row.identity),
    query: String(row.query ?? ""),
    correctedQuery: row.corrected_query === null || row.corrected_query === undefined ? null : String(row.corrected_query),
    status: row.status === "notified" ? "notified" : "open",
    notifiedSiteId: row.notified_site_id === null || row.notified_site_id === undefined ? null : String(row.notified_site_id),
    notifiedAt: row.notified_at === null || row.notified_at === undefined ? null : Number(row.notified_at),
    createdAt: Number(row.created_at ?? 0),
  };
}

export async function listWantedSearches(repo: Repository, identity: string): Promise<WantedSearchRecord[]> {
  const rows = await repo.raw(
    "SELECT * FROM wanted_searches WHERE identity = ? ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, created_at DESC",
    [identity],
  );
  return rows.map(rowToWantedSearch);
}

export async function countOpenWantedSearches(repo: Repository, identity: string): Promise<number> {
  const rows = await repo.raw("SELECT COUNT(*) AS c FROM wanted_searches WHERE identity = ? AND status = 'open'", [identity]);
  return Number(rows[0]?.c ?? 0);
}

/**
 * 存一条待找。(identity, query) 唯一：重复存返回已有行（duplicate: true，
 * 不建两行）。open 达上限返回 null（API 层译成 409）。
 */
export async function createWantedSearch(
  repo: Repository,
  input: { identity: string; query: string; correctedQuery?: string | null },
): Promise<{ item: WantedSearchRecord; duplicate: boolean } | null> {
  const query = normalizeWantedQuery(input.query);
  if (!query) return null;
  const existing = await repo.raw("SELECT * FROM wanted_searches WHERE identity = ? AND query = ?", [input.identity, query]);
  if (existing[0]) return { item: rowToWantedSearch(existing[0]), duplicate: true };
  if ((await countOpenWantedSearches(repo, input.identity)) >= WANTED_SEARCHES_MAX_OPEN_PER_USER) return null;
  const now = Date.now();
  const id = randomUUID();
  const corrected = input.correctedQuery ? normalizeWantedQuery(input.correctedQuery) : null;
  await repo.run(
    "INSERT INTO wanted_searches (id, identity, query, corrected_query, status, notified_site_id, notified_at, created_at) VALUES (?,?,?,?, 'open', NULL, NULL, ?)",
    [id, input.identity, query, corrected || null, now],
  );
  const rows = await repo.raw("SELECT * FROM wanted_searches WHERE id = ?", [id]);
  return rows[0] ? { item: rowToWantedSearch(rows[0]), duplicate: false } : null;
}

export async function deleteWantedSearch(repo: Repository, identity: string, id: string): Promise<boolean> {
  const rows = await repo.raw("SELECT id FROM wanted_searches WHERE id = ? AND identity = ?", [id, identity]);
  if (!rows[0]) return false;
  await repo.run("DELETE FROM wanted_searches WHERE id = ? AND identity = ?", [id, identity]);
  return true;
}

/**
 * 投稿审核通过后的匹配通知（钩子在 submissions.ts approve 处）。
 *
 * 匹配复用纠正算法的键与距离：归一化 wanted query 的每个 token 对新站的
 * title / pinyin_full / initials / host / 标签做子串或编辑距离 ≤阈值命中；
 * correctedQuery 有值时两个词都试（任一命中即算）。
 *
 * 命中则 emitNotification（幂等键 wanted:{wantedId}:{siteId}，kind
 * wanted_site_found，渠道仅站内 inapp——邮件发送器需配置，v1 不发邮件）
 * 并把行置 notified。状态机 + 幂等键双保险：同一待找被两个站先后匹配，
 * 只通知第一次。
 */
export async function matchWantedSearches(
  repo: Repository,
  site: { id: string; title: string; url: string },
): Promise<WantedSearchRecord[]> {
  const open = await repo.raw("SELECT * FROM wanted_searches WHERE status = 'open' ORDER BY created_at ASC", []);
  if (open.length === 0) return [];
  const pinyinRows = await repo.raw("SELECT pinyin_full, pinyin_initials FROM sites WHERE id = ?", [site.id]);
  const tagRows = await repo.raw(
    "SELECT t.name FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE st.site_id = ?",
    [site.id],
  );
  const siteKeys = [
    ...buildCorrectionKeys({
      title: site.title,
      url: site.url,
      pinyinFull: pinyinRows[0]?.pinyin_full ? String(pinyinRows[0].pinyin_full) : null,
      pinyinInitials: pinyinRows[0]?.pinyin_initials ? String(pinyinRows[0].pinyin_initials) : null,
    }),
    ...tagRows.map((r) => String(r.name ?? "")),
  ];
  const matched: WantedSearchRecord[] = [];
  for (const row of open) {
    const wanted = rowToWantedSearch(row);
    const queries = [wanted.query, wanted.correctedQuery].filter((q): q is string => Boolean(q));
    const hit = queries.some((q) => matchSiteKeys(q.split(/\s+/), siteKeys));
    if (!hit) continue;
    // 状态机先行：只有仍 open 的行才通知 + 置位，并发审核重放时第二人看到
    // 已 notified，不再发第二条。
    const claimed = await repo.withTransaction(async () => {
      const fresh = await repo.raw("SELECT status FROM wanted_searches WHERE id = ? AND status = 'open'", [wanted.id]);
      if (!fresh[0]) return false;
      await repo.emitNotification({
        identity: wanted.identity,
        idempotencyKey: `wanted:${wanted.id}:${site.id}`,
        kind: "wanted_site_found",
        title: `你待找的「${wanted.query}」已收录：${site.title}`,
        body: site.url,
        channels: ["inapp"],
      });
      await repo.run(
        "UPDATE wanted_searches SET status = 'notified', notified_site_id = ?, notified_at = ? WHERE id = ? AND status = 'open'",
        [site.id, Date.now(), wanted.id],
      );
      return true;
    }).catch(() => false);
    if (!claimed) continue;
    const after = await repo.raw("SELECT * FROM wanted_searches WHERE id = ?", [wanted.id]);
    if (after[0]) matched.push(rowToWantedSearch(after[0]));
  }
  return matched;
}
