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

export async function listTagsWithCounts(repo: Repository, minCount = 1): Promise<TagWithCount[]> {
  const rows = await repo.raw(
    "SELECT t.id, t.name, t.slug, COUNT(st.site_id) AS cnt " +
      "FROM tags t LEFT JOIN site_tags st ON st.tag_id = t.id " +
      "GROUP BY t.id, t.name, t.slug HAVING COUNT(st.site_id) >= ? " +
      "ORDER BY cnt DESC, t.name ASC",
    [minCount],
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    count: Number(r.cnt ?? 0),
  }));
}

export async function renameTag(repo: Repository, id: string, newName: string): Promise<void> {
  const name = newName.trim();
  if (!name) throw new Error("标签名不能为空");
  await repo.run("UPDATE tags SET name = ?, slug = ? WHERE id = ?", [name, slugify(name), id]);
}

export async function deleteTag(repo: Repository, id: string): Promise<{ unbound: number }> {
  const found = await repo.raw("SELECT id FROM tags WHERE id = ? LIMIT 1", [id]);
  if (!found.length) throw new Error("标签不存在");
  return repo.withTransaction(async () => {
  const affected = await repo.raw(
    "SELECT s.id, s.title, s.description, s.url FROM sites s JOIN site_tags st ON st.site_id = s.id WHERE st.tag_id = ?",
    [id],
  );
  await repo.run("DELETE FROM site_tags WHERE tag_id = ?", [id]);
  await repo.run("DELETE FROM tags WHERE id = ?", [id]);
  // 站点的 fts_tokens / pinyin_full 是「标题+描述+标签」拼出来的（见 buildIndexFields）。
  // 关联删了但索引不刷新的话，搜已删标签**仍然会命中**这些站点——
  // 属于静默不一致（不报错，只是结果不对），必须就地重算。
  for (const r of affected) {
    const siteId = String(r.id);
    const rest = await repo.raw(
      "SELECT t.slug FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE st.site_id = ?",
      [siteId],
    );
    const index = buildIndexFields({
      title: String(r.title),
      description: r.description ?? null,
      url: String(r.url),
      tags: rest.map((t) => String(t.slug)),
    });
    await repo.run(
      "UPDATE sites SET fts_tokens = ?, pinyin_full = ?, pinyin_initials = ?, updated_at = ? WHERE id = ?",
      [index.ftsTokens, index.pinyinFull, index.pinyinInitials, Date.now(), siteId],
    );
  }
  return { unbound: affected.length };
  });
}

export async function mergeTags(repo: Repository, sourceId: string, targetId: string): Promise<{ moved: number }> {
  if (sourceId === targetId) throw new Error("源标签与目标标签不能相同");
  return repo.withTransaction(async () => {
    const rows = await repo.raw(
      "SELECT site_id FROM site_tags WHERE tag_id = ? AND site_id NOT IN (SELECT site_id FROM site_tags WHERE tag_id = ?)",
      [sourceId, targetId],
    );
    for (const r of rows) {
      await repo.run(
        "UPDATE site_tags SET tag_id = ? WHERE tag_id = ? AND site_id = ?",
        [targetId, sourceId, String(r.site_id)],
      );
    }
    await repo.run("DELETE FROM site_tags WHERE tag_id = ?", [sourceId]);
    await repo.run("DELETE FROM tags WHERE id = ?", [sourceId]);
    return { moved: rows.length };
  });
}
