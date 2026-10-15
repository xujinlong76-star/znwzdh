import { randomUUID } from "node:crypto";
import {
  buildFtsTokens,
  pinyinTraits,
  type Category,
  type Collection,
  type Site,
  type SiteStatus,
} from "@navhub/core";
import type { Db } from "./driver.ts";
import { hashSiteId } from "./vector/types.ts";

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

/** 把站点转成可索引形态：标题+描述+标签一起进语料 */
function buildIndexFields(input: { title: string; description?: string | null; url: string; tags?: string[] }) {
  const corpus = [input.title, input.description ?? "", ...(input.tags ?? [])].join(" ");
  return {
    ftsTokens: buildFtsTokens([input.title, input.description, input.url, ...(input.tags ?? [])]),
    pinyinFull: pinyinTraits(corpus).full,
    pinyinInitials: pinyinTraits(input.title).initials,
  };
}

export class Repository {
  /** 显式字段（不用参数属性语法：Node 的 strip-only 模式不支持） */
  private db: Db;
  private txDepth = 0;

  constructor(db: Db) {
    this.db = db;
  }

  /** 双方言事务包裹辅助方法（可重入：嵌套调用直接复用外层事务，避免 SQLITE BEGIN 嵌套报错） */
  async withTransaction<T>(action: () => Promise<T>): Promise<T> {
    if (this.txDepth > 0) return action();
    if (this.db.dialect === "sqlite" && this.db.sqlite) {
      this.db.sqlite.exec("BEGIN IMMEDIATE");
      this.txDepth++;
      try {
        const result = await action();
        this.db.sqlite.exec("COMMIT");
        return result;
      } catch (err) {
        try { this.db.sqlite.exec("ROLLBACK"); } catch { /* ignore */ }
        throw err;
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

  async listSites(filter: { categoryId?: string; status?: SiteStatus; limit?: number; offset?: number; source?: string } = {}): Promise<Site[]> {
    const where: string[] = ["s.deleted_at IS NULL"];
    const params: unknown[] = [];
    if (filter.categoryId) { where.push("s.category_id = ?"); params.push(filter.categoryId); }
    if (filter.status) { where.push("s.status = ?"); params.push(filter.status); }
    if (filter.source) { where.push("s.source = ?"); params.push(filter.source); }
    // 默认 limit 100、上限 1000：无限制的全表扫是慢查询主因；调用方需显式传 limit 覆盖。
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000);
    const offset = Math.max(0, filter.offset ?? 0);
    const sqlText = this.selectSitesSql() +
      " WHERE " + where.join(" AND ") +
      " GROUP BY s.id" +
      " ORDER BY s.sort ASC, s.weight DESC" +
      " LIMIT ? OFFSET ?";
    params.push(limit, offset);
    const rows = await this.raw(sqlText, params);
    return rows.map(rowToSite);
  }

  /**
   * 批量按 id 取站点（N+1 消除用）。
   * 空数组直接返回空 Map；分批每批 500 防 SQLite/PG 变量上限（SQLITE_MAX_VARIABLE_NUMBER / PG 65535）。
   */
  async getSitesByIds(ids: string[]): Promise<Map<string, Site>> {
    const out = new Map<string, Site>();
    const uniq = [...new Set(ids.filter(Boolean))];
    if (uniq.length === 0) return out;
    for (let i = 0; i < uniq.length; i += 500) {
      const chunk = uniq.slice(i, i + 500);
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = await this.raw(
        this.selectSitesSql() + " WHERE s.id IN (" + placeholders + ") AND s.deleted_at IS NULL",
        chunk,
      );
      for (const r of rows.map(rowToSite)) out.set(r.id, r);
    }
    return out;
  }

  /**
   * 站点查询的公共 SELECT。
   *
   * 必须带上标签聚合：最初 rowToSite 把 tags 硬编码成空数组，
   * 结果站点创建后 tags 能写进 site_tags 表，却**永远读不回来**。
   * 聚合函数在两种方言里名字不同（SQLite 用 group_concat，PG 用 string_agg），
   * 这是少数必须分支的地方。
   */
  private selectSitesSql(): string {
    const tagExpr = this.db.dialect === "sqlite"
      ? "(SELECT group_concat(t.slug, ',') FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE st.site_id = s.id)"
      : "(SELECT string_agg(t.slug, ',') FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE st.site_id = s.id)";
    return "SELECT s.*, " + tagExpr + " AS tag_slugs FROM sites s";
  }

  async getSite(idOrUrl: string): Promise<Site | null> {
    const rows = await this.raw(
      this.selectSitesSql() + " WHERE (s.id = ? OR s.url = ?) AND s.deleted_at IS NULL LIMIT 1",
      [idOrUrl, idOrUrl],
    );
    const row = rows[0];
    return row ? rowToSite(row) : null;
  }

  /** 软删除的站点（回收站）：正常查询一律排除，只有这里返回 */
  async getDeletedSite(id: string): Promise<Site | null> {
    const rows = await this.raw(
      this.selectSitesSql() + " WHERE s.id = ? AND s.deleted_at IS NOT NULL LIMIT 1",
      [id],
    );
    const row = rows[0];
    return row ? rowToSite(row) : null;
  }

  async findSiteByUrl(url: string): Promise<Site | null> {
    const rows = await this.raw(
      this.selectSitesSql() + " WHERE s.url = ? AND s.deleted_at IS NULL LIMIT 1",
      [url],
    );
    const row = rows[0];
    return row ? rowToSite(row) : null;
  }

  async createSite(input: SiteInput): Promise<Site> {
    return this.createSiteWithId({ ...input, id: randomUUID() });
  }

  /**
   * 用指定 id 创建站点。
   *
   * 存在的意义：NavSphere 前端提交的 navigation.json 里带有它自己生成的站点 id，
   * 如果我们在入库时换成新 id，前端后续针对该 id 的 PATCH/DELETE 就会全部落空。
   * 因此这条兼容路径必须保留调用方的 id。
   */
  async createSiteWithId(input: SiteInput & { id: string }): Promise<Site> {
    return this.withTransaction(async () => {
    const id = input.id;
    const now = Date.now();
    const index = buildIndexFields({ title: input.title ?? input.url, description: input.description, url: input.url, tags: input.tags });
    // 同 id 的软删行会让主键冲突（快照写回会用原 id 复活站点）——
    // 这里直接"复活"该行：清 deleted_at 并覆盖内容，语义等价于重建。
    const deleted = await this.getDeletedSite(id);
    if (deleted) {
      await this.run(
        `UPDATE sites SET url = ?, title = ?, description = ?, category_id = ?, sub_category_id = ?,
           icon_key = ?, status = ?, enabled = ?, sort = ?, featured = ?, source = ?,
           fts_tokens = ?, pinyin_full = ?, pinyin_initials = ?, deleted_at = NULL, updated_at = ?
         WHERE id = ?`,
        [
          input.url, input.title ?? input.url, input.description ?? null, input.categoryId,
          input.subCategoryId ?? null, input.iconKey ?? null, input.status ?? "active",
          input.enabled === false ? 0 : 1, input.sort ?? 0, input.featured ? 1 : 0,
          input.source ?? "manual", index.ftsTokens, index.pinyinFull, index.pinyinInitials, now, id,
        ],
      );
      if (input.tags?.length) await this.setSiteTags(id, input.tags);
      const revived = await this.getSite(id);
      if (!revived) throw new Error("复活站点后无法读回");
      return revived;
    }
    await this.run(
      `INSERT INTO sites (
         id, url, title, description, category_id, sub_category_id, icon_key, status, enabled, sort,
         weight, featured, source, fts_tokens, pinyin_full, pinyin_initials, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, input.url, input.title ?? input.url, input.description ?? null, input.categoryId,
        input.subCategoryId ?? null, input.iconKey ?? null, input.status ?? "active",
        input.enabled === false ? 0 : 1, input.sort ?? 0, 0, input.featured ? 1 : 0,
        input.source ?? "manual", index.ftsTokens, index.pinyinFull, index.pinyinInitials, now, now,
      ],
    );
    if (input.tags?.length) await this.setSiteTags(id, input.tags);
    const created = await this.getSite(id);
    if (!created) throw new Error("创建站点后无法读回");
    return created;
    });
  }

  async updateSite(id: string, patch: Partial<SiteInput>): Promise<Site | null> {
    const existing = await this.getSite(id);
    if (!existing) return null;
    return this.withTransaction(async () => {

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

    params.push(id);
    await this.run(`UPDATE sites SET ${sets.join(", ")} WHERE id = ?`, params);
    if (patch.tags !== undefined) await this.setSiteTags(id, patch.tags);
    return this.getSite(id);
    });
  }

  /**
   * 软删除（进回收站）：只打 deleted_at 戳，不删行、不动 site_tags/embeddings。
   *
   * 为什么：删除是可撤销操作——回收站里能看到、能恢复；
   * 同时保留向量与标签意味着「恢复」是瞬时的，不用重新索引。
   * url 的唯一约束是部分索引（WHERE deleted_at IS NULL），因此删完
   * 同 URL 站点可以立即重新添加。
   */
  async deleteSite(id: string): Promise<boolean> {
    await this.run("UPDATE sites SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL", [Date.now(), Date.now(), id]);
    return true;
  }

  /** 恢复软删站点：清 deleted_at（行、标签、向量都还在，无需重建索引） */
  async restoreSite(id: string): Promise<Site | null> {
    await this.run("UPDATE sites SET deleted_at = NULL, updated_at = ? WHERE id = ?", [Date.now(), id]);
    return this.getSite(id);
  }

  /** 永久删除：从回收站彻底清除（连带 site_tags / embeddings） */
  async purgeSite(id: string): Promise<boolean> {
    await this.withTransaction(async () => {
    await this.run("DELETE FROM site_tags WHERE site_id = ?", [id]);
    await this.run("DELETE FROM embeddings WHERE site_id = ?", [id]);
    await this.run("DELETE FROM sites WHERE id = ?", [id]);
    });
    return true;
  }

  /** 回收站列表（只含软删站点，倒序按删除时间） */
  async listDeletedSites(limit = 100): Promise<Site[]> {
    const rows = await this.raw(
      this.selectSitesSql() + " WHERE s.deleted_at IS NOT NULL GROUP BY s.id ORDER BY s.deleted_at DESC LIMIT ?",
      [limit],
    );
    return rows.map(rowToSite);
  }

  /** 重排：一次事务写多行 sort，避免前端拖拽后出现重复序号 */
  async reorderSites(order: Array<{ id: string; sort: number }>): Promise<void> {
    await this.withTransaction(async () => {
      const now = Date.now();
      for (const o of order) {
        await this.run("UPDATE sites SET sort = ?, updated_at = ? WHERE id = ?", [o.sort, now, o.id]);
      }
    });
  }

  async setSiteTags(siteId: string, tagNames: string[]): Promise<void> {
    await this.run("DELETE FROM site_tags WHERE site_id = ?", [siteId]);
    for (const raw of tagNames) {
      const name = raw.trim();
      if (!name) continue;
      const slug = slugify(name);
      const tagId = await this.upsertTag(name, slug);
      await this.run("INSERT INTO site_tags (site_id, tag_id) VALUES (?, ?)", [siteId, tagId]);
    }
  }

  private async upsertTag(name: string, slug: string): Promise<string> {
    const found = await this.raw("SELECT id FROM tags WHERE slug = ? LIMIT 1", [slug]);
    if (found[0]) return String(found[0].id);
    const id = randomUUID();
    await this.run("INSERT INTO tags (id, name, slug, created_at) VALUES (?,?,?,?)", [id, name, slug, Date.now()]);
    return id;
  }

  /* ------------------------- 类目 ------------------------- */

  async listCategories(): Promise<Category[]> {
    const rows = await this.raw("SELECT * FROM categories ORDER BY sort ASC, title ASC", []);
    return rows.map(rowToCategory);
  }

  async getCategory(id: string): Promise<Category | null> {
    const rows = await this.raw("SELECT * FROM categories WHERE id = ? LIMIT 1", [id]);
    const row = rows[0];
    return row ? rowToCategory(row) : null;
  }

  /** 物化路径：父 anchor + '/' + 自身 id，避免插入时父类尚不存在的循环外键问题 */
  async createCategory(input: { id?: string; title: string; parentId?: string | null; icon?: string | null; description?: string | null; sort?: number; source?: string | null }): Promise<Category> {
    const id = input.id ?? randomUUID();
    let anchor = id;
    if (input.parentId) {
      const parent = await this.getCategory(input.parentId);
      if (!parent) throw new Error("父类目不存在: " + input.parentId);
      anchor = parent.anchor + "/" + id;
    }
    const now = Date.now();
    await this.run(
      "INSERT INTO categories (id, anchor, parent_id, title, description, icon, enabled, sort, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [id, anchor, input.parentId ?? null, input.title, input.description ?? null, input.icon ?? null, 1, input.sort ?? 0, input.source ?? null, now, now],
    );
    const created = await this.getCategory(id);
    if (!created) throw new Error("创建类目后无法读回");
    return created;
  }

  /** 按标题取类目，不存在则创建（用于「未分类」兜底等场景） */
  async ensureCategory(title: string, source?: string): Promise<string> {
    const rows = await this.raw("SELECT id FROM categories WHERE title = ? LIMIT 1", [title]);
    if (rows[0]) return String(rows[0].id);
    const created = await this.createCategory({ title, source: source ?? "api" });
    return created.id;
  }

  /**
   * 移动类目（含全部后代的 anchor 级联更新）。
   * 环检测：不能移动到自己下面，也不能移动到自己的后代下面。
   */
  async moveCategory(id: string, parentId: string | null): Promise<Category | null> {
    const existing = await this.getCategory(id);
    if (!existing) return null;
    if (parentId === id) throw new Error("不能把类目移动到它自己下面");
    let parent: Category | null = null;
    if (parentId) {
      parent = await this.getCategory(parentId);
      if (!parent) throw new Error("目标父类目不存在: " + parentId);
      if (parent.anchor === existing.anchor || parent.anchor.startsWith(existing.anchor + "/")) {
        throw new Error("不能把类目移动到它的子类目下面（会成环）");
      }
    }
    const newAnchor = parent ? parent.anchor + "/" + id : id;
    if (existing.anchor !== newAnchor) {
      await this.replaceAnchorPrefix(existing.anchor, newAnchor);
    }
    await this.run("UPDATE categories SET parent_id = ?, updated_at = ? WHERE id = ?", [parentId ?? null, Date.now(), id]);
    return this.getCategory(id);
  }

  /** 把 oldPrefix 开头的全部 anchor 换成 newPrefix 开头（move / delete 共用） */
  private async replaceAnchorPrefix(oldPrefix: string, newPrefix: string): Promise<void> {
    const rows = await this.raw(
      "SELECT id, anchor FROM categories WHERE anchor = ? OR anchor LIKE ?",
      [oldPrefix, oldPrefix + "/%"],
    );
    const now = Date.now();
    for (const r of rows) {
      const next = newPrefix + String(r.anchor).slice(oldPrefix.length);
      await this.run("UPDATE categories SET anchor = ?, updated_at = ? WHERE id = ?", [next, now, String(r.id)]);
    }
  }

  /**
   * 合并类目：源类目（含后代）的站点全部迁入目标类目，然后删除源整棵子树。
   * 走审计（由调用方记录）。
   */
  async mergeCategories(sourceId: string, targetId: string): Promise<{ movedSites: number; removedCategories: number }> {
    if (sourceId === targetId) throw new Error("源类目与目标类目不能相同");
    const source = await this.getCategory(sourceId);
    if (!source) throw new Error("源类目不存在: " + sourceId);
    const target = await this.getCategory(targetId);
    if (!target) throw new Error("目标类目不存在: " + targetId);
    return this.withTransaction(async () => {

    const subtree = await this.raw(
      "SELECT id FROM categories WHERE anchor = ? OR anchor LIKE ?",
      [source.anchor, source.anchor + "/%"],
    );
    const ids = subtree.map((r) => String(r.id));
    const now = Date.now();
    let moved = 0;
    for (const cid of ids) {
      const sites = await this.listSites({ categoryId: cid });
      for (const s of sites) {
        await this.run(
          "UPDATE sites SET category_id = ?, sub_category_id = NULL, updated_at = ? WHERE id = ?",
          [targetId, now, s.id],
        );
        moved++;
      }
    }
    for (const cid of ids) await this.run("DELETE FROM categories WHERE id = ?", [cid]);
    return { movedSites: moved, removedCategories: ids.length };
    });
  }

  async updateCategory(id: string, patch: Partial<Pick<Category, "title" | "titleEn" | "icon" | "description" | "enabled" | "sort">>): Promise<Category | null> {
    const existing = await this.getCategory(id);
    if (!existing) return null;
    const sets: string[] = ["updated_at = ?"];
    const params: unknown[] = [Date.now()];
    const assign = (col: string, v: unknown) => { sets.push(col + " = ?"); params.push(v); };
    if (patch.title !== undefined) assign("title", patch.title);
    if (patch.titleEn !== undefined) assign("title_en", patch.titleEn);
    if (patch.icon !== undefined) assign("icon", patch.icon);
    if (patch.description !== undefined) assign("description", patch.description);
    if (patch.enabled !== undefined) assign("enabled", patch.enabled ? 1 : 0);
    if (patch.sort !== undefined) assign("sort", patch.sort);
    params.push(id);
    await this.run(`UPDATE categories SET ${sets.join(", ")} WHERE id = ?`, params);
    return this.getCategory(id);
  }

  /**
   * 删除类目。
   *
   * 语义变更（重要）：不再级联删除站点，而是把站点移入「未分类」。
   * 原因：NavSphere 快照全量对齐时会调本方法，旧行为会把经 API/MCP/AI
   * 创建（不在快照里）的站点一起删掉——那是真实的数据丢失。
   * 子类目提升到被删类目的父级，anchor 同步级联。
   */
  async deleteCategory(id: string): Promise<void> {
    const existing = await this.getCategory(id);
    if (!existing) return;
    await this.withTransaction(async () => {
    const now = Date.now();

    // 1. 直接子类目挂到被删类目的父级（根则 parent_id = NULL）
    await this.run("UPDATE categories SET parent_id = ?, updated_at = ? WHERE parent_id = ?", [existing.parentId, now, id]);

    // 2. 全部后代的 anchor 前缀替换（去掉被删节点那一级）
    if (existing.parentId) {
      const parent = await this.getCategory(existing.parentId);
      if (parent) await this.replaceAnchorPrefix(existing.anchor, parent.anchor);
    } else {
      // 挂到根：新前缀为空串，即去掉 "oldAnchor/" 这一段
      const rows = await this.raw("SELECT id, anchor FROM categories WHERE anchor LIKE ?", [existing.anchor + "/%"]);
      for (const r of rows) {
        const rest = String(r.anchor).slice(existing.anchor.length + 1); // 去掉 "oldAnchor/"
        await this.run("UPDATE categories SET anchor = ?, updated_at = ? WHERE id = ?", [rest, now, String(r.id)]);
      }
    }

    // 3. 站点移入「未分类」而不是删除
    const fallback = await this.ensureCategory("未分类", "api");
    await this.run("UPDATE sites SET category_id = ?, updated_at = ? WHERE category_id = ?", [fallback, now, id]);

    // 4. 最后删除类目自身
    await this.run("DELETE FROM categories WHERE id = ?", [id]);
    });
  }

  /* ------------------------- 向量 ------------------------- */

  async saveEmbedding(siteId: string, model: string, vector: Float32Array): Promise<void> {
    const buf = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
    await this.run(
      `INSERT INTO embeddings (site_id, model, dim, vector, updated_at) VALUES (?,?,?,?,?)
       ON CONFLICT (site_id) DO UPDATE SET model = excluded.model, dim = excluded.dim, vector = excluded.vector, updated_at = excluded.updated_at`,
      [siteId, model, vector.length, buf, Date.now()],
    );
  }

  async savedEmbeddings(): Promise<Array<{ key: number; siteId: string; vector: Float32Array }>> {
    const rows = await this.raw("SELECT site_id AS siteId, vector FROM embeddings", []);
    const out: Array<{ key: number; siteId: string; vector: Float32Array }> = [];
    for (const r of rows) {
      const buf = r.vector as Buffer | Uint8Array | null;
      if (!buf) continue;
      const bytes = buf instanceof Uint8Array ? buf : Buffer.from(buf as ArrayBuffer);
      const copy = Buffer.from(bytes);
      out.push({
        key: hashSiteId(String(r.siteId)),
        siteId: String(r.siteId),
        vector: new Float32Array(copy.buffer, copy.byteOffset, Math.floor(copy.byteLength / 4)),
      });
    }
    return out;
  }

  /* ------------------------- 统计与事件 ------------------------- */

  async stats(): Promise<{ sites: number; categories: number; tags: number; broken: number; pending: number; trashed: number }> {
    const one = async (q: string, p: unknown[] = []) => Number((await this.raw(q, p))[0]?.c ?? 0);
    return {
      sites: await one("SELECT COUNT(*) AS c FROM sites WHERE deleted_at IS NULL"),
      categories: await one("SELECT COUNT(*) AS c FROM categories"),
      tags: await one("SELECT COUNT(*) AS c FROM tags"),
      broken: await one("SELECT COUNT(*) AS c FROM sites WHERE status = ? AND deleted_at IS NULL", ["broken"]),
      pending: await one("SELECT COUNT(*) AS c FROM sites WHERE status = ? AND deleted_at IS NULL", ["pending"]),
      // 回收站里的数量——让运营者知道还有可恢复的数据
      trashed: await one("SELECT COUNT(*) AS c FROM sites WHERE deleted_at IS NOT NULL"),
    };
  }

  /**
   * 记录一条行为/统计事件。
   *
   * identity（登录 userId 或匿名 anonId）落**独立列**（events.identity + 索引），
   * 供 behaviorEvents / deleteBehaviorEvents 等值过滤。
   * meta 里仍保留 identity 键（向后兼容旧数据/读方），但查询不再依赖 meta LIKE。
   * 显式 payload.identity 优先；否则从 meta.identity 提取（兼容既有调用点）。
   */
  async recordEvent(kind: string, payload: { siteId?: string; query?: string; categoryId?: string; identity?: string; meta?: unknown } = {}): Promise<void> {
    const metaIdentity = typeof payload.meta === "object" && payload.meta !== null
      ? (payload.meta as { identity?: unknown }).identity
      : undefined;
    const identity = payload.identity
      ?? (typeof metaIdentity === "string" ? metaIdentity : undefined)
      ?? null;
    await this.run(
      "INSERT INTO events (kind, site_id, query, category_id, meta, identity, created_at) VALUES (?,?,?,?,?,?,?)",
      [kind, payload.siteId ?? null, payload.query ?? null, payload.categoryId ?? null,
       payload.meta === undefined ? null : JSON.stringify(payload.meta), identity, Date.now()],
    );
  }

  async audit(entry: { actor: string; actorKind?: string; action: string; target?: string; diff?: unknown; ip?: string }): Promise<void> {
    await this.run(
      "INSERT INTO audit_logs (actor, actor_kind, action, target, diff, ip, created_at) VALUES (?,?,?,?,?,?,?)",
      [entry.actor, entry.actorKind ?? "user", entry.action, entry.target ?? null,
       entry.diff === undefined ? null : JSON.stringify(entry.diff), entry.ip ?? null, Date.now()],
    );
  }

  /**
   * 审计日志查询（倒序分页 + 可选过滤）。
   *
   * 与 events/search_history 一样用「多取 1 条」探针判断 hasMore，避免 COUNT 往返。
   * 追加页与首页用同一条件 → 拼接一致。
   */
  async listAuditLogs(filter: {
    limit?: number;
    offset?: number;
    action?: string;
    actor?: string;
  } = {}): Promise<{ items: AuditLogRecord[]; hasMore: boolean }> {
    const wheres: string[] = [];
    const params: unknown[] = [];
    if (filter.action) { wheres.push("action = ?"); params.push(filter.action); }
    if (filter.actor) { wheres.push("actor = ?"); params.push(filter.actor); }
    const where = wheres.length ? " WHERE " + wheres.join(" AND ") : "";
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const offset = Math.max(0, filter.offset ?? 0);
    params.push(limit + 1, offset);
    const rows = await this.raw(
      `SELECT * FROM audit_logs${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      params,
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: page.map(rowToAuditLog), hasMore };
  }

  /** 出现过的 action 全集（供过滤下拉；审计量大时也是「谁在动库」的概览） */
  async listAuditActions(limit = 50): Promise<string[]> {
    const rows = await this.raw(
      "SELECT action, MAX(id) AS newest FROM audit_logs GROUP BY action ORDER BY newest DESC LIMIT ?",
      [limit],
    );
    return rows.map((r) => String(r.action));
  }

  /* ------------------------- 行为统计 ------------------------- */

  /** 写回健康巡检结果（health_checks 表 + sites 的冗余列） */
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
    const now = Date.now();
    await this.run(
      `UPDATE sites SET http_status = ?, health_ok = ?, latency_ms = ?, redirect_to = ?,
              health_error = ?, last_checked_at = ?, status = ? WHERE id = ?`,
      [
        health.httpStatus, health.ok, health.latencyMs, health.redirectTo, health.error, now,
        health.ok ? (health.currentStatus ?? "active") : (health.markBroken === false ? (health.currentStatus ?? "active") : "broken"),
        siteId,
      ],
    );
    await this.run(
      "INSERT INTO health_checks (site_id, checked_at, ok, http_status, latency_ms, redirect_to, error) VALUES (?,?,?,?,?,?,?)",
      [siteId, now, health.ok, health.httpStatus, health.latencyMs, health.redirectTo, health.error],
    );
  }

  /**
   * 健康巡检历史（趋势数据源）：取 since 之后的检查记录。
   *
   * 刻意**返回原始行而不是按天聚合**——按天分桶在两种方言里写法完全不同
   * （SQLite `strftime('%Y-%m-%d', …)` vs PG `to_char(to_timestamp(…), …)`），
   * 由调用方在 JS 里分桶可完全避开方言分支。
   */
  async healthCheckSeries(since: number, limit = 5000): Promise<Array<{ siteId: string; checkedAt: number; ok: boolean; latencyMs: number | null }>> {
    const rows = await this.raw(
      "SELECT site_id, checked_at, ok, latency_ms FROM health_checks WHERE checked_at >= ? ORDER BY checked_at ASC LIMIT ?",
      [since, limit],
    );
    return rows.map((r) => ({
      siteId: String(r.site_id),
      checkedAt: Number(r.checked_at ?? 0),
      ok: r.ok === null || r.ok === undefined ? false : Boolean(r.ok),
      latencyMs: r.latency_ms === null || r.latency_ms === undefined ? null : Number(r.latency_ms),
    }));
  }

  /** 点击计数 + 最近点击时间（热度排序的原始信号） */
  async bumpVisit(siteId: string): Promise<void> {
    const now = Date.now();
    await this.run(
      "UPDATE sites SET visit_count = visit_count + 1, last_visited_at = ?, updated_at = ? WHERE id = ?",
      [now, now, siteId],
    );
  }

  /** 批量写入热度分（recompute_rank 任务用，同步更新 weight 并包裹事务） */
  async setTrendScores(scores: Array<{ id: string; trendScore: number }>): Promise<void> {
    await this.withTransaction(async () => {
      const now = Date.now();
      for (const s of scores) {
        await this.run("UPDATE sites SET trend_score = ?, weight = ?, updated_at = ? WHERE id = ?", [s.trendScore, s.trendScore, now, s.id]);
      }
    });
  }

  /* ------------------------- 标签管理 ------------------------- */

  /** 标签云：带站点计数，按计数降序 */
  async listTagsWithCounts(minCount = 1): Promise<TagWithCount[]> {
    const rows = await this.raw(
      "SELECT t.id, t.name, t.slug, COUNT(st.site_id) AS cnt " +
        "FROM tags t LEFT JOIN site_tags st ON st.tag_id = t.id " +
        "GROUP BY t.id, t.name, t.slug HAVING COUNT(st.site_id) >= ? " +
        "ORDER BY cnt DESC, t.name ASC",
      [minCount],
    );
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      slug: String(r.slug),
      count: Number(r.cnt ?? 0),
    }));
  }

  async renameTag(id: string, newName: string): Promise<void> {
    const name = newName.trim();
    if (!name) throw new Error("标签名不能为空");
    await this.run("UPDATE tags SET name = ?, slug = ? WHERE id = ?", [name, slugify(name), id]);
  }

  /**
   * 删除标签：解除它与所有站点的关联，然后删标签行。
   *
   * 站点侧无需处理——tags 是通过 site_tags 关联实时聚合出来的（见 selectSitesSql），
   * 关联删掉后站点的 tags 自动不再包含该标签。
   */
  async deleteTag(id: string): Promise<{ unbound: number }> {
    const found = await this.raw("SELECT id FROM tags WHERE id = ? LIMIT 1", [id]);
    if (!found.length) throw new Error("标签不存在");
    return this.withTransaction(async () => {
    const affected = await this.raw(
      "SELECT s.id, s.title, s.description, s.url FROM sites s JOIN site_tags st ON st.site_id = s.id WHERE st.tag_id = ?",
      [id],
    );
    await this.run("DELETE FROM site_tags WHERE tag_id = ?", [id]);
    await this.run("DELETE FROM tags WHERE id = ?", [id]);
    // 站点的 fts_tokens / pinyin_full 是「标题+描述+标签」拼出来的（见 buildIndexFields）。
    // 关联删了但索引不刷新的话，搜已删标签**仍然会命中**这些站点——
    // 属于静默不一致（不报错，只是结果不对），必须就地重算。
    for (const r of affected) {
      const siteId = String(r.id);
      const rest = await this.raw(
        "SELECT t.slug FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE st.site_id = ?",
        [siteId],
      );
      const index = buildIndexFields({
        title: String(r.title),
        description: r.description ?? null,
        url: String(r.url),
        tags: rest.map((t) => String(t.slug)),
      });
      await this.run(
        "UPDATE sites SET fts_tokens = ?, pinyin_full = ?, pinyin_initials = ?, updated_at = ? WHERE id = ?",
        [index.ftsTokens, index.pinyinFull, index.pinyinInitials, Date.now(), siteId],
      );
    }
    return { unbound: affected.length };
    });
  }

  /** 合并标签：源标签的关联迁到目标（已关联的跳过），然后删源 */
  async mergeTags(sourceId: string, targetId: string): Promise<{ moved: number }> {
    if (sourceId === targetId) throw new Error("源标签与目标标签不能相同");
    return this.withTransaction(async () => {
      const rows = await this.raw(
        "SELECT site_id FROM site_tags WHERE tag_id = ? AND site_id NOT IN (SELECT site_id FROM site_tags WHERE tag_id = ?)",
        [sourceId, targetId],
      );
      for (const r of rows) {
        await this.run(
          "UPDATE site_tags SET tag_id = ? WHERE tag_id = ? AND site_id = ?",
          [targetId, sourceId, String(r.site_id)],
        );
      }
      await this.run("DELETE FROM site_tags WHERE tag_id = ?", [sourceId]);
      await this.run("DELETE FROM tags WHERE id = ?", [sourceId]);
      return { moved: rows.length };
    });
  }

  /* ------------------------- 收藏夹 ------------------------- */

  async listFavorites(userId: string): Promise<FavoriteRecord[]> {
    const rows = await this.raw(
      "SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC",
      [userId],
    );
    return rows.map(rowToFavorite);
  }

  /** 收藏；已收藏时返回 existed=true（不报错，语义同 create_site 的 URL 去重） */
  async addFavorite(input: { userId: string; siteId: string; folderId?: string | null; note?: string | null }): Promise<{ favorite: FavoriteRecord; existed: boolean }> {
    const existing = await this.raw(
      "SELECT * FROM favorites WHERE user_id = ? AND site_id = ? LIMIT 1",
      [input.userId, input.siteId],
    );
    const existingRow = existing[0];
    if (existingRow) return { favorite: rowToFavorite(existingRow), existed: true };
    const id = randomUUID();
    const now = Date.now();
    await this.run(
      "INSERT INTO favorites (id, user_id, site_id, folder_id, note, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      [id, input.userId, input.siteId, input.folderId ?? null, input.note ?? null, now, now],
    );
    const row = (await this.raw("SELECT * FROM favorites WHERE id = ?", [id]))[0];
    if (!row) throw new Error("创建收藏后无法读回");
    return { favorite: rowToFavorite(row), existed: false };
  }

  async removeFavorite(userId: string, siteId: string): Promise<boolean> {
    const changes = await this.runCount("DELETE FROM favorites WHERE user_id = ? AND site_id = ?", [userId, siteId]);
    return changes > 0;
  }

  async listFavoriteFolders(userId: string): Promise<FavoriteFolderRecord[]> {
    const rows = await this.raw(
      "SELECT * FROM favorite_folders WHERE user_id = ? ORDER BY sort ASC, created_at ASC",
      [userId],
    );
    return rows.map(rowToFolder);
  }

  async createFavoriteFolder(userId: string, name: string): Promise<FavoriteFolderRecord> {
    const id = randomUUID();
    const now = Date.now();
    await this.run(
      "INSERT INTO favorite_folders (id, user_id, name, sort, created_at) VALUES (?,?,?,?,?)",
      [id, userId, name.trim(), 0, now],
    );
    const row = (await this.raw("SELECT * FROM favorite_folders WHERE id = ?", [id]))[0];
    if (!row) throw new Error("创建收藏夹后无法读回");
    return rowToFolder(row);
  }

  /** 删文件夹：内部收藏变为未分组（不删收藏） */
  async deleteFavoriteFolder(userId: string, folderId: string): Promise<void> {
    const now = Date.now();
    await this.run(
      "UPDATE favorites SET folder_id = NULL, updated_at = ? WHERE user_id = ? AND folder_id = ?",
      [now, userId, folderId],
    );
    await this.run("DELETE FROM favorite_folders WHERE id = ? AND user_id = ?", [folderId, userId]);
  }

  /* ------------------------- 个性化画像 ------------------------- */

  /* ------------------------- 个性化聚合 ------------------------- */

  /**
   * 取某身份的近期行为事件（click/favorite），附带站点类目与标签。
   *
   * identity 走独立列等值过滤（events.identity + events_identity_idx）——
   * 旧实现是 meta JSON 的 LIKE '%..."identity":"..."%'，无法走索引且随
   * events 表增长变慢。历史行的 identity 由启动时 migrateEventIdentity 回填。
   */
  async behaviorEvents(identity: string, since: number, limit = 500): Promise<Array<{ kind: string; siteId: string; categoryId: string | null; tags: string[]; createdAt: number }>> {
    const tagExpr = this.db.dialect === "sqlite"
      ? "(SELECT group_concat(t.slug, ',') FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE st.site_id = e.site_id)"
      : "(SELECT string_agg(t.slug, ',') FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE st.site_id = e.site_id)";
    const rows = await this.raw(
      `SELECT e.kind AS kind, e.site_id AS siteid, s.category_id AS categoryid,
              ${tagExpr} AS tagslugs, e.created_at AS createdat
         FROM events e LEFT JOIN sites s ON s.id = e.site_id
        WHERE e.kind IN ('click', 'favorite') AND e.created_at >= ?
          AND e.identity = ?
        ORDER BY e.created_at DESC LIMIT ?`,
      [since, identity, limit],
    );
    return rows
      .filter((r) => r.siteid)
      .map((r) => ({
        kind: String(r.kind),
        siteId: String(r.siteid),
        categoryId: r.categoryid ?? null,
        tags: r.tagslugs ? String(r.tagslugs).split(",").filter(Boolean) : [],
        createdAt: Number(r.createdat ?? 0),
      }));
  }

  async countSearches(userId: string): Promise<number> {
    const rows = await this.raw("SELECT COUNT(*) AS c FROM search_history WHERE user_id = ?", [userId]);
    return Number(rows[0]?.c ?? 0);
  }

  /** 近 N 天每站点的点击次数（recompute_rank 用） */
  async clickCountsSince(since: number): Promise<Map<string, number>> {
    const rows = await this.raw(
      "SELECT site_id AS siteid, COUNT(*) AS c FROM events WHERE kind = 'click' AND site_id IS NOT NULL AND created_at >= ? GROUP BY site_id",
      [since],
    );
    const out = new Map<string, number>();
    for (const r of rows) out.set(String(r.siteid), Number(r.c ?? 0));
    return out;
  }

  /** 近 N 天每站点的被收藏次数（recompute_rank 用） */
  async favoriteCountsSince(since: number): Promise<Map<string, number>> {
    const rows = await this.raw(
      "SELECT site_id AS siteid, COUNT(*) AS c FROM favorites WHERE created_at >= ? GROUP BY site_id",
      [since],
    );
    const out = new Map<string, number>();
    for (const r of rows) out.set(String(r.siteid), Number(r.c ?? 0));
    return out;
  }

  async getUserProfile(userId: string): Promise<UserProfileRecord | null> {
    const row = (await this.raw("SELECT * FROM user_profiles WHERE user_id = ?", [userId]))[0];
    return row ? rowToProfile(row) : null;
  }

  async deleteUserProfile(userId: string): Promise<void> {
    await this.run("DELETE FROM user_profiles WHERE user_id = ?", [userId]);
  }

  /**
   * 删除某身份的行为事件（click/favorite，identity 走独立列等值过滤）。
   * 「重置个性化」用——events 同时供 recompute_rank 统计点击热度，
   * 因此这里只删该 identity 的行，不碰匿名/其他身份的事件。
   * 历史行（identity 列为 NULL 但 meta 里有身份）由启动时回填覆盖，无需 LIKE 兜底。
   */
  async deleteBehaviorEvents(identity: string): Promise<number> {
    const rows = await this.raw(
      "SELECT COUNT(*) AS c FROM events WHERE kind IN ('click','favorite') AND identity = ?",
      [identity],
    );
    const removed = Number(rows[0]?.c ?? 0);
    await this.run("DELETE FROM events WHERE kind IN ('click','favorite') AND identity = ?", [identity]);
    return removed;
  }

  async saveUserProfile(userId: string, profile: Omit<UserProfileRecord, "userId" | "updatedAt">): Promise<void> {
    const now = Date.now();
    await this.run(
      `INSERT INTO user_profiles (user_id, top_categories, top_tags, visited_site_ids, favorite_site_ids, search_count, updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT (user_id) DO UPDATE SET
         top_categories = excluded.top_categories,
         top_tags = excluded.top_tags,
         visited_site_ids = excluded.visited_site_ids,
         favorite_site_ids = excluded.favorite_site_ids,
         search_count = excluded.search_count,
         updated_at = excluded.updated_at`,
      [
        userId,
        JSON.stringify(profile.topCategories),
        JSON.stringify(profile.topTags),
        JSON.stringify(profile.visitedSiteIds),
        JSON.stringify(profile.favoriteSiteIds),
        profile.searchCount,
        now,
      ],
    );
  }

  /* ------------------- E2EE 零知识云端金库同步 ------------------- */

  async getUserVault(userId: string): Promise<UserVaultRecord | null> {
    const rows = await this.raw(
      "SELECT user_id, payload, version, updated_at AS updatedat FROM user_vault_sync WHERE user_id = ? LIMIT 1",
      [userId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      userId: String(row.user_id),
      payload: String(row.payload),
      version: Number(row.version ?? 1),
      updatedAt: Number(row.updatedat ?? 0),
    };
  }

  async saveUserVault(userId: string, payload: string): Promise<{ version: number; updatedAt: number }> {
    const now = Date.now();
    await this.run(
      `INSERT INTO user_vault_sync (user_id, payload, version, updated_at)
       VALUES (?,?, 1, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         payload = excluded.payload,
         version = user_vault_sync.version + 1,
         updated_at = excluded.updated_at`,
      [userId, payload, now],
    );
    const updated = await this.getUserVault(userId);
    return {
      version: updated?.version ?? 1,
      updatedAt: updated?.updatedAt ?? now,
    };
  }

  async deleteUserVault(userId: string): Promise<boolean> {
    await this.run("DELETE FROM user_vault_sync WHERE user_id = ?", [userId]);
    return true;
  }

  /* ------------------------- 搜索历史 ------------------------- */

  async recordSearch(userId: string, query: string, resultCount: number): Promise<void> {
    const q = query.trim();
    if (!q) return;
    // id 自增：同毫秒的多条记录也能按插入顺序稳定排序
    await this.run(
      "INSERT INTO search_history (user_id, query, result_count, created_at) VALUES (?,?,?,?)",
      [userId, q, resultCount, Date.now()],
    );
  }

  async listSearchHistory(userId: string, limit = 10): Promise<Array<{ query: string; resultCount: number; createdAt: number }>> {
    // 自增 id 作次级排序键：created_at 同毫秒时按真实插入顺序
    const rows = await this.raw(
      "SELECT query, result_count AS resultcount, created_at AS createdat FROM search_history WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
      [userId, limit],
    );
    return rows.map((r) => ({
      query: String(r.query),
      resultCount: Number(r.resultcount ?? 0),
      createdAt: Number(r.createdat ?? 0),
    }));
  }

  async clearSearchHistory(userId: string): Promise<void> {
    await this.run("DELETE FROM search_history WHERE user_id = ?", [userId]);
  }

  /* ------------------------- 终端用户 ------------------------- */

  /**
   * OAuth 登录用户 upsert。
   * 先按 username 找，再按 email 找（同一人换登录方式也能归一）；
   * 新用户 role=user（区别于内置管理员 admin）。
   */
  async upsertOauthUser(input: { id?: string; username: string; email?: string | null; avatar?: string | null }): Promise<UserRecord> {
    let row = (await this.raw("SELECT * FROM users WHERE username = ? LIMIT 1", [input.username]))[0];
    if (!row && input.email) {
      row = (await this.raw("SELECT * FROM users WHERE email = ? LIMIT 1", [input.email]))[0];
    }
    if (row) {
      await this.run(
        "UPDATE users SET email = COALESCE(?, email), avatar = COALESCE(?, avatar), source = 'github' WHERE id = ?",
        [input.email ?? null, input.avatar ?? null, String(row.id)],
      );
      const updated = (await this.raw("SELECT * FROM users WHERE id = ?", [String(row.id)]))[0];
      if (!updated) throw new Error("更新用户后无法读回");
      return rowToUser(updated);
    }
    const id = input.id ?? randomUUID();
    // password_hash 为 NOT NULL；OAuth 用户无密码，置空串（本系统登录走 next-auth 会话，不查密码）
    await this.run(
      "INSERT INTO users (id, username, password_hash, role, email, avatar, source, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [id, input.username, "", "user", input.email ?? null, input.avatar ?? null, "github", Date.now()],
    );
    return { id, username: input.username, role: "user", email: input.email ?? null, avatar: input.avatar ?? null, source: "github" };
  }

  async getUser(idOrUsername: string): Promise<UserRecord | null> {
    const row = (await this.raw("SELECT * FROM users WHERE id = ? OR username = ? LIMIT 1", [idOrUsername, idOrUsername]))[0];
    return row ? rowToUser(row) : null;
  }

  /* ------------------------- API Token ------------------------- */

  /**
   * 创建 API token 记录。
   *
   * 只存 token_hash（sha256 十六进制），**永不落明文**：
   * 调用方在创建时拿到明文一次，之后无法再从库里还原。
   * scopes 用逗号分隔存储（与 api_tokens 表定义一致）。
   */
  async createApiToken(input: {
    name: string;
    tokenHash: string;
    scopes?: string;
    expiresAt?: number | null;
  }): Promise<ApiTokenRecord> {
    const id = randomUUID();
    const now = Date.now();
    await this.run(
      "INSERT INTO api_tokens (id, name, token_hash, scopes, expires_at, created_at) VALUES (?,?,?,?,?,?)",
      [id, input.name, input.tokenHash, input.scopes ?? "read", input.expiresAt ?? null, now],
    );
    return { id, name: input.name, scopes: (input.scopes ?? "read").split(",").map((s) => s.trim()).filter(Boolean), expiresAt: input.expiresAt ?? null, lastUsedAt: null, createdAt: now };
  }

  /**
   * 按明文 token 查记录。
   *
   * 调用方先算出 sha256 再传入——本方法只做哈希列的等值查询。
   * 查不到返回 null；过期的 token 同样返回 null（由调用方视为无效）。
   */
  async findApiTokenByHash(tokenHash: string): Promise<ApiTokenRecord | null> {
    const row = (await this.raw("SELECT * FROM api_tokens WHERE token_hash = ? LIMIT 1", [tokenHash]))[0];
    if (!row) return null;
    if (row.expires_at != null && Number(row.expires_at) < Date.now()) return null;
    return rowToApiToken(row);
  }

  /** 刷新最近使用时间；失败不影响鉴权主流程 */
  async touchApiToken(id: string): Promise<void> {
    await this.run("UPDATE api_tokens SET last_used_at = ? WHERE id = ?", [Date.now(), id]);
  }

  /** 列出全部 token（不含 hash——列表页不泄露凭据） */
  async listApiTokens(): Promise<ApiTokenRecord[]> {
    const rows = await this.raw("SELECT * FROM api_tokens ORDER BY created_at DESC", []);
    return rows.map(rowToApiToken);
  }

  async deleteApiToken(id: string): Promise<boolean> {
    await this.run("DELETE FROM api_tokens WHERE id = ?", [id]);
    return true;
  }

  /* ------------------------- 精选专题 ------------------------- */

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
    const slug = input.slug.trim();
    if (!slug) throw new Error("专题 slug 不能为空");
    const existing = await this.getCollectionBySlug(slug);
    const id = existing?.id ?? input.id ?? randomUUID();
    const now = Date.now();
    const kind = input.kind ?? "topic";
    const sort = input.sort ?? 0;
    const enabled = input.enabled !== false;
    const icon = input.icon ?? null;
    const description = input.description ?? null;

    await this.withTransaction(async () => {
      if (existing) {
        await this.run(
          "UPDATE collections SET title = ?, description = ?, kind = ?, icon = ?, sort = ?, enabled = ?, updated_at = ? WHERE id = ?",
          [input.title, description, kind, icon, sort, enabled ? 1 : 0, now, id],
        );
      } else {
        await this.run(
          "INSERT INTO collections (id, slug, title, description, kind, icon, sort, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
          [id, slug, input.title, description, kind, icon, sort, enabled ? 1 : 0, now, now],
        );
      }

      if (input.sites && Array.isArray(input.sites)) {
        await this.run("DELETE FROM collection_items WHERE collection_id = ?", [id]);
        let itemSort = 0;
        for (const siteRef of input.sites) {
          const site = await this.getSite(siteRef);
          if (site) {
            await this.run(
              "INSERT INTO collection_items (collection_id, site_id, sort, note) VALUES (?,?,?,?)",
              [id, site.id, itemSort++, null],
            );
          }
        }
      }
    });

    const saved = await this.getCollectionBySlug(slug);
    if (!saved) throw new Error("保存专题后无法读回: " + slug);
    return saved;
  }

  async listCollections(onlyEnabled = true): Promise<Collection[]> {
    const rows = await this.raw("SELECT * FROM collections ORDER BY sort ASC, title ASC", []);
    return rows.map(rowToCollection).filter((c) => !onlyEnabled || c.enabled);
  }

  async getCollectionBySlug(slug: string): Promise<Collection | null> {
    const row = (await this.raw("SELECT * FROM collections WHERE slug = ? LIMIT 1", [slug]))[0];
    return row ? rowToCollection(row) : null;
  }

  async listCollectionSites(slug: string): Promise<Site[]> {
    const col = await this.getCollectionBySlug(slug);
    if (!col) return [];
    const rows = await this.raw(
      this.selectSitesSql() +
        " JOIN collection_items ci ON ci.site_id = s.id" +
        " WHERE ci.collection_id = ? AND s.enabled = " + this.enabledLiteral + " AND s.deleted_at IS NULL" +
        " GROUP BY s.id ORDER BY ci.sort ASC",
      [col.id],
    );
    return rows.map(rowToSite);
  }

  /* ------------------------- 统计分析 ------------------------- */

  /** 热门搜索词（指导补录与运营） */
  async topQueries(days = 30, limit = 20): Promise<Array<{ query: string; count: number }>> {
    const since = Date.now() - days * 86_400_000;
    const rows = await this.raw(
      "SELECT query, COUNT(*) AS cnt FROM events " +
        "WHERE kind = 'search' AND query IS NOT NULL AND query != '' AND created_at >= ? " +
        "GROUP BY query ORDER BY cnt DESC LIMIT ?",
      [since, limit],
    );
    return rows.map((r) => ({ query: String(r.query), count: Number(r.cnt ?? 0) }));
  }

  /** 零结果搜索词（用户找了但库里没有） */
  async zeroResultQueries(days = 30, limit = 20): Promise<Array<{ query: string; count: number; lastAt: number }>> {
    const since = Date.now() - days * 86_400_000;
    const rows = await this.raw(
      "SELECT query, COUNT(*) AS cnt, MAX(created_at) AS lastat FROM events " +
        "WHERE kind = 'zero_result' AND created_at >= ? " +
        "GROUP BY query ORDER BY cnt DESC LIMIT ?",
      [since, limit],
    );
    return rows.map((r) => ({ query: String(r.query), count: Number(r.cnt ?? 0), lastAt: Number(r.lastat ?? 0) }));
  }

  /** 热度榜站点（trend_score 优先，点击数为辅） */
  async hotSites(limit = 20): Promise<Site[]> {
    const rows = await this.raw(
      this.selectSitesSql() +
        " WHERE s.enabled = " + this.enabledLiteral + " AND s.status != 'archived' AND s.deleted_at IS NULL" +
        " GROUP BY s.id ORDER BY s.trend_score DESC, s.visit_count DESC, s.sort ASC LIMIT ?",
      [limit],
    );
    return rows.map(rowToSite);
  }

  /** 最新入库站点 */
  async newestSites(limit = 20): Promise<Site[]> {
    const rows = await this.raw(
      this.selectSitesSql() +
        " WHERE s.enabled = " + this.enabledLiteral + " AND s.status != 'archived' AND s.deleted_at IS NULL" +
        " GROUP BY s.id ORDER BY s.created_at DESC LIMIT ?",
      [limit],
    );
    return rows.map(rowToSite);
  }

  /** 读回单个站点的向量（相似推荐用；没有则返回 null） */
  async getEmbedding(siteId: string): Promise<Float32Array | null> {
    const row = (await this.raw("SELECT vector FROM embeddings WHERE site_id = ?", [siteId]))[0];
    const raw = row?.vector;
    if (!raw) return null;
    const buf = raw instanceof Uint8Array ? Buffer.from(raw) : Buffer.from(raw as ArrayBuffer);
    if (buf.byteLength < 4) return null;
    return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  }

  /* ------------------------- 任务队列 ------------------------- */

  async enqueueJob(kind: string, payload: unknown): Promise<string> {
    const id = randomUUID();
    const now = Date.now();
    await this.run(
      // next_run_at 显式置 NULL：重试/重入同一语义 = 立即可被认领
      "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at, next_run_at) VALUES (?,?,?, 'pending', 0, ?, ?, NULL)",
      [id, kind, payload === undefined ? null : JSON.stringify(payload), now, now],
    );
    return id;
  }

  /**
   * 取最早的一个**到点** pending 并标记 running（单实例锁由调用方负责）。
   *
   * `next_run_at IS NULL OR <= now`：失败退避的任务在到点前不被认领——
   * 否则一个必失败的坏任务会每 30s 抢占一次队列、把正常任务饿死。
   * 复合索引 (status, next_run_at) 覆盖这个查询。
   *
   * 原子性：旧实现 SELECT + UPDATE 分两步，多 worker 并发会重复认领同一任务。
   * PG 用单条 UPDATE...FROM (SELECT...FOR UPDATE SKIP LOCKED)...RETURNING 原子认领；
   * SQLite 用 BEGIN IMMEDIATE 事务包裹 SELECT+UPDATE（withTransaction 已是 IMMEDIATE，写锁互斥）。
   */
  async claimNextJob(): Promise<JobRecord | null> {
    if (this.db.dialect === "pg") {
      const now = Date.now();
      const rows = await this.raw(
        "WITH next AS (" +
          "SELECT id FROM jobs WHERE status = 'pending' AND (next_run_at IS NULL OR next_run_at <= ?) " +
          "ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED" +
          ") UPDATE jobs SET status = 'running', attempts = attempts + 1, next_run_at = NULL, updated_at = ? " +
          "FROM next WHERE jobs.id = next.id RETURNING jobs.*",
        [now, now],
      );
      const row = rows[0];
      return row ? rowToJob(row) : null;
    }
    return this.withTransaction(async () => {
      const rows = await this.raw(
        "SELECT * FROM jobs WHERE status = 'pending' AND (next_run_at IS NULL OR next_run_at <= ?) ORDER BY created_at ASC LIMIT 1",
        [Date.now()],
      );
      const row = rows[0];
      if (!row) return null;
      await this.run(
        "UPDATE jobs SET status = 'running', attempts = attempts + 1, next_run_at = NULL, updated_at = ? WHERE id = ? AND status = 'pending'",
        [Date.now(), String(row.id)],
      );
      // 返回更新后的行（attempts 已 +1），调用方拿到的就是最新状态
      const updated = (await this.raw("SELECT * FROM jobs WHERE id = ?", [String(row.id)]))[0];
      return updated ? rowToJob(updated) : rowToJob(row);
    });
  }

  /**
   * 收尾任务。三态：
   *   done    成功
   *   retry   失败但还有重试机会（回 pending，next_run_at = 退避后时间）
   *   failed  重试耗尽（maxAttempts）
   *
   * 之前只有 done/failed 两态且失败即终态——瞬时抖动（网络/磁盘）会直接把
   * 任务打死，且失败任务永远留在 failed 列表里没有「重试」语义。
   */
  async completeJob(id: string, error?: string | null, opts: { retryAt?: number | null; exhausted?: boolean } | null = null): Promise<void> {
    const now = Date.now();
    if (error && !opts?.exhausted && opts?.retryAt) {
      await this.run(
        "UPDATE jobs SET status = 'pending', error = ?, next_run_at = ?, updated_at = ? WHERE id = ?",
        [error, opts.retryAt, now, id],
      );
      return;
    }
    await this.run(
      "UPDATE jobs SET status = ?, error = ?, next_run_at = NULL, updated_at = ? WHERE id = ?",
      [error ? "failed" : "done", error ?? null, now, id],
    );
  }

  async listJobs(status?: string, limit = 50): Promise<JobRecord[]> {
    const rows = status
      ? await this.raw("SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?", [status, limit])
      : await this.raw("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", [limit]);
    return rows.map(rowToJob);
  }

  /* ------------------------- 底层执行 ------------------------- */

  /** SQLite 的 "启用中" 字面量；PG 必须是 TRUE（布尔 = 整数会直接报错） */
  private get enabledLiteral(): string {
    return this.db.dialect === "sqlite" ? "1" : "TRUE";
  }

  /** 执行写操作并返回受影响行数（双方言） */
  private async runCount(sqlText: string, params: unknown[]): Promise<number> {
    if (this.db.dialect === "sqlite") {
      const info = this.db.sqlite!.prepare(sqlText).run(...bindSqlite(params)) as { changes?: number };
      return Number(info?.changes ?? 0);
    }
    const res = await this.db.pg!.query(toPgSql(sqlText), params);
    return Number(res.rowCount ?? 0);
  }

  private async raw(sqlText: string, params: unknown[]): Promise<Record<string, any>[]> {
    if (this.db.dialect === "sqlite") {
      return this.db.sqlite!.prepare(sqlText).all(...bindSqlite(params)) as Record<string, any>[];
    }
    const res = await this.db.pg!.query(toPgSql(sqlText), params);
    // PostgreSQL 折叠未加引号的别名为小写，这里统一归一化，读取侧用小写键
    return (res.rows as Record<string, unknown>[]).map((r) => {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(r)) out[k.toLowerCase()] = r[k];
      return out as Record<string, any>;
    });
  }

  private async run(sqlText: string, params: unknown[]): Promise<void> {
    if (this.db.dialect === "sqlite") {
      this.db.sqlite!.prepare(sqlText).run(...bindSqlite(params));
      return;
    }
    await this.db.pg!.query(toPgSql(sqlText), params);
  }
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

function rowToSite(row: Record<string, any>): Site {
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
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

function rowToCategory(row: Record<string, any>): Category {
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

function rowToFavorite(row: Record<string, any>): FavoriteRecord {
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

function rowToFolder(row: Record<string, any>): FavoriteFolderRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    sort: Number(row.sort ?? 0),
    createdAt: Number(row.created_at ?? 0),
  };
}

function rowToProfile(row: Record<string, any>): UserProfileRecord {
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

function rowToJob(row: Record<string, any>): JobRecord {
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

function rowToUser(row: Record<string, any>): UserRecord {
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
function rowToApiToken(row: Record<string, any>): ApiTokenRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    scopes: String(row.scopes ?? "read").split(",").map((s: string) => s.trim()).filter(Boolean),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
    createdAt: Number(row.created_at ?? 0),
  };
}

/** diff 列在库里是 JSON 文本，读出时解析；损坏则保留原字符串（不让整页查询挂掉） */
function rowToAuditLog(row: Record<string, any>): AuditLogRecord {
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
function rowToCollection(row: Record<string, any>): Collection {
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
