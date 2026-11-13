import type { Repository } from "../repository.ts";
import type {
  RelatedTag,
  TagAliasRecord,
  TagWithCount,
} from "./records.ts";
import {
  buildIndexFields,
  slugify,
} from "./dialect.ts";

/** 重算索引时单次 IN 查询的站点数上限（每行 1 个参数，留足余量） */
const REINDEX_CHUNK = 400;

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

/**
 * 就地重算一组站点的检索索引（fts_tokens / pinyin_full / pinyin_initials）。
 *
 * 索引语料是「标题 + 描述 + URL + 标签 slug」拼出来的（见 buildIndexFields），
 * 所以**任何**改动 site_tags 的写路径都必须走这里：关联变了但索引不刷新，
 * 搜旧标签名仍然命中这些站点——不报错、只是结果错，属于最难发现的静默不一致。
 * deleteTag 与 mergeTags 共用这一条路径，避免两处逻辑各自漂移
 * （历史上正是 mergeTags 漏了重算，合并后旧标签名仍能搜到）。
 */
async function reindexSites(repo: Repository, siteIds: string[]): Promise<void> {
  const unique = [...new Set(siteIds.map((id) => String(id)))].filter(Boolean);
  if (unique.length === 0) return;
  const now = Date.now();
  // 分片：绑定参数有语句级上限（sqlite 999），合并一个热门标签可能牵动上千站点
  for (let i = 0; i < unique.length; i += REINDEX_CHUNK) {
    const slice = unique.slice(i, i + REINDEX_CHUNK);
    const placeholders = slice.map(() => "?").join(",");
    const sites = await repo.raw(
      `SELECT id, title, description, url FROM sites WHERE id IN (${placeholders})`,
      slice,
    );
    if (!sites.length) continue;
    const rest = await repo.raw(
      `SELECT st.site_id, t.slug FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE st.site_id IN (${placeholders})`,
      slice,
    );
    const tagsBySite = new Map<string, string[]>();
    for (const r of rest) {
      const sid = String(r.site_id);
      const list = tagsBySite.get(sid);
      if (list) list.push(String(r.slug));
      else tagsBySite.set(sid, [String(r.slug)]);
    }
    for (const s of sites) {
      const siteId = String(s.id);
      const index = buildIndexFields({
        title: String(s.title),
        description: s.description ?? null,
        url: String(s.url),
        tags: tagsBySite.get(siteId) ?? [],
      });
      await repo.run(
        "UPDATE sites SET fts_tokens = ?, pinyin_full = ?, pinyin_initials = ?, updated_at = ? WHERE id = ?",
        [index.ftsTokens, index.pinyinFull, index.pinyinInitials, now, siteId],
      );
    }
  }
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
    await reindexSites(repo, affected.map((r) => String(r.id)));
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

    // 只迁移「目标标签尚未绑定的站点」：NOT EXISTS 反连接（P10），不用 NOT IN——
    // 后者在子查询含 NULL 时整批失效；这里是同一张表的相关子查询，按审计里
    // 孤儿清扫（migrate.ts cleanupOrphanPluginCategories）的写法。
    const rows = await repo.raw(
      "SELECT site_id FROM site_tags WHERE tag_id = ? AND NOT EXISTS (SELECT 1 FROM site_tags AS st2 WHERE st2.tag_id = ? AND st2.site_id = site_tags.site_id)",
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
    // 与 deleteTag 同一条重算路径：源标签被删、站点改挂目标标签后，
    // 索引语料里的旧 slug 必须换掉。漏了这一步的话，合并后搜旧标签名
    // 仍然命中这些站点（不报错，只是结果错）。
    await reindexSites(repo, rows.map((r) => String(r.site_id)));
    return { moved: rows.length };
  });
}


/**
 * 取标签原始行（按 id 或 slug 命中）。
 *
 * 为什么新增：相关标签路由要接受「slug 或 id」两种入参（与 /api/tags/resolve
 * 同口径，但 resolve 走 name/slug 别名归一、这里只认主键与 slug）。共现查询
 * 需要的是内部 id，页面侧传来的却是 URL 段（slug 形态），先归一成 id 再聚合。
 */
export async function getRawTag(repo: Repository, ref: string): Promise<{ id: string; name: string; slug: string } | null> {
  const norm = ref.trim();
  if (!norm) return null;
  const rows = await repo.raw(
    "SELECT id, name, slug FROM tags WHERE id = ? OR slug = ? LIMIT 1",
    [norm, norm],
  );
  if (!rows.length) return null;
  return { id: String(rows[0]!.id), name: String(rows[0]!.name), slug: String(rows[0]!.slug) };
}

/**
 * 标签共现相关标签（信息组织清晰度的真实缺口：标签页是浏览死胡同——
 * 用户看完「React」下的站点，没有任何路径通往「Vue / Next.js / 前端框架」，
 * 整套代码此前对标签共现零实现）。
 *
 * 方法：找同时挂了本标签与候选标签的**存活**站点，按共现站点数降序，
 * 取前 limit 个（排除自身）。纯只读、复用 site_tags 索引，不引入新表。
 *
 * 存活口径与 listTagsWithCounts 一致（deleted_at IS NULL / enabled / status='active'），
 * 否则软删除站点的关联会把弱相关标签顶上来。候选标签只回基础展示字段，
 * 不回 count（那是 listTagsWithCounts 的职责，避免一次请求里双重口径）。
 */
export async function listRelatedTags(
  repo: Repository,
  tagId: string,
  limit = 12,
): Promise<RelatedTag[]> {
  const lid = Math.max(1, Math.min(50, Math.trunc(limit)));
  const rows = await repo.raw(
    `SELECT t.id AS id, t.name AS name, t.slug AS slug, t.group_name AS group_name,
            t.color AS color, COUNT(DISTINCT st2.site_id) AS shared
     FROM site_tags st1
     JOIN site_tags st2 ON st2.site_id = st1.site_id AND st2.tag_id <> st1.tag_id
     JOIN tags t ON t.id = st2.tag_id
     JOIN sites s ON s.id = st2.site_id
       AND s.deleted_at IS NULL AND s.enabled = ? AND s.status = 'active'
     WHERE st1.tag_id = ?
     GROUP BY t.id, t.name, t.slug, t.group_name, t.color
     HAVING COUNT(DISTINCT st2.site_id) >= 1
     ORDER BY shared DESC, t.name ASC
     LIMIT ?`,
    [true, tagId, lid],
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    group: String(r.group_name || "topic"),
    color: r.color ? String(r.color) : null,
    sharedSites: Number(r.shared ?? 0),
  }));
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

export async function removeTagAlias(repo: Repository, rawAlias: string, tagId?: string): Promise<void> {
  const norm = rawAlias.trim();
  if (!norm) return;
  const alias = slugify(norm) || norm.toLowerCase();
  if (tagId) {
    await repo.run("DELETE FROM tag_aliases WHERE (alias = ? OR alias = ?) AND tag_id = ?", [alias, norm, tagId]);
  } else {
    await repo.run("DELETE FROM tag_aliases WHERE alias = ? OR alias = ?", [alias, norm]);
  }
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
