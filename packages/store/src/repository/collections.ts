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

export async function upsertCollection(repo: Repository, input: {
    id?: string;
    slug: string;
    title: string;
    description?: string | null;
    kind?: "topic" | "geo" | "roadmap";
    icon?: string | null;
    sort?: number;
    enabled?: boolean;
    sites?: string[];
  }): Promise<Collection> {
  const slug = input.slug.trim();
  if (!slug) throw new Error("专题 slug 不能为空");
  const existing = await repo.getCollectionBySlug(slug);
  const id = existing?.id ?? input.id ?? randomUUID();
  const now = Date.now();
  const kind = input.kind ?? "topic";
  const sort = input.sort ?? 0;
  const enabled = input.enabled !== false;
  const icon = input.icon ?? null;
  const description = input.description ?? null;

  await repo.withTransaction(async () => {
    if (existing) {
      await repo.run(
        "UPDATE collections SET title = ?, description = ?, kind = ?, icon = ?, sort = ?, enabled = ?, updated_at = ? WHERE id = ?",
        [input.title, description, kind, icon, sort, enabled ? 1 : 0, now, id],
      );
    } else {
      await repo.run(
        "INSERT INTO collections (id, slug, title, description, kind, icon, sort, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [id, slug, input.title, description, kind, icon, sort, enabled ? 1 : 0, now, now],
      );
    }

    if (input.sites && Array.isArray(input.sites)) {
      await repo.run("DELETE FROM collection_items WHERE collection_id = ?", [id]);
      let itemSort = 0;
      for (const siteRef of input.sites) {
        const site = await repo.getSite(siteRef);
        if (site) {
          await repo.run(
            "INSERT INTO collection_items (collection_id, site_id, sort, note) VALUES (?,?,?,?)",
            [id, site.id, itemSort++, null],
          );
        }
      }
    }
  });

  const saved = await repo.getCollectionBySlug(slug);
  if (!saved) throw new Error("保存专题后无法读回: " + slug);
  return saved;
}

export async function listCollections(repo: Repository, onlyEnabled = true): Promise<Collection[]> {
  const rows = await repo.raw("SELECT * FROM collections ORDER BY sort ASC, title ASC", []);
  return rows.map(rowToCollection).filter((c) => !onlyEnabled || c.enabled);
}

export async function getCollectionBySlug(repo: Repository, slug: string): Promise<Collection | null> {
  const row = (await repo.raw("SELECT * FROM collections WHERE slug = ? LIMIT 1", [slug]))[0];
  return row ? rowToCollection(row) : null;
}

export async function listCollectionSites(repo: Repository, slug: string): Promise<Site[]> {
  const col = await repo.getCollectionBySlug(slug);
  if (!col) return [];
  const rows = await repo.raw(
    repo.selectSitesSql() +
      " JOIN collection_items ci ON ci.site_id = s.id" +
      " WHERE ci.collection_id = ? AND s.enabled = " + repo.enabledLiteral + " AND s.deleted_at IS NULL" +
      // ORDER BY 必须用聚合：PG 不允许按「未分组且非 s.id 函数依赖」的列排序
      // （GROUP BY s.id + ORDER BY ci.sort 在 SQLite 能跑、到 PG 报错）。
      " GROUP BY s.id ORDER BY MIN(ci.sort) ASC",
    [col.id],
  );
  return rows.map(rowToSite);
}
