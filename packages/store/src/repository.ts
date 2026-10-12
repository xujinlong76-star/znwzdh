import { randomUUID } from "node:crypto";
import { buildFtsTokens, pinyinTraits, type Category, type Site, type SiteStatus } from "@navhub/core";
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
  constructor(private db: Db) {}

  /* ------------------------- 站点 ------------------------- */

  async listSites(filter: { categoryId?: string; status?: SiteStatus; limit?: number } = {}): Promise<Site[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.categoryId) { where.push("category_id = ?"); params.push(filter.categoryId); }
    if (filter.status) { where.push("status = ?"); params.push(filter.status); }
    const sqlText =
      "SELECT * FROM sites" +
      (where.length ? " WHERE " + where.join(" AND ") : "") +
      " ORDER BY sort ASC, weight DESC" +
      (filter.limit ? " LIMIT ?" : "");
    if (filter.limit) params.push(filter.limit);
    const rows = await this.raw(sqlText, params);
    return rows.map(rowToSite);
  }

  async getSite(idOrUrl: string): Promise<Site | null> {
    const rows = await this.raw("SELECT * FROM sites WHERE id = ? OR url = ? LIMIT 1", [idOrUrl, idOrUrl]);
    const row = rows[0];
    return row ? rowToSite(row) : null;
  }

  async findSiteByUrl(url: string): Promise<Site | null> {
    const rows = await this.raw("SELECT * FROM sites WHERE url = ? LIMIT 1", [url]);
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
  async createCategory(input: { id?: string; title: string; parentId?: string | null; icon?: string | null; description?: string | null; sort?: number }): Promise<Category> {
    const id = input.id ?? randomUUID();
    let anchor = id;
    if (input.parentId) {
      const parent = await this.getCategory(input.parentId);
      if (!parent) throw new Error("父类目不存在: " + input.parentId);
      anchor = parent.anchor + "/" + id;
    }
    const now = Date.now();
    await this.run(
      "INSERT INTO categories (id, anchor, parent_id, title, description, icon, enabled, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [id, anchor, input.parentId ?? null, input.title, input.description ?? null, input.icon ?? null, 1, input.sort ?? 0, now, now],
    );
    const created = await this.getCategory(id);
    if (!created) throw new Error("创建类目后无法读回");
    return created;
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

  async deleteCategory(id: string): Promise<void> {
    await this.run("DELETE FROM sites WHERE category_id = ?", [id]);
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

  /* ------------------------- 底层执行 ------------------------- */

  private async raw(sqlText: string, params: unknown[]): Promise<Record<string, any>[]> {
    if (this.db.dialect === "sqlite") {
      const safe = params.map((p) => {
        if (typeof p === "boolean") return p ? 1 : 0;
        if (p instanceof Float32Array) return Buffer.from(p.buffer, p.byteOffset, p.byteLength);
        return p;
      });
      return this.db.sqlite!.prepare(sqlText).all(...safe) as Record<string, any>[];
    }
    let i = 0;
    const pgSql = sqlText.replace(/\?/g, () => "$" + ++i);
    const res = await this.db.pg!.query(pgSql, params);
    return res.rows as Record<string, any>[];
  }

  private async run(sqlText: string, params: unknown[]): Promise<void> {
    if (this.db.dialect === "sqlite") {
      const safe = params.map((p) => {
        if (typeof p === "boolean") return p ? 1 : 0;
        if (p instanceof Float32Array) return Buffer.from(p.buffer, p.byteOffset, p.byteLength);
        return p;
      });
      this.db.sqlite!.prepare(sqlText).run(...safe);
      return;
    }
    let i = 0;
    const pgSql = sqlText.replace(/\?/g, () => "$" + ++i);
    await this.db.pg!.query(pgSql, params);
  }
}

export function slugify(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\u4e00-\u9fff-]/g, "");
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
    tags: [],
    status: (row.status ?? "active") as SiteStatus,
    enabled: Boolean(row.enabled),
    sort: Number(row.sort ?? 0),
    weight: Number(row.weight ?? 0),
    featured: Boolean(row.featured),
    source: row.source ?? null,
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
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}
