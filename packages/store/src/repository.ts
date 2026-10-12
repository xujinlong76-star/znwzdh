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

export interface UserRecord {
  id: string;
  username: string;
  role: string;
  email: string | null;
  avatar: string | null;
  source: string;
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

  constructor(db: Db) {
    this.db = db;
  }

  /* ------------------------- 站点 ------------------------- */

  async listSites(filter: { categoryId?: string; status?: SiteStatus; limit?: number } = {}): Promise<Site[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.categoryId) { where.push("s.category_id = ?"); params.push(filter.categoryId); }
    if (filter.status) { where.push("s.status = ?"); params.push(filter.status); }
    const sqlText = this.selectSitesSql() +
      (where.length ? " WHERE " + where.join(" AND ") : "") +
      " GROUP BY s.id" +
      " ORDER BY s.sort ASC, s.weight DESC" +
      (filter.limit ? " LIMIT ?" : "");
    if (filter.limit) params.push(filter.limit);
    const rows = await this.raw(sqlText, params);
    return rows.map(rowToSite);
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
    const rows = await this.raw(this.selectSitesSql() + " WHERE s.id = ? OR s.url = ? LIMIT 1", [idOrUrl, idOrUrl]);
    const row = rows[0];
    return row ? rowToSite(row) : null;
  }

  async findSiteByUrl(url: string): Promise<Site | null> {
    const rows = await this.raw(this.selectSitesSql() + " WHERE s.url = ? LIMIT 1", [url]);
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
    const id = input.id;
    const now = Date.now();
    const index = buildIndexFields({ title: input.title ?? input.url, description: input.description, url: input.url, tags: input.tags });
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
  }

  async updateSite(id: string, patch: Partial<SiteInput>): Promise<Site | null> {
    const existing = await this.getSite(id);
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

    params.push(id);
    await this.run(`UPDATE sites SET ${sets.join(", ")} WHERE id = ?`, params);
    if (patch.tags !== undefined) await this.setSiteTags(id, patch.tags);
    return this.getSite(id);
  }

  async deleteSite(id: string): Promise<boolean> {
    await this.run("DELETE FROM site_tags WHERE site_id = ?", [id]);
    await this.run("DELETE FROM embeddings WHERE site_id = ?", [id]);
    await this.run("DELETE FROM sites WHERE id = ?", [id]);
    return true;
  }

  /** 重排：一次事务写多行 sort，避免前端拖拽后出现重复序号 */
  async reorderSites(order: Array<{ id: string; sort: number }>): Promise<void> {
    for (const o of order) {
      await this.run("UPDATE sites SET sort = ?, updated_at = ? WHERE id = ?", [o.sort, Date.now(), o.id]);
    }
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

  async stats(): Promise<{ sites: number; categories: number; tags: number; broken: number; pending: number }> {
    const one = async (q: string, p: unknown[] = []) => Number((await this.raw(q, p))[0]?.c ?? 0);
    return {
      sites: await one("SELECT COUNT(*) AS c FROM sites"),
      categories: await one("SELECT COUNT(*) AS c FROM categories"),
      tags: await one("SELECT COUNT(*) AS c FROM tags"),
      broken: await one("SELECT COUNT(*) AS c FROM sites WHERE status = ?", ["broken"]),
      pending: await one("SELECT COUNT(*) AS c FROM sites WHERE status = ?", ["pending"]),
    };
  }

  async recordEvent(kind: string, payload: { siteId?: string; query?: string; categoryId?: string; meta?: unknown } = {}): Promise<void> {
    await this.run(
      "INSERT INTO events (kind, site_id, query, category_id, meta, created_at) VALUES (?,?,?,?,?,?)",
      [kind, payload.siteId ?? null, payload.query ?? null, payload.categoryId ?? null,
       payload.meta === undefined ? null : JSON.stringify(payload.meta), Date.now()],
    );
  }

  async audit(entry: { actor: string; actorKind?: string; action: string; target?: string; diff?: unknown; ip?: string }): Promise<void> {
    await this.run(
      "INSERT INTO audit_logs (actor, actor_kind, action, target, diff, ip, created_at) VALUES (?,?,?,?,?,?,?)",
      [entry.actor, entry.actorKind ?? "user", entry.action, entry.target ?? null,
       entry.diff === undefined ? null : JSON.stringify(entry.diff), entry.ip ?? null, Date.now()],
    );
  }

  /* ------------------------- 行为统计 ------------------------- */

  /** 点击计数 + 最近点击时间（热度排序的原始信号） */
  async bumpVisit(siteId: string): Promise<void> {
    const now = Date.now();
    await this.run(
      "UPDATE sites SET visit_count = visit_count + 1, last_visited_at = ?, updated_at = ? WHERE id = ?",
      [now, now, siteId],
    );
  }

  /** 批量写入热度分（recompute_rank 任务用，一次事务多行） */
  async setTrendScores(scores: Array<{ id: string; trendScore: number }>): Promise<void> {
    const now = Date.now();
    for (const s of scores) {
      await this.run("UPDATE sites SET trend_score = ?, updated_at = ? WHERE id = ?", [s.trendScore, now, s.id]);
    }
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

  /** 合并标签：源标签的关联迁到目标（已关联的跳过），然后删源 */
  async mergeTags(sourceId: string, targetId: string): Promise<{ moved: number }> {
    if (sourceId === targetId) throw new Error("源标签与目标标签不能相同");
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

  async getUserProfile(userId: string): Promise<UserProfileRecord | null> {
    const row = (await this.raw("SELECT * FROM user_profiles WHERE user_id = ?", [userId]))[0];
    return row ? rowToProfile(row) : null;
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

  /* ------------------------- 搜索历史 ------------------------- */

  async recordSearch(userId: string, query: string, resultCount: number): Promise<void> {
    const q = query.trim();
    if (!q) return;
    await this.run(
      "INSERT INTO search_history (id, user_id, query, result_count, created_at) VALUES (?,?,?,?,?)",
      [randomUUID(), userId, q, resultCount, Date.now()],
    );
  }

  async listSearchHistory(userId: string, limit = 10): Promise<Array<{ query: string; resultCount: number; createdAt: number }>> {
    const rows = await this.raw(
      "SELECT query, result_count AS resultcount, created_at AS createdat FROM search_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
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

  /* ------------------------- 精选专题 ------------------------- */

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
        " WHERE ci.collection_id = ? AND s.enabled = " + this.enabledLiteral +
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
        " WHERE s.enabled = " + this.enabledLiteral + " AND s.status != 'archived'" +
        " GROUP BY s.id ORDER BY s.trend_score DESC, s.visit_count DESC, s.sort ASC LIMIT ?",
      [limit],
    );
    return rows.map(rowToSite);
  }

  /** 最新入库站点 */
  async newestSites(limit = 20): Promise<Site[]> {
    const rows = await this.raw(
      this.selectSitesSql() +
        " WHERE s.enabled = " + this.enabledLiteral + " AND s.status != 'archived'" +
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
      "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at) VALUES (?,?,?, 'pending', 0, ?, ?)",
      [id, kind, payload === undefined ? null : JSON.stringify(payload), now, now],
    );
    return id;
  }

  /** 取最早的一个 pending 并标记 running（单实例锁由调用方负责） */
  async claimNextJob(): Promise<JobRecord | null> {
    const rows = await this.raw("SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1", []);
    const row = rows[0];
    if (!row) return null;
    await this.run(
      "UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?",
      [Date.now(), String(row.id)],
    );
    return rowToJob(row);
  }

  async completeJob(id: string, error?: string | null): Promise<void> {
    await this.run(
      "UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?",
      [error ? "failed" : "done", error ?? null, Date.now(), id],
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
