import type {
  Category,
  PluginKind,
  PluginManifest,
  PluginStatus,
  Site,
  SiteAction,
  SiteLiveMetrics,
  SiteRelation,
  SiteStatus,
  TaxonomyProposal,
  TaxonomyProposalKind,
  TaxonomyProposalStatus,
} from "@navhub/core";
export type { TaxonomyProposal, TaxonomyProposalKind, TaxonomyProposalStatus };
export type { PluginKind, PluginManifest, PluginStatus };
import type { Dialect } from "../driver.ts";

export interface SiteInput {
  url: string;
  title?: string;
  description?: string | null;
  categoryId: string;
  subCategoryId?: string | null;
  iconKey?: string | null;
  tags?: string[];
  status?: SiteStatus;
  enabled?: boolean;
  sort?: number;
  featured?: boolean;
  source?: string | null;
  actions?: SiteAction[];
  relations?: SiteRelation[];
  liveMetrics?: SiteLiveMetrics;
  workspaces?: string[];
  facets?: Record<string, string[]>;
  metadata?: Record<string, unknown>;
}

/* ------------------------- 新领域记录类型 ------------------------- */

export interface DashboardOverview {
  overview: {
    totalSites: number;
    activeSites: number;
    brokenSites: number;
    pendingSites: number;
    archivedSites: number;
    trashedSites: number;
    categories: number;
    tags: number;
    collections: number;
    favorites: number;
  };
  metrics24h: {
    newSites: number;
    healthChecks: number;
    healthFailed: number;
    healthRate: number | null;
    avgLatencyMs: number | null;
    jobsTotal: number;
    jobsCompleted: number;
    jobsFailed: number;
    jobsPending: number;
    jobsRunning: number;
    auditLogs: number;
    authFailures: number;
    eventsTotal: number;
    searches: number;
    clicks: number;
    zeroResults: number;
  };
  storage: {
    dbSizeBytes: number | null;
    walSizeBytes: number | null;
    tableCounts: Record<string, number>;
  };
  /** 用户域运营视图（T19）：DAU 与收藏分布是「用户中心是否被用起来」的最小指标集 */
  userCenter: {
    /** 近 24h 有行为事件（click/search/favorite）的独立身份数 */
    dau: number;
    /** 近 7 天每天活跃身份数（含今天，长度 ≤7，旧在前） */
    dau7d: Array<{ day: string; count: number }>;
    /** 至少有 1 条未删收藏的身份数 */
    identitiesWithFavorites: number;
    /** 人均收藏数（按有收藏的身份算） */
    avgFavoritesPerIdentity: number | null;
    /** 收藏数 P50 / P95（按身份聚合） */
    favoritesP50: number | null;
    favoritesP95: number | null;
  };
}

export interface CategoryDistributionItem {
  id: string;
  title: string;
  icon: string | null;
  siteCount: number;
  percentage: number;
  brokenCount?: number;
}

export interface CategorySemanticDetail {
  category: Category;
  related: Array<{
    id: string;
    title: string;
    titleEn?: string | null;
    icon?: string | null;
    siteCount: number;
  }>;
}

export interface SiteKnowledgeGraph {
  centerSiteId: string;
  nodes: Array<{
    id: string;
    title: string;
    url: string;
    iconKey?: string | null;
    categoryId?: string;
    categoryTitle?: string;
    isCenter?: boolean;
  }>;
  edges: Array<{
    source: string;
    target: string;
    relationType: string;
    labelZh: string;
    symmetric: boolean;
    note?: string;
  }>;
}

export interface MatchedSiteRelation extends SiteRelation {
  sourceSite: Site | null;
}


export interface SecurityOverview {
  recentFailures: Array<{ action: string; ip: string | null; count: number; lastAt: number }>;
  totalAuthFailures24h: number;
  recentAudits: Array<{ id: number; actor: string; actorKind: string; action: string; target: string | null; createdAt: number }>;
  tokenStats: {
    total: number;
    active: number;
    expired: number;
    revoked: number;
  };
}

export interface FavoriteRecord {
  id: string;
  userId: string;
  siteId: string;
  folderId: string | null;
  note: string | null;
  /** 标签（T22）：最多 8 个、每个 1-24 字符；null = 未打标签 */
  tags: string[] | null;
  createdAt: number;
  updatedAt: number;
  /** 软删墓碑时间戳；非空即「已删」。增量同步靠它把删除传播给客户端。 */
  deletedAt?: number | null;
}

export interface FavoriteFolderRecord {
  id: string;
  userId: string;
  name: string;
  sort: number;
  createdAt: number;
}

export interface UserProfileRecord {
  userId: string;
  topCategories: string[];
  topTags: string[];
  visitedSiteIds: string[];
  favoriteSiteIds: string[];
  searchCount: number;
  updatedAt: number;
}

export interface UserVaultRecord {
  userId: string;
  payload: string;
  version: number;
  updatedAt: number;
}

export interface UserRecord {
  id: string;
  username: string;
  role: string;
  email: string | null;
  avatar: string | null;
  source: string;
}

/** API token 记录（**不含 token_hash 明文**——哈希只在查询入参里出现，不进返回值） */
export interface ApiTokenRecord {
  id: string;
  name: string;
  scopes: string[];
  /** 归属用户身份（T20）：非空 = 用户自建的个人令牌，用户域以它为身份；null = 实例级令牌 */
  ownerIdentity: string | null;
  expiresAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
  /**
   * 软吊销时间戳。非 null = 已停用，鉴权一律拒绝。
   *
   * 为什么要有"停用"而不是只有"删除"：审核日志里 token 是以 id 记录的，
   * 硬删之后 audit_logs.target 变成悬空 id，"哪条凭据做过什么"就永远查不到了。
   */
  revokedAt: number | null;
  /** 上次轮换时间；null = 从未轮换。轮换**不**重写 created_at */
  rotatedAt: number | null;
  /** 明文前缀（如 nh_1a2b3c），仅用于列表区分凭据 */
  tokenPrefix: string | null;
}

/** 审计日志记录；diff 已解析（库里存的是 JSON 文本） */
export interface AuditLogRecord {
  id: number;
  actor: string;
  actorKind: string;
  action: string;
  target: string | null;
  diff: unknown;
  ip: string | null;
  createdAt: number;
}

export interface JobRecord {
  id: string;
  kind: string;
  payload: unknown;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  /** 下次可被认领的时间（退避中任务的 pending 到点时间；NULL = 立即可认领） */
  nextRunAt: number | null;
  /**
   * 长任务进度（异步恢复等）。0/0 = 未上报过，不是「进度 0%」——
   * 调用方要区分「还没开始报」与「刚开始」，否则一进页面就显示一个假的 0%。
   */
  progressDone: number;
  progressTotal: number;
}

export interface TagWithCount {
  id: string;
  name: string;
  slug: string;
  count: number;
  group: string;
  color?: string | null;
  description?: string | null;
  aliases: string[];
}

export interface TagAliasRecord {
  alias: string;
  tagId: string;
  createdAt: number;
}

export interface SiteFacetRecord {
  siteId: string;
  facetKey: string;
  facetValue: string;
}

export interface FacetCountRecord {
  facetKey: string;
  facetValue: string;
  count: number;
}

export interface MaintenanceStatus {
  ok: boolean;
  dialect: Dialect;
  integrity: string;
  dbSizeBytes: number | null;
  pageCount?: number;
  pageSize?: number;
  freePages?: number;
  tableCounts: Record<string, number>;
}

/* ------------------------- 插件市场 (Plugin Marketplace) ------------------------- */

/** 插件记录；manifest / tags 已从 JSON 列解析 */
export interface PluginRecord {
  id: string;
  slug: string;
  kind: PluginKind;
  name: string;
  description: string;
  icon: string | null;
  tags: string[];
  author: string | null;
  authorKind: string | null;
  /** 作者归属（内部字段；REST 公共响应会剔除） */
  ownerIdentity?: string | null;
  /** 作者公开页 key（ownerIdentity 的不可逆哈希） */
  ownerKey?: string | null;
  license: string | null;
  homepage: string | null;
  version: string;
  manifest: PluginManifest;
  status: PluginStatus;
  reviewNote: string | null;
  reviewedAt: number | null;
  /** 待审核版本的变更说明（内部字段；通过/驳回后清空） */
  pendingChangelog?: string | null;
  /** 双轨制 (Shadow Release)：在售版本继续服务，新版本在待审中暂存 */
  pendingVersion?: string | null;
  pendingManifest?: PluginManifest | null;
  /** 认证作者标记 */
  authorVerified?: boolean;
  /** 衍生自哪个插件（Remix 来源） */
  forkedFromSlug?: string | null;
  /** 被衍生创作（Remix）次数统计 */
  remixCount?: number;
  source: string;
  installCount: number;
  starCount: number;
  reportCount: number;
  featured: boolean;
  featuredRank: number;
  /** 列表聚合：仅统计 visible 评价（无评价为 0） */
  ratingAvg: number;
  reviewCount: number;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
}

/** 安装记录（复合主键 plugin_id + identity；removed_at 非空 = 已卸载） */
export interface PluginInstallRecord {
  pluginId: string;
  identity: string;
  version: string;
  meta: unknown;
  installedAt: number;
  removedAt: number | null;
}

/** 审计用调用者标识（来自 req.auth；identityOf 仅展示、不可信） */
export interface PluginActor {
  actor: string;
  actorKind?: string;
  ip?: string;
}

/** 插件版本历史快照 */
export interface PluginVersionRecord {
  id: string;
  pluginId: string;
  version: string;
  manifest: PluginManifest;
  changelog: string | null;
  checksum: string;
  publishedAt: number;
  createdAt: number;
}

/** 插件举报记录（去重审计用） */
export interface PluginReportRecord {
  pluginId: string;
  identity: string;
  ip?: string | null;
  reason: string;
  createdAt: number;
}

/** 插件真实评价记录 */
export interface PluginReviewRecord {
  id: string;
  pluginId: string;
  identity: string;
  rating: number;
  title: string | null;
  content: string | null;
  installedVersion: string;
  /** visible | hidden（hidden 不进公开列表与评分统计） */
  status: "visible" | "hidden" | string;
  reportCount: number;
  moderationNote: string | null;
  moderatedAt: number | null;
  moderatedBy: string | null;
  authorReply?: string | null;
  authorRepliedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PluginReviewStats {
  avgRating: number;
  reviewCount: number;
  ratingDistribution: Record<number, number>;
}

/** 管理台评价治理列表项（附插件名/slug，避免前端再查一次） */
export interface PluginReviewAdminItem extends PluginReviewRecord {
  pluginSlug: string;
  pluginName: string;
  pluginKind: string;
}

/** 市场漏斗（按日聚合） */
export interface PluginFunnelDay {
  date: string;
  views: number;
  installClicks: number;
  installs: number;
  uninstalls: number;
  reports: number;
}

export interface PluginFunnelMetrics {
  days: number;
  totals: { views: number; installClicks: number; installs: number; uninstalls: number; reports: number };
  conversion: { viewToClick: number; clickToInstall: number; viewToInstall: number };
  series: PluginFunnelDay[];
  topInstalled: Array<{ slug: string; name: string; installCount: number }>;
}

/** 治理告警（只读建议，不自动改变状态） */
export interface PluginGovernanceAlert {
  kind: "pending_sla" | "reported" | "review_reported";
  slug: string;
  name: string;
  status: string;
  detail: string;
  value: number;
  createdAt: number;
}

export interface ShortLinkRecord {
  code: string;
  target: string;
  pluginSlug: string | null;
  clicks: number;
  createdAt: number;
}
