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
  CONTROLLED_FACETS,
  CONTROLLED_RELATION_TYPES,
  normalizeSiteRelation,
  type FacetGroupSummary,
  type FacetOptionCount,
} from "@navhub/core";
import type {
  ApiTokenRecord,
  AuditLogRecord,
  CategoryDistributionItem,
  SiteKnowledgeGraph,
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
  rowToSiteRelation,
  rowToUser,
  slugify,
  toPgSql,
} from "./dialect.ts";
import type { Db } from "../driver.ts";

export async function listSites(repo: Repository, filter: { categoryId?: string; status?: SiteStatus; limit?: number; offset?: number; source?: string; facets?: Record<string, string[]> } = {}): Promise<Site[]> {
  const where: string[] = ["s.deleted_at IS NULL"];
  const params: unknown[] = [];
  if (filter.categoryId) { where.push("s.category_id = ?"); params.push(filter.categoryId); }
  if (filter.status) { where.push("s.status = ?"); params.push(filter.status); }
  if (filter.source) { where.push("s.source = ?"); params.push(filter.source); }
  if (filter.facets && Object.keys(filter.facets).length > 0) {
    const ids = await repo.filterSiteIdsByFacets(filter.facets);
    if (ids.length === 0) return [];
    where.push("s.id IN (" + ids.map(() => "?").join(",") + ")");
    params.push(...ids);
  }
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
  const facetExpr = repo.db.dialect === "sqlite"
    ? "(SELECT group_concat(sf.facet_key || ':' || sf.facet_value, ',') FROM site_facets sf WHERE sf.site_id = s.id)"
    : "(SELECT string_agg(sf.facet_key || ':' || sf.facet_value, ',') FROM site_facets sf WHERE sf.site_id = s.id)";
  return "SELECT s.*, " + tagExpr + " AS tag_slugs, " + facetExpr + " AS facet_pairs FROM sites s";
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
    if (input.facets !== undefined) {
      await repo.setSiteFacets(id, input.facets);
    } else if (input.workspaces?.length) {
      await repo.setSiteFacets(id, { scene: input.workspaces });
    }
    if (input.relations !== undefined) {
      await repo.setSiteRelations(id, input.relations);
    }
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
  if (input.facets !== undefined) {
    await repo.setSiteFacets(id, input.facets);
  } else if (input.workspaces?.length) {
    await repo.setSiteFacets(id, { scene: input.workspaces });
  }
  if (input.relations !== undefined) {
    await repo.setSiteRelations(id, input.relations);
  }
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
  if (patch.facets !== undefined) await repo.setSiteFacets(id, patch.facets);
  if (patch.relations !== undefined) await repo.setSiteRelations(id, patch.relations);
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
  await repo.run("DELETE FROM site_facets WHERE site_id = ?", [id]);
  await repo.run("DELETE FROM site_relations WHERE source_site_id = ? OR target_site_id = ?", [id, id]);
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

/* ------------------------------------------------------------------ *
 * 分面属性维护与检索 (Faceted Taxonomy Operations)
 * ------------------------------------------------------------------ */

export async function setSiteFacets(
  repo: Repository,
  siteId: string,
  rawFacets: Record<string, string[] | string | null | undefined>,
): Promise<void> {
  await repo.run("DELETE FROM site_facets WHERE site_id = ?", [siteId]);
  for (const [rawKey, rawVals] of Object.entries(rawFacets)) {
    const key = rawKey.trim().toLowerCase();
    if (!key) continue;
    const values = Array.isArray(rawVals)
      ? rawVals.map((v) => String(v).trim().toLowerCase()).filter(Boolean)
      : typeof rawVals === "string" && rawVals.trim()
        ? [rawVals.trim().toLowerCase()]
        : [];
    const deduped = [...new Set(values)];
    for (const val of deduped) {
      await repo.run(
        "INSERT INTO site_facets (site_id, facet_key, facet_value) VALUES (?, ?, ?)",
        [siteId, key, val],
      );
    }
  }
}

export async function getSiteFacets(repo: Repository, siteId: string): Promise<Record<string, string[]>> {
  const rows = await repo.raw(
    "SELECT facet_key, facet_value FROM site_facets WHERE site_id = ? ORDER BY facet_key ASC, facet_value ASC",
    [siteId],
  );
  const out: Record<string, string[]> = {};
  for (const r of rows as Array<{ facet_key: string; facet_value: string }>) {
    const k = String(r.facet_key);
    const v = String(r.facet_value);
    if (!out[k]) out[k] = [];
    out[k].push(v);
  }
  return out;
}

export async function filterSiteIdsByFacets(
  repo: Repository,
  facets: Record<string, string[] | string | null | undefined>,
): Promise<string[]> {
  const keys = Object.keys(facets).filter((k) => {
    const v = facets[k];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  });
  if (keys.length === 0) return [];

  let candidateSet: Set<string> | null = null;

  for (const rawKey of keys) {
    const key = rawKey.trim().toLowerCase();
    const rawVal = facets[rawKey];
    const vals = (Array.isArray(rawVal) ? rawVal : [rawVal])
      .map((v) => String(v).trim().toLowerCase())
      .filter(Boolean);
    if (vals.length === 0) continue;

    const placeholders = vals.map(() => "?").join(", ");
    const rows = await repo.raw(
      `SELECT DISTINCT site_id FROM site_facets WHERE facet_key = ? AND facet_value IN (${placeholders})`,
      [key, ...vals],
    );
    const currentKeySites = new Set(rows.map((r: any) => String(r.site_id)));

    if (candidateSet === null) {
      candidateSet = currentKeySites;
    } else {
      const next = new Set<string>();
      for (const id of candidateSet) {
        if (currentKeySites.has(id)) next.add(id);
      }
      candidateSet = next;
    }

    if (candidateSet.size === 0) return [];
  }

  return candidateSet ? [...candidateSet] : [];
}

export async function listFacetsSummary(
  repo: Repository,
  filter: { categoryId?: string; tag?: string } = {},
): Promise<FacetGroupSummary[]> {
  const wheres = ["s.deleted_at IS NULL"];
  const params: unknown[] = [];
  if (repo.db.dialect === "sqlite") {
    wheres.push("s.enabled = 1");
  } else {
    wheres.push("s.enabled = TRUE");
  }

  if (filter.categoryId) {
    wheres.push("s.category_id = ?");
    params.push(filter.categoryId);
  }

  let tagJoin = "";
  if (filter.tag) {
    tagJoin = "JOIN site_tags st ON st.site_id = s.id JOIN tags t ON t.id = st.tag_id LEFT JOIN tag_aliases ta ON ta.tag_id = t.id";
    wheres.push("(t.slug = ? OR t.name = ? OR ta.alias = ?)");
    params.push(filter.tag, filter.tag, filter.tag);
  }

  const sqlText = `
    SELECT sf.facet_key, sf.facet_value, COUNT(DISTINCT s.id) AS cnt
      FROM site_facets sf
      JOIN sites s ON s.id = sf.site_id
      ${tagJoin}
     WHERE ${wheres.join(" AND ")}
     GROUP BY sf.facet_key, sf.facet_value
     ORDER BY sf.facet_key ASC, cnt DESC
  `;

  const rows = await repo.raw(sqlText, params) as Array<{ facet_key: string; facet_value: string; cnt: number | string }>;
  const countMap = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const k = String(r.facet_key).toLowerCase();
    const v = String(r.facet_value).toLowerCase();
    const c = Number(r.cnt ?? 0);
    if (!countMap.has(k)) countMap.set(k, new Map());
    countMap.get(k)!.set(v, c);
  }

  const result: FacetGroupSummary[] = [];

  // 1. 遍历标准受控分面
  for (const def of CONTROLLED_FACETS) {
    const counts = countMap.get(def.key) ?? new Map();
    const options: FacetOptionCount[] = def.options.map((opt) => ({
      value: opt.value,
      label: opt.label,
      labelEn: opt.labelEn,
      count: counts.get(opt.value) ?? 0,
    }));

    // 收集非受控自定候选值（如有）
    for (const [val, cnt] of counts.entries()) {
      if (!def.options.some((o) => o.value === val)) {
        options.push({ value: val, label: val, count: cnt });
      }
    }

    result.push({
      key: def.key,
      label: def.label,
      labelEn: def.labelEn,
      description: def.description,
      options,
    });
  }

  // 2. 遍历动态新增的扩展分面
  for (const [k, counts] of countMap.entries()) {
    if (CONTROLLED_FACETS.some((def) => def.key === k)) continue;
    const options: FacetOptionCount[] = [];
    for (const [val, cnt] of counts.entries()) {
      options.push({ value: val, label: val, count: cnt });
    }
    result.push({
      key: k,
      label: k,
      options,
    });
  }

  return result;
}

/**
 * 覆盖保存站点的实体关系边（Site Relations），自动解析 targetSiteId
 */
export async function setSiteRelations(
  repo: Repository,
  siteId: string,
  relations: SiteRelation[]
): Promise<void> {
  await repo.run("DELETE FROM site_relations WHERE source_site_id = ?", [siteId]);
  const now = Date.now();
  for (const raw of relations) {
    const norm = normalizeSiteRelation(raw);
    if (!norm) continue;
    const id = norm.id ?? randomUUID();
    let targetSiteId = norm.targetSiteId ?? null;
    if (!targetSiteId) {
      const targetRows = await repo.raw(
        "SELECT id FROM sites WHERE url = ? AND deleted_at IS NULL LIMIT 1",
        [norm.targetUrl]
      );
      if (targetRows[0]) targetSiteId = String(targetRows[0].id);
    }
    await repo.run(
      `INSERT INTO site_relations (
         id, source_site_id, target_site_id, target_title, target_url, relation_type,
         is_free_or_open_source, note, confidence, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        siteId,
        targetSiteId,
        norm.targetTitle,
        norm.targetUrl,
        norm.relationType,
        norm.isFreeOrOpenSource ? 1 : 0,
        norm.note ?? null,
        norm.confidence ?? 1.0,
        norm.createdAt ?? now,
        now,
      ]
    );
  }
}

/**
 * 获取站点的完整关联详情（含出边、入边及对称反向推导）
 */
export async function getDetailedSiteRelations(
  repo: Repository,
  siteId: string
): Promise<{ outgoing: SiteRelation[]; incoming: SiteRelation[]; all: SiteRelation[] }> {
  const outRows = await repo.raw(
    "SELECT * FROM site_relations WHERE source_site_id = ? ORDER BY relation_type ASC, confidence DESC",
    [siteId]
  );
  const inRows = await repo.raw(
    "SELECT * FROM site_relations WHERE target_site_id = ? ORDER BY relation_type ASC, confidence DESC",
    [siteId]
  );

  let outgoing = outRows.map(rowToSiteRelation);
  const incoming = inRows.map(rowToSiteRelation);

  // 如果关系表尚无数据，兜底从现有 site.relations 补齐
  if (outgoing.length === 0) {
    const site = await repo.getSite(siteId);
    if (site?.relations?.length) {
      outgoing = site.relations.map((r) => ({
        ...r,
        sourceSiteId: siteId,
      }));
    }
  }

  const seen = new Set<string>();
  const all: SiteRelation[] = [];

  for (const r of outgoing) {
    const key = `${r.relationType}:${r.targetUrl.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      all.push(r);
    }
  }

  for (const r of incoming) {
    const meta = CONTROLLED_RELATION_TYPES[r.relationType];
    // 对称关系（alternative, complementary, mirror, related），自然可作为反向关联呈现
    if (meta?.symmetric && r.sourceSiteId) {
      const sourceSite = await repo.getSite(r.sourceSiteId);
      if (sourceSite) {
        const key = `${r.relationType}:${sourceSite.url.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          all.push({
            id: r.id ? `inv-${r.id}` : undefined,
            sourceSiteId: siteId,
            targetSiteId: sourceSite.id,
            targetTitle: sourceSite.title,
            targetUrl: sourceSite.url,
            relationType: r.relationType,
            isFreeOrOpenSource: false,
            note: r.note ? `[反向引用] ${r.note}` : undefined,
            confidence: r.confidence,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          });
        }
      }
    }
  }

  return { outgoing, incoming, all };
}

/**
 * 获取站点的全部关联集合（平铺，兼容原有 Site.relations 消费者）
 */
export async function getSiteRelations(
  repo: Repository,
  siteId: string
): Promise<SiteRelation[]> {
  const detailed = await getDetailedSiteRelations(repo, siteId);
  return detailed.all;
}

/**
 * 获取以目标站点为中心的局部知识图谱（Ego-Graph，供 /graph 与可视化组件渲染）
 */
export async function getSiteKnowledgeGraph(
  repo: Repository,
  siteId: string,
  maxNeighbors = 15
): Promise<SiteKnowledgeGraph | null> {
  const center = await repo.getSite(siteId);
  if (!center) return null;

  const centerCat = center.categoryId ? await repo.getCategory(center.categoryId) : null;
  const detailed = await getDetailedSiteRelations(repo, siteId);

  const nodesMap = new Map<string, SiteKnowledgeGraph["nodes"][number]>();
  nodesMap.set(center.id, {
    id: center.id,
    title: center.title,
    url: center.url,
    iconKey: center.iconKey ?? null,
    categoryId: center.categoryId,
    categoryTitle: centerCat?.title,
    isCenter: true,
  });

  const edges: SiteKnowledgeGraph["edges"] = [];
  const seenEdges = new Set<string>();

  const slice = detailed.all.slice(0, maxNeighbors);
  for (const rel of slice) {
    const meta = CONTROLLED_RELATION_TYPES[rel.relationType] ?? CONTROLLED_RELATION_TYPES.related;
    const targetId = rel.targetSiteId ?? `ext-${Buffer.from(rel.targetUrl).toString("base64url").slice(0, 12)}`;
    if (!nodesMap.has(targetId)) {
      let catTitle: string | undefined;
      let iconKey: string | null = null;
      if (rel.targetSiteId) {
        const targetSite = await repo.getSite(rel.targetSiteId);
        if (targetSite) {
          iconKey = targetSite.iconKey ?? null;
          if (targetSite.categoryId) {
            const cat = await repo.getCategory(targetSite.categoryId);
            catTitle = cat?.title;
          }
        }
      }
      nodesMap.set(targetId, {
        id: targetId,
        title: rel.targetTitle,
        url: rel.targetUrl,
        iconKey,
        categoryTitle: catTitle,
        isCenter: false,
      });
    }

    const edgeKey = `${center.id}->${targetId}:${rel.relationType}`;
    if (!seenEdges.has(edgeKey)) {
      seenEdges.add(edgeKey);
      edges.push({
        source: center.id,
        target: targetId,
        relationType: rel.relationType,
        labelZh: meta.labelZh,
        symmetric: meta.symmetric,
        note: rel.note,
      });
    }
  }

  return {
    centerSiteId: center.id,
    nodes: [...nodesMap.values()],
    edges,
  };
}


