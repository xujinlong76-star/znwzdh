import type { Repository } from "../repository.ts";
import { randomUUID, createHash } from "node:crypto";
import {
  canonicalizeUrl,
  checkPluginCompat,
  comparePluginVersions,
  isInternalShortLinkTarget,
  PLUGIN_LIMITS,
  resolveRegistryEntry,
  resolveRegistryLeaf,
  summarizePluginManifest,
  type BundlePayload,
  type PluginKind,
  type PluginManifest,
  type PluginStatus,
  type PluginSummary,
  type SearchPackPayload,
  type SitePackPayload,
} from "@navhub/core";
import { emitNotification } from "./notifications.ts";
import { slugify } from "./dialect.ts";
import { containsLike } from "../sql-like.ts";
import { buildKeysetPredicate, encodeKeysetCursor, parseKeysetCursor, type KeysetKey } from "../keyset.ts";
import type {
  PluginActor,
  PluginAuthorProfile,
  PluginAuthorProfileInput,
  PluginFunnelDay,
  PluginFunnelMetrics,
  PluginGovernanceAlert,
  PluginInstallConflict,
  PluginInstallRecord,
  PluginInstallTrend,
  PluginRecord,
  PluginReviewAdminItem,
  PluginReviewRecord,
  PluginReviewStats,
  PluginVersionRecord,
  ShortLinkRecord,
} from "./records.ts";

// 门面（repository.ts）通过 `pluginsRepo.` 命名空间引用插件域类型，保持域自包含
export type {
  PluginActor,
  PluginAuthorProfile,
  PluginAuthorProfileInput,
  PluginFunnelDay,
  PluginFunnelMetrics,
  PluginGovernanceAlert,
  PluginInstallConflict,
  PluginInstallRecord,
  PluginInstallTrend,
  PluginRecord,
  PluginReviewAdminItem,
  PluginReviewRecord,
  PluginReviewStats,
  PluginVersionRecord,
  ShortLinkRecord,
} from "./records.ts";
export type { PluginManifest, PluginStatus } from "@navhub/core";

/**
 * 插件市场（Plugin Marketplace）存储层。
 *
 * 设计约束（见 docs/PLUGIN-MARKET-DESIGN-2026-10-19.md）：
 * 1. 插件一律声明式：本模块只消费「已校验的 PluginManifest」（core 契约），永不执行插件内容；
 * 2. 安装是**增量**的：只新增缺失的站点/分类（URL 等价形态去重），绝不删改既有数据；
 * 3. 卸载默认只解绑记录；removeSites=true 时仅软删 source=plugin:<slug> 的站点（进回收站可恢复）；
 * 4. 计数列（install/star/report）在写路径维护，install_count 与「活跃安装」严格挂钩，
 *    重复安装不会重复计数（幂等）。
 */

const SLUG_MAX = 80;

export interface PluginCreateInput {
  manifest: PluginManifest;
  author?: string | null;
  authorKind?: string | null;
  /** 作者归属（发布者身份；seed/import 可空） */
  ownerIdentity?: string | null;
  /** user（社区发布，默认待审）| import（本机导入，可直接上架）| seed */
  source?: string;
  status?: PluginStatus;
  /** 显式指定 slug（导入迁移用）；缺省由名称生成并对冲突去重 */
  slug?: string;
  /** 认证作者标记 */
  authorVerified?: boolean;
  /** 衍生自哪个插件（Remix 来源） */
  forkedFromSlug?: string | null;
}

export interface PluginListFilter {
  status?: string;
  kind?: string;
  q?: string;
  /** 编辑精选（仅 published 有意义） */
  featured?: boolean;
  /** 公开作者页 key */
  ownerKey?: string;
  /** 我的插件：内部归属身份 */
  ownerIdentity?: string;
  /** new（默认）| popular | stars | updated | rating | trending */
  sort?: string;
  limit?: number;
  offset?: number;
  /** 是否只查含有待审新版本的已发布插件 */
  hasPendingVersion?: boolean;
  /** 标签过滤 */
  tag?: string;
  /** 多标签过滤（R2A-1）：全部命中才算（AND），与 q 里的 #tag 同口径 */
  tags?: string[];
  /** 只查这些 id（星标筛选：调用方星标 id 集合；空数组 = 不查） */
  ids?: string[];
}

/** 作者公开页 key：身份不可逆哈希，避免把匿名 id / userId 暴露在 URL 里 */
export function pluginOwnerKey(identity: string): string {
  return createHash("sha256").update("navhub:plugin-owner:" + identity).digest("hex").slice(0, 24);
}

export type PluginReviewAction = "approve" | "reject" | "delist";

export interface PluginBundleInstallItem {
  slug: string
  kind: PluginKind
  name: string
  alreadyInstalled: boolean
  sitesAdded: number
  sitesSkipped: number
  enginesAdded: number
}

export interface PluginInstallApplied {
  sitesAdded: number;
  sitesSkipped: number;
  categoriesCreated: number;
  createdSiteIds: string[];
  enginesAdded?: number;
  /** 解析不出、只能落「未分类」的包内类目标题（已各记一条 category_gap 提案） */
  categoryGaps?: string[];
  /** 包声明的 parentCategory 与权威树不一致（站点仍按权威树落位，仅告警） */
  categoryParentMismatches?: string[];
  /** bundle 安装时逐个成员的结果（非 bundle 为空） */
  bundleItems?: PluginBundleInstallItem[];
}

export interface PluginBundleMember {
  slug: string;
  /** 组合包清单声明的类型（用于识别类型漂移） */
  kind: string;
  name: string | null;
  icon: string | null;
  version: string | null;
  status: PluginStatus | "missing";
  available: boolean;
  reason?: string;
  summary: PluginSummary | null;
}

export interface PluginInstallResult {
  plugin: PluginRecord;
  install: PluginInstallRecord;
  /** 此前已处于活跃安装状态（重复安装）：计数未变 */
  alreadyInstalled: boolean;
  applied: PluginInstallApplied;
}

export interface PluginUninstallResult {
  /** false = 没有活跃安装（幂等语义，不报错） */
  removed: boolean;
  removedSites: number;
  removedCategories: number;
  plugin: PluginRecord;
}

/* ------------------------------------------------------------------ *
 * 行映射与 slug
 * ------------------------------------------------------------------ */

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // 落库前已经过 core 校验；解析失败只可能是外部脏数据，降级展示而不是抛错
    return fallback;
  }
}

function rowToPlugin(row: Record<string, any>): PluginRecord {
  const kind = String(row.kind ?? "site-pack") as PluginKind;
  const manifest = parseJson<PluginManifest | null>(row.manifest, null);
  const fallbackManifest: PluginManifest = {
    manifestVersion: 1,
    kind,
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    version: String(row.version ?? "0.0.0"),
    payload: { sites: [] },
  };
  const tagsRaw = parseJson<unknown>(row.tags, []);
  return {
    id: String(row.id),
    slug: String(row.slug),
    kind,
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    icon: row.icon == null ? null : String(row.icon),
    tags: Array.isArray(tagsRaw) ? tagsRaw.map(String) : [],
    author: row.author == null ? null : String(row.author),
    authorKind: row.author_kind == null ? null : String(row.author_kind),
    ownerIdentity: row.owner_identity == null ? null : String(row.owner_identity),
    ownerKey: row.owner_key == null ? null : String(row.owner_key),
    license: row.license == null ? null : String(row.license),
    homepage: row.homepage == null ? null : String(row.homepage),
    version: String(row.version ?? "0.0.0"),
    manifest: manifest ?? fallbackManifest,
    status: String(row.status ?? "pending") as PluginStatus,
    reviewNote: row.review_note == null ? null : String(row.review_note),
    reviewedAt: row.reviewed_at == null ? null : Number(row.reviewed_at),
    pendingChangelog: row.pending_changelog == null ? null : String(row.pending_changelog),
    pendingVersion: row.pending_version == null ? null : String(row.pending_version),
    pendingManifest: parseJson<PluginManifest | null>(row.pending_manifest, null),
    authorVerified: row.author_verified === true || Number(row.author_verified ?? 0) === 1,
    forkedFromSlug: row.forked_from_slug == null ? null : String(row.forked_from_slug),
    remixCount: Number(row.remix_count ?? 0),
    source: String(row.source ?? "user"),
    installCount: Number(row.install_count ?? 0),
    starCount: Number(row.star_count ?? 0),
    reportCount: Number(row.report_count ?? 0),
    featured: row.featured === true || Number(row.featured ?? 0) === 1,
    featuredRank: Number(row.featured_rank ?? 0),
    ratingAvg: Number(row.rating_avg ?? 0),
    reviewCount: Number(row.review_count ?? 0),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    publishedAt: row.published_at == null ? null : Number(row.published_at),
  };
}

/** 名称 → slug 基座；无有效字符时回落 "plugin"（slugify 的空兜底 "tag" 对插件语义不对） */
function baseSlug(seed: string): string {
  if (!/[a-z0-9\u4e00-\u9fff]/i.test(seed)) return "plugin";
  return slugify(seed).slice(0, SLUG_MAX) || "plugin";
}

/** 生成唯一 slug：已占用则追加 -2、-3…… */
async function uniqueSlug(repo: Repository, seed: string): Promise<string> {
  const base = baseSlug(seed);
  const rows = await repo.raw("SELECT slug FROM plugins WHERE slug = ? OR slug LIKE ?", [base, base + "-%"]);
  const taken = new Set(rows.map((r) => String(r.slug)));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    if (!taken.has(base + "-" + i)) return base + "-" + i;
  }
  return base + "-" + randomUUID().slice(0, 8);
}

/* ------------------------------------------------------------------ *
 * 注册表：发布 / 读取 / 列表 / 更新 / 审核
 * ------------------------------------------------------------------ */

type BundleOwner = Pick<PluginRecord, "slug" | "kind" | "manifest">;

/**
 * 解析组合包成员的真实状态。
 *
 * 公开返回只暴露已上架成员的名称/图标/版本；未上架或缺失成员只回 slug + 原因，
 * 避免把待审内容通过组合包侧面泄露。`available` 为 false 时安装会 fail closed。
 */
export async function getPluginBundleMembers(
  repo: Repository,
  plugin: BundleOwner,
): Promise<PluginBundleMember[]> {
  if (plugin.kind !== "bundle") return [];
  const payload = plugin.manifest.payload as BundlePayload;
  const members: PluginBundleMember[] = [];
  for (const item of payload.items ?? []) {
    const ref = await getPluginBySlug(repo, item.slug);
    const selfReference = String(item.slug).toLowerCase() === plugin.slug.toLowerCase();
    if (!ref) {
      members.push({
        slug: item.slug,
        kind: item.kind,
        name: null,
        icon: null,
        version: null,
        status: "missing",
        available: false,
        reason: "引用的插件不存在",
        summary: null,
      });
      continue;
    }
    const kindMatches = ref.kind === item.kind;
    const nested = ref.kind === "bundle";
    const publiclyVisible = ref.status === "published";
    let reason: string | undefined;
    if (selfReference) reason = "组合包不能引用自身";
    else if (nested) reason = "禁止嵌套组合包";
    else if (!kindMatches) reason = `声明类型 ${item.kind} 与实际类型 ${ref.kind} 不一致`;
    else if (!publiclyVisible) reason = `插件状态为 ${ref.status}`;
    const available = !reason && publiclyVisible;
    members.push({
      slug: item.slug,
      kind: item.kind,
      name: publiclyVisible ? ref.name : null,
      icon: publiclyVisible ? ref.icon : null,
      version: publiclyVisible ? ref.version : null,
      status: ref.status,
      available,
      ...(reason ? { reason } : {}),
      summary: available ? summarizePluginManifest(ref.manifest) : null,
    });
  }
  return members;
}

/** 服务端引用校验：组合包只能引用已上架、类型一致、非嵌套的非自身插件。 */
async function assertBundleManifestReferences(
  repo: Repository,
  manifest: PluginManifest,
  slug: string,
): Promise<void> {
  if (manifest.kind !== "bundle") return;
  const members = await getPluginBundleMembers(repo, { slug, kind: manifest.kind, manifest });
  const blocked = members.filter((member) => !member.available);
  if (blocked.length > 0) {
    const detail = blocked
      .map((member) => `${member.slug}（${member.reason ?? "不可用"}）`)
      .join("；");
    throw new Error(`组合包引用的成员不可用：${detail}`);
  }
}

/** 安装前解析出成员记录；任何成员失效都拒绝整个组合包，避免半安装。 */
async function resolveBundleMembers(repo: Repository, plugin: PluginRecord): Promise<PluginRecord[]> {
  const members = await getPluginBundleMembers(repo, plugin);
  const blocked = members.filter((member) => !member.available);
  if (blocked.length > 0) {
    const detail = blocked
      .map((member) => `${member.slug}（${member.reason ?? "不可用"}）`)
      .join("；");
    throw new Error(`组合包暂不可安装：${detail}`);
  }
  const resolved: PluginRecord[] = [];
  for (const member of members) {
    const ref = await getPluginBySlug(repo, member.slug);
    if (!ref) throw new Error(`组合包成员不存在：${member.slug}`);
    resolved.push(ref);
  }
  return resolved;
}

export async function createPlugin(
  repo: Repository,
  input: PluginCreateInput,
  actor?: PluginActor,
): Promise<PluginRecord> {
  const manifest = input.manifest;
  const now = Date.now();
  const source = input.source ?? "user";
  const status = input.status ?? "pending";
  if (input.slug) {
    const existing = await getPluginBySlug(repo, input.slug);
    if (existing) throw new Error(`插件 slug 已存在：${input.slug}`);
  }
  const slug = input.slug ?? (await uniqueSlug(repo, manifest.name));
  await assertBundleManifestReferences(repo, manifest, slug);
  const ownerIdentity = input.ownerIdentity?.trim().slice(0, 120) || null;
  const ownerKey = ownerIdentity ? pluginOwnerKey(ownerIdentity) : null;
  const featuredDefault = repo.db.dialect === "pg" ? "FALSE" : "0";
  const isVerified = Boolean(input.authorVerified) || source === "seed" || ownerIdentity === "seed" || ownerIdentity === "official";
  const authorVerifiedVal = repo.db.dialect === "pg" ? isVerified : isVerified ? 1 : 0;
  const forkedFromSlug = input.forkedFromSlug ?? manifest.forkedFrom ?? null;

  await repo.run(
    `INSERT INTO plugins (
       id, slug, kind, name, description, icon, tags, author, author_kind, owner_identity, owner_key,
       license, homepage, version, manifest, status, review_note, reviewed_at, source,
       author_verified, forked_from_slug,
       install_count, star_count, report_count, featured, featured_rank, created_at, updated_at, published_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,${featuredDefault},0,?,?,?)`,
    [
      randomUUID(),
      slug,
      manifest.kind,
      manifest.name,
      manifest.description,
      manifest.icon ?? null,
      JSON.stringify(manifest.tags ?? []),
      input.author ?? manifest.author ?? null,
      input.authorKind ?? null,
      ownerIdentity,
      ownerKey,
      manifest.license ?? null,
      manifest.homepage ?? null,
      manifest.version,
      JSON.stringify(manifest),
      status,
      null,
      null,
      source,
      authorVerifiedVal,
      forkedFromSlug,
      now,
      now,
      status === "published" ? now : null,
    ],
  );
  if (forkedFromSlug) {
    try {
      await repo.run("UPDATE plugins SET remix_count = remix_count + 1 WHERE slug = ?", [forkedFromSlug]);
    } catch {
      // 溯源计数更新失败不影响创建
    }
  }
  const created = await getPluginBySlug(repo, slug);
  if (!created) throw new Error("创建插件后无法读回");
  if (status === "published") {
    await recordPluginVersion(repo, created.id, manifest, source === "import" ? "导入即上架" : "初始发布", now);
  }
  await repo.audit({
    actor: actor?.actor ?? input.author ?? "anonymous",
    actorKind: actor?.actorKind ?? input.authorKind ?? "anonymous",
    action: source === "import" ? "plugin.import" : "plugin.publish",
    target: slug,
    diff: { kind: manifest.kind, version: manifest.version, source },
    ip: actor?.ip,
  });
  return created;
}

export async function getPluginBySlug(repo: Repository, slug: string): Promise<PluginRecord | null> {
  const rows = await repo.raw(
    `SELECT p.*, COALESCE(r.avg_rating, 0) AS rating_avg, COALESCE(r.review_count, 0) AS review_count
       FROM plugins p
       LEFT JOIN (
         SELECT plugin_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
         FROM plugin_reviews WHERE status = 'visible' GROUP BY plugin_id
       ) r ON r.plugin_id = p.id
       WHERE p.slug = ? LIMIT 1`,
    [slug],
  );
  return rows[0] ? rowToPlugin(rows[0]) : null;
}

/** 批量获取插件记录并一次性聚合评分，消除搜索与推荐回路中的 N+1 查询 */
export async function getPluginsBySlugs(repo: Repository, slugs: string[]): Promise<PluginRecord[]> {
  const unique = Array.from(new Set(slugs.filter(Boolean)));
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => "?").join(", ");
  const rows = await repo.raw(
    `SELECT p.*, COALESCE(r.avg_rating, 0) AS rating_avg, COALESCE(r.review_count, 0) AS review_count
       FROM plugins p
       LEFT JOIN (
         SELECT plugin_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
         FROM plugin_reviews WHERE status = 'visible' GROUP BY plugin_id
       ) r ON r.plugin_id = p.id
       WHERE p.slug IN (${placeholders})`,
    unique,
  );
  return rows.map(rowToPlugin);
}

export async function listPlugins(
  repo: Repository,
  filter: PluginListFilter = {},
): Promise<{ items: PluginRecord[]; total: number }> {
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    wheres.push("p.status = ?");
    params.push(filter.status);
  }
  if (filter.kind) {
    wheres.push("p.kind = ?");
    params.push(filter.kind);
  }
  if (filter.q) {
    // q 匹配名称 / 简介 / slug / 清单内容：包内站点名与引擎名只存在于 manifest
    // JSON（TEXT 列，sqlite 与 pg 同型），不加这一路，搜「DuckDuckGo」「GitHub」
    // 这类只在清单里出现过的词恒为 0。管理台「在队列中定位」按 alert.slug 搜索，
    // 旧口径只匹配名称与简介，slug 永远搜不到，定位按钮点后列表恒为空。
    wheres.push("(p.name LIKE ? ESCAPE '!' OR p.description LIKE ? ESCAPE '!' OR p.slug LIKE ? ESCAPE '!' OR p.manifest LIKE ? ESCAPE '!')");
    const like = containsLike(filter.q);
    params.push(like, like, like, like);
  }
  if (filter.featured !== undefined) {
    const truthy = repo.db.dialect === "pg" ? "TRUE" : "1";
    const falsy = repo.db.dialect === "pg" ? "FALSE" : "0";
    wheres.push(`p.featured = ${filter.featured ? truthy : falsy}`);
  }
  if (filter.ownerKey) {
    wheres.push("p.owner_key = ?");
    params.push(filter.ownerKey);
  }
  if (filter.ownerIdentity) {
    wheres.push("p.owner_identity = ?");
    params.push(filter.ownerIdentity);
  }
  if (filter.tag) {
    wheres.push("p.tags LIKE ? ESCAPE '!'");
    params.push(containsLike(`"${filter.tag}"`));
  }
  // R2A-1：q 里的 #tag 与 ?tag= 汇总到这里，多标签 AND（每个都必须命中）
  for (const t of filter.tags ?? []) {
    if (!t) continue;
    wheres.push("p.tags LIKE ? ESCAPE '!'");
    params.push(containsLike(`"${t}"`));
  }
  if (filter.hasPendingVersion) {
    wheres.push("p.pending_version IS NOT NULL");
  }
  if (filter.ids !== undefined) {
    // 星标筛选：空集合直接判 0 条，避免拼出非法的 `IN ()`
    if (filter.ids.length === 0) {
      return { items: [], total: 0 };
    }
    const placeholders = filter.ids.map(() => "?").join(", ");
    wheres.push(`p.id IN (${placeholders})`);
    params.push(...filter.ids);
  }
  const whereClause = wheres.length > 0 ? " WHERE " + wheres.join(" AND ") : "";
  const countRow = (await repo.raw(`SELECT COUNT(*) AS cnt FROM plugins p${whereClause}`, params))[0];
  const total = Number(countRow?.cnt ?? 0);
  const limit = Math.min(100, Math.max(1, filter.limit ?? 24));
  const offset = Math.max(0, filter.offset ?? 0);
  // 评分排序使用贝叶斯平滑（先验 3 条 3.5 星），避免 1 条 5 星压过大量 4.8 星。
  const ratingOrder =
    "CASE WHEN COALESCE(r.review_count, 0) > 0 THEN " +
    "(COALESCE(r.avg_rating, 0) * r.review_count + 10.5) / (r.review_count + 3.0) ELSE 0 END DESC, " +
    "p.install_count DESC, p.created_at DESC";
  const order =
    filter.sort === "popular"
      ? "p.install_count DESC, p.star_count DESC, p.created_at DESC"
      : filter.sort === "stars"
        ? "p.star_count DESC, p.created_at DESC"
        : filter.sort === "rating"
          ? ratingOrder
          : filter.sort === "featured"
            ? "p.featured_rank DESC, COALESCE(p.published_at, p.created_at) DESC"
            : filter.sort === "updated"
              ? "p.updated_at DESC, p.created_at DESC"
              : filter.sort === "trending"
                ? `((p.install_count * 3 + p.star_count * 5 - p.report_count * 10 + 1.0) / ((${Date.now()} - COALESCE(p.published_at, p.created_at)) / 86400000.0 + 2.0)) DESC, COALESCE(p.published_at, p.created_at) DESC`
                : "COALESCE(p.published_at, p.created_at) DESC, p.created_at DESC";
  // 列表一次性带出评分聚合，避免前端/详情页 N+1；LEFT JOIN 只扫 visible 评价。
  const rows = await repo.raw(
    `SELECT p.*, COALESCE(r.avg_rating, 0) AS rating_avg, COALESCE(r.review_count, 0) AS review_count
       FROM plugins p
       LEFT JOIN (
         SELECT plugin_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
         FROM plugin_reviews WHERE status = 'visible' GROUP BY plugin_id
       ) r ON r.plugin_id = p.id
       ${whereClause} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { items: rows.map(rowToPlugin), total };
}

/** 我的插件：按内部归属身份列出全部状态（供作者中心） */
export async function listPluginsByOwner(
  repo: Repository,
  identity: string,
  filter: Omit<PluginListFilter, "ownerIdentity" | "status" | "ownerKey"> = {},
): Promise<{ items: PluginRecord[]; total: number }> {
  return listPlugins(repo, { ...filter, ownerIdentity: identity });
}

/** 公开作者页：只列 published，按 ownerKey 聚合 */
export async function listPluginsByOwnerKey(
  repo: Repository,
  ownerKey: string,
  filter: Omit<PluginListFilter, "ownerKey" | "status" | "ownerIdentity"> = {},
): Promise<{ items: PluginRecord[]; total: number }> {
  return listPlugins(repo, { ...filter, ownerKey, status: "published" });
}

export interface AuthorPluginStats {
  /** 已上架插件数（与 listPluginsByOwnerKey 的 total 同口径） */
  plugins: number;
  /** 全部已上架插件的安装量之和（不限前 100 个） */
  installs: number;
  /** 全部已上架插件的星标数之和（不限前 100 个） */
  stars: number;
  /** 最新上架插件的作者名（与修前全量取首条同口径） */
  author: string | null;
  authorKind: string | null;
}

/**
 * 公开作者页聚合：单条 SQL 对全部已上架插件求和。
 *
 * 修前路由用 listPluginsByOwnerKey(key, { limit: 100 }) 的 items 求和，
 * 作者插件 >100 时第 101 个起的安装/星标恒不计入，total 却正确——统计偏小。
 * 这里直接 SUM 全量，不再经分页列表中转。
 */
export async function getAuthorPluginStats(
  repo: Repository,
  ownerKey: string,
): Promise<AuthorPluginStats> {
  const row = (
    await repo.raw(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(install_count), 0) AS installs,
              COALESCE(SUM(star_count), 0) AS stars
         FROM plugins WHERE owner_key = ? AND status = 'published'`,
      [ownerKey],
    )
  )[0];
  const first = (
    await repo.raw(
      `SELECT author, author_kind FROM plugins
        WHERE owner_key = ? AND status = 'published'
        ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC LIMIT 1`,
      [ownerKey],
    )
  )[0];
  return {
    plugins: Number(row?.cnt ?? 0),
    installs: Number(row?.installs ?? 0),
    stars: Number(row?.stars ?? 0),
    author: first?.author == null ? null : String(first.author),
    authorKind: first?.author_kind == null ? null : String(first.author_kind),
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password;
  } catch {
    return false;
  }
}

function rowToAuthorProfile(row: Record<string, any>): PluginAuthorProfile {
  const links = parseJson<Record<string, unknown>>(row.links, {});
  return {
    ownerKey: String(row.owner_key),
    displayName: row.display_name == null ? null : String(row.display_name),
    bio: row.bio == null ? null : String(row.bio),
    avatar: row.avatar == null ? null : String(row.avatar),
    links: {
      ...(typeof links.homepage === "string" ? { homepage: links.homepage } : {}),
      ...(typeof links.github === "string" ? { github: links.github } : {}),
      ...(typeof links.x === "string" ? { x: links.x } : {}),
    },
    donateUrl: row.donate_url == null ? null : String(row.donate_url),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

/** 读作者档案（未填过返回 null；作者页只渲染真实填过的内容） */
export async function getPluginAuthorProfile(
  repo: Repository,
  ownerKey: string,
): Promise<PluginAuthorProfile | null> {
  const rows = await repo.raw("SELECT * FROM plugin_author_profiles WHERE owner_key = ? LIMIT 1", [ownerKey]);
  const row = rows[0];
  return row ? rowToAuthorProfile(row) : null;
}

/**
 * 写作者档案（作者本人维护；调用方 identity → ownerKey，写不了别人的）。
 *
 * 校验与 manifest 同口径：头像只认 emoji/短文本（禁远程图片地址）、
 * 链接与捐赠一律 http(s) 绝对地址、超长报错不截断。空字符串按「未填」处理
 * （清掉旧值）；全空也保留该行（作者页按「未填档案」处理，不造假档案）。
 */
export async function upsertPluginAuthorProfile(
  repo: Repository,
  identity: string,
  input: PluginAuthorProfileInput,
): Promise<PluginAuthorProfile> {
  // 存的 owner_key 是身份的不可逆哈希（pluginOwnerKey，与 plugins.owner_key
  // 同口径），不是原始 identity：作者页 URL 里的 key 就是这个哈希，
  // 读档案（getPluginAuthorProfile）与插件归属才能对上号。
  const key = pluginOwnerKey(identity.trim());
  if (!identity.trim()) throw new Error("作者 key 不能为空");
  const clean = (v: string | null | undefined): string | null => {
    const t = typeof v === "string" ? v.trim() : "";
    return t ? t : null;
  };
  const displayName = clean(input.displayName);
  if (displayName && displayName.length > 60) throw new Error("作者名称超过 60 字符上限");
  const bio = clean(input.bio);
  if (bio && bio.length > 500) throw new Error("作者简介超过 500 字符上限");
  const avatar = clean(input.avatar);
  if (avatar && avatar.length > 8) throw new Error("头像只能是 emoji 或短文本（8 字符以内）");
  if (avatar && avatar.includes("://")) throw new Error("头像只能是 emoji 或短文本（禁止远程图片地址）");
  const linkOf = (v: string | null | undefined, label: string): string | undefined => {
    const t = clean(v);
    if (!t) return undefined;
    if (t.length > 300) throw new Error(`${label}超过 300 字符上限`);
    if (!isHttpUrl(t)) throw new Error(`${label}必须是 http/https 绝对地址`);
    return t;
  };
  const homepage = linkOf(input.links?.homepage, "主页链接");
  const github = linkOf(input.links?.github, "GitHub 链接");
  const x = linkOf(input.links?.x, "X 链接");
  const donateUrl = linkOf(input.donateUrl, "捐赠链接");
  const links: Record<string, string> = {};
  if (homepage) links.homepage = homepage;
  if (github) links.github = github;
  if (x) links.x = x;
  const now = Date.now();
  await repo.run(
    "INSERT INTO plugin_author_profiles (owner_key, display_name, bio, avatar, links, donate_url, created_at, updated_at) " +
      "VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner_key) DO UPDATE SET " +
      "display_name = excluded.display_name, bio = excluded.bio, avatar = excluded.avatar, " +
      "links = excluded.links, donate_url = excluded.donate_url, updated_at = excluded.updated_at",
    [key, displayName, bio, avatar, JSON.stringify(links), donateUrl, now, now],
  );
  const saved = await getPluginAuthorProfile(repo, key);
  if (!saved) throw new Error("保存作者档案后无法读回");
  return saved;
}

export interface OwnerPluginStats {
  total: number;
  pending: number;
  published: number;
  rejected: number;
  /** 除 pending/published/rejected 外的全部状态（delisted/quarantined 等） */
  other: number;
  installs: number;
  stars: number;
  remixes: number;
}

/**
 * 作者中心聚合：按归属身份对全部状态的插件求和（不限前 100 个）。
 *
 * 修前 /mine 只返回分页 items，前端对当页求和：作者插件 >100 时状态计数与
 * 安装/星标/remix 合计恒偏小。这里一次 SQL 算全，分页列表只负责展示当页。
 */
export async function getOwnerPluginStats(
  repo: Repository,
  identity: string,
): Promise<OwnerPluginStats> {
  const row = (
    await repo.raw(
      `SELECT COUNT(*) AS cnt,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
              SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
              COALESCE(SUM(install_count), 0) AS installs,
              COALESCE(SUM(star_count), 0) AS stars,
              COALESCE(SUM(remix_count), 0) AS remixes
         FROM plugins WHERE owner_identity = ?`,
      [identity],
    )
  )[0];
  const total = Number(row?.cnt ?? 0);
  const pending = Number(row?.pending ?? 0);
  const published = Number(row?.published ?? 0);
  const rejected = Number(row?.rejected ?? 0);
  return {
    total,
    pending,
    published,
    rejected,
    other: total - pending - published - rejected,
    installs: Number(row?.installs ?? 0),
    stars: Number(row?.stars ?? 0),
    remixes: Number(row?.remixes ?? 0),
  };
}

/**
 * 更新插件内容（新 manifest 须已通过 core 校验）。
 * 已发布/已驳回/已下架的插件一律回到 pending 重审——更新不允许绕过人工审核。
 */
export async function updatePlugin(
  repo: Repository,
  slug: string,
  manifest: PluginManifest,
  actor?: PluginActor,
): Promise<PluginRecord> {
  const existing = await getPluginBySlug(repo, slug);
  if (!existing) throw new Error(`插件不存在：${slug}`);
  if (existing.kind !== manifest.kind) {
    throw new Error(`插件类型不可变：当前为 ${existing.kind}，提交为 ${manifest.kind}`);
  }
  await assertBundleManifestReferences(repo, manifest, slug);
  await repo.run(
    `UPDATE plugins SET name = ?, description = ?, icon = ?, tags = ?, license = ?, homepage = ?,
       version = ?, manifest = ?, status = 'pending', review_note = NULL, reviewed_at = NULL,
       pending_changelog = NULL, published_at = NULL, updated_at = ?
     WHERE slug = ?`,
    [
      manifest.name,
      manifest.description,
      manifest.icon ?? null,
      JSON.stringify(manifest.tags ?? []),
      manifest.license ?? null,
      manifest.homepage ?? null,
      manifest.version,
      JSON.stringify(manifest),
      Date.now(),
      slug,
    ],
  );
  const updated = await getPluginBySlug(repo, slug);
  if (!updated) throw new Error("更新插件后无法读回");
  await repo.audit({
    actor: actor?.actor ?? existing.author ?? "anonymous",
    actorKind: actor?.actorKind,
    action: "plugin.update",
    target: slug,
    diff: { from: existing.version, to: manifest.version, statusReset: existing.status !== "pending" },
    ip: actor?.ip,
  });
  return updated;
}

/**
 * 作者提交新版本：版本号必须严格递增，类型不可变；内容重新进入 pending 审核。
 * 变更说明暂存在 plugins.pending_changelog，审核通过时写入版本历史。
 */
export async function submitPluginVersion(
  repo: Repository,
  slug: string,
  manifest: PluginManifest,
  changelog: string | null,
  actor?: PluginActor,
): Promise<PluginRecord> {
  const existing = await getPluginBySlug(repo, slug);
  if (!existing) throw new Error(`插件不存在：${slug}`);
  if (existing.kind !== manifest.kind) {
    throw new Error(`插件类型不可变：当前为 ${existing.kind}，提交为 ${manifest.kind}`);
  }
  await assertBundleManifestReferences(repo, manifest, slug);
  // pending/rejected 允许同版本修正（驳回后作者需要修复并重新提交同一版本）；
  // 已上架/已下架必须严格递增，避免覆盖已发布的版本历史快照。
  const cmp = comparePluginVersions(manifest.version, existing.version);
  const sameVersionAllowed = existing.status === "pending" || existing.status === "rejected";
  if (cmp < 0 || (cmp === 0 && !sameVersionAllowed)) {
    throw new Error(`新版本号必须大于当前版本 ${existing.version}`);
  }
  const now = Date.now();
  if (existing.status === "published") {
    // 双轨制 Shadow Release：已发布版本保持 published 在售与搜索有效，新版本在待审字段暂存
    await repo.run(
      `UPDATE plugins SET pending_version = ?, pending_manifest = ?, pending_changelog = ?, updated_at = ?
       WHERE slug = ?`,
      [
        manifest.version,
        JSON.stringify(manifest),
        changelog?.trim().slice(0, 2000) || null,
        now,
        slug,
      ],
    );
  } else {
    await repo.run(
      `UPDATE plugins SET name = ?, description = ?, icon = ?, tags = ?, license = ?, homepage = ?,
         version = ?, manifest = ?, status = 'pending', review_note = NULL, reviewed_at = NULL,
         pending_changelog = ?, pending_version = NULL, pending_manifest = NULL, published_at = NULL, updated_at = ?
       WHERE slug = ?`,
      [
        manifest.name,
        manifest.description,
        manifest.icon ?? null,
        JSON.stringify(manifest.tags ?? []),
        manifest.license ?? null,
        manifest.homepage ?? null,
        manifest.version,
        JSON.stringify(manifest),
        changelog?.trim().slice(0, 2000) || null,
        now,
        slug,
      ],
    );
  }
  const updated = await getPluginBySlug(repo, slug);
  if (!updated) throw new Error("提交版本后无法读回");
  await repo.audit({
    actor: actor?.actor ?? existing.ownerIdentity ?? existing.author ?? "anonymous",
    actorKind: actor?.actorKind ?? "owner",
    action: "plugin.version.submit",
    target: slug,
    diff: {
      from: existing.version,
      to: manifest.version,
      shadowPending: existing.status === "published",
      changelog: changelog?.trim().slice(0, 500) ?? null,
    },
    ip: actor?.ip,
  });
  if (existing.status === "published") {
    return {
      ...updated,
      version: manifest.version,
      manifest,
      status: "pending",
      publishedAt: null,
      pendingChangelog: changelog?.trim().slice(0, 2000) || null,
    };
  }
  return updated;
}

/** 编辑精选开关（管理台；featured 仅对 published 列表生效） */
export async function setPluginFeatured(
  repo: Repository,
  slug: string,
  featured: boolean,
  rank: number,
  actor?: PluginActor,
): Promise<PluginRecord> {
  const existing = await getPluginBySlug(repo, slug);
  if (!existing) throw new Error(`插件不存在：${slug}`);
  const truthy = repo.db.dialect === "pg" ? featured : featured ? 1 : 0;
  await repo.run("UPDATE plugins SET featured = ?, featured_rank = ?, updated_at = ? WHERE slug = ?", [
    truthy,
    Math.max(0, Math.min(9999, Math.trunc(rank))),
    Date.now(),
    slug,
  ]);
  const updated = await getPluginBySlug(repo, slug);
  if (!updated) throw new Error("更新精选后无法读回");
  await repo.audit({
    actor: actor?.actor ?? "admin",
    actorKind: actor?.actorKind ?? "admin",
    action: "plugin.featured",
    target: slug,
    diff: { featured, rank },
    ip: actor?.ip,
  });
  return updated;
}

/**
 * 更新主动提醒（R5-1）：新版本上架后，给仍装着旧版的用户各发一条站内通知。
 *
 * 触发点只在 reviewPlugin 的 approve 使版本号实际递增时（shadow release）；
 * 首次上架（无已装用户）与版本号不变的重上架不触发。幂等键
 * `plugin-update:<pluginId>:<version>` 保证同一版本只提醒一次；
 * 单条通知失败只记日志、不阻断审核（提醒是次生效应，审核本身不能因此失败）。
 * 通知进 outbox 后由 JobRunner 的 relayNotifications 投进站内信箱
 * （/me/notifications），与 C-4 的审核通知同一条投递链路。
 */
export async function notifyPluginUpdateAvailable(
  repo: Repository,
  plugin: PluginRecord,
  previousVersion: string,
): Promise<{ notified: number }> {
  const newVersion = plugin.version;
  if (comparePluginVersions(newVersion, previousVersion) <= 0) return { notified: 0 };
  const rows = await repo.raw(
    "SELECT identity, version FROM plugin_installs WHERE plugin_id = ? AND removed_at IS NULL",
    [plugin.id],
  );
  let notified = 0;
  for (const row of rows) {
    const identity = String(row.identity ?? "");
    const installedVersion = String(row.version ?? "");
    if (!identity) continue;
    if (comparePluginVersions(installedVersion, newVersion) >= 0) continue;
    try {
      await emitNotification(repo, {
        identity,
        idempotencyKey: `plugin-update:${plugin.id}:${newVersion}`,
        kind: "plugin_update_available",
        title: `「${plugin.name}」有新版本 v${newVersion}`,
        body: `你安装的 v${installedVersion} 已有新版本 v${newVersion}，前往已安装页一键升级。`,
        link: "/marketplace/installed",
        channels: ["inapp"],
      });
      notified++;
    } catch (err) {
      console.error("[plugins] 更新提醒发送失败（不阻断审核）:", err);
    }
  }
  return { notified };
}

/** 审核动作：approve（pending|delisted|quarantined|rejected → published）/ reject / delist
 * rejected 允许重新审核上架（C-1）：管理员误驳回后点「重新上架」不应永远失败，
 * 否则只能等作者重投；与 pending/delisted/quarantined 同一条上架路径。 */
export async function reviewPlugin(
  repo: Repository,
  slug: string,
  action: PluginReviewAction,
  note: string | null,
  actor?: PluginActor,
): Promise<PluginRecord> {
  const existing = await getPluginBySlug(repo, slug);
  if (!existing) throw new Error(`插件不存在：${slug}`);
  let status: PluginStatus = existing.status;
  const now = Date.now();

  if (action === "approve") {
    if (existing.status === "published") {
      // 审核通过已发布插件的待审新版本 (Shadow Release)
      if (!existing.pendingVersion || !existing.pendingManifest) {
        throw new Error(`插件当前状态为 ${existing.status}，只有 pending/delisted/quarantined/rejected 可以通过`);
      }
      const newManifest = existing.pendingManifest;
      await assertBundleManifestReferences(repo, newManifest, slug);
      const changelog = existing.pendingChangelog?.trim() || note || "新版本审核通过";

      await repo.run(
        `UPDATE plugins SET
           name = ?, description = ?, icon = ?, tags = ?, license = ?, homepage = ?,
           version = ?, manifest = ?,
           pending_version = NULL, pending_manifest = NULL, pending_changelog = NULL,
           review_note = ?, reviewed_at = ?, updated_at = ?
         WHERE slug = ?`,
        [
          newManifest.name,
          newManifest.description,
          newManifest.icon ?? null,
          JSON.stringify(newManifest.tags ?? []),
          newManifest.license ?? null,
          newManifest.homepage ?? null,
          existing.pendingVersion,
          JSON.stringify(newManifest),
          note,
          now,
          now,
          slug,
        ],
      );
      await recordPluginVersion(repo, existing.id, newManifest, changelog, now);
    } else {
      if (existing.status !== "pending" && existing.status !== "delisted" && existing.status !== "quarantined" && existing.status !== "rejected") {
        throw new Error(`插件当前状态为 ${existing.status}，只有 pending/delisted/quarantined/rejected 可以通过`);
      }
      status = "published";
      await assertBundleManifestReferences(repo, existing.manifest, slug);
      const changelog = existing.pendingChangelog?.trim() || note || "审核通过并上架";
      await repo.run(
        `UPDATE plugins SET status = ?, review_note = ?, reviewed_at = ?, published_at = ?,
           pending_version = NULL, pending_manifest = NULL, pending_changelog = NULL, updated_at = ?
         WHERE slug = ?`,
        [status, note, now, now, now, slug],
      );
      await recordPluginVersion(repo, existing.id, existing.manifest, changelog, now);
    }
  } else if (action === "reject") {
    if (existing.status === "published" && existing.pendingVersion) {
      await repo.run(
        `UPDATE plugins SET pending_version = NULL, pending_manifest = NULL, pending_changelog = NULL,
           review_note = ?, reviewed_at = ?, updated_at = ?
         WHERE slug = ?`,
        [note ? `新版本提交被驳回：${note}` : "新版本提交被驳回", now, now, slug],
      );
    } else {
      status = "rejected";
      await repo.run(
        "UPDATE plugins SET status = ?, review_note = ?, reviewed_at = ?, updated_at = ? WHERE slug = ?",
        [status, note, now, now, slug],
      );
    }
  } else {
    status = "delisted";
    await repo.run(
      "UPDATE plugins SET status = ?, review_note = ?, reviewed_at = ?, updated_at = ? WHERE slug = ?",
      [status, note, now, now, slug],
    );
  }

  const updated = await getPluginBySlug(repo, slug);
  if (!updated) throw new Error("审核后无法读回");
  await repo.audit({
    actor: actor?.actor ?? "admin",
    actorKind: actor?.actorKind,
    action: action === "delist" ? "plugin.delist" : `plugin.review.${action}`,
    target: slug,
    diff: { from: existing.status, to: updated.status, note },
    ip: actor?.ip,
  });
  // R5-1 更新主动提醒：版本号实际递增的上架，给仍装旧版的用户发通知
  // （首次上架/版本号不变时 notify 内直接返回 0，不发）。
  // 提醒是次生效应：初始 SELECT 抛错也不得让审核 500（状态已提交），只记日志。
  if (action === "approve") {
    try {
      await notifyPluginUpdateAvailable(repo, updated, existing.version);
    } catch (err) {
      console.error("[plugins] 更新提醒发送失败（不阻断审核）:", err);
    }
  }
  return updated;
}

/**
 * 写入一次「不改变状态」的审核结论。
 *
 * 用于已上架插件的复审：`reviewPlugin('approve')` 只接受 pending/delisted/quarantined/rejected，
 * 对 published 会抛错；但复审通过时状态本来就该保持 published，只需要刷新
 * review_note / reviewed_at（详情页徽标与 AI 审核报告都从这里读）。
 */
export async function recordPluginAuditNote(
  repo: Repository,
  slug: string,
  note: string | null,
  at: number = Date.now(),
): Promise<PluginRecord> {
  await repo.run(
    "UPDATE plugins SET review_note = ?, reviewed_at = ?, updated_at = ? WHERE slug = ?",
    [note, at, at, slug],
  );
  const updated = await getPluginBySlug(repo, slug);
  if (!updated) throw new Error("审核记录写入后无法读回");
  return updated;
}

/* ------------------------------------------------------------------ *
 * 安装 / 卸载
 * ------------------------------------------------------------------ */

/** 站点包安装时的叶子解析结果：库里那一行的 id + 它在权威树里的位置 */
interface PackLeaf {
  id: string;
  slug: string;
  /** 权威树里的叶子标题；包自己的垂类标题与它不同才算「被折叠」 */
  title: string;
  parentSlug: string;
}

/**
 * 导入去重：URL 的常见等价形态（原文 / 规范化 / 尾斜杠增删）任一命中即视为已存在。
 * 为什么不能只用 findSiteByUrl：落库存的是**原文**，lookup 侧带不带尾斜杠都可能，
 * 两侧都展开比对才能在「https://a.com/」与「https://a.com」之间正确去重。
 */
async function siteUrlExists(repo: Repository, url: string): Promise<boolean> {
  const forms = new Set<string>();
  for (const form of [url.trim(), canonicalizeUrl(url)]) {
    if (!form) continue;
    forms.add(form);
    forms.add(form.endsWith("/") ? form.slice(0, -1) : form + "/");
  }
  const list = [...forms];
  const rows = await repo.raw(
    `SELECT 1 AS ok FROM sites WHERE url IN (${list.map(() => "?").join(",")}) AND deleted_at IS NULL LIMIT 1`,
    list,
  );
  return rows.length > 0;
}

function parseInstallRow(row: Record<string, any>): PluginInstallRecord {
  return {
    pluginId: String(row.plugin_id),
    identity: String(row.identity),
    version: String(row.version),
    meta: parseJson<unknown>(row.meta, null),
    installedAt: Number(row.installed_at ?? 0),
    removedAt: row.removed_at == null ? null : Number(row.removed_at),
    disabledAt: row.disabled_at == null ? null : Number(row.disabled_at),
  };
}

export async function getPluginInstall(
  repo: Repository,
  pluginId: string,
  identity: string,
): Promise<PluginInstallRecord | null> {
  const rows = await repo.raw("SELECT * FROM plugin_installs WHERE plugin_id = ? AND identity = ? LIMIT 1", [
    pluginId,
    identity,
  ]);
  const row = rows[0];
  return row ? parseInstallRow(row) : null;
}

/** 详情页/卡片交互态：某身份对该插件的安装与星标状态 */
export async function pluginInteraction(
  repo: Repository,
  pluginId: string,
  identity: string,
): Promise<{ installed: boolean; starred: boolean }> {
  const who = identity.trim().slice(0, 120);
  if (!who) return { installed: false, starred: false };
  const install = await getPluginInstall(repo, pluginId, who);
  const stars = await repo.raw("SELECT 1 AS ok FROM plugin_stars WHERE plugin_id = ? AND identity = ? LIMIT 1", [
    pluginId,
    who,
  ]);
  return { installed: !!install && install.removedAt === null, starred: stars.length > 0 };
}

export interface PluginInstalledItem {
  install: PluginInstallRecord;
  plugin: PluginRecord;
}

/** 「我的插件」：某身份的活跃安装列表（含插件本体，按安装时间倒序） */
export async function listPluginInstallsByIdentity(
  repo: Repository,
  identity: string,
): Promise<PluginInstalledItem[]> {
  const who = identity.trim().slice(0, 120);
  if (!who) return [];
  const rows = await repo.raw(
    "SELECT * FROM plugin_installs WHERE identity = ? AND removed_at IS NULL ORDER BY installed_at DESC",
    [who],
  );
  if (rows.length === 0) return [];
  // 一次 IN 查询取回全部插件，替代「每条安装记录一次 SELECT」的 N+1。
  const pluginIds = [...new Set(rows.map((r) => String(r.plugin_id)))];
  const pluginRows = (await repo.raw(
    `SELECT * FROM plugins WHERE id IN (${pluginIds.map(() => "?").join(",")})`,
    pluginIds,
  )) as Array<Record<string, unknown>>;
  const pluginById = new Map(pluginRows.map((p) => [String(p.id), p]));
  const items: PluginInstalledItem[] = [];
  for (const row of rows) {
    const pluginRow = pluginById.get(String(row.plugin_id));
    if (!pluginRow) continue;
    items.push({ install: parseInstallRow(row), plugin: rowToPlugin(pluginRow) });
  }
  return items;
}

export interface PluginInstallOptions {
  version?: string;
  selectedSites?: string[];
}

/**
 * 安装时冲突检测（D 批）。
 *
 * 只覆盖服务端能真实判定的两类：
 * - search-pack：目标包的 !前缀已被另一已装包注册——安装会顶掉对方的引擎
 *   （registerSearchPackEngines 是「同前缀新包胜出」语义，旧包的引擎会被移除）；
 *   已禁用的包不算冲突（它的引擎已在客户端注销，不会被顶掉）。
 * - site-pack：目标包与另一已装包收录了同一站点——重复安装不会重复计数，
 *   但用户应知道内容是重复的；禁用不移除站点，故禁用的包仍算冲突方。
 * theme / workspace-preset 不在检测范围：主题激活是客户端显式动作，
 * 预设的看板追加/覆盖由用户在应用时当面选择，服务端无可判定的冲突面。
 * bundle：逐成员递归检测（成员自身不与自己冲突）。
 */
export async function detectInstallConflicts(
  repo: Repository,
  slug: string,
  identity: string,
  options?: { version?: string },
): Promise<PluginInstallConflict[]> {
  const plugin = await getPluginBySlug(repo, slug);
  if (!plugin) throw new Error(`插件不存在：${slug}`);
  if (plugin.status !== "published") {
    throw new Error(`插件状态为 ${plugin.status}，只有已上架（published）插件可以安装`);
  }
  let targetManifest = plugin.manifest;
  if (options?.version && options.version !== plugin.version) {
    const vSnapshot = await getPluginVersion(repo, plugin.id, options.version);
    if (!vSnapshot) throw new Error(`找不到版本 ${options.version} 的历史快照`);
    targetManifest = vSnapshot.manifest;
  }
  const installed = await listPluginInstallsByIdentity(repo, identity);
  const conflicts: PluginInstallConflict[] = [];

  if (targetManifest.kind === "bundle") {
    const members = await resolveBundleMembers(repo, { ...plugin, manifest: targetManifest });
    for (const member of members) {
      if (member.status !== "published") continue;
      const memberConflicts = await detectInstallConflicts(repo, member.slug, identity);
      conflicts.push(...memberConflicts);
    }
    return conflicts;
  }

  if (targetManifest.kind === "search-pack") {
    const engines = (targetManifest.payload as SearchPackPayload).engines ?? [];
    for (const item of installed) {
      if (item.plugin.slug === slug) continue;
      if (item.plugin.kind !== "search-pack") continue;
      // 已禁用的包：引擎已在客户端注销，装新包顶不掉任何东西，不算冲突
      if (item.install.disabledAt !== null) continue;
      const otherEngines = (item.plugin.manifest.payload as SearchPackPayload).engines ?? [];
      for (const other of otherEngines) {
        for (const engine of engines) {
          if (engine.prefix.toLowerCase() !== other.prefix.toLowerCase()) continue;
          const sameUrl = engine.searchUrl === other.searchUrl;
          conflicts.push({
            type: "search-prefix",
            severity: "warn",
            message: sameUrl
              ? `「${engine.prefix}」已被已安装的「${item.plugin.name}」注册为同一检索地址，安装后该前缀仍指向同一地址`
              : `「${engine.prefix}」已被已安装的「${item.plugin.name}」注册，安装后该前缀将改指本插件的检索地址`,
            otherSlug: item.plugin.slug,
            otherName: item.plugin.name,
            detail: { prefix: engine.prefix, sameUrl, otherSearchUrl: other.searchUrl },
          });
        }
      }
    }
    return conflicts;
  }

  if (targetManifest.kind === "site-pack") {
    const targetUrls = new Set(
      ((targetManifest.payload as SitePackPayload).sites ?? []).map((s) => siteUrlKey(s.url)),
    );
    for (const item of installed) {
      if (item.plugin.slug === slug) continue;
      if (item.plugin.kind !== "site-pack") continue;
      const otherUrls = ((item.plugin.manifest.payload as SitePackPayload).sites ?? []).map((s) => s.url);
      const overlap = otherUrls.filter((u) => targetUrls.has(siteUrlKey(u)));
      if (overlap.length === 0) continue;
      conflicts.push({
        type: "site-url",
        severity: "warn",
        message: `与已安装的「${item.plugin.name}」收录了 ${overlap.length} 个相同站点，重复安装不会重复计数`,
        otherSlug: item.plugin.slug,
        otherName: item.plugin.name,
        detail: { overlapCount: overlap.length, sampleUrls: overlap.slice(0, 3) },
      });
    }
    return conflicts;
  }

  return conflicts;
}

export async function installPlugin(
  repo: Repository,
  slug: string,
  identity: string,
  actor?: PluginActor,
  options?: PluginInstallOptions,
): Promise<PluginInstallResult> {
  const plugin = await getPluginBySlug(repo, slug);
  if (!plugin) throw new Error(`插件不存在：${slug}`);
  if (plugin.status !== "published") {
    throw new Error(`插件状态为 ${plugin.status}，只有已上架（published）插件可以安装`);
  }
  let targetManifest = plugin.manifest;
  let targetVersion = plugin.version;
  if (options?.version && options.version !== plugin.version) {
    const vSnapshot = await getPluginVersion(repo, plugin.id, options.version);
    if (!vSnapshot) {
      throw new Error(`找不到版本 ${options.version} 的历史快照`);
    }
    targetManifest = vSnapshot.manifest;
    targetVersion = vSnapshot.version;
  }
  // 兼容性声明（D 批）：要求高于当前应用版本时拒绝安装，不静默装坏。
  // 放在 installPlugin 里，组合包成员递归安装与回滚也同走这道闸。
  const compatError = checkPluginCompat(targetManifest);
  if (compatError) throw new Error(compatError);
  const who = identity.trim().slice(0, 120) || "anonymous";
  const applied: PluginInstallApplied = { sitesAdded: 0, sitesSkipped: 0, categoriesCreated: 0, createdSiteIds: [] };

  if (targetManifest.kind === "bundle") {
    // 单层组合包：先全量预检，再按清单顺序复用 installPlugin。
    // 不在同一事务里包住多个成员（site-pack 自身使用事务）；预检后失败只会留下
    // 已成功的幂等安装，重试可补齐，绝不回滚/删除用户已有数据。
    const members = await resolveBundleMembers(repo, { ...plugin, manifest: targetManifest });
    const bundleItems: PluginBundleInstallItem[] = [];
    const completed: string[] = [];
    for (const member of members) {
      try {
        const result = await installPlugin(repo, member.slug, who, actor);
        const memberApplied = result.applied;
        applied.sitesAdded += memberApplied.sitesAdded;
        applied.sitesSkipped += memberApplied.sitesSkipped;
        applied.categoriesCreated += memberApplied.categoriesCreated;
        applied.createdSiteIds.push(...memberApplied.createdSiteIds);
        applied.categoryGaps = [...new Set([...(applied.categoryGaps ?? []), ...(memberApplied.categoryGaps ?? [])])];
        applied.categoryParentMismatches = [
          ...new Set([
            ...(applied.categoryParentMismatches ?? []),
            ...(memberApplied.categoryParentMismatches ?? []),
          ]),
        ];
        const enginesAdded = memberApplied.enginesAdded ?? 0;
        applied.enginesAdded = (applied.enginesAdded ?? 0) + enginesAdded;
        bundleItems.push({
          slug: member.slug,
          kind: member.kind,
          name: member.name,
          alreadyInstalled: result.alreadyInstalled,
          sitesAdded: memberApplied.sitesAdded,
          sitesSkipped: memberApplied.sitesSkipped,
          enginesAdded,
        });
        completed.push(member.slug);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const done = completed.length > 0 ? completed.join("、") : "无";
        throw new Error(
          `组合包安装中断：${message}。已完成成员：${done}；重试会幂等补全，不会重复计数。`,
        );
      }
    }
    applied.bundleItems = bundleItems;
  }

  if (targetManifest.kind === "site-pack") {
    const payload = targetManifest.payload as SitePackPayload;
    // A-2：selectedSites 一旦传了数组（含空数组）就按它过滤；只有省略
    // （undefined）才表示全量。空数组曾被当成「不过滤」，全不选反装全部。
    const sitesToInstall = Array.isArray(options?.selectedSites)
      ? payload.sites.filter((s) => options!.selectedSites!.includes(s.url))
      : payload.sites;
    await repo.withTransaction(async () => {
      // 只认权威树：安装不再凭空造类目行。`plugin:*` 类目既是 106 个平铺根的成因，
      // 也是「卸载/启动清扫把新树叶子一起吃掉」的反噬入口——不造行，反噬路径自动消失。
      const knownSlugs = new Set<string>();
      for (const category of await repo.listCategories()) {
        if (category.slug) knownSlugs.add(category.slug.toLowerCase());
      }
      const leafCache = new Map<string, PackLeaf | null>();
      async function resolveLeaf(title: string): Promise<PackLeaf | null> {
        const key = title.trim().toLowerCase();
        if (!key) return null;
        if (leafCache.has(key)) return leafCache.get(key)!;
        const entry = resolveRegistryLeaf(title);
        if (!entry) {
          leafCache.set(key, null);
          return null;
        }
        const row = await repo.ensureRegistryCategory(entry.slug);
        if (!row) {
          leafCache.set(key, null);
          return null;
        }
        if (!knownSlugs.has(entry.slug)) {
          knownSlugs.add(entry.slug);
          applied.categoriesCreated++;
        }
        const leaf: PackLeaf = { id: row.id, slug: entry.slug, title: entry.title, parentSlug: entry.parentSlug ?? "" };
        leafCache.set(key, leaf);
        return leaf;
      }

      // 包声明的分类：解析不出就是缺口（站点级还会再兜一次），但绝不建 `plugin:*` 行
      const gapTitles = new Map<string, string>();
      const parentMismatches: string[] = [];
      for (const category of payload.categories ?? []) {
        const leaf = await resolveLeaf(category.title);
        if (!leaf) {
          const key = category.title.trim().toLowerCase();
          if (key) gapTitles.set(key, category.title.trim());
          continue;
        }
        const declared = (category.parentCategory ?? "").trim();
        if (!declared) continue;
        const declaredRoot = resolveRegistryEntry(declared);
        if (!declaredRoot || declaredRoot.slug !== leaf.parentSlug) {
          parentMismatches.push(`${category.title.trim()}（声明父级「${declared}」≠ 权威树「${leaf.parentSlug}」）`);
        }
      }

      let uncategorizedId: string | null = null;
      // 单分类包（旧夹具常见写法）：站点不重复写 category，包声明的那一个就是默认桶
      const defaultTitle = payload.categories?.length === 1 ? (payload.categories[0]?.title ?? "").trim() : "";
      for (const site of sitesToInstall) {
        if (await siteUrlExists(repo, site.url)) {
          applied.sitesSkipped++;
          continue;
        }
        const rawTitle = (site.category ?? "").trim() || defaultTitle;
        const primary = await resolveLeaf(rawTitle);
        if (!primary && rawTitle) gapTitles.set(rawTitle.toLowerCase(), rawTitle);
        let categoryId = primary?.id ?? null;
        if (!categoryId) {
          uncategorizedId ??= await repo.ensureUncategorized();
          categoryId = uncategorizedId;
        }
        // 二级只作「同根兄弟叶子」的细化：跨根会把站点计到两个一级根名下（dashboard 双算）
        const subTitle = site.subCategory?.trim();
        let subCategoryId: string | null = null;
        if (subTitle && primary) {
          const sub = await resolveLeaf(subTitle);
          if (sub && sub.parentSlug === primary.parentSlug && sub.slug !== primary.slug) {
            subCategoryId = sub.id;
          }
        }
        // 包自己的垂类标题（如「赛车与赛事」）在权威树里塌进同一个叶子（「汽车与驾驶」）时，
        // 那层细分在树上已无处安放——只剩标签能接住（方案 §2.4「解析不出就只留 tags」）。
        // 不这么做的话，一个垂类包装完就是 200 站平铺在一个叶子里，浏览层级全丢。
        const tagNames: string[] = [];
        const pushTag = (name: string | undefined | null) => {
          const t = (name ?? "").trim();
          if (!t || t.length > PLUGIN_LIMITS.maxTagChars) return;
          if (tagNames.length >= PLUGIN_LIMITS.maxSiteTags) return;
          if (tagNames.some((x) => x.toLowerCase() === t.toLowerCase())) return;
          tagNames.push(t);
        };
        for (const t of site.tags ?? []) pushTag(t);
        if (primary && rawTitle && rawTitle !== primary.title) pushTag(rawTitle);
        const created = await repo.createSiteWithId({
          id: randomUUID(),
          url: site.url,
          title: site.title,
          description: site.description ?? null,
          categoryId,
          subCategoryId,
          tags: tagNames,
          status: "active",
          enabled: true,
          source: `plugin:${slug}`,
        });
        applied.sitesAdded++;
        applied.createdSiteIds.push(created.id);
      }

      // 缺口交给人工判定：站点已落未分类，采纳时再决定「挂在哪个根下、叫什么」
      for (const title of gapTitles.values()) {
        await repo.recordCategoryGap({
          title,
          source: `站点包「${plugin.name}」安装`,
          reasonNote: "该标题既不在权威树里、也没有 legacyTitles 归宿；请判定是并入现有叶子还是新建叶子。",
        });
      }
      if (gapTitles.size > 0) applied.categoryGaps = [...gapTitles.values()];
      if (parentMismatches.length > 0) applied.categoryParentMismatches = parentMismatches;
    });
  }

  if (targetManifest.kind === "search-pack") {
    const payload = targetManifest.payload as any;
    applied.enginesAdded = Array.isArray(payload?.engines) ? payload.engines.length : 0;
  }

  const now = Date.now();
  const existingInstall = await getPluginInstall(repo, plugin.id, who);
  const wasActive = !!existingInstall && existingInstall.removedAt === null;
  const meta = JSON.stringify({ ...applied, manifest: targetManifest });
  if (existingInstall) {
    await repo.run(
      "UPDATE plugin_installs SET version = ?, meta = ?, installed_at = ?, removed_at = NULL WHERE plugin_id = ? AND identity = ?",
      [targetVersion, meta, now, plugin.id, who],
    );
  } else {
    await repo.run(
      "INSERT INTO plugin_installs (plugin_id, identity, version, meta, installed_at, removed_at) VALUES (?,?,?,?,?,NULL)",
      [plugin.id, who, targetVersion, meta, now],
    );
  }
  if (!wasActive) {
    // 相对自增，不能写「读到的快照 + 1」：plugin 是函数开头读的、这行又在事务外，
    // 两个身份并发首装会各自读到同一个 N 再写回 N+1，丢掉一次安装（星标计数早已是这种写法）。
    await repo.run("UPDATE plugins SET install_count = install_count + 1 WHERE id = ?", [plugin.id]);
  }
  await repo.audit({
    actor: actor?.actor ?? who,
    actorKind: actor?.actorKind ?? "identity",
    action: "plugin.install",
    target: slug,
    diff: {
      version: targetVersion,
      sitesAdded: applied.sitesAdded,
      sitesSkipped: applied.sitesSkipped,
      categoriesCreated: applied.categoriesCreated,
    },
    ip: actor?.ip,
  });
  const refreshed = await getPluginBySlug(repo, slug);
  const install = await getPluginInstall(repo, plugin.id, who);
  if (!refreshed || !install) throw new Error("安装后无法读回插件状态");
  return { plugin: refreshed, install, alreadyInstalled: wasActive, applied };
}

export interface PluginRollbackResult extends PluginInstallResult {
  /** 回滚前已安装的版本 */
  rolledBackFrom: string;
  /** 回滚目标版本（安装记录写回的版本与之一致，不再是“版本号撒谎”） */
  rolledBackTo: string;
  /** 本次移除的新版独有站点数（软删除，可恢复） */
  sitesRemoved: number;
}

/** 站点 URL 归一键：与 siteUrlExists 同一套规范化（去首尾空白、canonicalize、去尾斜杠）。 */
function siteUrlKey(url: string): string {
  const c = canonicalizeUrl(url.trim()) || url.trim();
  return c.endsWith("/") ? c.slice(0, -1) : c;
}

/**
 * 真实回滚到历史版本（B-1）。
 *
 * 旧行为（时间轴「安装/回滚此版本」只调 install(version)）是假的：
 * 服务端只新增不删除——新版独有站点留在库里、安装记录却写成旧版本号，
 * 数据是新旧并集、版本号撒谎；主题/搜索包的客户端重应用也没做。
 *
 * 本函数的回滚语义（写进安装记录的版本号必须与实际内容一致）：
 *   1. 目标版本必须低于已安装版本（升级走安装，不走回滚）且历史快照存在；
 *   2. site-pack：先移除「已装版有、目标版没有」的插件来源站点（软删除，
 *      只动 source=plugin:<slug> 的行，用户自己改过来源的站点不受影响；
 *      有其他身份仍活跃安装时直接拒绝——删不干净就不能把版本号写成旧版，
 *      与卸载的共享保护同一条红线），再按目标清单安装（补回旧版独有站点）；
 *   3. 其余类型服务端本就没有按用户落库的状态可删，直接按目标清单安装，
 *      客户端重应用（主题 tokens / 搜索包 !前缀）由调用方在成功后做；
 *   4. 找不到已装版清单快照时直接报错，不猜差集。
 */
export async function rollbackPlugin(
  repo: Repository,
  slug: string,
  identity: string,
  targetVersion: string,
  actor?: PluginActor,
): Promise<PluginRollbackResult> {
  const plugin = await getPluginBySlug(repo, slug);
  if (!plugin) throw new Error(`插件不存在：${slug}`);
  if (plugin.status !== "published") {
    throw new Error(`插件状态为 ${plugin.status}，只有已上架（published）插件可以回滚`);
  }
  const who = identity.trim().slice(0, 120) || "anonymous";
  const install = await getPluginInstall(repo, plugin.id, who);
  if (!install || install.removedAt !== null) {
    throw new Error("尚未安装该插件，回滚前请先安装");
  }
  const fromVersion = install.version;
  if (comparePluginVersions(targetVersion, fromVersion) >= 0) {
    throw new Error(`回滚目标 v${targetVersion} 不低于已安装版本 v${fromVersion}，升级请用安装`);
  }
  const targetSnapshot = await getPluginVersion(repo, plugin.id, targetVersion);
  if (!targetSnapshot) {
    throw new Error(`找不到版本 ${targetVersion} 的历史快照`);
  }
  const targetManifest = targetSnapshot.manifest;
  let sitesRemoved = 0;
  if (targetManifest.kind === "site-pack") {
    // 当前已装版的清单：优先版本历史快照，其次安装记录 meta 里的清单
    const fromSnapshot = await getPluginVersion(repo, plugin.id, fromVersion);
    const fromManifest = fromSnapshot?.manifest ?? (await getPluginInstalledManifest(repo, plugin.id, who));
    if (!fromManifest || fromManifest.kind !== "site-pack") {
      throw new Error(`找不到已安装版本 v${fromVersion} 的清单快照，无法计算回滚差集`);
    }
    const targetUrls = new Set(
      ((targetManifest.payload as SitePackPayload).sites ?? []).map((s) => siteUrlKey(s.url)),
    );
    const removedUrls = ((fromManifest.payload as SitePackPayload).sites ?? [])
      .map((s) => s.url)
      .filter((u) => !targetUrls.has(siteUrlKey(u)));
    if (removedUrls.length > 0) {
      const otherActiveInstalls = await repo.raw(
        "SELECT 1 FROM plugin_installs WHERE plugin_id = ? AND identity != ? AND removed_at IS NULL LIMIT 1",
        [plugin.id, who],
      );
      if (otherActiveInstalls.length > 0) {
        throw new Error("有其他用户仍在使用新版，无法移除新版独有站点，回滚已取消（你的安装未改动）");
      }
      const removedKeys = new Set(removedUrls.map((u) => siteUrlKey(u)));
      const rows = await repo.raw("SELECT id, url FROM sites WHERE source = ? AND deleted_at IS NULL", [
        `plugin:${slug}`,
      ]);
      for (const row of rows) {
        if (!removedKeys.has(siteUrlKey(String(row.url)))) continue;
        await repo.deleteSite(String(row.id));
        sitesRemoved++;
      }
    }
  }
  const installed = await installPlugin(repo, slug, who, actor, { version: targetVersion });
  await repo.audit({
    actor: actor?.actor ?? who,
    actorKind: actor?.actorKind ?? "identity",
    action: "plugin.rollback",
    target: slug,
    diff: {
      from: fromVersion,
      to: targetVersion,
      sitesRemoved,
      sitesAdded: installed.applied.sitesAdded,
      sitesSkipped: installed.applied.sitesSkipped,
    },
    ip: actor?.ip,
  });
  return { ...installed, rolledBackFrom: fromVersion, rolledBackTo: targetVersion, sitesRemoved };
}

export async function uninstallPlugin(
  repo: Repository,
  slug: string,
  identity: string,
  options: { removeSites?: boolean } = {},
  actor?: PluginActor,
): Promise<PluginUninstallResult> {
  const plugin = await getPluginBySlug(repo, slug);
  if (!plugin) throw new Error(`插件不存在：${slug}`);
  const who = identity.trim().slice(0, 120) || "anonymous";
  const install = await getPluginInstall(repo, plugin.id, who);
  if (!install || install.removedAt !== null) {
    return { removed: false, removedSites: 0, removedCategories: 0, plugin };
  }
  let removedSites = 0;
  let removedCategories = 0;
  // 组合包只解绑自身，不级联卸载成员，也不删除成员带来的站点/主题/预设。
  if (options.removeSites && plugin.kind === "site-pack") {
    // 检查是否有其他身份依然活跃安装此插件；若有，绝不可级联删除共享站点与分类！
    const otherActiveInstalls = await repo.raw(
      "SELECT 1 FROM plugin_installs WHERE plugin_id = ? AND identity != ? AND removed_at IS NULL LIMIT 1",
      [plugin.id, who],
    );
    const hasOtherActiveInstalls = otherActiveInstalls.length > 0;

    if (!hasOtherActiveInstalls) {
      // 1. 只软删「来源仍是该插件」的站点（用户改过的来源已变，不会被误伤）；进回收站可恢复
      const rows = await repo.raw("SELECT id FROM sites WHERE source = ? AND deleted_at IS NULL", [`plugin:${slug}`]);
      for (const row of rows) {
        await repo.deleteSite(String(row.id));
        removedSites++;
      }

      // 2. 同步清理该插件创建的网址分类与子分类
      const pluginCats = await repo.raw(
        "SELECT id, parent_id FROM categories WHERE source = ?",
        [`plugin:${slug}`]
      );
      // 子分类排在前面优先清理，避免外键或 anchor 约束问题
      pluginCats.sort((a: any, b: any) => {
        const aIsChild = a.parent_id ? 1 : 0;
        const bIsChild = b.parent_id ? 1 : 0;
        return bIsChild - aIsChild;
      });

      for (const cat of pluginCats) {
        // 检查是否有非本插件来源的站点。回收站里的站点也算引用：直接 DELETE 分类
        // 会在恢复站点时把它扔进「未分类」（schema 没有外键，甚至留下悬空 category_id）。
        // 本插件来源的站点在上一步已软删、且用户明确要求 removeSites，不阻止清理。
        const otherSites = await repo.raw(
          "SELECT 1 AS ok FROM sites WHERE (category_id = ? OR sub_category_id = ?) AND source != ? LIMIT 1",
          [cat.id, cat.id, `plugin:${slug}`],
        );
        if (otherSites.length > 0) {
          // 用户数据（含回收站）仍引用该分类，保留并把 source 转为 api，避免误删
          await repo.run("UPDATE categories SET source = 'api', updated_at = ? WHERE id = ?", [Date.now(), cat.id]);
        } else {
          // 只有本插件的站点引用，彻底删除分类
          await repo.deleteCategory(String(cat.id));
          removedCategories++;
        }
      }
    }
  }
  await repo.run("UPDATE plugin_installs SET removed_at = ? WHERE plugin_id = ? AND identity = ?", [
    Date.now(),
    plugin.id,
    who,
  ]);
  // 同上：卸载与安装可能并发，用 SQL 内的条件递减代替「快照 - 1」，
  // 既不会覆盖并发的自增，也不会因两次并发卸载把计数减成负数。
  await repo.run("UPDATE plugins SET install_count = CASE WHEN install_count > 0 THEN install_count - 1 ELSE 0 END WHERE id = ?", [
    plugin.id,
  ]);
  await repo.audit({
    actor: actor?.actor ?? who,
    actorKind: actor?.actorKind ?? "identity",
    action: "plugin.uninstall",
    target: slug,
    diff: { version: install.version, removedSites, removedCategories },
    ip: actor?.ip,
  });
  const refreshed = await getPluginBySlug(repo, slug);
  if (!refreshed) throw new Error("卸载后无法读回插件状态");
  return { removed: true, removedSites, removedCategories, plugin: refreshed };
}

export interface PluginDisableResult {
  plugin: PluginRecord;
  install: PluginInstallRecord;
  /** true = 本次调用改了状态；false = 已经是目标状态（幂等） */
  changed: boolean;
}

/**
 * 禁用已安装插件（D 批）。
 *
 * 语义（按类型如实区分，已安装页文案与之一致）：
 * - 全部类型：安装记录打 disabled_at 标记，版本与数据不动；再启用一键恢复，
 *   不必重新安装；
 * - theme / search-pack：运行效果由客户端在禁用/启用时同步停用/恢复
 *   （主题回落默认、搜索引擎注销注册），服务端只记状态；
 * - site-pack / workspace-preset / bundle：已导入的站点/看板保留原处
 *   （它们已是公共收录或用户数据，单用户禁用不能替别人删数据），
 *   禁用只停后续效果、不丢数据。
 * 未安装 / 已卸载时抛错；已禁用时幂等成功（changed=false）。
 */
export async function disablePluginInstall(
  repo: Repository,
  slug: string,
  identity: string,
  actor?: PluginActor,
): Promise<PluginDisableResult> {
  const plugin = await getPluginBySlug(repo, slug);
  if (!plugin) throw new Error(`插件不存在：${slug}`);
  const who = identity.trim().slice(0, 120) || "anonymous";
  const install = await getPluginInstall(repo, plugin.id, who);
  if (!install || install.removedAt !== null) {
    throw new Error("尚未安装该插件，禁用前请先安装");
  }
  if (install.disabledAt !== null) {
    return { plugin, install, changed: false };
  }
  const now = Date.now();
  await repo.run("UPDATE plugin_installs SET disabled_at = ? WHERE plugin_id = ? AND identity = ?", [
    now,
    plugin.id,
    who,
  ]);
  await repo.audit({
    actor: actor?.actor ?? who,
    actorKind: actor?.actorKind ?? "identity",
    action: "plugin.disable",
    target: slug,
    diff: { version: install.version },
    ip: actor?.ip,
  });
  const updated = await getPluginInstall(repo, plugin.id, who);
  if (!updated) throw new Error("禁用后无法读回安装记录");
  return { plugin, install: updated, changed: true };
}

/** 启用已禁用的插件（与 disablePluginInstall 对称；未禁用时幂等成功）。 */
export async function enablePluginInstall(
  repo: Repository,
  slug: string,
  identity: string,
  actor?: PluginActor,
): Promise<PluginDisableResult> {
  const plugin = await getPluginBySlug(repo, slug);
  if (!plugin) throw new Error(`插件不存在：${slug}`);
  const who = identity.trim().slice(0, 120) || "anonymous";
  const install = await getPluginInstall(repo, plugin.id, who);
  if (!install || install.removedAt !== null) {
    throw new Error("尚未安装该插件，启用前请先安装");
  }
  if (install.disabledAt === null) {
    return { plugin, install, changed: false };
  }
  await repo.run("UPDATE plugin_installs SET disabled_at = NULL WHERE plugin_id = ? AND identity = ?", [
    plugin.id,
    who,
  ]);
  await repo.audit({
    actor: actor?.actor ?? who,
    actorKind: actor?.actorKind ?? "identity",
    action: "plugin.enable",
    target: slug,
    diff: { version: install.version },
    ip: actor?.ip,
  });
  const updated = await getPluginInstall(repo, plugin.id, who);
  if (!updated) throw new Error("启用后无法读回安装记录");
  return { plugin, install: updated, changed: true };
}

/* ------------------------------------------------------------------ *
 * 星标 / 举报
 * ------------------------------------------------------------------ */

/**
 * 星标探测（备份导入重放用）：返回插件是否已被该身份星标；
 * 插件已不存在时返回 null——「插件没了」和「已经标过」是两个不同的跳过原因。
 */
export async function isPluginStarredBySlug(
  repo: Repository,
  slug: string,
  identity: string,
): Promise<boolean | null> {
  const plugin = await getPluginBySlug(repo, slug);
  if (!plugin) return null;
  const who = identity.trim().slice(0, 120) || "anonymous";
  const row = (
    await repo.raw("SELECT 1 AS ok FROM plugin_stars WHERE plugin_id = ? AND identity = ? LIMIT 1", [
      plugin.id,
      who,
    ])
  )[0];
  return Boolean(row);
}

/**
 * 举报身份解析（插件举报与评价举报共用）。
 * 字面量 "anonymous" 视作无身份：路由层用它作占位时，actor.ip 仍应作为回退，
 * 否则所有无头匿名举报共享同一身份、互相去重丢弃，却又回“已受理”。
 * 优先级：显式身份 → actor（非 anonymous 者）→ 调用方 IP → "anonymous"。
 */
function resolveReporterIdentity(identity: string | undefined, actor?: PluginActor): string {
  const direct = (identity ?? "").trim();
  if (direct && direct !== "anonymous") return direct.slice(0, 120);
  const actorName = (actor?.actor ?? "").trim();
  if (actorName && actorName !== "anonymous") return actorName.slice(0, 120);
  const ip = (actor?.ip ?? "").trim();
  if (ip) return `ip:${ip}`.slice(0, 120);
  return "anonymous";
}

export async function starPlugin(
  repo: Repository,
  slug: string,
  identity: string,
): Promise<{ starred: boolean; starCount: number }> {
  const plugin = await getPluginBySlug(repo, slug);
  if (!plugin) throw new Error(`插件不存在：${slug}`);
  // R4-6：只有已上架插件可被星标。待审/下架包 star 直接 400（路由映射），
  // 不写星标。unstar 刻意不加此门禁：已星标用户应能取消对下架包的星标，
  // 那是清理路径，不是新的认可。
  if (plugin.status !== "published") {
    throw new Error(`插件未上架或不存在：${slug}`);
  }
  const who = identity.trim().slice(0, 120) || "anonymous";
  // 幂等插入 + 相对自增放在同一事务：并发的重复点赞不会把计数推高，
  // 也不会用读到的旧值覆盖别的写入者刚加上的 star。
  await repo.withTransaction(async () => {
    const inserted = await repo.runCount(
      "INSERT INTO plugin_stars (plugin_id, identity, created_at) VALUES (?,?,?) ON CONFLICT (plugin_id, identity) DO NOTHING",
      [plugin.id, who, Date.now()],
    );
    if (inserted > 0) {
      await repo.run("UPDATE plugins SET star_count = star_count + 1 WHERE id = ?", [plugin.id]);
    }
  });
  const rows = await repo.raw("SELECT star_count FROM plugins WHERE id = ?", [plugin.id]);
  return { starred: true, starCount: Number(rows[0]?.star_count ?? plugin.starCount) };
}

export async function unstarPlugin(
  repo: Repository,
  slug: string,
  identity: string,
): Promise<{ starred: boolean; starCount: number }> {
  const plugin = await getPluginBySlug(repo, slug);
  if (!plugin) throw new Error(`插件不存在：${slug}`);
  const who = identity.trim().slice(0, 120) || "anonymous";
  await repo.withTransaction(async () => {
    const removed = await repo.runCount("DELETE FROM plugin_stars WHERE plugin_id = ? AND identity = ?", [plugin.id, who]);
    if (removed > 0) {
      await repo.run(
        "UPDATE plugins SET star_count = CASE WHEN star_count > 0 THEN star_count - 1 ELSE 0 END WHERE id = ?",
        [plugin.id],
      );
    }
  });
  const rows = await repo.raw("SELECT star_count FROM plugins WHERE id = ?", [plugin.id]);
  return { starred: false, starCount: Number(rows[0]?.star_count ?? plugin.starCount) };
}

export async function reportPlugin(
  repo: Repository,
  slug: string,
  input: { reason: string; identity?: string },
  actor?: PluginActor,
): Promise<{ reportCount: number; status: PluginStatus; quarantined: boolean; deduplicated: boolean }> {
  const plugin = await getPluginBySlug(repo, slug);
  if (!plugin) throw new Error(`插件不存在：${slug}`);
  const reason = input.reason.trim().slice(0, 500) || "（未填写理由）";
  const identity = resolveReporterIdentity(input.identity, actor);
  const ip = actor?.ip ?? null;
  const now = Date.now();

  // R4-8：原子去重。INSERT ... ON CONFLICT DO NOTHING + runCount 判是否新增，
  // 替代“先 SELECT 再 INSERT + catch {} 吞错”：并发同身份举报只会有一方真正
  // 写入，另一方 inserted=0；真实表异常不再被吞，会正常上抛。
  // R4-4：取消静默自动下架。举报只计数 + 进治理告警，不再直接改 status；
  // 隔离改由管理员在管理端决定（quarantinePlugin）。quarantined 字段保留
  // 作调用方兼容，恒为 false。
  let isNewReport = false;
  let reportCount = plugin.reportCount;
  await repo.withTransaction(async () => {
    const inserted = await repo.runCount(
      "INSERT INTO plugin_reports (plugin_id, identity, ip, reason, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (plugin_id, identity) DO NOTHING",
      [plugin.id, identity, ip, reason, now],
    );
    if (inserted > 0) {
      isNewReport = true;
      await repo.run("UPDATE plugins SET report_count = report_count + 1, updated_at = ? WHERE id = ?", [
        now,
        plugin.id,
      ]);
    }
  });
  if (isNewReport) {
    const rows = await repo.raw("SELECT report_count FROM plugins WHERE id = ?", [plugin.id]);
    reportCount = Number(rows[0]?.report_count ?? plugin.reportCount + 1);
  }

  await repo.recordEvent("plugin_report", {
    identity: input.identity,
    meta: { slug, reason, reportCount, deduplicated: !isNewReport, quarantined: false },
  });

  await repo.audit({
    actor: actor?.actor ?? input.identity ?? "anonymous",
    actorKind: actor?.actorKind ?? "identity",
    action: "plugin.report",
    target: slug,
    diff: { reason, reportCount, isNewReport, quarantined: false },
    ip: actor?.ip,
  });

  return { reportCount, status: plugin.status, quarantined: false, deduplicated: !isNewReport };
}

/** 管理员/治理系统人工执行隔离处置 */
export async function quarantinePlugin(
  repo: Repository,
  slug: string,
  reason: string,
  actor?: PluginActor,
): Promise<PluginRecord> {
  const plugin = await getPluginBySlug(repo, slug);
  if (!plugin) throw new Error(`插件不存在：${slug}`);
  const now = Date.now();
  await repo.run(
    "UPDATE plugins SET status = 'quarantined', review_note = ?, updated_at = ? WHERE id = ?",
    [`人工隔离处置：${reason}`, now, plugin.id],
  );
  await repo.audit({
    actor: actor?.actor ?? "admin",
    actorKind: actor?.actorKind ?? "admin",
    action: "plugin.quarantine",
    target: slug,
    diff: { from: plugin.status, to: "quarantined", reason },
    ip: actor?.ip,
  });
  const updated = await getPluginBySlug(repo, slug);
  if (!updated) throw new Error("隔离后无法读回");
  return updated;
}

export async function hasUserStarredPlugin(
  repo: Repository,
  pluginId: string,
  identity: string,
): Promise<boolean> {
  const who = identity.trim().slice(0, 120);
  if (!who) return false;
  const rows = await repo.raw("SELECT 1 AS ok FROM plugin_stars WHERE plugin_id = ? AND identity = ? LIMIT 1", [
    pluginId,
    who,
  ]);
  return Boolean(rows[0]);
}

/**
 * 列表星标标注：某身份点亮过的全部插件 id，一次查询。
 * 与 listPluginInstallsByIdentity 同款批量口径，不逐条 hasUserStarredPlugin。
 */
export async function listStarredPluginIdsByIdentity(
  repo: Repository,
  identity: string,
): Promise<string[]> {
  const who = identity.trim().slice(0, 120);
  if (!who) return [];
  const rows = await repo.raw("SELECT plugin_id FROM plugin_stars WHERE identity = ?", [who]);
  return rows.map((r) => String(r.plugin_id));
}

/** 获取某用户安装时保留的清单快照 */
export async function getPluginInstalledManifest(
  repo: Repository,
  pluginId: string,
  identity: string,
): Promise<PluginManifest | null> {
  const install = await getPluginInstall(repo, pluginId, identity);
  if (!install || !install.meta || typeof install.meta !== "object") return null;
  const metaObj = install.meta as Record<string, unknown>;
  if (metaObj.manifest && typeof metaObj.manifest === "object") {
    return metaObj.manifest as PluginManifest;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 插件生态遥测与大盘指标 (Plugin Ecosystem Telemetry)
 * ------------------------------------------------------------------ */

export interface PluginTelemetryMetrics {
  totalPlugins: number;
  publishedCount: number;
  pendingCount: number;
  rejectedCount: number;
  delistedCount: number;
  quarantinedCount: number;
  totalInstalls: number;
  activeInstalls: number;
  totalStars: number;
  totalReports: number;
  kindDistribution: {
    sitePack: number;
    workspacePreset: number;
    theme: number;
    searchPack: number;
    bundle: number;
  };
  topInstalled: Array<{
    id: string;
    slug: string;
    name: string;
    kind: string;
    version: string;
    installCount: number;
    starCount: number;
  }>;
}

export async function getPluginTelemetry(repo: Repository): Promise<PluginTelemetryMetrics> {
  const statRows = await repo.raw(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN status = 'delisted' THEN 1 ELSE 0 END) AS delisted,
      SUM(CASE WHEN status = 'quarantined' THEN 1 ELSE 0 END) AS quarantined,
      COALESCE(SUM(install_count), 0) AS total_installs,
      COALESCE(SUM(report_count), 0) AS total_reports,
      SUM(CASE WHEN kind = 'site-pack' AND status = 'published' THEN 1 ELSE 0 END) AS site_packs,
      SUM(CASE WHEN kind = 'workspace-preset' AND status = 'published' THEN 1 ELSE 0 END) AS workspace_presets,
      SUM(CASE WHEN kind = 'theme' AND status = 'published' THEN 1 ELSE 0 END) AS themes,
      SUM(CASE WHEN kind = 'search-pack' AND status = 'published' THEN 1 ELSE 0 END) AS search_packs,
      SUM(CASE WHEN kind = 'bundle' AND status = 'published' THEN 1 ELSE 0 END) AS bundles
    FROM plugins
  `);

  const stat = statRows[0] ?? {};

  const activeRow = (await repo.raw("SELECT COUNT(*) AS cnt FROM plugin_installs WHERE removed_at IS NULL"))[0];
  const starRow = (await repo.raw("SELECT COUNT(*) AS cnt FROM plugin_stars"))[0];

  const topRows = await repo.raw(`
    SELECT id, slug, name, kind, version, install_count, star_count
    FROM plugins
    WHERE status = 'published'
    ORDER BY install_count DESC, star_count DESC
    LIMIT 5
  `);

  return {
    totalPlugins: Number(stat.total ?? 0),
    publishedCount: Number(stat.published ?? 0),
    pendingCount: Number(stat.pending ?? 0),
    rejectedCount: Number(stat.rejected ?? 0),
    delistedCount: Number(stat.delisted ?? 0),
    quarantinedCount: Number(stat.quarantined ?? 0),
    totalInstalls: Number(stat.total_installs ?? 0),
    activeInstalls: Number(activeRow?.cnt ?? 0),
    totalStars: Number(starRow?.cnt ?? 0),
    totalReports: Number(stat.total_reports ?? 0),
    kindDistribution: {
      sitePack: Number(stat.site_packs ?? 0),
      workspacePreset: Number(stat.workspace_presets ?? 0),
      theme: Number(stat.themes ?? 0),
      searchPack: Number(stat.search_packs ?? 0),
      bundle: Number(stat.bundles ?? 0),
    },
    topInstalled: topRows.map((r) => ({
      id: String(r.id),
      slug: String(r.slug),
      name: String(r.name),
      kind: String(r.kind),
      version: String(r.version),
      installCount: Number(r.install_count ?? 0),
      starCount: Number(r.star_count ?? 0),
    })),
  };
}

/* ------------------------------------------------------------------ *
 * 版本历史快照 (Plugin Versions)
 * ------------------------------------------------------------------ */

export function computeManifestChecksum(manifest: PluginManifest): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

function rowToPluginVersion(row: Record<string, any>): PluginVersionRecord {
  return {
    id: String(row.id),
    pluginId: String(row.plugin_id),
    version: String(row.version),
    manifest: parseJson<PluginManifest>(row.manifest, {} as any),
    changelog: row.changelog == null ? null : String(row.changelog),
    checksum: String(row.checksum ?? ""),
    publishedAt: Number(row.published_at ?? 0),
    createdAt: Number(row.created_at ?? 0),
  };
}

export async function recordPluginVersion(
  repo: Repository,
  pluginId: string,
  manifest: PluginManifest,
  changelog?: string | null,
  publishedAt?: number,
): Promise<PluginVersionRecord> {
  const version = manifest.version;
  const checksum = computeManifestChecksum(manifest);
  const now = Date.now();
  const pubTime = publishedAt ?? now;

  const existing = await repo.raw(
    "SELECT * FROM plugin_versions WHERE plugin_id = ? AND version = ? LIMIT 1",
    [pluginId, version],
  );
  if (existing[0]) {
    return rowToPluginVersion(existing[0]);
  }

  const id = randomUUID();
  await repo.run(
    "INSERT INTO plugin_versions (id, plugin_id, version, manifest, changelog, checksum, published_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, pluginId, version, JSON.stringify(manifest), changelog ?? null, checksum, pubTime, now],
  );

  const row = (await repo.raw("SELECT * FROM plugin_versions WHERE id = ? LIMIT 1", [id]))[0];
  if (!row) throw new Error("版本快照记录后无法读回");
  return rowToPluginVersion(row);
}

export async function listPluginVersions(
  repo: Repository,
  pluginId: string,
): Promise<PluginVersionRecord[]> {
  const rows = await repo.raw(
    "SELECT * FROM plugin_versions WHERE plugin_id = ? ORDER BY published_at DESC, created_at DESC",
    [pluginId],
  );
  return rows.map(rowToPluginVersion);
}

export async function getPluginVersion(
  repo: Repository,
  pluginId: string,
  version: string,
): Promise<PluginVersionRecord | null> {
  const rows = await repo.raw(
    "SELECT * FROM plugin_versions WHERE plugin_id = ? AND version = ? LIMIT 1",
    [pluginId, version],
  );
  return rows[0] ? rowToPluginVersion(rows[0]) : null;
}

/* ------------------------------------------------------------------ *
 * 用户真实评价与评分 (Plugin Reviews)
 * ------------------------------------------------------------------ */

function rowToPluginReview(row: Record<string, any>): PluginReviewRecord {
  return {
    id: String(row.id),
    pluginId: String(row.plugin_id),
    identity: String(row.identity),
    rating: Number(row.rating),
    title: row.title == null ? null : String(row.title),
    content: row.content == null ? null : String(row.content),
    installedVersion: String(row.installed_version ?? ""),
    status: String(row.status ?? "visible"),
    reportCount: Number(row.report_count ?? 0),
    moderationNote: row.moderation_note == null ? null : String(row.moderation_note),
    moderatedAt: row.moderated_at == null ? null : Number(row.moderated_at),
    moderatedBy: row.moderated_by == null ? null : String(row.moderated_by),
    authorReply: row.author_reply == null ? null : String(row.author_reply),
    authorRepliedAt: row.author_replied_at == null ? null : Number(row.author_replied_at),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

export async function createPluginReview(
  repo: Repository,
  slug: string,
  identity: string,
  input: { rating: number; title?: string | null; content?: string | null },
  actor?: PluginActor,
): Promise<PluginReviewRecord> {
  const plugin = await getPluginBySlug(repo, slug);
  if (!plugin) throw new Error(`插件不存在：${slug}`);
  const who = identity.trim().slice(0, 120);
  if (!who) throw new Error("必须提供有效用户身份才能提交评价");

  // 写面门禁（A-1b）：只有已上架（published）插件接受新评价提交（含更新旧评价，
  // createPluginReview 是 upsert）。下架/待审/驳回等非 published 状态一律拒绝，
  // 与读面门禁（详情/相似/徽章：非 published 视作不存在）同口径；与安装门禁
  // （installPlugin：非 published 拒装）同为无例外口径，作者/管理员也不放宽。
  // 放在安装门禁之前：未上架插件的未安装用户先吃「未上架」而非「未安装」。
  // 另一写入口（/api/me/import 的评价重放）同走此处：未上架插件的评价只跳过、不恢复。
  if (plugin.status !== "published") {
    throw new Error(`插件未上架（${plugin.status}），暂不接受新评价`);
  }

  // 门禁（B-3）：新评价仍需活跃安装；但「修改自己已有的评价」不再要求
  // 活跃安装——用户卸载后连改错字都被锁死是 bug。先查已有评价，有则放行
  // 修改（installed_version 沿用评价当时的版本，不再被卸载清空）。
  const existingRow = (await repo.raw(
    "SELECT id, installed_version FROM plugin_reviews WHERE plugin_id = ? AND identity = ? LIMIT 1",
    [plugin.id, who],
  ))[0];
  const install = await getPluginInstall(repo, plugin.id, who);
  if (!existingRow && (!install || install.removedAt !== null)) {
    throw new Error("只有已安装该插件的用户才能发表评价与打分");
  }

  const rating = Math.min(5, Math.max(1, Math.round(Number(input.rating))));
  if (isNaN(rating)) throw new Error("评分必须为 1 到 5 之间的整数");

  // R4-10：与路由校验同口径（标题 ≤200 字、正文 ≤4000 字），超长时明确报错
  // 而不是静默截断。路由先校验，存储层再守一道（覆盖 /api/me/import 的
  // 评价重放等非路由写入口——超长评价落入 reviewsSkippedInvalid 计数）。
  const now = Date.now();
  const title = input.title ? input.title.trim() : null;
  const content = input.content ? input.content.trim() : null;
  if (title !== null && title.length > 200) {
    throw new Error("评价标题不能超过 200 字");
  }
  if (content !== null && content.length > 4000) {
    throw new Error("评价正文不能超过 4000 字");
  }
  const installedVersion = install && install.removedAt === null ? install.version : String(existingRow?.installed_version ?? "");

  const existing = existingRow ? { id: String(existingRow.id) } : null;

  let reviewId: string;
  if (existing) {
    reviewId = String(existing.id);
    await repo.run(
      "UPDATE plugin_reviews SET rating = ?, title = ?, content = ?, installed_version = ?, updated_at = ? WHERE id = ?",
      [rating, title, content, installedVersion, now, reviewId],
    );
  } else {
    reviewId = randomUUID();
    await repo.run(
      "INSERT INTO plugin_reviews (id, plugin_id, identity, rating, title, content, installed_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [reviewId, plugin.id, who, rating, title, content, installedVersion, now, now],
    );
  }

  await repo.audit({
    actor: actor?.actor ?? who,
    actorKind: actor?.actorKind ?? "identity",
    action: "plugin.review.submit",
    target: slug,
    diff: { rating, title, version: installedVersion },
    ip: actor?.ip,
  });

  const row = (await repo.raw("SELECT * FROM plugin_reviews WHERE id = ? LIMIT 1", [reviewId]))[0];
  if (!row) throw new Error("保存评价后无法读回");
  return rowToPluginReview(row);
}

/**
 * 插件评价排序键（M12 keyset）：updated_at DESC, id DESC——与 ORDER BY 逐项一致。
 * id 是新增的决胜键：此前同 updated_at 的并列行顺序不稳定，跨页会抖动。
 */
const PLUGIN_REVIEW_KEYSET_KEYS: KeysetKey[] = [
  { column: "updated_at", direction: "DESC" },
  { column: "id", direction: "DESC" },
];

export interface PluginReviewWithInstallStatus extends PluginReviewRecord {
  /** 评价作者当前是否仍处于活跃安装状态（B-3）：
   * true =「已验证真实安装用户」，false =「发表时已验证安装，现已卸载」。
   * 徽章按此区分，而不是按评价当时的安装快照一刀切。 */
  installedNow: boolean;
}

export async function listPluginReviews(
  repo: Repository,
  pluginId: string,
  options: { limit?: number; offset?: number; includeHidden?: boolean; cursor?: string } = {},
): Promise<{ items: PluginReviewWithInstallStatus[]; total: number; nextCursor: string | null }> {
  const where = options.includeHidden ? "plugin_id = ?" : "plugin_id = ? AND status = 'visible'";
  const countRow = (await repo.raw(`SELECT COUNT(*) AS cnt FROM plugin_reviews WHERE ${where}`, [pluginId]))[0];
  const total = Number(countRow?.cnt ?? 0);
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const offset = Math.max(0, options.offset ?? 0);
  // Keyset 游标（M12）：传了就走 WHERE (updated_at,id) > (?,?)，不再 OFFSET；
  // 无效游标抛 InvalidKeysetCursorError，由路由层映射成 400。
  const keysetValues = parseKeysetCursor(options.cursor, PLUGIN_REVIEW_KEYSET_KEYS.length);
  const keyset = keysetValues ? buildKeysetPredicate(PLUGIN_REVIEW_KEYSET_KEYS, keysetValues) : null;
  // 不论 offset 还是游标，都多取一行判定 hasMore：有余行就给 nextCursor，
  // 否则 null（已到末页）。offset 页也给游标——客户端可以从第 1 页（offset）
  // 直接切到游标翻页，不用先算 offset。
  const rows = await repo.raw(
    `SELECT * FROM plugin_reviews WHERE ${where}${keyset ? ` AND ${keyset.sql}` : ""} ORDER BY updated_at DESC, id DESC LIMIT ?${keyset ? "" : " OFFSET ?"}`,
    keyset ? [pluginId, ...keyset.params, limit + 1] : [pluginId, limit + 1, offset],
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = page.map(rowToPluginReview);
  // 一次查询取回本插件的全部活跃安装身份，逐条标注「当前是否仍安装」
  // （B-3：卸载后评价仍在，徽章必须诚实区分现装/已卸）。
  const activeInstalls = await repo.raw(
    "SELECT identity FROM plugin_installs WHERE plugin_id = ? AND removed_at IS NULL",
    [pluginId],
  );
  const installedSet = new Set(activeInstalls.map((r) => String(r.identity)));
  const itemsWithStatus: PluginReviewWithInstallStatus[] = items.map((item) => ({
    ...item,
    installedNow: installedSet.has(item.identity),
  }));
  const last = hasMore ? itemsWithStatus[itemsWithStatus.length - 1] : undefined;
  return {
    items: itemsWithStatus,
    total,
    nextCursor: last ? encodeKeysetCursor([last.updatedAt, last.id]) : null,
  };
}

/**
 * 删除一条评价（B-3）。
 * 本人或管理员可删；硬删除（连同该评价的举报记录一并清理，审计留痕），
 * 删后用户可重新发表（createPluginReview 的 upsert 查不到旧行即走新评价分支）。
 */
export async function deletePluginReview(
  repo: Repository,
  slug: string,
  reviewId: string,
  identity: string,
  actor?: PluginActor,
): Promise<{ deleted: boolean; review: PluginReviewRecord }> {
  const plugin = await getPluginBySlug(repo, slug);
  if (!plugin) throw new Error(`插件不存在：${slug}`);
  const row = (await repo.raw("SELECT * FROM plugin_reviews WHERE id = ? AND plugin_id = ? LIMIT 1", [reviewId, plugin.id]))[0];
  if (!row) throw new Error(`评价不存在：${reviewId}`);
  const review = rowToPluginReview(row);
  const who = identity.trim().slice(0, 120);
  const isAdmin = actor?.actorKind === "admin";
  if (!isAdmin && review.identity !== who) {
    throw new Error("只能删除自己的评价");
  }
  await repo.run("DELETE FROM plugin_review_reports WHERE review_id = ?", [reviewId]);
  await repo.run("DELETE FROM plugin_reviews WHERE id = ?", [reviewId]);
  await repo.audit({
    actor: actor?.actor ?? who,
    actorKind: actor?.actorKind ?? "identity",
    action: "plugin.review.delete",
    target: slug,
    diff: { reviewId, rating: review.rating, byAdmin: isAdmin },
    ip: actor?.ip,
  });
  return { deleted: true, review };
}

export async function getPluginReviewStats(
  repo: Repository,
  pluginId: string,
): Promise<PluginReviewStats> {
  const rows = await repo.raw(
    `SELECT rating, COUNT(*) as cnt FROM plugin_reviews WHERE plugin_id = ? AND status = 'visible' GROUP BY rating`,
    [pluginId],
  );

  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let totalReviews = 0;
  let sumScore = 0;

  for (const r of rows) {
    const star = Number(r.rating);
    const count = Number(r.cnt ?? 0);
    if (star >= 1 && star <= 5) {
      distribution[star] = count;
      totalReviews += count;
      sumScore += star * count;
    }
  }

  const avgRating = totalReviews > 0 ? Number((sumScore / totalReviews).toFixed(1)) : 0;
  return {
    avgRating,
    reviewCount: totalReviews,
    ratingDistribution: distribution,
  };
}

export async function getUserPluginReview(
  repo: Repository,
  pluginId: string,
  identity: string,
): Promise<PluginReviewRecord | null> {
  const who = identity.trim().slice(0, 120);
  if (!who) return null;
  const rows = await repo.raw(
    "SELECT * FROM plugin_reviews WHERE plugin_id = ? AND identity = ? LIMIT 1",
    [pluginId, who],
  );
  return rows[0] ? rowToPluginReview(rows[0]) : null;
}

/** 管理台评价列表：附插件信息，默认按举报数/更新时间倒序 */
export async function listPluginReviewsForAdmin(
  repo: Repository,
  options: { status?: string; limit?: number; offset?: number } = {},
): Promise<{ items: PluginReviewAdminItem[]; total: number }> {
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (options.status) {
    wheres.push("r.status = ?");
    params.push(options.status);
  }
  const where = wheres.length > 0 ? " WHERE " + wheres.join(" AND ") : "";
  const countRow = (await repo.raw(`SELECT COUNT(*) AS cnt FROM plugin_reviews r${where}`, params))[0];
  const total = Number(countRow?.cnt ?? 0);
  const limit = Math.min(100, Math.max(1, options.limit ?? 30));
  const offset = Math.max(0, options.offset ?? 0);
  const rows = await repo.raw(
    `SELECT r.*, p.slug AS plugin_slug, p.name AS plugin_name, p.kind AS plugin_kind
       FROM plugin_reviews r JOIN plugins p ON p.id = r.plugin_id
       ${where}
       ORDER BY r.report_count DESC, r.updated_at DESC
       LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return {
    items: rows.map((row) => ({
      ...rowToPluginReview(row),
      pluginSlug: String(row.plugin_slug ?? ""),
      pluginName: String(row.plugin_name ?? ""),
      pluginKind: String(row.plugin_kind ?? ""),
    })),
    total,
  };
}

/** 隐藏/恢复评价；隐藏后立即退出公开列表与评分聚合 */
export async function moderatePluginReview(
  repo: Repository,
  reviewId: string,
  action: "hide" | "restore",
  note: string | null,
  actor?: PluginActor,
): Promise<PluginReviewRecord> {
  const row = (await repo.raw("SELECT * FROM plugin_reviews WHERE id = ? LIMIT 1", [reviewId]))[0];
  if (!row) throw new Error("评价不存在");
  const status = action === "hide" ? "hidden" : "visible";
  const now = Date.now();
  await repo.run(
    "UPDATE plugin_reviews SET status = ?, moderation_note = ?, moderated_at = ?, moderated_by = ?, updated_at = ? WHERE id = ?",
    [status, note?.trim().slice(0, 500) || null, now, actor?.actor ?? "admin", now, reviewId],
  );
  const updated = (await repo.raw("SELECT * FROM plugin_reviews WHERE id = ? LIMIT 1", [reviewId]))[0];
  if (!updated) throw new Error("更新评价后无法读回");
  await repo.audit({
    actor: actor?.actor ?? "admin",
    actorKind: actor?.actorKind ?? "admin",
    action: `plugin.review.${action}`,
    target: `${row.plugin_id}:${reviewId}`,
    diff: { from: row.status ?? "visible", to: status, note: note ?? null },
    ip: actor?.ip,
  });
  return rowToPluginReview(updated);
}

/** 公开举报：只累计计数并写事件，不自动隐藏（避免恶意举报一键下架） */
export async function reportPluginReview(
  repo: Repository,
  slug: string,
  reviewId: string,
  reason: string,
  reporterIdentity: string | null,
  actor?: PluginActor,
): Promise<PluginReviewRecord & { deduplicated: boolean }> {
  const row = (await repo.raw(
    "SELECT r.*, p.slug AS plugin_slug FROM plugin_reviews r JOIN plugins p ON p.id = r.plugin_id WHERE r.id = ? AND p.slug = ? LIMIT 1",
    [reviewId, slug],
  ))[0];
  if (!row) throw new Error("评价不存在");
  // R4-7：按 (review_id, identity) 去重。INSERT ... ON CONFLICT DO NOTHING +
  // runCount 判是否新增：同一身份重复举报同一评价，report_count 不再 +1。
  // 身份解析与插件举报共用 resolveReporterIdentity（字面量 "anonymous" 视作
  // 无身份，actor.ip 作回退）。
  const identity = resolveReporterIdentity(reporterIdentity ?? undefined, actor);
  const ip = actor?.ip ?? null;
  const now = Date.now();
  let isNewReport = false;
  await repo.withTransaction(async () => {
    const inserted = await repo.runCount(
      "INSERT INTO plugin_review_reports (review_id, identity, ip, reason, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (review_id, identity) DO NOTHING",
      [reviewId, identity, ip, reason.slice(0, 500), now],
    );
    if (inserted > 0) {
      isNewReport = true;
      await repo.run("UPDATE plugin_reviews SET report_count = report_count + 1 WHERE id = ?", [reviewId]);
    }
  });
  await repo.recordEvent("plugin_review_report", {
    identity: reporterIdentity ?? undefined,
    meta: { slug: row.plugin_slug, reviewId, reason: reason.slice(0, 200), deduplicated: !isNewReport },
  });
  await repo.audit({
    actor: actor?.actor ?? reporterIdentity ?? "anonymous",
    actorKind: actor?.actorKind ?? "identity",
    action: "plugin.review.report",
    target: `${row.plugin_slug}:${reviewId}`,
    diff: { reason: reason.slice(0, 200), isNewReport },
    ip: actor?.ip,
  });
  const updated = (await repo.raw("SELECT * FROM plugin_reviews WHERE id = ? LIMIT 1", [reviewId]))[0];
  if (!updated) throw new Error("举报后无法读回评价");
  return { ...rowToPluginReview(updated), deduplicated: !isNewReport };
}

/* ------------------------------------------------------------------ *
 * 市场漏斗与治理 (Plugin Funnel / Governance)
 * ------------------------------------------------------------------ */

/** 市场漏斗：按日聚合客户端埋点 + 服务端安装结果；缺失日期补 0 */
export async function getPluginFunnel(repo: Repository, days = 30): Promise<PluginFunnelMetrics> {
  const span = Math.min(90, Math.max(1, Math.trunc(days)));
  const since = Date.now() - span * 24 * 60 * 60 * 1000;
  const dayExpr =
    repo.db.dialect === "pg"
      ? "to_char(to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD')"
      : "date(created_at / 1000, 'unixepoch')";
  const rows = await repo.raw(
    `SELECT ${dayExpr} AS d, kind, COUNT(*) AS cnt
       FROM events
       WHERE kind IN ('plugin_view','plugin_install_click','plugin_install_success','plugin_uninstall','plugin_review_report')
         AND created_at >= ?
       GROUP BY d, kind ORDER BY d ASC`,
    [since],
  );
  const byDate = new Map<string, PluginFunnelDay>();
  const total = { views: 0, installClicks: 0, installs: 0, uninstalls: 0, reports: 0 };
  for (const row of rows) {
    const d = String(row.d ?? "");
    if (!d) continue;
    const day = byDate.get(d) ?? { date: d, views: 0, installClicks: 0, installs: 0, uninstalls: 0, reports: 0 };
    const count = Number(row.cnt ?? 0);
    switch (String(row.kind)) {
      case "plugin_view": day.views += count; total.views += count; break;
      case "plugin_install_click": day.installClicks += count; total.installClicks += count; break;
      case "plugin_install_success": day.installs += count; total.installs += count; break;
      case "plugin_uninstall": day.uninstalls += count; total.uninstalls += count; break;
      case "plugin_review_report": day.reports += count; total.reports += count; break;
    }
    byDate.set(d, day);
  }
  const series: PluginFunnelDay[] = [];
  const today = new Date();
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    series.push(byDate.get(key) ?? { date: key, views: 0, installClicks: 0, installs: 0, uninstalls: 0, reports: 0 });
  }
  const ratio = (a: number, b: number) => (b > 0 ? Number((a / b).toFixed(3)) : 0);
  const top = await repo.raw(
    "SELECT slug, name, install_count FROM plugins WHERE status = 'published' ORDER BY install_count DESC, star_count DESC LIMIT 5",
  );
  return {
    days: span,
    totals: total,
    conversion: {
      viewToClick: ratio(total.installClicks, total.views),
      clickToInstall: ratio(total.installs, total.installClicks),
      viewToInstall: ratio(total.installs, total.views),
    },
    series,
    topInstalled: top.map((row) => ({
      slug: String(row.slug),
      name: String(row.name),
      installCount: Number(row.install_count ?? 0),
    })),
  };
}

/**
 * 单插件安装趋势（D 批）：按天聚合 plugin_install_success 事件（真实安装记录）。
 *
 * 事件 meta 里有 slug（安装路由写 meta: { slug, kind, version }），
 * LIKE 预筛 + 应用层精确认（与事件幂等预筛同路子：预筛可能多命中，
 * 精确认只认 meta.slug 全等，slug 来自服务端查库、不是用户输入）。
 * 零安装的日子补 0，不跳过、不编造。事件保留 90 天
 * （data_retention telemetryDays），30 天窗口恒在保留期内。
 */
export async function getPluginInstallTrend(
  repo: Repository,
  slug: string,
  days = 30,
): Promise<PluginInstallTrend> {
  const plugin = await getPluginBySlug(repo, slug);
  if (!plugin) throw new Error(`插件不存在：${slug}`);
  const span = Math.min(90, Math.max(1, Math.trunc(days)));
  const since = Date.now() - span * 24 * 60 * 60 * 1000;
  const dayExpr =
    repo.db.dialect === "pg"
      ? "to_char(to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD')"
      : "date(created_at / 1000, 'unixepoch')";
  const rows = await repo.raw(
    `SELECT ${dayExpr} AS d, meta FROM events
       WHERE kind = 'plugin_install_success' AND meta LIKE ? AND created_at >= ?`,
    [`%"slug":"${plugin.slug}"%`, since],
  );
  const byDate = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    const meta = parseJson<Record<string, unknown>>(row.meta, {});
    if (meta.slug !== plugin.slug) continue;
    const d = String(row.d ?? "");
    if (!d) continue;
    byDate.set(d, (byDate.get(d) ?? 0) + 1);
    total++;
  }
  const series: { date: string; installs: number }[] = [];
  const today = new Date();
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, installs: byDate.get(key) ?? 0 });
  }
  return { pluginId: plugin.id, slug: plugin.slug, days: span, total, series };
}

/** 治理告警：待审超 SLA / 插件被举报 / 评价被举报；只读，不自动改变状态 */
export async function getPluginGovernanceAlerts(repo: Repository): Promise<PluginGovernanceAlert[]> {
  const now = Date.now();
  const slaCutoff = now - 48 * 60 * 60 * 1000;
  const pending = await repo.raw(
    "SELECT slug, name, status, created_at FROM plugins WHERE status = 'pending' AND created_at < ? ORDER BY created_at ASC LIMIT 30",
    [slaCutoff],
  );
  // R4-4：举报只计数、不再静默自动下架后，告警必须覆盖已被隔离的插件——
  // 否则一次隔离动作（无论人工还是历史自动）会让它从告警里消失、下架动作本身
  // 不可见。status 覆盖 published 与 quarantined，quarantined 的 detail 追加标注。
  const reported = await repo.raw(
    "SELECT slug, name, status, report_count, updated_at FROM plugins WHERE report_count >= 3 AND status IN ('published', 'quarantined') ORDER BY report_count DESC LIMIT 20",
  );
  const reviewReported = await repo.raw(
    `SELECT r.id, r.report_count, r.created_at, p.slug, p.name, p.status
       FROM plugin_reviews r JOIN plugins p ON p.id = r.plugin_id
       WHERE r.report_count >= 3 AND r.status = 'visible'
       ORDER BY r.report_count DESC LIMIT 20`,
  );
  const alerts: PluginGovernanceAlert[] = [];
  for (const row of pending) {
    const hours = Math.floor((now - Number(row.created_at ?? now)) / 3_600_000);
    alerts.push({
      kind: "pending_sla",
      slug: String(row.slug),
      name: String(row.name),
      status: String(row.status),
      detail: `待审已 ${hours} 小时（SLA 48h）`,
      value: hours,
      createdAt: Number(row.created_at ?? 0),
    });
  }
  for (const row of reported) {
    const quarantined = String(row.status) === "quarantined";
    alerts.push({
      kind: "reported",
      slug: String(row.slug),
      name: String(row.name),
      status: String(row.status),
      detail: `插件被举报 ${Number(row.report_count ?? 0)} 次${quarantined ? "（已隔离）" : ""}`,
      value: Number(row.report_count ?? 0),
      createdAt: Number(row.updated_at ?? 0),
    });
  }
  for (const row of reviewReported) {
    alerts.push({
      kind: "review_reported",
      slug: String(row.slug),
      name: `${String(row.name)} · 评价 ${String(row.id).slice(0, 8)}`,
      status: String(row.status),
      detail: `评价被举报 ${Number(row.report_count ?? 0)} 次`,
      value: Number(row.report_count ?? 0),
      createdAt: Number(row.created_at ?? 0),
    });
  }
  return alerts.sort((a, b) => b.value - a.value).slice(0, 50);
}

/* ------------------------------------------------------------------ *
 * 分享短链 (Short Links)
 * ------------------------------------------------------------------ */

/** 创建短链；目标口径与解析侧完全一致，写入即把关（不依赖调用方先校验） */
export async function createShortLink(
  repo: Repository,
  input: { target: string; pluginSlug?: string | null },
): Promise<ShortLinkRecord> {
  if (!isInternalShortLinkTarget(input.target)) {
    throw new Error("短链目标必须是站内 /marketplace/ 路径");
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomUUID().replace(/-/g, "").slice(0, 8);
    try {
      await repo.run("INSERT INTO short_links (code, target, plugin_slug, clicks, created_at) VALUES (?, ?, ?, 0, ?)", [
        code,
        input.target,
        input.pluginSlug ?? null,
        Date.now(),
      ]);
      const row = (await repo.raw("SELECT * FROM short_links WHERE code = ? LIMIT 1", [code]))[0];
      if (row) {
        return {
          code: String(row.code),
          target: String(row.target),
          pluginSlug: row.plugin_slug == null ? null : String(row.plugin_slug),
          clicks: Number(row.clicks ?? 0),
          createdAt: Number(row.created_at ?? 0),
        };
      }
    } catch {
      // 极低概率的 code 冲突：重试
    }
  }
  throw new Error("生成短链失败，请稍后重试");
}

/** 解析并累计点击；无效/外链目标返回 null（防开放重定向的最后一道闸） */
export async function resolveShortLink(repo: Repository, code: string): Promise<ShortLinkRecord | null> {
  const normalized = code.trim().slice(0, 32);
  if (!/^[a-zA-Z0-9]+$/.test(normalized)) return null;
  await repo.run("UPDATE short_links SET clicks = clicks + 1 WHERE code = ?", [normalized]);
  const row = (await repo.raw("SELECT * FROM short_links WHERE code = ? LIMIT 1", [normalized]))[0];
  if (!row) return null;
  const target = String(row.target ?? "");
  if (!isInternalShortLinkTarget(target)) return null;
  return {
    code: String(row.code),
    target,
    pluginSlug: row.plugin_slug == null ? null : String(row.plugin_slug),
    clicks: Number(row.clicks ?? 0),
    createdAt: Number(row.created_at ?? 0),
  };
}


export async function replyPluginReview(
  repo: Repository,
  reviewId: string,
  replyText: string,
  actor: PluginActor,
): Promise<PluginReviewRecord> {
  const row = (await repo.raw("SELECT * FROM plugin_reviews WHERE id = ? LIMIT 1", [reviewId]))[0];
  if (!row) throw new Error(`评价不存在：${reviewId}`);
  const pluginRow = (await repo.raw("SELECT * FROM plugins WHERE id = ? LIMIT 1", [row.plugin_id]))[0];
  if (!pluginRow) throw new Error("关联插件不存在");
  const plugin = rowToPlugin(pluginRow);

  const actorIdentity = actor.actor;
  const isAdmin = actor.actorKind === "admin";
  if (!isAdmin && plugin.ownerIdentity !== actorIdentity) {
    throw new Error("只有插件作者或系统管理员才能回复此评价");
  }

  const now = Date.now();
  const cleanReply = replyText.trim().slice(0, 1000);
  await repo.run(
    "UPDATE plugin_reviews SET author_reply = ?, author_replied_at = ?, updated_at = ? WHERE id = ?",
    [cleanReply, now, now, reviewId],
  );

  await repo.audit({
    actor: actor.actor,
    actorKind: actor.actorKind,
    action: "plugin.review.reply",
    target: plugin.slug,
    diff: { reviewId, reply: cleanReply },
  });

  const updatedRow = (await repo.raw("SELECT * FROM plugin_reviews WHERE id = ? LIMIT 1", [reviewId]))[0];
  if (!updatedRow) throw new Error("无法读回回复后的评价记录");
  return rowToPluginReview(updatedRow);
}
