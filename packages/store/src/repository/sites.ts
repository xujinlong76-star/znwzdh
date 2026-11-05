import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";
import { containsLike } from "../sql-like.ts";
import {
  canonicalizeUrl,
  type Site,
  type SiteRelation,
  type SiteStatus,
  CONTROLLED_FACETS,
  CONTROLLED_RELATION_TYPES,
  normalizeSiteRelation,
  type FacetGroupSummary,
  type FacetOptionCount,
  type SiteOfflineArchive,
} from "@navhub/core";
import type {
  SiteKnowledgeGraph,
  MatchedSiteRelation,
  SiteInput,
} from "./records.ts";
import {
  buildIndexFields,
  packMetadata,
  rowToSite,
  rowToSiteRelation,
  slugify,
} from "./dialect.ts";
import { chunkList, inPredicate, SQL_IN_CHUNK } from "../sql-in.ts";

export async function listSites(repo: Repository, filter: { categoryId?: string; status?: SiteStatus; excludeStatuses?: SiteStatus[]; limit?: number; offset?: number; source?: string; facets?: Record<string, string[]> } = {}): Promise<Site[]> {
  const where: string[] = ["s.deleted_at IS NULL"];
  const params: unknown[] = [];
  if (filter.categoryId) { where.push("s.category_id = ?"); params.push(filter.categoryId); }
  if (filter.status) { where.push("s.status = ?"); params.push(filter.status); }
  // 数据面最小化：把编辑工作面的中间态（pending/archived）排除在只读集成之外。
  // 用 <> 逐条排除而不是 NOT IN：要排除的状态最多两个，不必引入分片复杂度。
  for (const status of filter.excludeStatuses ?? []) {
    where.push("s.status <> ?");
    params.push(status);
  }
  if (filter.source) { where.push("s.source = ?"); params.push(filter.source); }
  // 默认 limit 100、上限 1000：无限制的全表扫是慢查询主因；调用方需显式传 limit 覆盖。
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000);
  const offset = Math.max(0, filter.offset ?? 0);

  let facetIds: string[] | null = null;
  let facetPred: { sql: string; params: unknown[] } | null = null;
  if (filter.facets && Object.keys(filter.facets).length > 0) {
    facetIds = await repo.filterSiteIdsByFacets(filter.facets);
    if (facetIds.length === 0) return [];
    // 首选：整个 id 列表绑成一个参数（sqlite 走 json_each、pg 走 ANY），
    // 任意规模都是一条语句，绕开语句级绑参上限，也就不需要下面的分片归并。
    // 老 SQLite 没有 JSON1 时探测失败返回 null，行为退回下面的老路径。
    facetPred = await repo.collectionIn("s.id", facetIds);
    if (facetPred) {
      where.push(facetPred.sql);
      params.push(...facetPred.params);
    }
  }
  const baseWhere = where.join(" AND ");
  const baseParams = [...params];

  // 排序键说明：sort（手工序）> trend_score（热度）> id（决胜）。
  // 这里**不再**排 weight：它在两个 INSERT 站点被硬编码为 0（见本文件 createSite /
  // createSitesWithIds），全仓没有任何 UPDATE 写它，所以这个键恒等、永远区分不了
  // 任何两行——实际顺序全靠 sort/id。热度由 recompute_rank 任务写 trend_score
  // （repository/health.ts 的 setTrendScores），所以用它做次级键。
  // weight 列本身保留（老库/导出行仍在写），只是退出所有 ORDER BY。
  //
  // 单语句路径的三个前提：没有分面过滤 / 集合谓词已吸收全部 id / id 少到装得下一片
  if (facetPred !== null || facetIds === null || facetIds.length <= SQL_IN_CHUNK) {
    const sqlText = SELECT_SITES_BASE_SQL +
      " WHERE " + baseWhere +
      " ORDER BY s.sort ASC, s.weight DESC, s.trend_score DESC, s.id ASC" +
      " LIMIT ? OFFSET ?";
    const rows = await repo.raw(sqlText, [...baseParams, limit, offset]);
    return hydrateSites(repo, rows);
  }

  // 回退路径（仅当集合谓词探测失败：老 SQLite 没有 JSON1）：候选 id 装不进
  // 一条语句的绑参预算（语句级上限，见 sql-in.ts，超限是 500 而不是变慢）。
  // 分片各取「本页候选」（只取排序键与 id，成本远低于整行），在 JS 里按同一条
  // ORDER BY 归并分页，最后用内部已分片的 getSitesByIds 取整行。
  // 注意：这里不做 Promise.all——sqlite 是同步驱动，并发派发不产生并行；
  // 真正的提速来自上面的单语句路径（一次执行，无归并），本循环只是能力兜底。
  const window = offset + limit;
  const ranked: Array<{ id: string; sort: number; trendScore: number }> = [];
  for (const part of chunkList(facetIds)) {
    const predicate = inPredicate("s.id", part);
    const rows = (await repo.raw(
      "SELECT s.id AS id, s.sort AS sort, s.trend_score AS trend_score FROM sites s" +
        " WHERE " + predicate.sql + " AND " + baseWhere +
        " ORDER BY s.sort ASC, s.trend_score DESC LIMIT ?",
      [...predicate.params, ...baseParams, window],
    )) as Array<{ id: unknown; sort: unknown; trend_score: unknown }>;
    for (const r of rows) {
      ranked.push({ id: String(r.id), sort: Number(r.sort) || 0, trendScore: Number(r.trend_score) || 0 });
    }
  }
  // 与单语句路径同一套排序（含 id 决胜）：缺 id 决胜时跨片并列的页边界会抖动，
  // 同一份数据两次查询可能切出不同的页。
  ranked.sort((a, b) => a.sort - b.sort || b.trendScore - a.trendScore || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pageIds = ranked.slice(offset, offset + limit).map((r) => r.id);
  if (pageIds.length === 0) return [];
  const siteMap = await repo.getSitesByIds(pageIds);
  return pageIds
    .map((id) => siteMap.get(id))
    .filter((s): s is Site => Boolean(s));
}

/**
 * 全量站点：不分页、不受 1000 上限裁剪（**仅供快照层使用**）。
 *
 * 为什么必须单独给快照开一个函数：navigation.json 是「全量投影」——
 * 读侧少一条，写侧全量对齐时就会把它当成「用户删了」；反过来，读不到的
 * 存量站点在写回时匹配不到行，会走 createSiteWithId 对活行 INSERT，
 * 直接撞同 id 主键冲突（整个保存 500）。
 * 普通列表接口继续用 listSites（默认 100、上限 1000）防止慢查询。
 *
 * `facets: false` 是给快照的：快照投影里没有分面字段，而这一条聚合查询的代价
 * 与站点数成正比（见 hydrateSites 的说明）。
 */
export async function listAllSites(repo: Repository, limit?: number, options: { facets?: boolean } = {}): Promise<Site[]> {
  const rows = await repo.raw(
    SELECT_SITES_BASE_SQL +
      " WHERE s.deleted_at IS NULL ORDER BY s.sort ASC, s.weight DESC, s.trend_score DESC" +
      (limit ? " LIMIT ?" : ""),
    limit ? [limit] : [],
  );
  return hydrateSites(repo, rows, options);
}

export async function getSitesByIds(repo: Repository, ids: string[]): Promise<Map<string, Site>> {
  const out = new Map<string, Site>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return out;
  for (const part of chunkList(uniq)) {
    const placeholders = part.map(() => "?").join(", ");
    const rows = await repo.raw(
      SELECT_SITES_BASE_SQL + " WHERE s.id IN (" + placeholders + ") AND s.deleted_at IS NULL",
      part,
    );
    for (const r of await hydrateSites(repo, rows)) out.set(r.id, r);
  }
  return out;
}

/**
 * 站点行的聚合列（标签 / 分面）**相关子查询**版本。
 *
 * 只给「按主键/URL 取一到几行」的路径用（`getSite`、`getDeletedSite`、`findSiteByUrl`）：
 * 单行时它就是最优解——一次往返、每个子查询走 `site_tags_site_idx` / `site_facets_site_idx`。
 *
 * **不要把它接回列表路径**（P1-1）：8000 站点 = 16000 次相关子查询，
 * 而「缓存命中」的那次读也要付这个钱。列表走 `selectSitesBaseSql` + `hydrateSites`。
 *
 * 两个方言的聚合都带**显式排序**：`getSite` 与列表必须给出同一个标签顺序，
 * 否则同一个站点在不同接口里标签会「洗牌」。SQLite 用子查询 ORDER BY，
 * PG 用 `string_agg(... ORDER BY ...)`（SQLite 的 group_concat 没有 ORDER BY 语法）。
 */
export function selectSitesSql(repo: Repository): string {
  const isPg = repo.db.dialect === "pg";
  const tagExpr = isPg
    ? "(SELECT string_agg(t.slug, ',' ORDER BY t.slug) FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE st.site_id = s.id)"
    : "(SELECT group_concat(slug, ',') FROM (SELECT t.slug AS slug FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE st.site_id = s.id ORDER BY t.slug))";
  const facetExpr = isPg
    ? "(SELECT string_agg(sf.facet_key || ':' || sf.facet_value, ',' ORDER BY sf.facet_key, sf.facet_value) FROM site_facets sf WHERE sf.site_id = s.id)"
    : "(SELECT group_concat(pair, ',') FROM (SELECT sf.facet_key || ':' || sf.facet_value AS pair FROM site_facets sf WHERE sf.site_id = s.id ORDER BY sf.facet_key, sf.facet_value))";
  return "SELECT s.*, " + tagExpr + " AS tag_slugs, " + facetExpr + " AS facet_pairs FROM sites s";
}

/**
 * 站点列表的**基础**投影：只有 sites 表本身，没有逐行相关子查询（P1-1）。
 *
 * 聚合列由 `hydrateSites` 用两条 `GROUP BY site_id` 的批量查询补齐：
 * 一次列表读 = 1 条主查询 + 2 条聚合查询，与行数无关。
 */
export const SELECT_SITES_BASE_SQL = "SELECT s.* FROM sites s";

/** 单参数集合谓词优先（`collectionIn`：任意规模一条语句），探测失败退回分片 */
async function siteIdPredicates(repo: Repository, column: string, ids: string[]): Promise<Array<{ sql: string; params: unknown[] }>> {
  const one = await repo.collectionIn(column, ids);
  if (one) return [one];
  return chunkList(ids).map((part) => inPredicate(column, part));
}

/**
 * 一条按 site_id 分组的聚合查询：`site_id -> "a,b,c"`。
 *
 * 排序在两方言里走不同写法（PG 的 `string_agg` 自带 ORDER BY，SQLite 的 `group_concat`
 * 没有），但**排序键与 `selectSitesSql` 的相关子查询逐字一致**——两条路径必须给出
 * 同一个标签顺序，否则同一个站点在 `getSite` 和列表接口里会「洗牌」。
 */
async function aggregateBySiteId(
  repo: Repository,
  opts: {
    /** 限定后的站点 id 列，如 `st.site_id` */
    column: string;
    /** FROM 片段（含 JOIN） */
    from: string;
    /** 被聚合的表达式 */
    expr: string;
    /** 排序键（表达式列表，可为多个） */
    orderBy: string;
    ids: string[];
  },
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (opts.ids.length === 0) return out;
  for (const pred of await siteIdPredicates(repo, opts.column, opts.ids)) {
    const sql =
      repo.db.dialect === "pg"
        ? "SELECT " + opts.column + " AS site_id, string_agg(" + opts.expr + ", ',' ORDER BY " + opts.orderBy +
          ") AS v FROM " + opts.from + " WHERE " + pred.sql + " GROUP BY " + opts.column
        : "SELECT site_id, group_concat(v, ',') AS v FROM (SELECT " + opts.column + " AS site_id, " + opts.expr +
          " AS v FROM " + opts.from + " WHERE " + pred.sql + " ORDER BY " + opts.column + ", " + opts.orderBy +
          ") GROUP BY site_id";
    const rows = await repo.raw(sql, pred.params);
    for (const r of rows) {
      if (r.v !== null && r.v !== undefined) out.set(String(r.site_id), String(r.v));
    }
  }
  return out;
}

/**
 * 把「只有 sites 列」的查询结果补齐成 `rowToSite` 能吃的行（P1-1）。
 *
 * 标签与分面各一条 `GROUP BY site_id` 聚合，取代 `selectSitesSql` 的逐行相关子查询。
 * 没有标签/分面的站点在聚合结果里根本不出现 —— 与相关子查询给出 NULL 后
 * `rowToSite` 落到 `[]` 的行为一致，所以这里补 null 而不是空串。
 *
 * `facets: false` 给快照这类「不读分面」的消费者：省掉一条聚合查询。
 * 快照写回从不按快照里的分面删分面（见 apps/api/src/storage.ts 的写侧），
 * 所以少读一个字段在这里是安全的；需要分面的调用方保持默认。
 */
export async function hydrateSites(
  repo: Repository,
  rows: Array<Record<string, any>>,
  options: { facets?: boolean } = {},
): Promise<Site[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => String(r.id));
  // 不做 Promise.all：sqlite 是同步驱动，并发派发不产生并行（见 listSites 的同款注释）
  const tags = await aggregateBySiteId(repo, {
    column: "st.site_id",
    from: "site_tags st JOIN tags t ON t.id = st.tag_id",
    expr: "t.slug",
    orderBy: "t.slug",
    ids,
  });
  const facets =
    options.facets === false
      ? null
      : await aggregateBySiteId(repo, {
          column: "sf.site_id",
          from: "site_facets sf",
          expr: "sf.facet_key || ':' || sf.facet_value",
          orderBy: "sf.facet_key, sf.facet_value",
          ids,
        });
  const sites: Site[] = [];
  for (const row of rows) {
    const id = String(row.id);
    // 浅拷贝而不是原地写：同一个 rows 数组可能被连续 hydrate 两次（例如对照测试或
    // 两种投影都要跑），原地写会让第二次读到第一次的聚合列。
    sites.push(
      rowToSite({
        ...row,
        tag_slugs: tags.get(id) ?? null,
        // facets:false 是投影开关，不是「顺便保留调用方带来的值」：显式清空，
        // 否则同一个函数在有无分面之间取决于输入行里有没有残留字段。
        facet_pairs: facets ? facets.get(id) ?? null : null,
      }),
    );
  }
  return sites;
}

/**
 * 按 id 或 url 取一条站点。
 *
 * **不要写回 `WHERE (s.id = ? OR s.url = ?)`**：OR 跨两列会让 SQLite 放弃主键索引，
 * 退化成全表扫描。实测 1 万行时单次 5.8ms，而 `reindex` 要对每个站点调一次
 * （`updateSite` 内部也调它），于是「重建索引」变成 O(n²)：
 * 1 万站点的 reindex 要 47.7s，而其中 41.6s 花在这条查询上。
 *
 * 拆成两次查询：先按主键（绝大多数调用方传的就是 id），未命中再按 url
 * （url 上有 `sites_url_idx` 部分唯一索引，条件里带 `deleted_at IS NULL` 正好命中它）。
 * 实测 1 万次「按 id」从 58s 降到 0.4s，reindex 从 47.7s 降到 3s 量级。
 */
export async function getSite(repo: Repository, idOrUrl: string): Promise<Site | null> {
  if (!idOrUrl) return null;
  const byId = await repo.raw(
    repo.selectSitesSql() + " WHERE s.id = ? AND s.deleted_at IS NULL LIMIT 1",
    [idOrUrl],
  );
  if (byId[0]) return rowToSite(byId[0]);
  const byUrl = await repo.raw(
    repo.selectSitesSql() + " WHERE s.url = ? AND s.deleted_at IS NULL LIMIT 1",
    [idOrUrl],
  );
  return byUrl[0] ? rowToSite(byUrl[0]) : null;
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
  const alt = canonical.endsWith("/") ? canonical.slice(0, -1) : canonical + "/";
  const rows = await repo.raw(
    repo.selectSitesSql() + " WHERE (s.url = ? OR s.url = ? OR s.url = ?) AND s.deleted_at IS NULL LIMIT 1",
    [url, canonical, alt],
  );
  const row = rows[0];
  return row ? rowToSite(row) : null;
}

/**
 * 批量 URL 存在性检查（批量导入/恢复的去重前置）。
 *
 * 单条 `findSiteByUrl` 每次 1 次往返；`/api/sites/batch` 的上限是 200 条，
 * 逐条判定就是 200 次查询压在同一个事务里。这里把每条 URL 的三个变体
 * （原样 / canonical / canonical 的斜杠反例）合并成按片 IN 查询，
 * 语义与 `findSiteByUrl` 严格一致：只认未软删的行，三变体任一命中都算已存在。
 *
 * 返回集合同时包含**原始写法与 canonical 写法**：调用方既可能拿原文比对，
 * 也可能先 canonicalize 再比对，两种键都要能命中，否则会把重复站点当新站插入。
 */
export async function findExistingSiteUrls(repo: Repository, urls: string[]): Promise<Set<string>> {
  const probe = new Set<string>();
  for (const raw of urls) {
    if (!raw) continue;
    const canonical = canonicalizeUrl(raw);
    probe.add(raw);
    probe.add(canonical);
    probe.add(canonical.endsWith("/") ? canonical.slice(0, -1) : canonical + "/");
  }
  const found = new Set<string>();
  if (probe.size === 0) return found;
  for (const chunk of chunkList([...probe])) {
    if (chunk.length === 0) continue;
    const pred = inPredicate("url", chunk);
    const rows = await repo.raw(
      `SELECT url FROM sites WHERE ${pred.sql} AND deleted_at IS NULL`,
      pred.params,
    );
    for (const row of rows) {
      const value = String(row.url ?? "");
      if (!value) continue;
      found.add(value);
      found.add(canonicalizeUrl(value));
    }
  }
  return found;
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
    // 复活语义等价于「用新数据重建」：旧行的 tags/facets/relations 必须清空后重写，
    // 否则调用方没传的字段会悄悄继承上一次删除前的关联数据。
    await repo.setSiteTags(id, input.tags ?? []);
    if (input.facets !== undefined) {
      await repo.setSiteFacets(id, input.facets);
    } else if (input.workspaces?.length) {
      await repo.setSiteFacets(id, { scene: input.workspaces });
    } else {
      await repo.setSiteFacets(id, {});
    }
    await repo.setSiteRelations(id, input.relations ?? []);
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

/**
 * 批量插入站点（备份恢复 / 大批量导入专用）。
 *
 * 与 `createSite` 的差异是**刻意收窄**的，不是通用替代品：
 * - 只走「新建」路径，不处理软删 id 复活（调用方生成新 UUID，不会与软删行相撞）；
 * - 不处理 facets / relations（恢复场景只携带 tags）；
 * - 不做单条回读，改为最后一次 `getSitesByIds` 分片回读。
 *
 * 必须与 `createSite` 等价的部分：fts/pinyin 索引字段、metadata 打包、
 * status/enabled/sort/featured/source 默认值。任何一处漂移都会让「恢复出来的站点
 * 搜得到但索引字段不同」——这种缺陷很难在 UI 上察觉，只能靠测试钉住。
 *
 * 性能差异（为什么值得单独一条路径）：`/api/backup/restore` 的上限是 5 万站点，
 * 逐条 `createSite` 每条要经过 getDeletedSite + INSERT + setSiteTags(每 tag 2~3 查)
 * + getSite 回读，合计约 6~12 次往返；5 万条就是 30 万次以上。
 */
export async function insertSitesBulk(
  repo: Repository,
  inputs: Array<SiteInput & {
    id: string;
    /**
     * 原始创建时间（毫秒）。缺省写当前时刻。
     *
     * 备份包带 `createdAt`，恢复时若丢掉它，所有站点的 `created_at` 都会变成
     * 恢复时刻——「最新收录」「按创建时间排序」在恢复后整片失真，而页面上
     * 看不出任何异常（时间列全都一样，像是同一天批量导入的）。
     * 这里显式接住，由调用方决定是否沿用原值。
     */
    createdAt?: number;
  }>,
  options: {
    /**
     * 是否回读完整 Site 列表（默认 true）。
     *
     * 备份恢复只需条数：5 万条回读要 100 次分片查询，每条还要解 metadata/tags，
     * 而返回值最终只被取 `.length`。这类「为了计数而整表回读」是批量路径上
     * 最容易被忽略的浪费，所以给调用方一个显式开关，而不是让它自己 slice。
     */
    hydrate?: boolean;
  } = {},
): Promise<{ count: number; sites: Site[] }> {
  if (inputs.length === 0) return { count: 0, sites: [] };
  const now = Date.now();

  /**
   * 标签解析：先把所有唯一 name 映射到 tag id（upsert 幂等），
   * 避免「每条站点各自 upsert 同一批标签」造成的重复查询。
   */
  const uniqueTagNames = new Set<string>();
  for (const input of inputs) {
    for (const raw of input.tags ?? []) {
      const name = raw.trim();
      if (name) uniqueTagNames.add(name);
    }
  }
  const tagIdByName = new Map<string, string>();
  for (const name of uniqueTagNames) {
    tagIdByName.set(name, await repo.upsertTag(name, slugify(name)));
  }

  /**
   * 站点行：多值 INSERT。sites 表 19 列 → 每行 19 个绑定参数，
   * 40 行 = 760 参数，对 SQLite 老构建的 999 上限留出余量。
   */
  const SITE_INSERT_CHUNK = 40;
  for (let i = 0; i < inputs.length; i += SITE_INSERT_CHUNK) {
    const slice = inputs.slice(i, i + SITE_INSERT_CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    for (const input of slice) {
      const index = buildIndexFields({
        title: input.title ?? input.url,
        description: input.description,
        url: input.url,
        tags: input.tags,
      });
      values.push("(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
      params.push(
        input.id, input.url, input.title ?? input.url, input.description ?? null, input.categoryId,
        input.subCategoryId ?? null, input.iconKey ?? null, input.status ?? "active",
        input.enabled === false ? 0 : 1, input.sort ?? 0, 0, input.featured ? 1 : 0,
        input.source ?? "manual", index.ftsTokens, index.pinyinFull, index.pinyinInitials,
        packMetadata(input),
        // created_at 用调用方给的原值（恢复场景），缺省才取本批时间
        input.createdAt ?? now,
        now,
      );
    }
    await repo.run(
      `INSERT INTO sites (
         id, url, title, description, category_id, sub_category_id, icon_key, status, enabled, sort,
         weight, featured, source, fts_tokens, pinyin_full, pinyin_initials, metadata, created_at, updated_at
       ) VALUES ${values.join(",")}`,
      params,
    );
  }

  /**
   * 站点-标签关联：同样批量。这里**按 (site_id, tag_id) 去重**——恢复包里的
   * tags 来自用户导出，完全可能有重复（"AI" 与 "ai"），不去重会撞唯一约束。
   * `setSiteTags` 现在同样按解析后的 tag_id 去重，两者口径一致；
   * 去重是更宽容的行为，且与「标签是集合」的语义一致。
   */
  const links = new Map<string, [string, string]>();
  for (const input of inputs) {
    for (const raw of input.tags ?? []) {
      const name = raw.trim();
      if (!name) continue;
      const tagId = tagIdByName.get(name);
      if (!tagId) continue;
      links.set(input.id + "\u0000" + tagId, [input.id, tagId]);
    }
  }
  const LINK_CHUNK = 400; // 每行 2 个参数 → 800，仍在 999 以内
  const linkRows = [...links.values()];
  for (let i = 0; i < linkRows.length; i += LINK_CHUNK) {
    const slice = linkRows.slice(i, i + LINK_CHUNK);
    await repo.run(
      `INSERT INTO site_tags (site_id, tag_id) VALUES ${slice.map(() => "(?,?)").join(",")}`,
      slice.flat(),
    );
  }

  if (options.hydrate === false) return { count: inputs.length, sites: [] };

  const byId = await getSitesByIds(repo, inputs.map((input) => input.id));
  const sites = inputs
    .map((input) => byId.get(input.id))
    .filter((site): site is Site => site !== undefined);
  return { count: sites.length, sites };
}

export async function updateSite(repo: Repository, id: string, patch: Partial<SiteInput>): Promise<Site | null> {
  return repo.withTransaction(async () => {
  // 读取放进事务内：事务外读 + 事务内写会让并发两次 PATCH 基于同一旧快照，
  // 后写者覆盖先写者（丢失更新）。
  const existing = await repo.getSite(id);
  if (!existing) return null;

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

/**
 * 快照写回托管的主字段（navigation.json 只有这些）。
 *
 * 与 `SiteInput` 分开命名是为了让「批量路径不碰 tags/facets/relations/status」
 * 在类型层面就成立：拿错对象编译期就会报错。
 */
export interface SnapshotSiteWrite {
  id: string;
  url: string;
  title: string;
  description: string | null;
  categoryId: string;
  iconKey: string | null;
  enabled: boolean;
  sort: number;
}

/** 快照里「看似新增」的 id 里，哪些其实是回收站里的软删行（写回要复活而不是 INSERT） */
export async function listDeletedSiteIds(repo: Repository, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  for (const part of chunkList(uniq)) {
    const placeholders = part.map(() => "?").join(", ");
    const rows = await repo.raw(
      `SELECT id FROM sites WHERE deleted_at IS NOT NULL AND id IN (${placeholders})`,
      part,
    );
    for (const row of rows) out.add(String(row.id));
  }
  return out;
}

/**
 * 批量更新快照托管的字段（P1-2）。
 *
 * 与 `updateSite` 的差异：不回读旧行、不回读结果、不碰 tags/facets/relations。
 * 调用方（快照写回）在同一个事务里已经持有全量存量行并做过内存 diff，
 * 这里只负责把「确实变化」的行落库。fts_tokens 含标签线索，而标签不在快照里，
 * 所以只对变化行补一次标签聚合（分片），口径与 updateSite 的
 * `patch.tags ?? existing.tags` 一致。
 */
export async function updateSitesFromSnapshot(repo: Repository, rows: SnapshotSiteWrite[]): Promise<number> {
  if (rows.length === 0) return 0;
  const tagsById = new Map<string, string[]>();
  for (const part of chunkList(rows.map((row) => row.id))) {
    const placeholders = part.map(() => "?").join(", ");
    const tagRows = await repo.raw(
      `SELECT st.site_id AS site_id, t.slug AS slug
         FROM site_tags st JOIN tags t ON t.id = st.tag_id
        WHERE st.site_id IN (${placeholders}) ORDER BY t.slug`,
      part,
    );
    for (const row of tagRows) {
      const id = String(row.site_id);
      const list = tagsById.get(id) ?? [];
      list.push(String(row.slug));
      tagsById.set(id, list);
    }
  }
  const now = Date.now();
  for (const row of rows) {
    const index = buildIndexFields({
      title: row.title,
      description: row.description,
      url: row.url,
      tags: tagsById.get(row.id) ?? [],
    });
    await repo.run(
      `UPDATE sites SET url = ?, title = ?, description = ?, category_id = ?, icon_key = ?,
         enabled = ?, sort = ?, fts_tokens = ?, pinyin_full = ?, pinyin_initials = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [
        row.url, row.title, row.description, row.categoryId, row.iconKey,
        row.enabled ? 1 : 0, row.sort,
        index.ftsTokens, index.pinyinFull, index.pinyinInitials, now, row.id,
      ],
    );
  }
  return rows.length;
}

/**
 * 复活软删行（快照写回带回了回收站里的 id）。
 *
 * 语义必须与 `createSiteWithId` 的复活分支一致：覆盖主字段、清空
 * tags/facets/relations、metadata 归零（快照不携带这些），状态回到 active。
 * 只更新 `deleted_at IS NOT NULL` 的行；调用方已用 `listDeletedSiteIds`
 * 在同一事务里判定过，不会误伤活行。
 */
export async function reviveSitesFromSnapshot(repo: Repository, rows: SnapshotSiteWrite[]): Promise<number> {
  if (rows.length === 0) return 0;
  const now = Date.now();
  for (const row of rows) {
    const index = buildIndexFields({ title: row.title, description: row.description, url: row.url, tags: [] });
    await repo.run(
      `UPDATE sites SET url = ?, title = ?, description = ?, category_id = ?, sub_category_id = NULL,
         icon_key = ?, status = 'active', enabled = ?, sort = ?, featured = 0, source = 'navsphere',
         fts_tokens = ?, pinyin_full = ?, pinyin_initials = ?, metadata = NULL, deleted_at = NULL, updated_at = ?
       WHERE id = ? AND deleted_at IS NOT NULL`,
      [
        row.url, row.title, row.description, row.categoryId, row.iconKey,
        row.enabled ? 1 : 0, row.sort,
        index.ftsTokens, index.pinyinFull, index.pinyinInitials, now, row.id,
      ],
    );
  }
  for (const part of chunkList(rows.map((row) => row.id))) {
    const placeholders = part.map(() => "?").join(", ");
    await repo.run(`DELETE FROM site_tags WHERE site_id IN (${placeholders})`, part);
    await repo.run(`DELETE FROM site_facets WHERE site_id IN (${placeholders})`, part);
    await repo.run(`DELETE FROM site_relations WHERE source_site_id IN (${placeholders})`, part);
  }
  return rows.length;
}

/** 批量软删（快照里缺席的托管站点），语义与逐条 deleteSite 相同 */
export async function softDeleteSites(repo: Repository, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const now = Date.now();
  for (const part of chunkList(ids)) {
    const placeholders = part.map(() => "?").join(", ");
    await repo.run(
      `UPDATE sites SET deleted_at = ?, updated_at = ? WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
      [now, now, ...part],
    );
  }
  return ids.length;
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
  // 以下五张表同样以 site_id 关联站点，但 schema 里没有外键（跨方言手写 DDL），
  // 不会自动级联。漏删的后果：site_archives 留着整页 HTML（体积最大、回收站
  // 清理后存储持续膨胀），favorites / collection_items 留下指向不存在站点的
  // 空引用，health_checks / events 无限增长。
  await repo.run("DELETE FROM site_archives WHERE site_id = ?", [id]);
  await repo.run("DELETE FROM health_checks WHERE site_id = ?", [id]);
  await repo.run("DELETE FROM favorites WHERE site_id = ?", [id]);
  await repo.run("DELETE FROM collection_items WHERE site_id = ?", [id]);
  await repo.run("DELETE FROM events WHERE site_id = ?", [id]);
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

/**
 * 重写站点的标签关联。
 *
 * 这里**必须按解析后的 tag_id 去重**：一次请求里传两个等价标签名（"AI" 与 "ai"、
 * trim 后同值、或 slugify 同值）时，upsertTag 会把它们解析到同一个 tag_id，
 * 逐条 INSERT 就撞上 site_tags_unique_idx(site_id, tag_id)，整个事务回滚 ——
 * 表现为 PATCH /api/sites 直接 500。按 tag_id 去重同时也让「标签是集合」的
 * 语义成立（与 insertSitesBulk 的处理一致；那里曾专门注释过本函数不去重）。
 */
export async function setSiteTags(repo: Repository, siteId: string, tagNames: string[]): Promise<void> {
  return repo.withTransaction(async () => {
    await repo.run("DELETE FROM site_tags WHERE site_id = ?", [siteId]);
    const seen = new Set<string>();
    for (const raw of tagNames) {
      const name = raw.trim();
      if (!name) continue;
      const slug = slugify(name);
      const tagId = await repo.upsertTag(name, slug);
      if (seen.has(tagId)) continue;
      seen.add(tagId);
      await repo.run("INSERT INTO site_tags (site_id, tag_id) VALUES (?, ?)", [siteId, tagId]);
    }
  });
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
  return repo.withTransaction(async () => {
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
  });
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
  const conditions = Object.entries(facets)
    .map(([rawKey, rawVal]) => {
      const vals = (Array.isArray(rawVal) ? rawVal : [rawVal])
        .filter((v) => v !== null && v !== undefined)
        .map((v) => String(v).trim().toLowerCase())
        .filter(Boolean);
      return vals.length > 0 ? { key: rawKey.trim().toLowerCase(), vals } : null;
    })
    .filter((c): c is { key: string; vals: string[] } => c !== null);
  if (conditions.length === 0) return [];

  // 条件之间并发查：条件数由客户端的 facets JSON 决定，串行 await 等于
  // 「一个查询串放大成 N 次网络往返」（PG 上实测每个 key 一跳）。
  // DbAccessGate 允许并发读，所以这里 Promise.all 不与写事务争锁。
  const perCondition = await Promise.all(
    conditions.map(async ({ key, vals }) => {
      const sites = new Set<string>();
      // 主路径：整片值绑成一个参数（json_each / ANY），一条语句查完。
      // facet_value 是「分面取值」，热门值能覆盖上千行——与 s.id 同一预算风险。
      const pred = await repo.collectionIn("facet_value", vals);
      if (pred) {
        const rows = (await repo.raw(
          `SELECT DISTINCT site_id FROM site_facets WHERE facet_key = ? AND ${pred.sql}`,
          [key, ...pred.params],
        )) as Array<{ site_id: unknown }>;
        for (const r of rows) sites.add(String(r.site_id));
        return sites;
      }
      // 回退路径：仅 JSON1 探测失败（老 SQLite 构建）时走，分片 + 并集归并。
      for (const part of chunkList(vals)) {
        const placeholders = part.map(() => "?").join(", ");
        const rows = (await repo.raw(
          `SELECT DISTINCT site_id FROM site_facets WHERE facet_key = ? AND facet_value IN (${placeholders})`,
          [key, ...part],
        )) as Array<{ site_id: unknown }>;
        for (const r of rows) sites.add(String(r.site_id));
      }
      return sites;
    }),
  );

  let candidateSet = perCondition[0]!;
  for (const set of perCondition.slice(1)) {
    if (candidateSet.size === 0) break;
    const next = new Set<string>();
    for (const id of candidateSet) {
      if (set.has(id)) next.add(id);
    }
    candidateSet = next;
  }

  return [...candidateSet];
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
    // 与 search.ts 的 tagSiteIdsSql 同口径：只在查询侧归一（lower + slugify），
    // 不动库里已存的 slug/name。否则 tag=AI 在这里匹配不到 slug 为 "ai" 的标签，
    // 分面计数全成 0，与检索结果的标签过滤对不上。
    tagJoin = "JOIN site_tags st ON st.site_id = s.id JOIN tags t ON t.id = st.tag_id LEFT JOIN tag_aliases ta ON ta.tag_id = t.id";
    const norm = filter.tag.trim();
    const lower = norm.toLowerCase();
    const slug = slugify(norm);
    const conds = ["lower(t.slug) = ?", "lower(t.name) = ?", "lower(ta.alias) = ?"];
    params.push(lower, lower, lower);
    if (slug !== lower) {
      conds.push("lower(t.slug) = ?");
      params.push(slug);
    }
    wheres.push(`(${conds.join(" OR ")})`);
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
  await repo.withTransaction(async () => {
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
  });
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
  // 批量取邻居与类目，避免「每个邻居 2 次串行查询」的 N+1（最多 15×2 = 30 次往返）。
  const targetIds = [...new Set(slice.map((r) => r.targetSiteId).filter((v): v is string => Boolean(v)))];
  const targetSites = await repo.getSitesByIds(targetIds);
  const categoryTitles = new Map((await repo.listCategories()).map((c) => [c.id, c.title] as const));
  for (const rel of slice) {
    const meta = CONTROLLED_RELATION_TYPES[rel.relationType] ?? CONTROLLED_RELATION_TYPES.related;
    const targetId = rel.targetSiteId ?? `ext-${Buffer.from(rel.targetUrl).toString("base64url").slice(0, 12)}`;
    if (!nodesMap.has(targetId)) {
      let catTitle: string | undefined;
      let iconKey: string | null = null;
      if (rel.targetSiteId) {
        const targetSite = targetSites.get(rel.targetSiteId);
        if (targetSite) {
          iconKey = targetSite.iconKey ?? null;
          if (targetSite.categoryId) catTitle = categoryTitles.get(targetSite.categoryId);
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

/**
 * 根据查询词智能匹配实体关系（如用户搜索 "figma"，召回作为其对标开源平替的站点 "Penpot"）
 */
export async function findRelationsByQuery(
  repo: Repository,
  query: string,
  limit = 5
): Promise<MatchedSiteRelation[]> {
  const norm = query.trim().toLowerCase();
  if (!norm || norm.length < 2) return [];
  const pattern = containsLike(norm);

  const rows = await repo.raw(
    `SELECT sr.*
       FROM site_relations sr
       JOIN sites s ON s.id = sr.source_site_id
      WHERE (lower(sr.target_title) LIKE ? ESCAPE '!' OR lower(sr.target_url) LIKE ? ESCAPE '!')
        AND s.deleted_at IS NULL
      ORDER BY (CASE WHEN sr.relation_type = 'alternative' THEN 1 ELSE 2 END) ASC,
               sr.confidence DESC
      LIMIT ?`,
    [pattern, pattern, limit]
  );

  const out: MatchedSiteRelation[] = [];
  const siteIds = [...new Set(rows.map((r) => String(r.source_site_id)))];
  const sitesMap = await repo.getSitesByIds(siteIds);

  for (const r of rows) {
    const rel = rowToSiteRelation(r);
    if (!rel.sourceSiteId) continue;
    const sourceSite = sitesMap.get(rel.sourceSiteId) ?? null;
    if (!sourceSite || !sourceSite.enabled) continue;
    out.push({
      ...rel,
      sourceSite,
    });
  }
  return out;
}

export async function saveSiteArchive(repo: Repository, archive: SiteOfflineArchive): Promise<void> {
  const id = randomUUID();
  const tagsJson = JSON.stringify(archive.tags || []);
  const nowTs = Date.now();
  await repo.run(
    `INSERT INTO site_archives (id, site_id, title, url, excerpt, read_time_minutes, html_content, byte_size, tags, captured_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      archive.siteId,
      archive.title,
      archive.url,
      archive.excerpt || "",
      archive.readTimeMinutes || 1,
      archive.htmlContent,
      archive.byteSize || Buffer.byteLength(archive.htmlContent, "utf8"),
      tagsJson,
      archive.capturedAt || nowTs,
      nowTs,
    ]
  );
}

export async function getLatestSiteArchive(repo: Repository, siteId: string): Promise<SiteOfflineArchive | null> {
  const rows = await repo.raw(
    `SELECT * FROM site_archives WHERE site_id = ? ORDER BY captured_at DESC LIMIT 1`,
    [siteId]
  );
  if (!rows || rows.length === 0) return null;
  const r = rows[0];
  if (!r) return null;
  let tags: string[] = [];
  try {
    tags = typeof r.tags === "string" ? JSON.parse(r.tags) : (r.tags || []);
  } catch {
    tags = [];
  }
  return {
    siteId: String(r.site_id),
    title: String(r.title),
    url: String(r.url),
    capturedAt: Number(r.captured_at),
    excerpt: String(r.excerpt || ""),
    readTimeMinutes: Number(r.read_time_minutes || 1),
    htmlContent: String(r.html_content),
    byteSize: Number(r.byte_size || 0),
    tags,
  };
}




/**
 * 基于共享标签发现相似站点（详情页推荐增强）。
 *
 * 为什么基于标签而不是单纯同分类：
 * 1. 同一分类（如「开发工具」）可能有几十上百站点，单纯按分类取排序无法体现主题紧密性；
 * 2. 共享标签（如「React」+「状态管理」）具有极强的语义指向，两个站点重合标签越多，相似度越高；
 * 3. 纯 SQL 基于 site_tags 聚合，只计算存活站点（deleted_at IS NULL AND enabled AND status = 'active'），
 *    性能高且不依赖外部服务。若无共现标签或站点无标签，返回空数组由调用方回退至分类树。
 */
export async function listSimilarSitesByTags(
  repo: Repository,
  siteId: string,
  limit = 6,
): Promise<Site[]> {
  const cap = Math.max(1, Math.min(24, Math.trunc(limit)));
  const rows = await repo.raw(
    `SELECT s.id, COUNT(DISTINCT st2.tag_id) AS shared_tags_count
       FROM site_tags st1
       JOIN site_tags st2 ON st2.tag_id = st1.tag_id AND st2.site_id <> st1.site_id
       JOIN sites s ON s.id = st2.site_id
         AND s.deleted_at IS NULL AND s.enabled = ? AND s.status = 'active'
      WHERE st1.site_id = ?
      GROUP BY s.id
     HAVING COUNT(DISTINCT st2.tag_id) >= 1
      ORDER BY shared_tags_count DESC, s.sort ASC, s.created_at DESC
      LIMIT ?`,
    [true, siteId, cap],
  );

  if (!rows || rows.length === 0) return [];
  const siteIds = rows.map((r) => String(r.id));
  const sitesMap = await repo.getSitesByIds(siteIds);
  const out: Site[] = [];
  for (const id of siteIds) {
    const s = sitesMap.get(id);
    if (s && s.status === 'active') out.push(s);
  }
  return out;
}
