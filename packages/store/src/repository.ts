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
  type FacetGroupSummary,
  type SkosConcept,
  type TaxonomyProposal,
} from "@navhub/core";
import type { Db } from "./driver.ts";
import type {
    ApiTokenRecord,
    AuditLogRecord,
    CategoryDistributionItem,
    CategorySemanticDetail,
    SiteKnowledgeGraph,
    MatchedSiteRelation,
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
} from "./repository/records.ts";

import * as sitesRepo from "./repository/sites.ts";
import * as categoriesRepo from "./repository/categories.ts";
import * as embeddingsRepo from "./repository/embeddings.ts";
import * as statsRepo from "./repository/stats.ts";
import * as dashboardRepo from "./repository/dashboard.ts";
import * as eventsRepo from "./repository/events.ts";
import * as healthRepo from "./repository/health.ts";
import * as tagsRepo from "./repository/tags.ts";
import * as favoritesRepo from "./repository/favorites.ts";
import * as behaviorRepo from "./repository/behavior.ts";
import * as profilesRepo from "./repository/profiles.ts";
import * as vaultRepo from "./repository/vault.ts";
import * as historyRepo from "./repository/history.ts";
import * as usersRepo from "./repository/users.ts";
import * as tokensRepo from "./repository/tokens.ts";
import * as collectionsRepo from "./repository/collections.ts";
import * as analyticsRepo from "./repository/analytics.ts";
import * as jobsRepo from "./repository/jobs.ts";
import * as systemRepo from "./repository/system.ts";
import * as maintenanceRepo from "./repository/maintenance.ts";
import * as taxonomyRepo from "./repository/taxonomy-governance.ts";
import * as pluginsRepo from "./repository/plugins.ts";
import * as ioRepo from "./repository/io.ts";
export * from "./repository/records.ts";
export { bindSqlite, normalizeTokenScopes, slugify, toPgSql } from "./repository/dialect.ts";
export { TOKEN_TOUCH_THROTTLE_MS } from "./repository/tokens.ts";
/**
 * 数据仓储。
 *
 * 这一层是「NavSphere 的 JSON 世界」与「真实数据库」之间的翻译层。
 * NavSphere 全站只通过 getFileContent/commitFile 读写 3 个 JSON 文件，
 * 因此只要本层能提供等价语义，前端就完全不需要改。
 *
 * 关键点：写入时必须同步维护 fts_tokens / pinyin_* 这些检索线索，
 * 否则搜索会静默失效（而不是报错）——这是最容易埋雷的地方。
 */
export class Repository {
  /** @internal 仓储上下文：供 repository/* 域函数使用，对外视为内部 API */
  readonly db: Db;
  /** @internal token 触点节流表：供 repository/tokens 使用 */
  readonly tokenTouchAt = new Map<string, number>();
  private txDepth = 0;

  constructor(db: Db) {
    this.db = db;
  }

  async withTransaction<T>(action: () => Promise<T>): Promise<T> {
    if (this.txDepth > 0) return action();
    if (this.db.dialect === "sqlite" && this.db.sqlite) {
      this.txDepth++;
      try {
        try { this.db.sqlite.exec("PRAGMA busy_timeout = 5000"); } catch { /* ignore */ }
        let lastErr: unknown = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            this.db.sqlite.exec("BEGIN IMMEDIATE");
            try {
              const result = await action();
              this.db.sqlite.exec("COMMIT");
              return result;
            } catch (err) {
              try { this.db.sqlite.exec("ROLLBACK"); } catch { /* ignore */ }
              throw err;
            }
          } catch (err) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            // 只有 BUSY/LOCKED 才重试，其它错误直接抛
            if (!/BUSY|LOCKED/i.test(msg) || attempt === 3) throw err;
            await new Promise((r) => setTimeout(r, 50 * 2 ** (attempt - 1)));
          }
        }
        throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
      } finally {
        this.txDepth--;
      }
    } else if (this.db.dialect === "pg" && this.db.pg) {
      // 必须在独占连接上跑 BEGIN/COMMIT，否则 pool 会把语句打散到不同连接，原子性丢失。
      const poolAny = this.db.pg as unknown as {
        query(sql: string, params?: unknown[]): Promise<unknown>;
        connect(): Promise<{ query(sql: string, params?: unknown[]): Promise<unknown>; release(): void }>;
      };
      if (typeof poolAny.connect === "function") {
        const client = await poolAny.connect();
        // 事务期间把 this.db.pg 临时指向该独占连接，保证内部 run/raw 走同一连接
        const origPg = this.db.pg;
        (this as unknown as { db: { pg: unknown } }).db.pg = client as never;
        this.txDepth++;
        try {
          await client.query("BEGIN", []);
          const result = await action();
          await client.query("COMMIT", []);
          return result;
        } catch (err) {
          try { await client.query("ROLLBACK", []); } catch { /* ignore */ }
          throw err;
        } finally {
          (this as unknown as { db: { pg: unknown } }).db.pg = origPg as never;
          client.release();
          this.txDepth--;
        }
      }
      this.txDepth++;
      try {
        await this.db.pg.query("BEGIN");
        const result = await action();
        await this.db.pg.query("COMMIT");
        return result;
      } catch (err) {
        try { await this.db.pg.query("ROLLBACK"); } catch { /* ignore */ }
        throw err;
      } finally {
        this.txDepth--;
      }
    }
    return action();
  }

  /* ------------------------- 站点 ------------------------- */

  async listSites(filter: { categoryId?: string; status?: SiteStatus; limit?: number; offset?: number; source?: string; facets?: Record<string, string[]> } = {}): Promise<Site[]> {
    return sitesRepo.listSites(this, filter);
  }

  /** 全量站点（快照层专用，不分页；普通列表请用 listSites） */
  async listAllSites(limit?: number): Promise<Site[]> {
    return sitesRepo.listAllSites(this, limit);
  }

  async getSitesByIds(ids: string[]): Promise<Map<string, Site>> {
    return sitesRepo.getSitesByIds(this, ids);
  }

  /** @internal repository/* 域函数使用 */
  selectSitesSql(): string {
    return sitesRepo.selectSitesSql(this);
  }

  async getSite(idOrUrl: string): Promise<Site | null> {
    return sitesRepo.getSite(this, idOrUrl);
  }

  async getDeletedSite(id: string): Promise<Site | null> {
    return sitesRepo.getDeletedSite(this, id);
  }

  async findSiteByUrl(url: string): Promise<Site | null> {
    return sitesRepo.findSiteByUrl(this, url);
  }

  async createSite(input: SiteInput): Promise<Site> {
    return sitesRepo.createSite(this, input);
  }

  async createSiteWithId(input: SiteInput & { id: string }): Promise<Site> {
    return sitesRepo.createSiteWithId(this, input);
  }

  async updateSite(id: string, patch: Partial<SiteInput>): Promise<Site | null> {
    return sitesRepo.updateSite(this, id, patch);
  }

  async deleteSite(id: string): Promise<boolean> {
    return sitesRepo.deleteSite(this, id);
  }

  async restoreSite(id: string): Promise<Site | null> {
    return sitesRepo.restoreSite(this, id);
  }

  async purgeSite(id: string): Promise<boolean> {
    return sitesRepo.purgeSite(this, id);
  }

  async listDeletedSites(limit = 100): Promise<Site[]> {
    return sitesRepo.listDeletedSites(this, limit);
  }

  async reorderSites(order: Array<{ id: string; sort: number }>): Promise<void> {
    return sitesRepo.reorderSites(this, order);
  }

  async setSiteTags(siteId: string, tagNames: string[]): Promise<void> {
    return sitesRepo.setSiteTags(this, siteId, tagNames);
  }

  async setSiteFacets(siteId: string, facets: Record<string, string[] | string | null | undefined>): Promise<void> {
    return sitesRepo.setSiteFacets(this, siteId, facets);
  }

  async getSiteFacets(siteId: string): Promise<Record<string, string[]>> {
    return sitesRepo.getSiteFacets(this, siteId);
  }

  async filterSiteIdsByFacets(facets: Record<string, string[] | string | null | undefined>): Promise<string[]> {
    return sitesRepo.filterSiteIdsByFacets(this, facets);
  }

  async listFacetsSummary(filter?: { categoryId?: string; tag?: string }): Promise<FacetGroupSummary[]> {
    return sitesRepo.listFacetsSummary(this, filter);
  }

  async setSiteRelations(siteId: string, relations: SiteRelation[]): Promise<void> {
    return sitesRepo.setSiteRelations(this, siteId, relations);
  }

  async getSiteRelations(siteId: string): Promise<SiteRelation[]> {
    return sitesRepo.getSiteRelations(this, siteId);
  }

  async getDetailedSiteRelations(siteId: string): Promise<{ outgoing: SiteRelation[]; incoming: SiteRelation[]; all: SiteRelation[] }> {
    return sitesRepo.getDetailedSiteRelations(this, siteId);
  }

  async getSiteKnowledgeGraph(siteId: string, maxNeighbors?: number): Promise<SiteKnowledgeGraph | null> {
    return sitesRepo.getSiteKnowledgeGraph(this, siteId, maxNeighbors);
  }

  async findRelationsByQuery(query: string, limit = 5): Promise<MatchedSiteRelation[]> {
    return sitesRepo.findRelationsByQuery(this, query, limit);
  }

  /** @internal repository/* 域函数使用 */
  async upsertTag(name: string, slug: string, group = "topic"): Promise<string> {
    return sitesRepo.upsertTag(this, name, slug, group);
  }


  /* ------------------------- 类目 ------------------------- */

  async listCategories(): Promise<Category[]> {
    return categoriesRepo.listCategories(this);
  }

  async getCategory(id: string): Promise<Category | null> {
    return categoriesRepo.getCategory(this, id);
  }

  async getCategoryWithSemantic(id: string): Promise<CategorySemanticDetail | null> {
    return categoriesRepo.getCategoryWithSemantic(this, id);
  }

  async exportSkosConcepts(baseUri?: string): Promise<SkosConcept[]> {
    return categoriesRepo.exportSkosConcepts(this, baseUri);
  }

  async createCategory(input: {
    id?: string;
    title: string;
    titleEn?: string | null;
    parentId?: string | null;
    icon?: string | null;
    description?: string | null;
    sort?: number;
    source?: string | null;
    altLabels?: string[];
    relatedCategories?: string[];
  }): Promise<Category> {
    return categoriesRepo.createCategory(this, input);
  }

  async ensureCategory(title: string, source?: string): Promise<string> {
    return categoriesRepo.ensureCategory(this, title, source);
  }

  async moveCategory(id: string, parentId: string | null): Promise<Category | null> {
    return categoriesRepo.moveCategory(this, id, parentId);
  }

  /** @internal repository/* 域函数使用 */
  async replaceAnchorPrefix(oldPrefix: string, newPrefix: string): Promise<void> {
    return categoriesRepo.replaceAnchorPrefix(this, oldPrefix, newPrefix);
  }

  async mergeCategories(sourceId: string, targetId: string): Promise<{ movedSites: number; removedCategories: number }> {
    return categoriesRepo.mergeCategories(this, sourceId, targetId);
  }

  async updateCategory(
    id: string,
    patch: Partial<Pick<Category, "title" | "titleEn" | "icon" | "description" | "enabled" | "sort" | "altLabels" | "relatedCategories">>
  ): Promise<Category | null> {
    return categoriesRepo.updateCategory(this, id, patch);
  }

  async deleteCategory(id: string): Promise<void> {
    return categoriesRepo.deleteCategory(this, id);
  }


  /* ------------------------- 向量 ------------------------- */

  async saveEmbedding(siteId: string, model: string, vector: Float32Array): Promise<void> {
    return embeddingsRepo.saveEmbedding(this, siteId, model, vector);
  }

  async savedEmbeddings(): Promise<Array<{ key: number; siteId: string; vector: Float32Array }>> {
    return embeddingsRepo.savedEmbeddings(this);
  }

  async savePluginEmbedding(slug: string, model: string, vector: Float32Array): Promise<void> {
    return embeddingsRepo.savePluginEmbedding(this, slug, model, vector);
  }

  async savedPluginEmbeddings(): Promise<Array<{ key: number; siteId: string; vector: Float32Array }>> {
    return embeddingsRepo.savedPluginEmbeddings(this);
  }

  async getPluginEmbedding(slug: string): Promise<Float32Array | null> {
    return embeddingsRepo.getPluginEmbedding(this, slug);
  }

  async deletePluginEmbedding(slug: string): Promise<void> {
    return embeddingsRepo.deletePluginEmbedding(this, slug);
  }


  /* ------------------------- 统计 ------------------------- */

  async stats(): Promise<{ sites: number; categories: number; tags: number; broken: number; pending: number; trashed: number }> {
    return statsRepo.stats(this);
  }


  /* ------------------------- 总览仪表盘 ------------------------- */

  async dashboardOverview(): Promise<DashboardOverview> {
    return dashboardRepo.dashboardOverview(this);
  }

  async categorySiteDistribution(limit = 10): Promise<CategoryDistributionItem[]> {
    return dashboardRepo.categorySiteDistribution(this, limit);
  }

  async dbStorageMetrics(): Promise<{ dbSizeBytes: number | null; walSizeBytes: number | null; tableCounts: Record<string, number> }> {
    return dashboardRepo.dbStorageMetrics(this);
  }


  /* ------------------------- 数据库维护 ------------------------- */

  async maintenanceCheck(): Promise<MaintenanceStatus> {
    return maintenanceRepo.maintenanceCheck(this);
  }

  async vacuumDatabase(): Promise<{ ok: boolean; tookMs: number; message: string }> {
    return maintenanceRepo.vacuumDatabase(this);
  }

  async optimizeFts(): Promise<{ ok: boolean; tookMs: number; skipped?: boolean }> {
    return maintenanceRepo.optimizeFts(this);
  }

  async checkpointWal(mode: "passive" | "full" | "restart" | "truncate" = "passive"): Promise<{ ok: boolean; tookMs: number; logSize?: number }> {
    return maintenanceRepo.checkpointWal(this, mode);
  }


  /* ------------------------- 总览仪表盘 ------------------------- */

  async securityOverview(hours = 24): Promise<SecurityOverview> {
    return dashboardRepo.securityOverview(this, hours);
  }

  async jobsQueueDepth(): Promise<{ pending: number; running: number }> {
    return dashboardRepo.jobsQueueDepth(this);
  }


  /* ------------------------- 事件与审计 ------------------------- */

  async recordEvent(kind: string, payload: { siteId?: string; query?: string; categoryId?: string; identity?: string; meta?: unknown } = {}): Promise<void> {
    return eventsRepo.recordEvent(this, kind, payload);
  }

  async audit(entry: { actor: string; actorKind?: string; action: string; target?: string; diff?: unknown; ip?: string }): Promise<void> {
    return eventsRepo.audit(this, entry);
  }

  async listAuditLogs(filter: {
    limit?: number;
    offset?: number;
    action?: string;
    actor?: string;
  } = {}): Promise<{ items: AuditLogRecord[]; hasMore: boolean }> {
    return eventsRepo.listAuditLogs(this, filter);
  }

  async listAuditActions(limit = 50): Promise<string[]> {
    return eventsRepo.listAuditActions(this, limit);
  }


  /* ------------------------- 健康与趋势 ------------------------- */

  async updateSiteHealth(siteId: string, health: {
    httpStatus: number | null
    ok: boolean
    latencyMs: number
    redirectTo: string | null
    error: string | null
    /** 失败时是否把 status 置为 broken */
    markBroken?: boolean
    currentStatus?: string
  }): Promise<void> {
    return healthRepo.updateSiteHealth(this, siteId, health);
  }

  async healthCheckSeries(since: number, limit = 5000): Promise<Array<{ siteId: string; checkedAt: number; ok: boolean; latencyMs: number | null }>> {
    return healthRepo.healthCheckSeries(this, since, limit);
  }

  /** 某站点最近 N 次巡检（新→旧），供「连续失败才判 broken」使用 */
  async recentHealthChecks(siteId: string, limit = 5): Promise<Array<{ ok: boolean; checkedAt: number }>> {
    return healthRepo.recentHealthChecks(this, siteId, limit);
  }

  async bumpVisit(siteId: string): Promise<void> {
    return healthRepo.bumpVisit(this, siteId);
  }

  async setTrendScores(scores: Array<{ id: string; trendScore: number }>): Promise<void> {
    return healthRepo.setTrendScores(this, scores);
  }


  /* ------------------------- 标签 ------------------------- */

  async listTagsWithCounts(minCount = 1, group?: string): Promise<TagWithCount[]> {
    return tagsRepo.listTagsWithCounts(this, minCount, group);
  }

  async renameTag(id: string, newName: string): Promise<void> {
    return tagsRepo.renameTag(this, id, newName);
  }

  async updateTag(
    id: string,
    patch: { name?: string; group?: string; color?: string | null; description?: string | null },
  ): Promise<void> {
    return tagsRepo.updateTag(this, id, patch);
  }

  async deleteTag(id: string): Promise<{ unbound: number }> {
    return tagsRepo.deleteTag(this, id);
  }

  async mergeTags(sourceId: string, targetId: string): Promise<{ moved: number }> {
    return tagsRepo.mergeTags(this, sourceId, targetId);
  }

  async addTagAlias(tagId: string, alias: string): Promise<{ alias: string }> {
    return tagsRepo.addTagAlias(this, tagId, alias);
  }

  async removeTagAlias(alias: string): Promise<void> {
    return tagsRepo.removeTagAlias(this, alias);
  }

  async listTagAliases(tagId?: string): Promise<TagAliasRecord[]> {
    return tagsRepo.listTagAliases(this, tagId);
  }

  async resolveTag(nameOrAlias: string): Promise<{ id: string; name: string; slug: string; group: string } | null> {
    return tagsRepo.resolveTag(this, nameOrAlias);
  }


  /* ------------------------- 收藏夹 ------------------------- */

  async listFavorites(userId: string): Promise<FavoriteRecord[]> {
    return favoritesRepo.listFavorites(this, userId);
  }

  async addFavorite(input: { userId: string; siteId: string; folderId?: string | null; note?: string | null }): Promise<{ favorite: FavoriteRecord; existed: boolean }> {
    return favoritesRepo.addFavorite(this, input);
  }

  async removeFavorite(userId: string, siteId: string): Promise<boolean> {
    return favoritesRepo.removeFavorite(this, userId, siteId);
  }

  async listFavoriteFolders(userId: string): Promise<FavoriteFolderRecord[]> {
    return favoritesRepo.listFavoriteFolders(this, userId);
  }

  async createFavoriteFolder(userId: string, name: string): Promise<FavoriteFolderRecord> {
    return favoritesRepo.createFavoriteFolder(this, userId, name);
  }

  async deleteFavoriteFolder(userId: string, folderId: string): Promise<void> {
    return favoritesRepo.deleteFavoriteFolder(this, userId, folderId);
  }


  /* ------------------------- 行为事件聚合 ------------------------- */

  async behaviorEvents(identity: string, since: number, limit = 500): Promise<Array<{ kind: string; siteId: string; categoryId: string | null; tags: string[]; createdAt: number }>> {
    return behaviorRepo.behaviorEvents(this, identity, since, limit);
  }

  async countSearches(userId: string): Promise<number> {
    return behaviorRepo.countSearches(this, userId);
  }

  async clickCountsSince(since: number): Promise<Map<string, number>> {
    return behaviorRepo.clickCountsSince(this, since);
  }

  async favoriteCountsSince(since: number): Promise<Map<string, number>> {
    return behaviorRepo.favoriteCountsSince(this, since);
  }


  /* ------------------------- 画像 ------------------------- */

  async getUserProfile(userId: string): Promise<UserProfileRecord | null> {
    return profilesRepo.getUserProfile(this, userId);
  }

  async deleteUserProfile(userId: string): Promise<void> {
    return profilesRepo.deleteUserProfile(this, userId);
  }

  async deleteBehaviorEvents(identity: string): Promise<number> {
    return profilesRepo.deleteBehaviorEvents(this, identity);
  }

  async saveUserProfile(userId: string, profile: Omit<UserProfileRecord, "userId" | "updatedAt">): Promise<void> {
    return profilesRepo.saveUserProfile(this, userId, profile);
  }


  /* ------------------------- 金库 ------------------------- */

  async getUserVault(userId: string): Promise<UserVaultRecord | null> {
    return vaultRepo.getUserVault(this, userId);
  }

  async saveUserVault(userId: string, payload: string): Promise<{ version: number; updatedAt: number }> {
    return vaultRepo.saveUserVault(this, userId, payload);
  }

  async deleteUserVault(userId: string): Promise<boolean> {
    return vaultRepo.deleteUserVault(this, userId);
  }


  /* ------------------------- 搜索历史 ------------------------- */

  async recordSearch(userId: string, query: string, resultCount: number): Promise<void> {
    return historyRepo.recordSearch(this, userId, query, resultCount);
  }

  async listSearchHistory(userId: string, limit = 10): Promise<Array<{ query: string; resultCount: number; createdAt: number }>> {
    return historyRepo.listSearchHistory(this, userId, limit);
  }

  async clearSearchHistory(userId: string): Promise<void> {
    return historyRepo.clearSearchHistory(this, userId);
  }


  /* ------------------------- 用户 ------------------------- */

  async upsertOauthUser(input: { id?: string; username: string; email?: string | null; avatar?: string | null }): Promise<UserRecord> {
    return usersRepo.upsertOauthUser(this, input);
  }

  async getUser(idOrUsername: string): Promise<UserRecord | null> {
    return usersRepo.getUser(this, idOrUsername);
  }


  /* ------------------------- API 令牌 ------------------------- */

  async createApiToken(input: {
    name: string;
    tokenHash: string;
    scopes?: string;
    expiresAt?: number | null;
    /** 明文前缀（不含可还原部分），供列表页区分凭据 */
    tokenPrefix?: string | null;
  }): Promise<ApiTokenRecord> {
    return tokensRepo.createApiToken(this, input);
  }

  async updateApiToken(id: string, patch: { name?: string; scopes?: string; expiresAt?: number | null }): Promise<ApiTokenRecord | null> {
    return tokensRepo.updateApiToken(this, id, patch);
  }

  async rotateApiToken(
    id: string,
    tokenHash: string,
    expiresAt?: number | null,
    tokenPrefix?: string | null
  ): Promise<ApiTokenRecord | null> {
    return tokensRepo.rotateApiToken(this, id, tokenHash, expiresAt, tokenPrefix);
  }

  async revokeApiToken(id: string): Promise<ApiTokenRecord | null> {
    return tokensRepo.revokeApiToken(this, id);
  }

  async findApiTokenByHash(tokenHash: string): Promise<ApiTokenRecord | null> {
    return tokensRepo.findApiTokenByHash(this, tokenHash);
  }

  async touchApiToken(id: string): Promise<void> {
    return tokensRepo.touchApiToken(this, id);
  }

  async listApiTokens(): Promise<ApiTokenRecord[]> {
    return tokensRepo.listApiTokens(this);
  }

  async deleteApiToken(id: string): Promise<boolean> {
    return tokensRepo.deleteApiToken(this, id);
  }


  /* ------------------------- 合集 ------------------------- */

  async upsertCollection(input: {
    id?: string;
    slug: string;
    title: string;
    description?: string | null;
    kind?: "topic" | "geo" | "roadmap";
    icon?: string | null;
    sort?: number;
    enabled?: boolean;
    sites?: string[];
  }): Promise<Collection> {
    return collectionsRepo.upsertCollection(this, input);
  }

  async listCollections(onlyEnabled = true): Promise<Collection[]> {
    return collectionsRepo.listCollections(this, onlyEnabled);
  }

  async getCollectionBySlug(slug: string): Promise<Collection | null> {
    return collectionsRepo.getCollectionBySlug(this, slug);
  }

  async listCollectionSites(slug: string): Promise<Site[]> {
    return collectionsRepo.listCollectionSites(this, slug);
  }


  /* ------------------------- 榜单与分析 ------------------------- */

  async topQueries(days = 30, limit = 20): Promise<Array<{ query: string; count: number }>> {
    return analyticsRepo.topQueries(this, days, limit);
  }

  async zeroResultQueries(days = 30, limit = 20): Promise<Array<{ query: string; count: number; lastAt: number }>> {
    return analyticsRepo.zeroResultQueries(this, days, limit);
  }

  async hotSites(limit = 20): Promise<Site[]> {
    return analyticsRepo.hotSites(this, limit);
  }

  async newestSites(limit = 20): Promise<Site[]> {
    return analyticsRepo.newestSites(this, limit);
  }

  async getEmbedding(siteId: string): Promise<Float32Array | null> {
    return analyticsRepo.getEmbedding(this, siteId);
  }


  /* ------------------------- 任务队列 ------------------------- */

  async enqueueJob(kind: string, payload: unknown): Promise<string> {
    return jobsRepo.enqueueJob(this, kind, payload);
  }

  async claimNextJob(): Promise<JobRecord | null> {
    return jobsRepo.claimNextJob(this);
  }

  async completeJob(id: string, error?: string | null, opts: { retryAt?: number | null; exhausted?: boolean } | null = null): Promise<void> {
    return jobsRepo.completeJob(this, id, error, opts);
  }

  async listJobs(status?: string, limit = 50): Promise<JobRecord[]> {
    return jobsRepo.listJobs(this, status, limit);
  }

  async getJob(id: string): Promise<JobRecord | null> {
    return jobsRepo.getJob(this, id);
  }

  async cancelJob(id: string): Promise<boolean> {
    return jobsRepo.cancelJob(this, id);
  }

  async retryJob(id: string): Promise<JobRecord | null> {
    return jobsRepo.retryJob(this, id);
  }

  async pruneJobs(olderThanDays = 7, statuses: string[] = ["done", "failed", "cancelled"]): Promise<{ pruned: number }> {
    return jobsRepo.pruneJobs(this, olderThanDays, statuses);
  }

  async reapStaleJobs(timeoutMs = 15 * 60 * 1000): Promise<number> {
    return jobsRepo.reapStaleJobs(this, timeoutMs);
  }


  /* ------------------------- 系统状态 ------------------------- */

  async getSystemState<T = unknown>(key: string): Promise<T | null> {
    return systemRepo.getSystemState(this, key);
  }

  async setSystemState(key: string, value: unknown): Promise<void> {
    return systemRepo.setSystemState(this, key, value);
  }


  /* ------------------------- 任务队列 ------------------------- */

  async purgeExpiredDeletedSites(olderThanMs: number): Promise<number> {
    return jobsRepo.purgeExpiredDeletedSites(this, olderThanMs);
  }


  /* ------------------------- 分类与标签体系治理 (Taxonomy Governance) ------------------------- */

  async saveTaxonomyProposals(proposals: TaxonomyProposal[]): Promise<number> {
    return taxonomyRepo.saveTaxonomyProposals(this, proposals);
  }

  async listTaxonomyProposals(filter: { status?: string; kind?: string; limit?: number; offset?: number } = {}): Promise<{ items: TaxonomyProposal[]; total: number }> {
    return taxonomyRepo.listTaxonomyProposals(this, filter);
  }

  async getTaxonomyProposal(id: string): Promise<TaxonomyProposal | null> {
    return taxonomyRepo.getTaxonomyProposal(this, id);
  }

  async applyTaxonomyProposal(id: string, actor = "admin"): Promise<{ ok: boolean; message: string; proposal: TaxonomyProposal }> {
    return taxonomyRepo.applyTaxonomyProposal(this, id, actor);
  }

  async dismissTaxonomyProposal(id: string, actor = "admin"): Promise<{ ok: boolean; proposal: TaxonomyProposal }> {
    return taxonomyRepo.dismissTaxonomyProposal(this, id, actor);
  }

  async runTaxonomyAudit(options: { dryRun?: boolean; siteLimit?: number } = {}): Promise<{ proposalsCount: number; proposals: TaxonomyProposal[] }> {
    return taxonomyRepo.runTaxonomyAudit(this, options);
  }


  /* ------------------------- 插件市场 (Plugin Marketplace) ------------------------- */

  async createPlugin(input: pluginsRepo.PluginCreateInput, actor?: pluginsRepo.PluginActor): Promise<pluginsRepo.PluginRecord> {
    return pluginsRepo.createPlugin(this, input, actor);
  }

  async getPluginBySlug(slug: string): Promise<pluginsRepo.PluginRecord | null> {
    return pluginsRepo.getPluginBySlug(this, slug);
  }

  async listPlugins(filter: pluginsRepo.PluginListFilter = {}): Promise<{ items: pluginsRepo.PluginRecord[]; total: number }> {
    return pluginsRepo.listPlugins(this, filter);
  }

  async listPluginsByOwner(identity: string, filter: Omit<pluginsRepo.PluginListFilter, "ownerIdentity" | "status" | "ownerKey"> = {}): Promise<{ items: pluginsRepo.PluginRecord[]; total: number }> {
    return pluginsRepo.listPluginsByOwner(this, identity, filter);
  }

  async listPluginsByOwnerKey(ownerKey: string, filter: Omit<pluginsRepo.PluginListFilter, "ownerKey" | "status" | "ownerIdentity"> = {}): Promise<{ items: pluginsRepo.PluginRecord[]; total: number }> {
    return pluginsRepo.listPluginsByOwnerKey(this, ownerKey, filter);
  }

  async updatePlugin(slug: string, manifest: pluginsRepo.PluginManifest, actor?: pluginsRepo.PluginActor): Promise<pluginsRepo.PluginRecord> {
    return pluginsRepo.updatePlugin(this, slug, manifest, actor);
  }

  async submitPluginVersion(slug: string, manifest: pluginsRepo.PluginManifest, changelog: string | null, actor?: pluginsRepo.PluginActor): Promise<pluginsRepo.PluginRecord> {
    return pluginsRepo.submitPluginVersion(this, slug, manifest, changelog, actor);
  }

  async setPluginFeatured(slug: string, featured: boolean, rank: number, actor?: pluginsRepo.PluginActor): Promise<pluginsRepo.PluginRecord> {
    return pluginsRepo.setPluginFeatured(this, slug, featured, rank, actor);
  }

  async reviewPlugin(slug: string, action: pluginsRepo.PluginReviewAction, note: string | null = null, actor?: pluginsRepo.PluginActor): Promise<pluginsRepo.PluginRecord> {
    return pluginsRepo.reviewPlugin(this, slug, action, note, actor);
  }

  async installPlugin(slug: string, identity: string, actor?: pluginsRepo.PluginActor): Promise<pluginsRepo.PluginInstallResult> {
    return pluginsRepo.installPlugin(this, slug, identity, actor);
  }

  async getPluginBundleMembers(plugin: pluginsRepo.PluginRecord): Promise<pluginsRepo.PluginBundleMember[]> {
    return pluginsRepo.getPluginBundleMembers(this, plugin);
  }

  async uninstallPlugin(slug: string, identity: string, options: { removeSites?: boolean } = {}, actor?: pluginsRepo.PluginActor): Promise<pluginsRepo.PluginUninstallResult> {
    return pluginsRepo.uninstallPlugin(this, slug, identity, options, actor);
  }

  async getPluginInstall(pluginId: string, identity: string): Promise<pluginsRepo.PluginInstallRecord | null> {
    return pluginsRepo.getPluginInstall(this, pluginId, identity);
  }

  async starPlugin(slug: string, identity: string): Promise<{ starred: boolean; starCount: number }> {
    return pluginsRepo.starPlugin(this, slug, identity);
  }

  async unstarPlugin(slug: string, identity: string): Promise<{ starred: boolean; starCount: number }> {
    return pluginsRepo.unstarPlugin(this, slug, identity);
  }

  async reportPlugin(slug: string, input: { reason: string; identity?: string }, actor?: pluginsRepo.PluginActor): Promise<{ reportCount: number; status: pluginsRepo.PluginStatus; quarantined: boolean }> {
    return pluginsRepo.reportPlugin(this, slug, input, actor);
  }

  async pluginInteraction(pluginId: string, identity: string): Promise<{ installed: boolean; starred: boolean }> {
    return pluginsRepo.pluginInteraction(this, pluginId, identity);
  }

  async hasUserStarredPlugin(pluginId: string, identity: string): Promise<boolean> {
    return pluginsRepo.hasUserStarredPlugin(this, pluginId, identity);
  }

  async listPluginInstallsByIdentity(identity: string): Promise<pluginsRepo.PluginInstalledItem[]> {
    return pluginsRepo.listPluginInstallsByIdentity(this, identity);
  }

  async getPluginInstalledManifest(pluginId: string, identity: string): Promise<pluginsRepo.PluginManifest | null> {
    return pluginsRepo.getPluginInstalledManifest(this, pluginId, identity);
  }

  async getPluginTelemetry(): Promise<pluginsRepo.PluginTelemetryMetrics> {
    return pluginsRepo.getPluginTelemetry(this);
  }

  async listPluginVersions(pluginId: string): Promise<pluginsRepo.PluginVersionRecord[]> {
    return pluginsRepo.listPluginVersions(this, pluginId);
  }

  async getPluginVersion(pluginId: string, version: string): Promise<pluginsRepo.PluginVersionRecord | null> {
    return pluginsRepo.getPluginVersion(this, pluginId, version);
  }

  async createPluginReview(
    slug: string,
    identity: string,
    input: { rating: number; title?: string | null; content?: string | null },
    actor?: pluginsRepo.PluginActor,
  ): Promise<pluginsRepo.PluginReviewRecord> {
    return pluginsRepo.createPluginReview(this, slug, identity, input, actor);
  }

  async listPluginReviews(
    pluginId: string,
    options?: { limit?: number; offset?: number; includeHidden?: boolean },
  ): Promise<{ items: pluginsRepo.PluginReviewRecord[]; total: number }> {
    return pluginsRepo.listPluginReviews(this, pluginId, options);
  }

  async getPluginReviewStats(pluginId: string): Promise<pluginsRepo.PluginReviewStats> {
    return pluginsRepo.getPluginReviewStats(this, pluginId);
  }

  async getUserPluginReview(pluginId: string, identity: string): Promise<pluginsRepo.PluginReviewRecord | null> {
    return pluginsRepo.getUserPluginReview(this, pluginId, identity);
  }

  async listPluginReviewsForAdmin(options?: { status?: string; limit?: number; offset?: number }): Promise<{ items: pluginsRepo.PluginReviewAdminItem[]; total: number }> {
    return pluginsRepo.listPluginReviewsForAdmin(this, options);
  }

  async moderatePluginReview(reviewId: string, action: "hide" | "restore", note: string | null = null, actor?: pluginsRepo.PluginActor): Promise<pluginsRepo.PluginReviewRecord> {
    return pluginsRepo.moderatePluginReview(this, reviewId, action, note, actor);
  }

  async reportPluginReview(slug: string, reviewId: string, reason: string, reporterIdentity: string | null, actor?: pluginsRepo.PluginActor): Promise<pluginsRepo.PluginReviewRecord> {
    return pluginsRepo.reportPluginReview(this, slug, reviewId, reason, reporterIdentity, actor);
  }

  async getPluginFunnel(days = 30): Promise<pluginsRepo.PluginFunnelMetrics> {
    return pluginsRepo.getPluginFunnel(this, days);
  }

  async getPluginGovernanceAlerts(): Promise<pluginsRepo.PluginGovernanceAlert[]> {
    return pluginsRepo.getPluginGovernanceAlerts(this);
  }

  async createShortLink(input: { target: string; pluginSlug?: string | null }): Promise<pluginsRepo.ShortLinkRecord> {
    return pluginsRepo.createShortLink(this, input);
  }

  async resolveShortLink(code: string): Promise<pluginsRepo.ShortLinkRecord | null> {
    return pluginsRepo.resolveShortLink(this, code);
  }


  /* ------------------------- 底层执行 ------------------------- */

  /** @internal repository/* 域函数使用 */
  get enabledLiteral(): string {
    return ioRepo.getEnabledLiteral(this);
  }

  /** @internal repository/* 域函数使用 */
  async runCount(sqlText: string, params: unknown[]): Promise<number> {
    return ioRepo.runCount(this, sqlText, params);
  }

  /** @internal repository/* 域函数使用 */
  async raw(sqlText: string, params: unknown[] = []): Promise<Record<string, any>[]> {
    return ioRepo.raw(this, sqlText, params);
  }

  /** @internal repository/* 域函数使用 */
  async run(sqlText: string, params: unknown[] = []): Promise<void> {
    return ioRepo.run(this, sqlText, params);
  }

}
