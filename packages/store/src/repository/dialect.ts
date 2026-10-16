import {
  buildFtsTokens,
  getEnhancedSiteData,
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
  UserProfileRecord,
  UserRecord,
} from "./records.ts";

/** 把站点转成可索引形态：标题+描述+标签一起进语料 */
export function buildIndexFields(input: { title: string; description?: string | null; url: string; tags?: string[] }) {
  const corpus = [input.title, input.description ?? "", ...(input.tags ?? [])].join(" ");
  return {
    ftsTokens: buildFtsTokens([input.title, input.description, input.url, ...(input.tags ?? [])]),
    pinyinFull: pinyinTraits(corpus).full,
    pinyinInitials: pinyinTraits(input.title).initials,
  };
}

export function packMetadata(input: Partial<SiteInput>): string | null {
  const metaObj: Record<string, any> = { ...(input.metadata ?? {}) };
  if (input.actions !== undefined) metaObj.actions = input.actions;
  if (input.relations !== undefined) metaObj.relations = input.relations;
  if (input.liveMetrics !== undefined) metaObj.liveMetrics = input.liveMetrics;
  if (input.workspaces !== undefined) metaObj.workspaces = input.workspaces;
  return Object.keys(metaObj).length > 0 ? JSON.stringify(metaObj) : null;
}


/**
 * 生成标签 slug。
 *
 * 必须**保留中文**：最初的实现把非 [a-z0-9] 字符全部删掉，
 * 导致中文标签「天气」被 slug 成空字符串，于是中文标签永远无法被过滤命中。
 * 对中文优先的导航站来说，这是硬伤。
 *
 * 空结果兜底为 "tag"：避免出现空 slug 导致多个标签互相覆盖。
 */
export function slugify(input: string): string {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "");
  return s.length > 0 ? s : "tag";
}

/**
 * 归一化 API token 的 scope 串：
 * 小写 + 去重 + 丢弃非法值，输出逗号分隔的合法集合（保底 "read"）。
 *
 * 与 apps/api/src/auth.ts 的 parseScopes 语义一致，但这里**不依赖 API 层**——
 * store 是更底层的模块，任何调用方（REST / MCP / 脚本）写入都走这一道，防大写/非法 scope 落库。
 */
export function normalizeTokenScopes(raw: string | null | undefined): string {
  const valid = new Set(["read", "write", "admin"]);
  const out: string[] = [];
  for (const s of (raw ?? "").split(",").map((x) => x.trim().toLowerCase())) {
    if (valid.has(s) && !out.includes(s)) out.push(s);
  }
  return out.length > 0 ? out.join(",") : "read";
}

export function rowToSite(row: Record<string, any>): Site {
  let metaParsed: Record<string, any> = {};
  if (row.metadata) {
    try {
      metaParsed = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata;
    } catch {
      // 容错降级
    }
  }
  const enhanced = getEnhancedSiteData(String(row.url));
  return {
    id: String(row.id),
    url: String(row.url),
    title: String(row.title),
    titleEn: row.title_en ?? null,
    description: row.description ?? null,
    descriptionEn: row.description_en ?? null,
    iconKey: row.icon_key ?? null,
    screenshotKey: row.screenshot_key ?? null,
    categoryId: String(row.category_id),
    subCategoryId: row.sub_category_id ?? null,
    // 标签由 selectSitesSql 聚合而来（group_concat / string_agg），按 slug 存储
    tags: row.tag_slugs ? String(row.tag_slugs).split(",").filter(Boolean) : [],
    status: (row.status ?? "active") as SiteStatus,
    enabled: Boolean(row.enabled),
    sort: Number(row.sort ?? 0),
    weight: Number(row.weight ?? 0),
    featured: Boolean(row.featured),
    source: row.source ?? null,
    visitCount: Number(row.visit_count ?? 0),
    lastVisitedAt: row.last_visited_at ?? null,
    trendScore: Number(row.trend_score ?? 0),
    deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
    health: {
      ok: row.health_ok === null || row.health_ok === undefined ? false : Boolean(row.health_ok),
      httpStatus: row.http_status ?? null,
      latencyMs: row.latency_ms ?? null,
      redirectTo: row.redirect_to ?? null,
      error: row.health_error ?? null,
      lastCheckedAt: row.last_checked_at ?? null,
    },
    actions: metaParsed.actions ?? enhanced.actions,
    relations: metaParsed.relations ?? enhanced.relations,
    liveMetrics: metaParsed.liveMetrics ?? enhanced.liveMetrics,
    workspaces: metaParsed.workspaces ?? enhanced.workspaces,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

export function rowToCategory(row: Record<string, any>): Category {
  return {
    id: String(row.id),
    anchor: String(row.anchor),
    parentId: row.parent_id ?? null,
    title: String(row.title),
    titleEn: row.title_en ?? null,
    description: row.description ?? null,
    icon: row.icon ?? null,
    enabled: Boolean(row.enabled),
    sort: Number(row.sort ?? 0),
    source: row.source ?? null,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

export function rowToFavorite(row: Record<string, any>): FavoriteRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    siteId: String(row.site_id),
    folderId: row.folder_id ?? null,
    note: row.note ?? null,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

export function rowToFolder(row: Record<string, any>): FavoriteFolderRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    sort: Number(row.sort ?? 0),
    createdAt: Number(row.created_at ?? 0),
  };
}

export function rowToProfile(row: Record<string, any>): UserProfileRecord {
  const parse = (v: unknown): string[] => {
    if (typeof v !== "string" || !v) return [];
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  };
  return {
    userId: String(row.user_id),
    topCategories: parse(row.top_categories),
    topTags: parse(row.top_tags),
    visitedSiteIds: parse(row.visited_site_ids),
    favoriteSiteIds: parse(row.favorite_site_ids),
    searchCount: Number(row.search_count ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

export function rowToJob(row: Record<string, any>): JobRecord {
  let payload: unknown = null;
  if (typeof row.payload === "string" && row.payload) {
    try { payload = JSON.parse(row.payload); } catch { payload = row.payload; }
  }
  return {
    id: String(row.id),
    kind: String(row.kind),
    payload,
    status: String(row.status ?? "pending"),
    attempts: Number(row.attempts ?? 0),
    error: row.error ?? null,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    nextRunAt: row.next_run_at === null || row.next_run_at === undefined ? null : Number(row.next_run_at),
  };
}

export function rowToUser(row: Record<string, any>): UserRecord {
  return {
    id: String(row.id),
    username: String(row.username),
    role: String(row.role ?? "user"),
    email: row.email ?? null,
    avatar: row.avatar ?? null,
    source: String(row.source ?? "local"),
  };
}

/** token_hash 列刻意不映射进记录——哈希只用于查询，不进返回值 */
export function rowToApiToken(row: Record<string, any>): ApiTokenRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    scopes: String(row.scopes ?? "read").split(",").map((s: string) => s.trim()).filter(Boolean),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
    createdAt: Number(row.created_at ?? 0),
    revokedAt: row.revoked_at == null ? null : Number(row.revoked_at),
    rotatedAt: row.rotated_at == null ? null : Number(row.rotated_at),
    // 老库没这一列 -> null，管理页显示"未知"即可，不能因为缺列让整个列表挂掉
    tokenPrefix: row.token_prefix == null ? null : String(row.token_prefix),
  };
}

/** diff 列在库里是 JSON 文本，读出时解析；损坏则保留原字符串（不让整页查询挂掉） */
export function rowToAuditLog(row: Record<string, any>): AuditLogRecord {
  let diff: unknown = null;
  if (typeof row.diff === "string" && row.diff) {
    try { diff = JSON.parse(row.diff); } catch { diff = row.diff; }
  }
  return {
    id: Number(row.id),
    actor: String(row.actor),
    actorKind: String(row.actor_kind ?? "user"),
    action: String(row.action),
    target: row.target == null ? null : String(row.target),
    diff,
    ip: row.ip == null ? null : String(row.ip),
    createdAt: Number(row.created_at ?? 0),
  };
}
export function rowToCollection(row: Record<string, any>): Collection {
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    description: row.description ?? null,
    kind: (row.kind ?? "topic") as Collection["kind"],
    icon: row.icon ?? null,
    sort: Number(row.sort ?? 0),
    enabled: Boolean(row.enabled),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}
/* ------------------------------------------------------------------ *
 * 方言适配辅助
 * ------------------------------------------------------------------ */

/**
 * SQLite 的参数绑定。
 *
 * 关键点：SQLite 没有真正的布尔类型，`enabled = ?` 必须传 0/1；
 * 而 PostgreSQL 是强类型，`boolean = 0` 会直接报
 * `operator does not exist: boolean = integer`。
 * 因此布尔值必须**按方言**转换，不能统一转成 0/1。
 */
export function bindSqlite(params: unknown[]): unknown[] {
  return params.map((p) => {
    if (typeof p === "boolean") return p ? 1 : 0;
    if (p instanceof Float32Array) return Buffer.from(p.buffer, p.byteOffset, p.byteLength);
    return p;
  });
}

/** 把 `?` 占位符转成 PostgreSQL 的 `$1..$n` */
export function toPgSql(sqlText: string): string {
  let i = 0;
  return sqlText.replace(/\?/g, () => "$" + ++i);
}

