import type { SiteStatus } from "@navhub/core";

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
}

/* ------------------------- 新领域记录类型 ------------------------- */

export interface FavoriteRecord {
  id: string;
  userId: string;
  siteId: string;
  folderId: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
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
  expiresAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
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
}

export interface TagWithCount {
  id: string;
  name: string;
  slug: string;
  count: number;
}
