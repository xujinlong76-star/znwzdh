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
  TagAliasRecord,
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

export async function listTagsWithCounts(repo: Repository, minCount = 1, group?: string): Promise<TagWithCount[]> {
  const params: unknown[] = [];
  // 计数只算**存活站点**（s.deleted_at IS NULL AND s.enabled AND s.status = 'active'，
  // 与 catalog / sitemap 的候选集同口径）。曾用裸 COUNT(st.site_id) 把软删除站点的
  // 标签关联也算进来：实测 dev 库里「开源」报 123 而存活站点只有 3——chip 计数、
  // TAG_LINK_MIN 渲染规则、sitemap 的 ≥5 门槛全部失真（方案 §4.1 的分层表也因此
  // 虚高）。随后又发现仅过滤 deleted_at/enabled 仍会把 broken 站点计入，导致
  // 标签页比 sitemap 收录的站点还少、门槛被软 404 撑起。
  // JOIN 条件里过滤而不是 WHERE：让 0 存活站点的标签仍出现在结果里（cnt=0，
  // 由 minCount/HAVING 决定去留），行为面与旧版一致。
  let sql =
    "SELECT t.id, t.name, t.slug, t.group_name, t.color, t.description, COUNT(s.id) AS cnt " +
    "FROM tags t " +
    "LEFT JOIN site_tags st ON st.tag_id = t.id " +
    "LEFT JOIN sites s ON s.id = st.site_id AND s.deleted_at IS NULL AND s.enabled = ? AND s.status = 'active' ";
  params.push(true);
  if (group && group.trim()) {
    sql += "WHERE t.group_name = ? ";
    params.push(group.trim());
  }
  sql +=
    "GROUP BY t.id, t.name, t.slug, t.group_name, t.color, t.description " +
    "HAVING COUNT(s.id) >= ? " +
    "ORDER BY cnt DESC, t.name ASC";
  params.push(minCount);

  const rows = await repo.raw(sql, params);

  // 批量拉取别名映射 (SKOS altLabels)
  let aliasMap = new Map<string, string[]>();
  try {
    const aliasRows = await repo.raw("SELECT alias, tag_id FROM tag_aliases ORDER BY alias ASC", []);
    for (const ar of aliasRows) {
      const tid = String(ar.tag_id);
      const a = String(ar.alias);
      const list = aliasMap.get(tid);
      if (list) list.push(a);
      else aliasMap.set(tid, [a]);
    }
  } catch {
    aliasMap = new Map();
  }

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    count: Number(r.cnt ?? 0),
    group: String(r.group_name || "topic"),
    color: r.color ? String(r.color) : null,
    description: r.description ? String(r.description) : null,
    aliases: aliasMap.get(String(r.id)) ?? [],
  }));
}

export async function renameTag(repo: Repository, id: string, newName: string): Promise<void> {
  const name = newName.trim();
  if (!name) throw new Error("标签名不能为空");
  await repo.run("UPDATE tags SET name = ?, slug = ? WHERE id = ?", [name, slugify(name), id]);
}

export async function updateTag(
  repo: Repository,
  id: string,
  patch: { name?: string; group?: string; color?: string | null; description?: string | null },
): Promise<void> {
  const tag = await repo.raw("SELECT id, name, slug, group_name FROM tags WHERE id = ? LIMIT 1", [id]);
  if (!tag.length) throw new Error("标签不存在");

  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error("标签名不能为空");
    sets.push("name = ?", "slug = ?");
    params.push(name, slugify(name));
  }
  if (patch.group !== undefined) {
    const group = patch.group.trim();
    if (!group) throw new Error("维度分组不能为空");
    sets.push("group_name = ?");
    params.push(group);
  }
  if (patch.color !== undefined) {
    sets.push("color = ?");
    params.push(patch.color);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    params.push(patch.description);
  }

  if (sets.length === 0) return;
  params.push(id);
  await repo.run(`UPDATE tags SET ${sets.join(", ")} WHERE id = ?`, params);
}

export async function deleteTag(repo: Repository, id: string): Promise<{ unbound: number }> {
  const found = await repo.raw("SELECT id FROM tags WHERE id = ? LIMIT 1", [id]);
  if (!found.length) throw new Error("标签不存在");
  return repo.withTransaction(async () => {
    const affected = await repo.raw(
      "SELECT s.id, s.title, s.description, s.url FROM sites s JOIN site_tags st ON st.site_id = s.id WHERE st.tag_id = ?",
      [id],
    );
    try {
      await repo.run("DELETE FROM tag_aliases WHERE tag_id = ?", [id]);
    } catch {
      // 容错
    }
    await repo.run("DELETE FROM site_tags WHERE tag_id = ?", [id]);
    await repo.run("DELETE FROM tags WHERE id = ?", [id]);
    // 站点的 fts_tokens / pinyin_full 是「标题+描述+标签」拼出来的（见 buildIndexFields）。
    // 关联删了但索引不刷新的话，搜已删标签仍然会命中这些站点——
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
    const sourceRows = await repo.raw("SELECT id, name, slug FROM tags WHERE id = ? LIMIT 1", [sourceId]);
    if (!sourceRows.length) throw new Error("源标签不存在");
    const targetRows = await repo.raw("SELECT id, name, slug FROM tags WHERE id = ? LIMIT 1", [targetId]);
    if (!targetRows.length) throw new Error("目标标签不存在");
    const sourceTag = sourceRows[0]!;

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
    // 迁移既有别名至目标标签
    try {
      await repo.run("UPDATE tag_aliases SET tag_id = ? WHERE tag_id = ?", [targetId, sourceId]);
    } catch {
      // 容错
    }
    // 自动将源标签名称与 slug 转换为目标标签的别名（SKOS 概念合并与兼容性规范）
    try {
      const alias1 = String(sourceTag.slug);
      const exist = await repo.raw("SELECT alias FROM tag_aliases WHERE alias = ?", [alias1]);
      if (!exist.length) {
        await repo.run("INSERT INTO tag_aliases (alias, tag_id, created_at) VALUES (?, ?, ?)", [
          alias1,
          targetId,
          Date.now(),
        ]);
      }
    } catch {
      // 忽略冲突
    }

    await repo.run("DELETE FROM site_tags WHERE tag_id = ?", [sourceId]);
    await repo.run("DELETE FROM tags WHERE id = ?", [sourceId]);
    return { moved: rows.length };
  });
}

export async function addTagAlias(repo: Repository, tagId: string, rawAlias: string): Promise<{ alias: string }> {
  const norm = rawAlias.trim();
  if (!norm) throw new Error("别名不能为空");
  const alias = slugify(norm) || norm.toLowerCase();

  const tagRows = await repo.raw("SELECT id, name, slug FROM tags WHERE id = ? LIMIT 1", [tagId]);
  if (!tagRows.length) throw new Error("标签不存在");

  // 检查是否与其它主标签冲突
  const conflictTag = await repo.raw("SELECT id FROM tags WHERE slug = ? OR name = ? LIMIT 1", [alias, norm]);
  if (conflictTag.length && String(conflictTag[0]!.id) !== tagId) {
    throw new Error(`别名 "${norm}" 与既有主标签冲突`);
  }

  // 检查别名表
  const existingAlias = await repo.raw("SELECT tag_id FROM tag_aliases WHERE alias = ? LIMIT 1", [alias]);
  if (existingAlias.length) {
    if (String(existingAlias[0]!.tag_id) === tagId) {
      return { alias };
    }
    throw new Error(`别名 "${norm}" 已被其他标签绑定`);
  }

  await repo.run("INSERT INTO tag_aliases (alias, tag_id, created_at) VALUES (?, ?, ?)", [
    alias,
    tagId,
    Date.now(),
  ]);
  return { alias };
}

export async function removeTagAlias(repo: Repository, rawAlias: string): Promise<void> {
  const norm = rawAlias.trim();
  if (!norm) return;
  const alias = slugify(norm) || norm.toLowerCase();
  await repo.run("DELETE FROM tag_aliases WHERE alias = ? OR alias = ?", [alias, norm]);
}

export async function listTagAliases(repo: Repository, tagId?: string): Promise<TagAliasRecord[]> {
  try {
    const rows = tagId
      ? await repo.raw("SELECT alias, tag_id, created_at FROM tag_aliases WHERE tag_id = ? ORDER BY alias ASC", [tagId])
      : await repo.raw("SELECT alias, tag_id, created_at FROM tag_aliases ORDER BY alias ASC", []);
    return rows.map((r) => ({
      alias: String(r.alias),
      tagId: String(r.tag_id),
      createdAt: Number(r.created_at ?? 0),
    }));
  } catch {
    return [];
  }
}

export async function resolveTag(
  repo: Repository,
  rawNameOrAlias: string,
): Promise<{ id: string; name: string; slug: string; group: string; description: string | null } | null> {
  const norm = rawNameOrAlias.trim();
  if (!norm) return null;
  const slugNorm = slugify(norm);

  // 1. 直查主标签表 (name 或 slug 命中)
  const tagRows = await repo.raw(
    "SELECT id, name, slug, group_name, description FROM tags WHERE slug = ? OR name = ? OR slug = ? LIMIT 1",
    [slugNorm, norm, norm],
  );
  if (tagRows.length) {
    const r = tagRows[0]!;
    return {
      id: String(r.id),
      name: String(r.name),
      slug: String(r.slug),
      group: String(r.group_name || "topic"),
      description: r.description ? String(r.description) : null,
    };
  }

  // 2. 查别名表 (alias 或 slug(alias) 命中)
  try {
    const aliasRows = await repo.raw(
      "SELECT t.id, t.name, t.slug, t.group_name, t.description FROM tag_aliases ta JOIN tags t ON t.id = ta.tag_id WHERE ta.alias = ? OR ta.alias = ? LIMIT 1",
      [slugNorm, norm],
    );
    if (aliasRows.length) {
      const r = aliasRows[0]!;
      return {
        id: String(r.id),
        name: String(r.name),
        slug: String(r.slug),
        group: String(r.group_name || "topic"),
        description: r.description ? String(r.description) : null,
      };
    }
  } catch {
    // 兼容迁移前旧表
  }

  return null;
}
