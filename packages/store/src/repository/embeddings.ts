import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";
import {
  buildFtsTokens,
  canonicalizeUrl,
  getEnhancedSiteData,
  pinyinTraits,
  type Category,
  type Collection,
  type Site,
  type SiteAction,
  type SiteLiveMetrics,
  type SiteRelation,
  type SiteStatus,
} from "@navhub/core";
import type {
  ApiTokenRecord,
  AuditLogRecord,
  CategoryDistributionItem,
  DashboardOverview,
  FavoriteFolderRecord,
  FavoriteRecord,
  JobRecord,
  MaintenanceStatus,
  SecurityOverview,
  SiteInput,
  TagWithCount,
  UserProfileRecord,
  UserRecord,
  UserVaultRecord,
} from "./records.ts";
import {
  bindSqlite,
  buildIndexFields,
  normalizeTokenScopes,
  packMetadata,
  rowToApiToken,
  rowToAuditLog,
  rowToCategory,
  rowToCollection,
  rowToFavorite,
  rowToFolder,
  rowToJob,
  rowToProfile,
  rowToSite,
  rowToUser,
  slugify,
  toPgSql,
} from "./dialect.ts";
import type { Db } from "../driver.ts";
import { hashSiteId, vectorToBlob } from "../vector/types.ts";

export async function saveEmbedding(repo: Repository, siteId: string, model: string, vector: Float32Array): Promise<void> {
  // 过 vectorToBlob：非有限值会在 BLOB 里静默存活，之后 rehydrate
  // 把它灌回 vec0，整个 KNN 索引的距离都变成 NaN 且不报错
  const buf = vectorToBlob(vector);
  await repo.run(
    `INSERT INTO embeddings (site_id, model, dim, vector, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT (site_id) DO UPDATE SET model = excluded.model, dim = excluded.dim, vector = excluded.vector, updated_at = excluded.updated_at`,
    [siteId, model, vector.length, buf, Date.now()],
  );
}

export async function savedEmbeddings(repo: Repository): Promise<Array<{ key: number; siteId: string; vector: Float32Array }>> {
  const rows = await repo.raw("SELECT site_id AS siteId, vector FROM embeddings", []);
  const out: Array<{ key: number; siteId: string; vector: Float32Array }> = [];
  for (const r of rows) {
    const buf = r.vector as Buffer | Uint8Array | null;
    if (!buf) continue;
    const bytes = buf instanceof Uint8Array ? buf : Buffer.from(buf as ArrayBuffer);
    const copy = Buffer.from(bytes);
    out.push({
      key: hashSiteId(String(r.siteId)),
      siteId: String(r.siteId),
      vector: new Float32Array(copy.buffer, copy.byteOffset, Math.floor(copy.byteLength / 4)),
    });
  }
  return out;
}
