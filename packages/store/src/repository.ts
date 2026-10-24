import { AsyncLocalStorage } from "node:async_hooks";
import {
  type Category,
  type Collection,
  type Site,
  type SiteRelation,
  type SiteStatus,
  type FacetGroupSummary,
  type SkosConcept,
  type TaxonomyProposal,
  type TaxonomyProposalKind,
  type SiteOfflineArchive,
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
import * as registrySeedRepo from "./repository/category-registry.ts";
import * as embeddingsRepo from "./repository/embeddings.ts";
import * as statsRepo from "./repository/stats.ts";
import * as dashboardRepo from "./repository/dashboard.ts";
import * as eventsRepo from "./repository/events.ts";
import * as llmUsageRepo from "./repository/llm-usage.ts";
import * as healthRepo from "./repository/health.ts";
import * as tagsRepo from "./repository/tags.ts";
import * as favoritesRepo from "./repository/favorites.ts";
import * as behaviorRepo from "./repository/behavior.ts";
import * as profilesRepo from "./repository/profiles.ts";
import * as vaultRepo from "./repository/vault.ts";
import * as workspaceBlobRepo from "./repository/workspace-blobs.ts";
import * as historyRepo from "./repository/history.ts";
import * as sessionsRepo from "./repository/sessions.ts";
import type { SessionDeviceRecord } from "./repository/sessions.ts";
import * as notificationsRepo from "./repository/notifications.ts";
import * as usersRepo from "./repository/users.ts";
import * as tokensRepo from "./repository/tokens.ts";
import * as collectionsRepo from "./repository/collections.ts";
import * as analyticsRepo from "./repository/analytics.ts";
import * as jobsRepo from "./repository/jobs.ts";
import * as systemRepo from "./repository/system.ts";
import * as llmConfigRepo from "./repository/llm-config.ts";
import * as maintenanceRepo from "./repository/maintenance.ts";
import * as taxonomyRepo from "./repository/taxonomy-governance.ts";
import * as pluginsRepo from "./repository/plugins.ts";
import * as ioRepo from "./repository/io.ts";
import * as identityRepo from "./repository/identity.ts";
import * as settingsRepo from "./repository/settings.ts";
import * as userDataRepo from "./repository/user-data.ts";
export * from "./repository/records.ts";
export { bindSqlite, normalizeTokenScopes, slugify, toPgSql } from "./repository/dialect.ts";
export { TOKEN_TOUCH_THROTTLE_MS } from "./repository/tokens.ts";
// 导入侧的条数上限要跟导出侧对齐，否则合法备份会被自己的上限拒掉
export { EXPORT_HISTORY_LIMIT, EXPORT_FAVORITES_LIMIT, EXPORT_SCHEMA_VERSION } from "./repository/user-data.ts";
export type { SessionDeviceRecord } from "./repository/sessions.ts";
export type { NotificationRecord } from "./repository/notifications.ts";
/**
 * 数据库访问闸门（读写锁）。
 *
 * SQLite 只有一个连接，事务一旦 BEGIN，任何在 `await` 期间插进来的普通查询
 * 都会落进这个事务；事务回滚时，普通查询的写入会被一起抹掉。
 * 事务持有写锁、普通查询持有读锁，确保「事务期间没有外部 SQL」。
 */
class DbAccessGate {
  private readers = 0;
  private writer = false;
  private readonly queue: Array<{ mode: "read" | "write"; resolve: () => void }> = [];

  async read<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire("read");
    try {
      return await fn();
    } finally {
      this.release("read");
    }
  }

  async write<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire("write");
    try {
      return await fn();
    } finally {
      this.release("write");
    }
  }

  private acquire(mode: "read" | "write"): Promise<void> {
    if (mode === "read" && !this.writer && this.queue.length === 0) {
      this.readers++;
      return Promise.resolve();
    }
    if (mode === "write" && !this.writer && this.readers === 0 && this.queue.length === 0) {
      this.writer = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push({ mode, resolve }));
  }

  private release(mode: "read" | "write"): void {
    if (mode === "write") this.writer = false;
    else this.readers--;
    this.drain();
  }

  private drain(): void {
    if (this.writer) return;
    const head = this.queue[0];
    if (!head) return;
    if (head.mode === "write") {
      if (this.readers > 0) return;
      this.queue.shift();
      this.writer = true;
      head.resolve();
      return;
    }
    while (this.queue[0]?.mode === "read") {
      const next = this.queue.shift()!;
      this.readers++;
      next.resolve();
    }
  }
}

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
  /**
   * 「当前异步上下文已在事务内」标记。
   *
   * 不能用实例上的计数器（原 `txDepth`）判断嵌套：那是**跨请求共享**的状态，
   * A 请求开事务后，B 请求看到计数 > 0 就会绕过 BEGIN 直接执行，
   * 其写入被并入 A 的事务 —— A 回滚时 B 已「提交」的数据一起消失。
   * AsyncLocalStorage 把判断范围收窄到「同一条异步调用链」，并发请求互不可见。
   */
  private readonly txContext = new AsyncLocalStorage<true>();
  /**
   * 事务 / 普通查询互斥闸门。
   *
   * SQLite 只有一个连接；PostgreSQL 分支为了原子性会临时把 `db.pg` 指向独占连接。
   * 事务期间必须阻止普通查询插进同一个连接，否则事务回滚会连带丢失外部写入。
   */
  private readonly dbGate = new DbAccessGate();

  constructor(db: Db) {
    this.db = db;
  }

  async withTransaction<T>(action: () => Promise<T>): Promise<T> {
    // 真嵌套（同一异步调用链）：复用外层事务，不重复 BEGIN
    if (this.txContext.getStore()) return action();

    // 写锁覆盖整个 BEGIN ... COMMIT，普通查询在此期间排队
    return this.dbGate.write(() => this.txContext.run(true, () => this.runTransaction(action)));
  }

  private async runTransaction<T>(action: () => Promise<T>): Promise<T> {
    if (this.db.dialect === "sqlite" && this.db.sqlite) {
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
    } else if (this.db.dialect === "pg" && this.db.pg) {
      // 必须在独占连接上跑 BEGIN/COMMIT，否则 pool 会把语句打散到不同连接，原子性丢失。
      const poolAny = this.db.pg as unknown as {
        query(sql: string, params?: unknown[]): Promise<unknown>;
        connect(): Promise<{ query(sql: string, params?: unknown[]): Promise<unknown>; release(): void }>;
      };
      if (typeof poolAny.connect === "function") {
        const client = await poolAny.connect();
        // 事务期间把 this.db.pg 临时指向该独占连接，保证内部 run/raw 走同一连接。
        // 因为事务已由 txLock 串行化，这里不会与另一个事务的替换互相覆盖。
        const origPg = this.db.pg;
        (this as unknown as { db: { pg: unknown } }).db.pg = client as never;
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
        }
      }
      try {
        await this.db.pg.query("BEGIN");
        const result = await action();
        await this.db.pg.query("COMMIT");
        return result;
      } catch (err) {
        try { await this.db.pg.query("ROLLBACK"); } catch { /* ignore */ }
        throw err;
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

  /** 批量 URL 去重：一次 IN 查询替代 N 次 findSiteByUrl（批量导入/恢复用）。 */
  async findExistingSiteUrls(urls: string[]): Promise<Set<string>> {
    return sitesRepo.findExistingSiteUrls(this, urls);
  }

  async createSite(input: SiteInput): Promise<Site> {
    return sitesRepo.createSite(this, input);
  }

  async createSiteWithId(input: SiteInput & { id: string }): Promise<Site> {
    return sitesRepo.createSiteWithId(this, input);
  }

  /**
   * 批量插入站点（备份恢复专用）：多值 INSERT + 批量标签 + 可选回读。
   * 语义与 createSite 的「新建」分支对齐，不处理软删 id 复活。
   */
  async insertSitesBulk(
    inputs: Array<SiteInput & { id: string; createdAt?: number }>,
    options: { hydrate?: boolean } = {},
  ): Promise<{ count: number; sites: Site[] }> {
    return sitesRepo.insertSitesBulk(this, inputs, options);
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

  async saveSiteArchive(archive: SiteOfflineArchive): Promise<void> {
    return sitesRepo.saveSiteArchive(this, archive);
  }

  async getLatestSiteArchive(siteId: string): Promise<SiteOfflineArchive | null> {
    return sitesRepo.getLatestSiteArchive(this, siteId);
  }

  /** @internal repository/* 域函数使用 */
  async upsertTag(name: string, slug: string, group = "topic"): Promise<string> {
    return sitesRepo.upsertTag(this, name, slug, group);
  }


  /* ------------------------- 类目 ------------------------- */

  async listCategories(): Promise<Category[]> {
    return categoriesRepo.listCategories(this);
  }

  async listCategoriesPage(
    filter: { limit?: number; offset?: number; parentId?: string | null; level?: number } = {}
  ): Promise<{ items: Category[]; total: number; limit: number; offset: number }> {
    return categoriesRepo.listCategoriesPage(this, filter);
  }

  async categorySiteCounts(): Promise<Array<{ categoryId: string; sites: number }>> {
    return categoriesRepo.categorySiteCounts(this);
  }

  async getCategory(id: string): Promise<Category | null> {
    return categoriesRepo.getCategory(this, id);
  }

  /** 按 slug 取类目（/category/{slug} 的读路径；slug 全局唯一） */
  async getCategoryBySlug(slug: string): Promise<Category | null> {
    return categoriesRepo.getCategoryBySlug(this, slug);
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
    /** 省略则由 titleEn/title 生成并自动避让全局冲突 */
    slug?: string | null;
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

  /** 「未分类」兜底类目（固定 id cat-uncategorized），缺则建 */
  async ensureUncategorized(): Promise<string> {
    return categoriesRepo.ensureUncategorized(this);
  }

  /** 站点归属的边界校验：类目存在且不是「一级根」（未分类除外）；写入口据此返回 400，成功时回吐解析后的真实 id */
  async checkSiteCategoryAttachment(
    categoryId: string | null | undefined,
  ): Promise<{ ok: true; categoryId: string | null } | { ok: false; error: string }> {
    return categoriesRepo.checkSiteCategoryAttachment(this, categoryId);
  }

  /** 权威树：补齐单个条目（含它的父级）；slug 不在树里返回 null，调用方走「未分类 + 提案」 */
  async ensureRegistryCategory(slug: string): Promise<Category | null> {
    return registrySeedRepo.ensureRegistryCategory(this, slug);
  }

  /** 权威树全量播种（幂等，装包/富化前都能安全调用） */
  async seedCategoryRegistry(): Promise<{ total: number; created: number; patched: number; failed: string[] }> {
    return registrySeedRepo.seedCategoryRegistry(this);
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
    patch: Partial<Pick<Category, "title" | "titleEn" | "slug" | "icon" | "description" | "enabled" | "sort" | "altLabels" | "relatedCategories">>
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

  /** 批量向量写入：一条多值 UPSERT，替代 N 次 saveEmbedding 往返。 */
  async saveEmbeddingsBatch(
    records: Array<{ siteId: string; model: string; vector: Float32Array }>,
  ): Promise<void> {
    return embeddingsRepo.saveEmbeddingsBatch(this, records);
  }

  async savedEmbeddings(filter?: {
    model?: string;
    dim?: number;
  }): Promise<Array<{ key: number; siteId: string; vector: Float32Array }>> {
    return embeddingsRepo.savedEmbeddings(this, filter);
  }

  async savePluginEmbedding(slug: string, model: string, vector: Float32Array): Promise<void> {
    return embeddingsRepo.savePluginEmbedding(this, slug, model, vector);
  }

  async savedPluginEmbeddings(filter?: {
    model?: string;
    dim?: number;
  }): Promise<Array<{ key: number; siteId: string; vector: Float32Array }>> {
    return embeddingsRepo.savedPluginEmbeddings(this, filter);
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

  /** 按身份的访问历史分页（T23：events kind=click），新在前 */
  async listVisitsPage(
    identity: string,
    limit: number,
    offset: number,
  ): Promise<{ items: eventsRepo.VisitItem[]; hasMore: boolean }> {
    return eventsRepo.listVisitsPage(this, identity, limit, offset);
  }

  /** 该身份的访问历史总条数（T23） */
  async countVisits(identity: string): Promise<number> {
    return eventsRepo.countVisits(this, identity);
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

  /* ------------------------------ LLM 用量 ------------------------------ */

  /** 记录一次模型调用（成功/失败都记；失败静默，不影响调用结果） */
  async recordLlmUsage(input: Parameters<typeof llmUsageRepo.recordLlmUsage>[1]): Promise<void> {
    return llmUsageRepo.recordLlmUsage(this, input);
  }

  /** 聚合窗口内用量（总量/成功率/p50/p95/按场景/按来源/真实小时分桶） */
  async aggregateLlmUsage(options: { since: number; until?: number; maxRows?: number }) {
    return llmUsageRepo.aggregateLlmUsage(this, options);
  }

  /** 窗口内用量合计（次数/token/失败数/最早一条）——额度闸门用，不拉明细 */
  async sumLlmUsage(options: {
    since: number;
    until?: number;
    identity?: string | null;
    excludeUserSource?: boolean;
  }) {
    return llmUsageRepo.sumLlmUsage(this, options);
  }

  /** 最近 N 条调用明细（新→旧） */
  async listRecentLlmUsage(limit = 20) {
    return llmUsageRepo.listRecentLlmUsage(this, limit);
  }

  /** 按 retention 清理旧用量，返回删除条数 */
  async pruneLlmUsage(before: number): Promise<number> {
    return llmUsageRepo.pruneLlmUsage(this, before);
  }

  async pruneHealthChecks(before: number): Promise<number> {
    return healthRepo.pruneHealthChecks(this, before);
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

  async removeTagAlias(alias: string, tagId?: string): Promise<void> {
    return tagsRepo.removeTagAlias(this, alias, tagId);
  }

  async listTagAliases(tagId?: string): Promise<TagAliasRecord[]> {
    return tagsRepo.listTagAliases(this, tagId);
  }

  async resolveTag(nameOrAlias: string): Promise<{ id: string; name: string; slug: string; group: string; description: string | null } | null> {
    return tagsRepo.resolveTag(this, nameOrAlias);
  }


  /* ------------------------- 收藏夹 ------------------------- */

  async listFavorites(userId: string): Promise<FavoriteRecord[]> {
    return favoritesRepo.listFavorites(this, userId);
  }

  /** 列表 UI 用的分页/检索版；导出与画像聚合仍走上面的全量 `listFavorites` */
  async listFavoritesPage(
    userId: string,
    query: favoritesRepo.FavoriteListQuery = {},
  ): Promise<favoritesRepo.FavoriteListPage> {
    return favoritesRepo.listFavoritesPage(this, userId, query);
  }

  async addFavorite(input: { userId: string; siteId: string; folderId?: string | null; note?: string | null; tags?: string[] | null }): Promise<{ favorite: FavoriteRecord; existed: boolean }> {
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

  async updateFavorite(
    userId: string,
    siteId: string,
    patch: { folderId?: string | null; note?: string | null },
  ): Promise<favoritesRepo.FavoriteUpdateResult> {
    return favoritesRepo.updateFavorite(this, userId, siteId, patch);
  }

  async clearFavorites(userId: string): Promise<number> {
    return favoritesRepo.clearFavorites(this, userId);
  }

  /** 增量拉取收藏（含墓碑）+ 水位 */
  async listFavoritesSince(userId: string, since: number): Promise<favoritesRepo.FavoriteSyncSlice> {
    return favoritesRepo.listFavoritesSince(this, userId, since);
  }

  /** 批量应用客户端收藏 ops（LWW + 事务） */
  async applyFavoriteOps(
    userId: string,
    ops: favoritesRepo.FavoriteOp[],
  ): Promise<{ applied: number; version: number }> {
    return favoritesRepo.applyFavoriteOps(this, userId, ops);
  }

  async updateFavoriteFolder(
    userId: string,
    folderId: string,
    patch: { name?: string; sort?: number },
  ): Promise<favoritesRepo.FavoriteFolderUpdateResult> {
    return favoritesRepo.updateFavoriteFolder(this, userId, folderId, patch);
  }


  /* ------------------------- 行为事件聚合 ------------------------- */

  async behaviorEvents(identity: string, since: number, limit = 500): Promise<Array<{ kind: string; siteId: string; categoryId: string | null; tags: string[]; createdAt: number }>> {
    return behaviorRepo.behaviorEvents(this, identity, since, limit);
  }

  async countSearches(userId: string): Promise<number> {
    return behaviorRepo.countSearches(this, userId);
  }

  async signalCounts(identity: string, since: number): Promise<{ click: number; favorite: number; searches: number }> {
    return behaviorRepo.signalCounts(this, identity, since);
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

  async deleteBehaviorEvents(identity: string, kind?: "click" | "favorite"): Promise<number> {
    return profilesRepo.deleteBehaviorEvents(this, identity, kind);
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

  /* --------------- 工作区明文存储（非 E2EE，见 workspace-blobs.ts） --------------- */

  async getWorkspaceBlob(key: string) {
    return workspaceBlobRepo.getWorkspaceBlob(this, key);
  }

  async saveWorkspaceBlob(key: string, payload: string): Promise<void> {
    return workspaceBlobRepo.saveWorkspaceBlob(this, key, payload);
  }

  async saveUserVaultIfUnchanged(
    userId: string,
    payload: string,
    expectedVersion: number,
  ): Promise<vaultRepo.VaultSaveResult> {
    return vaultRepo.saveUserVaultIfUnchanged(this, userId, payload, expectedVersion);
  }

  async deleteUserVault(userId: string): Promise<boolean> {
    return vaultRepo.deleteUserVault(this, userId);
  }


  /* ------------------------- 搜索历史 ------------------------- */

  async recordSearch(userId: string, query: string, resultCount: number): Promise<void> {
    return historyRepo.recordSearch(this, userId, query, resultCount);
  }

  async listSearchHistory(userId: string, limit = 10): Promise<historyRepo.SearchHistoryItem[]> {
    return historyRepo.listSearchHistory(this, userId, limit);
  }

  async listSearchHistoryPage(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: historyRepo.SearchHistoryItem[]; hasMore: boolean }> {
    return historyRepo.listSearchHistoryPage(this, userId, limit, offset);
  }

  async deleteSearchHistoryItem(userId: string, id: number): Promise<boolean> {
    return historyRepo.deleteSearchHistoryItem(this, userId, id);
  }

  /** 批量删除历史（T4）：按 id 集合，只删该身份的行，返回实际删除数 */
  async deleteSearchHistoryItems(userId: string, ids: number[]): Promise<number> {
    return historyRepo.deleteSearchHistoryItems(this, userId, ids);
  }

  /** 服务端筛选删除全部零结果历史（T4），返回删除数 */
  async deleteZeroResultSearchHistory(userId: string): Promise<number> {
    return historyRepo.deleteZeroResultSearchHistory(this, userId);
  }

  /** 按身份删除早于 cutoff 的历史（T11 保留期自动化），返回删除数 */
  async deleteSearchHistoryBefore(userId: string, cutoff: number): Promise<number> {
    return historyRepo.deleteSearchHistoryBefore(this, userId, cutoff);
  }

  /** 显式设置了非默认历史保留期的用户（T11） */
  async listCustomHistoryRetention(): Promise<Array<{ identity: string; retentionDays: number }>> {
    return settingsRepo.listCustomHistoryRetention(this);
  }

  async clearSearchHistory(userId: string): Promise<void> {
    return historyRepo.clearSearchHistory(this, userId);
  }

  /* --------------------------- 会话治理（T8） --------------------------- */

  /** BFF 每次代理 /api/me/* 时惰性登记会话活跃（幂等 upsert） */
  async upsertSessionActivity(input: { token: string; userId: string; userAgent?: string | null; expiresAt: number }): Promise<void> {
    return sessionsRepo.upsertSessionActivity(this, input);
  }

  /** 会话是否已被用户踢出；无行 = 旧会话/未路过 BFF → 未吊销（fail-open） */
  async isSessionRevoked(token: string): Promise<boolean> {
    return sessionsRepo.isSessionRevoked(this, token);
  }

  /** 设备列表：未吊销且未过期的会话，按最近活跃排序 */
  async listSessionDevices(userId: string): Promise<SessionDeviceRecord[]> {
    return sessionsRepo.listSessionDevices(this, userId);
  }

  /** 踢出设备；跨用户 token 无效返回 false */
  async revokeSessionDevice(userId: string, token: string): Promise<boolean> {
    return sessionsRepo.revokeSessionDevice(this, userId, token);
  }

  /* --------------------------- 站内通知（T13） --------------------------- */

  async createNotification(input: { identity: string; kind: string; title: string; body?: string | null }) {
    return notificationsRepo.createNotification(this, input);
  }

  /** 同 kind 通知的去重窗口（触发源据此降噪） */
  async hasRecentNotification(identity: string, kind: string, withinMs: number): Promise<boolean> {
    return notificationsRepo.hasRecentNotification(this, identity, kind, withinMs);
  }

  async listNotificationsPage(
    identity: string,
    limit: number,
    offset: number,
    unreadOnly: boolean,
  ): Promise<{ items: notificationsRepo.NotificationRecord[]; hasMore: boolean }> {
    return notificationsRepo.listNotificationsPage(this, identity, limit, offset, unreadOnly);
  }

  async countUnreadNotifications(identity: string): Promise<number> {
    return notificationsRepo.countUnreadNotifications(this, identity);
  }

  async markNotificationRead(identity: string, id: string): Promise<boolean> {
    return notificationsRepo.markNotificationRead(this, identity, id);
  }

  async markAllNotificationsRead(identity: string): Promise<number> {
    return notificationsRepo.markAllNotificationsRead(this, identity);
  }

  async countSearchHistory(userId: string): Promise<number> {
    return historyRepo.countSearchHistory(this, userId);
  }


  /* ------------------------- 用户 ------------------------- */

  async upsertOauthUser(input: { id?: string; username: string; email?: string | null; avatar?: string | null; source?: string }): Promise<UserRecord> {
    return usersRepo.upsertOauthUser(this, input);
  }

  async getUser(idOrUsername: string): Promise<UserRecord | null> {
    return usersRepo.getUser(this, idOrUsername);
  }

  async updateUserProfileInfo(
    identity: string,
    patch: { username?: string; avatar?: string | null; email?: string | null },
  ): Promise<{ ok: true; user: UserRecord } | { ok: false; reason: "username_taken" | "email_taken" | "invalid_input" }> {
    return usersRepo.updateUserProfileInfo(this, identity, patch);
  }

  /* ------------------------- 身份合并 / 用户中心 ------------------------- */

  /** 解析旧 anonId 到合并后的 canonical userId */
  async resolveIdentity(identity: string): Promise<string> {
    return identityRepo.resolveIdentity(this, identity);
  }

  /** 匿名身份 -> 登录身份（幂等、事务、写入别名与合并记录） */
  async mergeIdentity(source: string, target: string): Promise<identityRepo.IdentityMergeResult> {
    return identityRepo.mergeIdentity(this, source, target);
  }

  /** 用户中心概览聚合（计数 + 各域存在性 + 别名） */
  async getUserCenterOverview(identity: string): Promise<identityRepo.UserCenterOverview> {
    return identityRepo.getUserCenterOverview(this, identity);
  }

  /* ------------------------- 用户中心设置 / 数据主权 ------------------------- */

  async getUserSettings(identity: string): Promise<settingsRepo.UserSettingsRecord> {
    return settingsRepo.getUserSettings(this, identity);
  }

  async updateUserSettings(
    identity: string,
    patch: settingsRepo.UserSettingsPatch,
  ): Promise<settingsRepo.UserSettingsRecord> {
    return settingsRepo.updateUserSettings(this, identity, patch);
  }

  async deleteUserSettings(identity: string): Promise<void> {
    return settingsRepo.deleteUserSettings(this, identity);
  }

  /** 导出用户全部数据（密钥字段已脱敏，金库只带版本元信息） */
  async exportUserData(identity: string): Promise<userDataRepo.UserDataExport> {
    return userDataRepo.exportUserData(this, identity);
  }

  /** 注销：单事务级联删除该身份的全部用户数据 */
  async deleteUserData(identity: string): Promise<userDataRepo.UserDataDeletionCounts> {
    return userDataRepo.deleteUserData(this, identity);
  }


  /* ------------------------- API 令牌 ------------------------- */

  async createApiToken(input: {
    name: string;
    tokenHash: string;
    scopes?: string;
    expiresAt?: number | null;
    /** 明文前缀（不含可还原部分），供列表页区分凭据 */
    tokenPrefix?: string | null;
    /** 归属用户身份（T20）：非空 = 用户自建个人令牌 */
    ownerIdentity?: string | null;
  }): Promise<ApiTokenRecord> {
    return tokensRepo.createApiToken(this, input);
  }

  /** 用户自建令牌列表（T20）：只返回自己的、未吊销的 */
  async listApiTokensByOwner(ownerIdentity: string): Promise<ApiTokenRecord[]> {
    return tokensRepo.listApiTokensByOwner(this, ownerIdentity);
  }

  /** 用户吊销自己的令牌（ownership 校验在 SQL 条件里） */
  async revokeApiTokenByOwner(ownerIdentity: string, id: string): Promise<boolean> {
    return tokensRepo.revokeApiTokenByOwner(this, ownerIdentity, id);
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

  /** 长任务进度上报（只对 running 生效，同时刷新 updated_at 供僵尸判定） */
  async updateJobProgress(id: string, progress: { done: number; total: number }): Promise<void> {
    return jobsRepo.updateJobProgress(this, id, progress);
  }

  async claimNextJob(): Promise<JobRecord | null> {
    return jobsRepo.claimNextJob(this);
  }

  async completeJob(id: string, error?: string | null, opts: { retryAt?: number | null; exhausted?: boolean } | null = null): Promise<boolean> {
    return jobsRepo.completeJob(this, id, error, opts);
  }

  async heartbeatJob(id: string): Promise<boolean> {
    return jobsRepo.heartbeatJob(this, id);
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

  /** AI / MCP 建议了树里不存在的类目名时记账，而不是直接建根 */
  async recordCategoryGap(input: {
    title: string;
    siteId?: string;
    siteUrl?: string;
    source: string;
    ambiguousCategoryIds?: string[];
    reasonNote?: string;
  }): Promise<{ proposalId: string; seenCount: number }> {
    return taxonomyRepo.recordCategoryGap(this, input);
  }

  async listTaxonomyProposals(filter: { status?: string; kind?: string; limit?: number; offset?: number } = {}): Promise<{ items: TaxonomyProposal[]; total: number }> {
    return taxonomyRepo.listTaxonomyProposals(this, filter);
  }

  async getTaxonomyProposal(id: string): Promise<TaxonomyProposal | null> {
    return taxonomyRepo.getTaxonomyProposal(this, id);
  }

  async applyTaxonomyProposal(
    id: string,
    actor = "admin",
    overrides?: { parentId?: string | null; titleEn?: string | null; icon?: string | null }
  ): Promise<{ ok: boolean; message: string; proposal: TaxonomyProposal }> {
    return taxonomyRepo.applyTaxonomyProposal(this, id, actor, overrides);
  }

  async dismissTaxonomyProposal(id: string, actor = "admin"): Promise<{ ok: boolean; proposal: TaxonomyProposal }> {
    return taxonomyRepo.dismissTaxonomyProposal(this, id, actor);
  }

  async runTaxonomyAudit(options: { dryRun?: boolean; siteLimit?: number } = {}): Promise<{
    proposalsCount: number;
    proposals: TaxonomyProposal[];
    byKind: Partial<Record<TaxonomyProposalKind, number>>;
  }> {
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

  /** 已上架插件复审：只刷新审核结论，不改变 published 状态 */
  async recordPluginAuditNote(slug: string, note: string | null, at?: number): Promise<pluginsRepo.PluginRecord> {
    return pluginsRepo.recordPluginAuditNote(this, slug, note, at);
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

  /** 备份导入重放用：null=插件不存在，boolean=是否已星标 */
  async isPluginStarredBySlug(slug: string, identity: string): Promise<boolean | null> {
    return pluginsRepo.isPluginStarredBySlug(this, slug, identity);
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

  /* ---------------------- LLM 配置（系统/用户） ---------------------- */

  /** 读用户级 LLM 配置（原始 JSON，密钥为加密信封） */
  async getUserLlmConfig(identity: string): Promise<llmConfigRepo.UserLlmConfigRecord | null> {
    return llmConfigRepo.getUserLlmConfig(this, identity);
  }

  /** 写入/覆盖用户级 LLM 配置 */
  async upsertUserLlmConfig(identity: string, provider: Record<string, unknown>): Promise<void> {
    return llmConfigRepo.upsertUserLlmConfig(this, identity, provider);
  }

  /** 删除用户级 LLM 配置（回退系统默认） */
  async deleteUserLlmConfig(identity: string): Promise<void> {
    return llmConfigRepo.deleteUserLlmConfig(this, identity);
  }

  /** 删除系统状态键（「恢复环境变量默认」用） */
  async deleteSystemState(key: string): Promise<void> {
    return systemRepo.deleteSystemState(this, key);
  }


  /* ------------------------- 底层执行 ------------------------- */

  /** @internal repository/* 域函数使用 */
  get enabledLiteral(): string {
    return ioRepo.getEnabledLiteral(this);
  }

  /** @internal repository/* 域函数使用 */
  async runCount(sqlText: string, params: unknown[]): Promise<number> {
    if (this.txContext.getStore()) return ioRepo.runCount(this, sqlText, params);
    return this.dbGate.read(() => ioRepo.runCount(this, sqlText, params));
  }

  /** @internal repository/* 域函数使用 */
  async raw(sqlText: string, params: unknown[] = []): Promise<Record<string, any>[]> {
    if (this.txContext.getStore()) return ioRepo.raw(this, sqlText, params);
    return this.dbGate.read(() => ioRepo.raw(this, sqlText, params));
  }

  /** @internal repository/* 域函数使用 */
  async run(sqlText: string, params: unknown[] = []): Promise<void> {
    if (this.txContext.getStore()) return ioRepo.run(this, sqlText, params);
    return this.dbGate.read(() => ioRepo.run(this, sqlText, params));
  }

}
