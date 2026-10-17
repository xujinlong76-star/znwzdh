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

export async function listSites(repo: Repository, filter: { categoryId?: string; status?: SiteStatus; limit?: number; offset?: number; source?: string } = {}): Promise<Site[]> {
  const where: string[] = ["s.deleted_at IS NULL"];
  const params: unknown[] = [];
  if (filter.categoryId) { where.push("s.category_id = ?"); params.push(filter.categoryId); }
  if (filter.status) { where.push("s.status = ?"); params.push(filter.status); }
  if (filter.source) { where.push("s.source = ?"); params.push(filter.source); }
  // 默认 limit 100、上限 1000：无限制的全表扫是慢查询主因；调用方需显式传 limit 覆盖。
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000);
  const offset = Math.max(0, filter.offset ?? 0);
  const sqlText = repo.selectSitesSql() +
    " WHERE " + where.join(" AND ") +
    " GROUP BY s.id" +
    " ORDER BY s.sort ASC, s.weight DESC" +
    " LIMIT ? OFFSET ?";
  params.push(limit, offset);
  const rows = await repo.raw(sqlText, params);
  return rows.map(rowToSite);
}

export async function getSitesByIds(repo: Repository, ids: string[]): Promise<Map<string, Site>> {
  const out = new Map<string, Site>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return out;
  for (let i = 0; i < uniq.length; i += 500) {
    const chunk = uniq.slice(i, i + 500);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await repo.raw(
      repo.selectSitesSql() + " WHERE s.id IN (" + placeholders + ") AND s.deleted_at IS NULL",
      chunk,
    );
    for (const r of rows.map(rowToSite)) out.set(r.id, r);
  }
  return out;
}

export function selectSitesSql(repo: Repository): string {
  const tagExpr = repo.db.dialect === "sqlite"
    ? "(SELECT group_concat(t.slug, ',') FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE st.site_id = s.id)"
    : "(SELECT string_agg(t.slug, ',') FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE st.site_id = s.id)";
  return "SELECT s.*, " + tagExpr + " AS tag_slugs FROM sites s";
}

export async function getSite(repo: Repository, idOrUrl: string): Promise<Site | null> {
  const rows = await repo.raw(
    repo.selectSitesSql() + " WHERE (s.id = ? OR s.url = ?) AND s.deleted_at IS NULL LIMIT 1",
    [idOrUrl, idOrUrl],
  );
  const row = rows[0];
  return row ? rowToSite(row) : null;
}

export async function getDeletedSite(repo: Repository, id: string): Promise<Site | null> {
  const rows = await repo.raw(
    repo.selectSitesSql() + " WHERE s.id = ? AND s.deleted_at IS NOT NULL LIMIT 1",
    [id],
  );
  const row = rows[0];
  return row ? rowToSite(row) : null;
}

export async function findSiteByUrl(repo: Repository, url: string): Promise<Site | null> {
  const canonical = canonicalizeUrl(url);
  const rows = await repo.raw(
    repo.selectSitesSql() + " WHERE (s.url = ? OR s.url = ?) AND s.deleted_at IS NULL LIMIT 1",
    [url, canonical],
  );
  const row = rows[0];
  return row ? rowToSite(row) : null;
}

export async function createSite(repo: Repository, input: SiteInput): Promise<Site> {
  return repo.createSiteWithId({ ...input, id: randomUUID() });
}

export async function createSiteWithId(repo: Repository, input: SiteInput & { id: string }): Promise<Site> {
  return repo.withTransaction(async () => {
  const id = input.id;
  const now = Date.now();
  const index = buildIndexFields({ title: input.title ?? input.url, description: input.description, url: input.url, tags: input.tags });
  const metaStr = packMetadata(input);
  // 同 id 的软删行会让主键冲突（快照写回会用原 id 复活站点）——
  // 这里直接"复活"该行：清 deleted_at 并覆盖内容，语义等价于重建。
  const deleted = await repo.getDeletedSite(id);
  if (deleted) {
    await repo.run(
      `UPDATE sites SET url = ?, title = ?, description = ?, category_id = ?, sub_category_id = ?,
         icon_key = ?, status = ?, enabled = ?, sort = ?, featured = ?, source = ?,
         fts_tokens = ?, pinyin_full = ?, pinyin_initials = ?, metadata = ?, deleted_at = NULL, updated_at = ?
       WHERE id = ?`,
      [
        input.url, input.title ?? input.url, input.description ?? null, input.categoryId,
        input.subCategoryId ?? null, input.iconKey ?? null, input.status ?? "active",
        input.enabled === false ? 0 : 1, input.sort ?? 0, input.featured ? 1 : 0,
        input.source ?? "manual", index.ftsTokens, index.pinyinFull, index.pinyinInitials,
        metaStr, now, id,
      ],
    );
    if (input.tags?.length) await repo.setSiteTags(id, input.tags);
    const revived = await repo.getSite(id);
    if (!revived) throw new Error("复活站点后无法读回");
    return revived;
  }
  await repo.run(
    `INSERT INTO sites (
       id, url, title, description, category_id, sub_category_id, icon_key, status, enabled, sort,
       weight, featured, source, fts_tokens, pinyin_full, pinyin_initials, metadata, created_at, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, input.url, input.title ?? input.url, input.description ?? null, input.categoryId,
      input.subCategoryId ?? null, input.iconKey ?? null, input.status ?? "active",
      input.enabled === false ? 0 : 1, input.sort ?? 0, 0, input.featured ? 1 : 0,
      input.source ?? "manual", index.ftsTokens, index.pinyinFull, index.pinyinInitials,
      metaStr, now, now,
    ],
  );
  if (input.tags?.length) await repo.setSiteTags(id, input.tags);
  const created = await repo.getSite(id);
  if (!created) throw new Error("创建站点后无法读回");
  return created;
  });
}

export async function updateSite(repo: Repository, id: string, patch: Partial<SiteInput>): Promise<Site | null> {
  const existing = await repo.getSite(id);
  if (!existing) return null;
  return repo.withTransaction(async () => {

  const title = patch.title ?? existing.title;
  const description = patch.description === undefined ? existing.description : patch.description;
  const tags = patch.tags ?? existing.tags;
  const index = buildIndexFields({ title, description, url: patch.url ?? existing.url, tags });

  const sets: string[] = [
    "title = ?", "description = ?", "fts_tokens = ?", "pinyin_full = ?", "pinyin_initials = ?", "updated_at = ?",
  ];
  const params: unknown[] = [title, description ?? null, index.ftsTokens, index.pinyinFull, index.pinyinInitials, Date.now()];

  const assign = (col: string, value: unknown) => { sets.push(col + " = ?"); params.push(value); };
  if (patch.url !== undefined) assign("url", patch.url);
  if (patch.categoryId !== undefined) assign("category_id", patch.categoryId);
  if (patch.subCategoryId !== undefined) assign("sub_category_id", patch.subCategoryId);
  if (patch.iconKey !== undefined) assign("icon_key", patch.iconKey);
  if (patch.status !== undefined) assign("status", patch.status);
  if (patch.enabled !== undefined) assign("enabled", patch.enabled ? 1 : 0);
  if (patch.sort !== undefined) assign("sort", patch.sort);
  if (patch.featured !== undefined) assign("featured", patch.featured ? 1 : 0);
  if (patch.source !== undefined) assign("source", patch.source);
  if (patch.metadata !== undefined || patch.actions !== undefined || patch.relations !== undefined || patch.liveMetrics !== undefined || patch.workspaces !== undefined) {
    const mergedMeta: Record<string, any> = {
      actions: patch.actions !== undefined ? patch.actions : existing.actions,
      relations: patch.relations !== undefined ? patch.relations : existing.relations,
      liveMetrics: patch.liveMetrics !== undefined ? patch.liveMetrics : existing.liveMetrics,
      workspaces: patch.workspaces !== undefined ? patch.workspaces : existing.workspaces,
      ...(patch.metadata ?? {}),
    };
    assign("metadata", JSON.stringify(mergedMeta));
  }

  params.push(id);
  await repo.run(`UPDATE sites SET ${sets.join(", ")} WHERE id = ?`, params);
  if (patch.tags !== undefined) await repo.setSiteTags(id, patch.tags);
  return repo.getSite(id);
  });
}

export async function deleteSite(repo: Repository, id: string): Promise<boolean> {
  await repo.run("UPDATE sites SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL", [Date.now(), Date.now(), id]);
  return true;
}

export async function restoreSite(repo: Repository, id: string): Promise<Site | null> {
  await repo.run("UPDATE sites SET deleted_at = NULL, updated_at = ? WHERE id = ?", [Date.now(), id]);
  return repo.getSite(id);
}

export async function purgeSite(repo: Repository, id: string): Promise<boolean> {
  await repo.withTransaction(async () => {
  await repo.run("DELETE FROM site_tags WHERE site_id = ?", [id]);
  await repo.run("DELETE FROM embeddings WHERE site_id = ?", [id]);
  await repo.run("DELETE FROM sites WHERE id = ?", [id]);
  });
  return true;
}

export async function listDeletedSites(repo: Repository, limit = 100): Promise<Site[]> {
  const rows = await repo.raw(
    repo.selectSitesSql() + " WHERE s.deleted_at IS NOT NULL GROUP BY s.id ORDER BY s.deleted_at DESC LIMIT ?",
    [limit],
  );
  return rows.map(rowToSite);
}

export async function reorderSites(repo: Repository, order: Array<{ id: string; sort: number }>): Promise<void> {
  await repo.withTransaction(async () => {
    const now = Date.now();
    for (const o of order) {
      await repo.run("UPDATE sites SET sort = ?, updated_at = ? WHERE id = ?", [o.sort, now, o.id]);
    }
  });
}

export async function setSiteTags(repo: Repository, siteId: string, tagNames: string[]): Promise<void> {
  await repo.run("DELETE FROM site_tags WHERE site_id = ?", [siteId]);
  for (const raw of tagNames) {
    const name = raw.trim();
    if (!name) continue;
    const slug = slugify(name);
    const tagId = await repo.upsertTag(name, slug);
    await repo.run("INSERT INTO site_tags (site_id, tag_id) VALUES (?, ?)", [siteId, tagId]);
  }
}

export async function upsertTag(repo: Repository, name: string, slug: string, group = "topic"): Promise<string> {
  // 1. 尝试别名或已存在规范标签解析 (SKOS altLabel 归一化)
  const resolved = await repo.resolveTag(name);
  if (resolved) return resolved.id;
  const resolvedBySlug = await repo.resolveTag(slug);
  if (resolvedBySlug) return resolvedBySlug.id;

  const found = await repo.raw("SELECT id FROM tags WHERE slug = ? LIMIT 1", [slug]);
  if (found[0]) return String(found[0].id);
  const id = randomUUID();
  await repo.run(
    "INSERT INTO tags (id, name, slug, group_name, created_at) VALUES (?,?,?,?,?)",
    [id, name, slug, group, Date.now()],
  );
  return id;
}
