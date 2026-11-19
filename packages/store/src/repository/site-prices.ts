import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";
import { inPredicate } from "../sql-in.ts";

/**
 * 对照价格数值（Batch 4 Phase 2 P2-2）。
 *
 * 每用户每站只留最新一条（UNIQUE (owner_identity, site_id)）：upsert 即
 * INSERT … ON CONFLICT DO UPDATE（`excluded.` 写法两方言通用，见
 * repository/embeddings.ts 的先例），第二次写替换第一条，表里只有一条；
 * 价格历史由快照承担，本表不存历史。
 * verified_at 一律由调用方传服务端时间（路由层 Date.now()），仓储层不接受
 * 客户端传入——这里只按入参原样写库。
 */

export type SitePriceCurrency =
  | "CNY" | "USD" | "EUR" | "GBP" | "JPY"
  | "HKD" | "AUD" | "CAD" | "SGD" | "KRW";

export type SitePricePeriod = "month" | "year" | "once" | "usage";

export type SitePriceSourceType = "manual" | "official_scrape";

export interface SitePriceRecord {
  id: string;
  ownerIdentity: string;
  siteId: string;
  amountMinor: number;
  currency: SitePriceCurrency;
  period: SitePricePeriod;
  freeTierLimit: string | null;
  sourceType: SitePriceSourceType;
  sourceUrl: string | null;
  verifiedAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertSitePriceInput {
  ownerIdentity: string;
  siteId: string;
  amountMinor: number;
  currency: SitePriceCurrency;
  period: SitePricePeriod;
  freeTierLimit: string | null;
  sourceType: SitePriceSourceType;
  sourceUrl: string | null;
  /** 服务端写入时间（毫秒戳，路由层 Date.now()）。 */
  verifiedAt: number;
}

type SitePriceRow = {
  id: string;
  owner_identity: string;
  site_id: string;
  amount_minor: number;
  currency: string;
  period: string;
  free_tier_limit: string | null;
  source_type: string;
  source_url: string | null;
  verified_at: number;
  created_at: number;
  updated_at: number;
};

function rowToPrice(row: SitePriceRow): SitePriceRecord {
  return {
    id: row.id,
    ownerIdentity: row.owner_identity,
    siteId: row.site_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency as SitePriceCurrency,
    period: row.period as SitePricePeriod,
    freeTierLimit: row.free_tier_limit,
    sourceType: row.source_type as SitePriceSourceType,
    sourceUrl: row.source_url,
    verifiedAt: Number(row.verified_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function upsertSitePrice(
  repo: Repository,
  input: UpsertSitePriceInput,
): Promise<SitePriceRecord> {
  const now = Date.now();
  const id = randomUUID();
  await repo.run(
    `INSERT INTO site_prices
       (id, owner_identity, site_id, amount_minor, currency, period,
        free_tier_limit, source_type, source_url, verified_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (owner_identity, site_id) DO UPDATE SET
       amount_minor = excluded.amount_minor,
       currency = excluded.currency,
       period = excluded.period,
       free_tier_limit = excluded.free_tier_limit,
       source_type = excluded.source_type,
       source_url = excluded.source_url,
       verified_at = excluded.verified_at,
       updated_at = excluded.updated_at`,
    [
      id,
      input.ownerIdentity,
      input.siteId,
      input.amountMinor,
      input.currency,
      input.period,
      input.freeTierLimit,
      input.sourceType,
      input.sourceUrl,
      input.verifiedAt,
      now,
      now,
    ],
  );
  const saved = await getSitePrice(repo, input.ownerIdentity, input.siteId);
  if (!saved) throw new Error("保存站点价格后无法读回: " + input.ownerIdentity + "/" + input.siteId);
  return saved;
}

export async function getSitePrice(
  repo: Repository,
  ownerIdentity: string,
  siteId: string,
): Promise<SitePriceRecord | null> {
  const row = (await repo.raw(
    "SELECT * FROM site_prices WHERE owner_identity = ? AND site_id = ? LIMIT 1",
    [ownerIdentity, siteId],
  ))[0] as SitePriceRow | undefined;
  return row ? rowToPrice(row) : null;
}

/**
 * 一次批量取某身份名下若干站点的价格（与 getSitesByIds 同模式）：
 * 对照组装时一次取数，不逐站查库。
 */
export async function getSitePricesBySiteIds(
  repo: Repository,
  ownerIdentity: string,
  siteIds: string[],
): Promise<Map<string, SitePriceRecord>> {
  const out = new Map<string, SitePriceRecord>();
  const uniq = [...new Set(siteIds.filter(Boolean))];
  if (uniq.length === 0) return out;
  const predicate = inPredicate("site_id", uniq);
  const rows = (await repo.raw(
    "SELECT * FROM site_prices WHERE owner_identity = ? AND " + predicate.sql,
    [ownerIdentity, ...predicate.params],
  )) as SitePriceRow[];
  for (const row of rows) {
    const record = rowToPrice(row);
    out.set(record.siteId, record);
  }
  return out;
}

/** 列出某身份的全部价格记录（导出包用；注销由 data-inventory 通用删除循环覆盖）。 */
export async function listSitePricesByOwner(
  repo: Repository,
  ownerIdentity: string,
): Promise<SitePriceRecord[]> {
  const rows = (await repo.raw(
    "SELECT * FROM site_prices WHERE owner_identity = ? ORDER BY updated_at DESC, id DESC",
    [ownerIdentity],
  )) as SitePriceRow[];
  return rows.map(rowToPrice);
}

/**
 * 按站取全部价格记录（GET /api/sites/:id/profile 的价格行摘要用）。
 * 不按 owner 过滤：档案是站点的公开属性，摘要取最近核查的一条；
 * owner_identity 不出路由层（priceView 只含价格字段）。
 */
export async function listSitePricesBySite(
  repo: Repository,
  siteId: string,
): Promise<SitePriceRecord[]> {
  const rows = (await repo.raw(
    "SELECT * FROM site_prices WHERE site_id = ? ORDER BY verified_at DESC, updated_at DESC, id DESC",
    [siteId],
  )) as SitePriceRow[];
  return rows.map(rowToPrice);
}

/**
 * 删除一条价格记录（幂等由路由层保证：无记录返回 false，路由仍回 200）。
 * 先读后删：repo.run 不回行数，读一次即可判定是否真的删过。
 */
export async function deleteSitePrice(
  repo: Repository,
  ownerIdentity: string,
  siteId: string,
): Promise<boolean> {
  const existing = await getSitePrice(repo, ownerIdentity, siteId);
  if (!existing) return false;
  await repo.run(
    "DELETE FROM site_prices WHERE owner_identity = ? AND site_id = ?",
    [ownerIdentity, siteId],
  );
  return true;
}
