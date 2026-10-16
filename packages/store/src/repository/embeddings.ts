import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";
import {
  buildFtsTokens,
  canonicalizeUrl,
  pinyinTraits,
  type Category,
  type Collection,
  type Site,
  type SiteStatus,
} from "@navhub/core";
import type {
  ApiTokenRecord,
  AuditLogRecord,
  FavoriteFolderRecord,
  FavoriteRecord,
  JobRecord,
  SiteInput,
  TagWithCount,
  UserProfileRecord,
  UserRecord,
  UserVaultRecord,
} from "./records.ts";
import {
  bindSqlite,
  buildIndexFields,
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
import { hashSiteId } from "../vector/types.ts";

export async function saveEmbedding(repo: Repository, siteId: string, model: string, vector: Float32Array): Promise<void> {
  const buf = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
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
