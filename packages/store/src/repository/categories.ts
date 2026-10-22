import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";
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
  type SkosConcept,
  UNCATEGORIZED_CATEGORY_ID,
  UNCATEGORIZED_CATEGORY_TITLE,
  categorySlug,
  categoryToSkosConcept,
} from "@navhub/core";
import type {
  ApiTokenRecord,
  AuditLogRecord,
  CategoryDistributionItem,
  CategorySemanticDetail,
  DashboardOverview,
  FavoriteFolderRecord,
  FavoriteRecord,
  JobRecord,
  MaintenanceStatus,
  SecurityOverview,
  SiteInput,
  TagWithCount,
  UserProfileRecord,
  UserRecord,
  UserVaultRecord,
} from "./records.ts";
import {
  bindSqlite,
  buildIndexFields,
  normalizeTokenScopes,
  packMetadata,
  rowToApiToken,
  rowToAuditLog,
  rowToCategory,
  rowToCollection,
  rowToFavorite,
  rowToFolder,
  rowToJob,
  rowToProfile,
  rowToSite,
  rowToUser,
  slugify,
  toPgSql,
} from "./dialect.ts";
import type { Db } from "../driver.ts";
import { chunkList, inPredicate } from "../sql-in.ts";

export async function listCategories(repo: Repository): Promise<Category[]> {
  const rows = await repo.raw("SELECT * FROM categories ORDER BY sort ASC, title ASC", []);
  return rows.map(rowToCategory);
}

/**
 * 有界分页读取类目。
 *
 * `listCategories()` 的全量口径要保留（SKOS 导出、快照构建都要整棵树），
 * 但 HTTP 接口不能再无条件返回全表：类目树上线后是 154 行量级，
 * 一旦治理失手就是几百行 × 每次请求。分页参数由路由层收窄后再进来。
 *
 * `parentId === null` → 只要根；字符串 → 只要该父的直接子级；
 * 两者都不传 → 全树（再配 `level` 可按「根 / 非根」粗筛）。
 */
export async function listCategoriesPage(
  repo: Repository,
  filter: { limit?: number; offset?: number; parentId?: string | null; level?: number } = {}
): Promise<{ items: Category[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 200), 1), 500);
  const offset = Math.max(Math.trunc(filter.offset ?? 0), 0);
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.parentId === null) where.push("parent_id IS NULL");
  else if (typeof filter.parentId === "string") {
    where.push("parent_id = ?");
    params.push(filter.parentId);
  } else if (filter.level === 1) where.push("parent_id IS NULL");
  else if (filter.level === 2) where.push("parent_id IS NOT NULL");
  const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";

  const totalRows = await repo.raw(`SELECT COUNT(*) AS c FROM categories${whereSql}`, params);
  const rows = await repo.raw(
    `SELECT * FROM categories${whereSql} ORDER BY sort ASC, title ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { items: rows.map(rowToCategory), total: Number(totalRows[0]?.c ?? 0), limit, offset };
}

/**
 * 每个类目的存活站点数（一次聚合，取代调用方「翻 5 页 × 1000 站点再 JS 计数」）。
 *
 * 口径：**单主指针**（`sites.category_id`），`status = 'active'` 且未进回收站。
 * 新树落地后 `sub_category_id` 只是同根下的只读副指针，浏览侧（search 的
 * categoryId 过滤）也只看主指针；把它并集进来会让「一级根 = 子叶计数之和」
 * 重复计算同根副指针站点（实测 jobs-and-career 11 站被算成 13），进而让
 * 首页/sitemap 链向一个按 11 站判定已 404 的类目页。
 * broken/pending 不计入：类目页只列 active，坏链算进「达标」会显示 N 个却渲染更少。
 */
export async function categorySiteCounts(repo: Repository): Promise<Array<{ categoryId: string; sites: number }>> {
  const rows = await repo.raw(
    `SELECT category_id AS categoryid, COUNT(*) AS sites
       FROM sites
      WHERE deleted_at IS NULL AND status = 'active' AND category_id IS NOT NULL
      GROUP BY category_id`,
    [],
  );
  return rows
    .map((r) => ({ categoryId: String(r.categoryid), sites: Number(r.sites ?? 0) }))
    .filter((r) => r.categoryId && r.categoryId !== "null");
}

export async function getCategory(repo: Repository, id: string): Promise<Category | null> {
  const rows = await repo.raw("SELECT * FROM categories WHERE id = ? LIMIT 1", [id]);
  const row = rows[0];
  return row ? rowToCategory(row) : null;
}

export async function getCategoryBySlug(repo: Repository, slug: string): Promise<Category | null> {
  const norm = (slug ?? "").trim().toLowerCase();
  if (!norm) return null;
  const rows = await repo.raw("SELECT * FROM categories WHERE slug = ? LIMIT 1", [norm]);
  const row = rows[0];
  return row ? rowToCategory(row) : null;
}

/**
 * 取一个全局未被占用的 slug。
 *
 * 冲突要判**全表**而不是判同父：URL 是 /category/{slug}，没有父级路径，
 * 两个不同父下的同名类目会撞同一个 URL。「每父标题唯一」是另一条规矩
 * （见 assertNoSiblingTitleClash），不能拿它当 slug 的作用域。
 */
async function reserveCategorySlug(repo: Repository, base: string): Promise<string> {
  const root = base || "category";
  let candidate = root;
  // 到 -50 还撞不完说明同名堆积异常（例如回填脚本没跑），退回时间戳保证可用且不覆盖
  for (let i = 2; i <= 50; i += 1) {
    const rows = await repo.raw("SELECT id FROM categories WHERE slug = ? LIMIT 1", [candidate]);
    if (!rows[0]) return candidate;
    candidate = `${root}-${i}`;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/** 同一父级下标题重名（trim 后精确比较，和将来那个 UNIQUE 索引同口径） */
async function assertNoSiblingTitleClash(
  repo: Repository,
  parentId: string | null,
  title: string,
  exceptId?: string
): Promise<void> {
  const norm = (title ?? "").trim();
  const rows = parentId
    ? await repo.raw("SELECT id FROM categories WHERE parent_id = ? AND title = ? AND id <> ? LIMIT 1", [parentId, norm, exceptId ?? ""])
    : await repo.raw("SELECT id FROM categories WHERE parent_id IS NULL AND title = ? AND id <> ? LIMIT 1", [norm, exceptId ?? ""]);
  if (rows[0]) throw new Error(`同级下已存在名为「${norm}」的类目，请换名或改放不同父级`);
}

export async function createCategory(
  repo: Repository,
  input: {
    id?: string;
    title: string;
    titleEn?: string | null;
    slug?: string | null;
    parentId?: string | null;
    icon?: string | null;
    description?: string | null;
    sort?: number;
    source?: string | null;
    altLabels?: string[];
    relatedCategories?: string[];
  }
): Promise<Category> {
  const id = input.id ?? randomUUID();
  let anchor = id;
  if (input.parentId) {
    const parent = await repo.getCategory(input.parentId);
    if (!parent) throw new Error("父类目不存在: " + input.parentId);
    anchor = parent.anchor + "/" + id;
  }
  const title = (input.title ?? "").trim();
  await assertNoSiblingTitleClash(repo, input.parentId ?? null, title);
  const explicitSlug = (input.slug ?? "").trim().toLowerCase();
  let slug: string;
  if (explicitSlug) {
    // 显式 slug（registry 播种走这条路）撞名要报错而不是自动改名：
    // URL 是外部资产，静默加 -2 会让「registry 里的 slug」和「库里的 slug」对不上。
    const clash = await repo.raw("SELECT id FROM categories WHERE slug = ? LIMIT 1", [explicitSlug]);
    if (clash[0]) throw new Error(`类目 slug「${explicitSlug}」已被占用`);
    slug = explicitSlug;
  } else {
    slug = await reserveCategorySlug(repo, categorySlug(input.titleEn, title));
  }
  const now = Date.now();
  const altLabels = JSON.stringify(input.altLabels ?? []);
  const relatedCategories = JSON.stringify(input.relatedCategories ?? []);
  await repo.run(
    "INSERT INTO categories (id, anchor, parent_id, title, title_en, slug, description, icon, enabled, sort, source, alt_labels, related_categories, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      anchor,
      input.parentId ?? null,
      title,
      input.titleEn ?? null,
      slug,
      input.description ?? null,
      input.icon ?? null,
      1,
      input.sort ?? 0,
      input.source ?? null,
      altLabels,
      relatedCategories,
      now,
      now,
    ],
  );
  const created = await repo.getCategory(id);
  if (!created) throw new Error("创建类目后无法读回");
  return created;
}

export async function ensureCategory(repo: Repository, title: string, source?: string): Promise<string> {
  const rows = await repo.raw("SELECT id FROM categories WHERE title = ? LIMIT 1", [title]);
  if (rows[0]) return String(rows[0].id);
  const created = await repo.createCategory({ title, source: source ?? "api" });
  return created.id;
}

/**
 * 「未分类」兜底类目：按固定 id 取，缺则用该 id 建。
 *
 * 为什么不复用 `ensureCategory("未分类")`：那条路按标题匹配，
 * 一旦有人手工建了同名类目或标题被改（如加上「（待归类）」），
 * 兜底就会指向一个随时可被删除/改名的普通类目。
 *
 * `source = "system"` 是刻意的：
 *   - 不能是 `seed`/`null` —— 那属于快照托管集（storage.ts 的 SNAPSHOT_MANAGED_SOURCES），
 *     前端保存导航时快照里没有它 = 删除；
 *   - 不能是 `plugin:*` —— 会被启动清扫当孤儿删掉。
 * 两者都会让兜底类目在某个瞬间消失，站点随即落回悬空 category_id。
 */
export async function ensureUncategorized(repo: Repository): Promise<string> {
  const existing = await repo.getCategory(UNCATEGORIZED_CATEGORY_ID);
  if (existing) return existing.id;
  const created = await repo.createCategory({
    id: UNCATEGORIZED_CATEGORY_ID,
    title: UNCATEGORIZED_CATEGORY_TITLE,
    titleEn: "Uncategorized",
    description: "待归类的站点兜底位置，不出现在导航与站点地图",
    icon: "folder",
    sort: 999,
    source: "system",
  });
  return created.id;
}

/**
 * 站点归属的边界校验（方案 §2.6）：类目必须存在，且不能是一级根。
 *
 * 只在写入口拦、仓储写路径保持宽松：迁移脚本与 SKOS 全量导出需要直挂根的能力，
 * 存量夹具也普遍把站点挂在平铺根上——把「只挂叶子」做成存储不变量收益为负。
 * 「未分类」是唯一的根例外：它是兜底桶，按设计就挂在顶层。
 *
 * 成功时回吐解析后的真实 id：入参可以是 slug，直接把它写进 sites.category_id 会造出悬空外键。
 */
export async function checkSiteCategoryAttachment(
  repo: Repository,
  categoryId: string | null | undefined,
): Promise<{ ok: true; categoryId: string | null } | { ok: false; error: string }> {
  const id = (categoryId ?? "").trim();
  if (!id) return { ok: true, categoryId: null };
  const category = (await getCategory(repo, id)) ?? (await getCategoryBySlug(repo, id));
  if (!category) return { ok: false, error: `类目「${id}」不存在；站点只能挂在子类目（叶子）上` };
  if (category.parentId || category.id === UNCATEGORIZED_CATEGORY_ID) return { ok: true, categoryId: category.id };
  const leaves = (await listCategories(repo)).filter((c) => c.parentId === category.id);
  const hint = leaves.length > 0
    ? `请改挂它的子类目：${leaves.slice(0, 8).map((l) => `「${l.title}」`).join("、")}${leaves.length > 8 ? ` 等 ${leaves.length} 个` : ""}`
    : `「${category.title}」下还没有子类目，请先建一个叶子再挂站点`;
  return { ok: false, error: `类目「${category.title}」是一级根，只能作导航；${hint}` };
}

export async function moveCategory(repo: Repository, id: string, parentId: string | null): Promise<Category | null> {
  return repo.withTransaction(async () => {
    const existing = await repo.getCategory(id);
    if (!existing) return null;
    if (parentId === id) throw new Error("不能把类目移动到它自己下面");
    let parent: Category | null = null;
    if (parentId) {
      parent = await repo.getCategory(parentId);
      if (!parent) throw new Error("目标父类目不存在: " + parentId);
      if (parent.anchor === existing.anchor || parent.anchor.startsWith(existing.anchor + "/")) {
        throw new Error("不能把类目移动到它的子类目下面（会成环）");
      }
    }
    // 移动同样受「每父唯一标题」约束：把子树挪进一个已有同名子级的父级，
    // 会把重名带进目标层，之后那个 UNIQUE 索引就再也建不上了。
    if ((existing.parentId ?? null) !== (parentId ?? null)) {
      await assertNoSiblingTitleClash(repo, parentId ?? null, existing.title, id);
    }
    const newAnchor = parent ? parent.anchor + "/" + id : id;
    if (existing.anchor !== newAnchor) {
      await repo.replaceAnchorPrefix(existing.anchor, newAnchor);
    }
    await repo.run("UPDATE categories SET parent_id = ?, updated_at = ? WHERE id = ?", [parentId ?? null, Date.now(), id]);
    return repo.getCategory(id);
  });
}

export async function replaceAnchorPrefix(repo: Repository, oldPrefix: string, newPrefix: string): Promise<void> {
  const rows = await repo.raw(
    "SELECT id, anchor FROM categories WHERE anchor = ? OR anchor LIKE ?",
    [oldPrefix, oldPrefix + "/%"],
  );
  const now = Date.now();
  for (const r of rows) {
    const next = newPrefix + String(r.anchor).slice(oldPrefix.length);
    await repo.run("UPDATE categories SET anchor = ?, updated_at = ? WHERE id = ?", [next, now, String(r.id)]);
  }
}

export async function mergeCategories(repo: Repository, sourceId: string, targetId: string): Promise<{ movedSites: number; removedCategories: number }> {
  if (sourceId === targetId) throw new Error("源类目与目标类目不能相同");
  const source = await repo.getCategory(sourceId);
  if (!source) throw new Error("源类目不存在: " + sourceId);
  const target = await repo.getCategory(targetId);
  if (!target) throw new Error("目标类目不存在: " + targetId);
  return repo.withTransaction(async () => {

  const subtree = await repo.raw(
    "SELECT id, anchor FROM categories WHERE anchor = ? OR anchor LIKE ?",
    [source.anchor, source.anchor + "/%"],
  );
  // 目标在源子树里 = 把父类目并进自己的孙子：子树连目标一起删掉，
  // 站点会指向已删除的类目行（schema 没有外键，悬空不报错）。
  if (subtree.some((r) => String(r.id) === targetId)) {
    throw new Error("目标类目不能是源类目本身或它的子类目");
  }
  const ids = subtree.map((r) => String(r.id));
  const now = Date.now();
  // 集合式 UPDATE，且**不筛 deleted_at**：回收站里的站点同样带着 category_id，
  // 按「存活站点」搬（旧实现走 listSites，还受默认 limit 100 截断）会让
  // 被删子树里的回收站行与 100 名之后的行留下悬空 category_id。
  let moved = 0;
  for (const chunk of chunkList(ids)) {
    const byCategory = inPredicate("category_id", chunk);
    const counted = await repo.raw(`SELECT COUNT(*) AS c FROM sites WHERE ${byCategory.sql}`, byCategory.params);
    moved += Number(counted[0]?.c ?? 0);
    await repo.run(
      `UPDATE sites SET category_id = ?, sub_category_id = NULL, updated_at = ? WHERE ${byCategory.sql}`,
      [targetId, now, ...byCategory.params],
    );
    // 挂在别处、但子指针指向被并入类目的行：子指针必须清掉，否则同样悬空
    const bySub = inPredicate("sub_category_id", chunk);
    await repo.run(`UPDATE sites SET sub_category_id = NULL, updated_at = ? WHERE ${bySub.sql}`, [
      now,
      ...bySub.params,
    ]);
  }
  for (const cid of ids) await repo.run("DELETE FROM categories WHERE id = ?", [cid]);
  return { movedSites: moved, removedCategories: ids.length };
  });
}

export async function updateCategory(
  repo: Repository,
  id: string,
  patch: Partial<Pick<Category, "title" | "titleEn" | "slug" | "icon" | "description" | "enabled" | "sort" | "altLabels" | "relatedCategories">>
): Promise<Category | null> {
  const existing = await repo.getCategory(id);
  if (!existing) return null;
  // 改名不自动改 slug：slug 已经发出去过（导航、sitemap、外链），
  // 跟着标题重写等于把所有入链打成 404。要换 URL 就显式传 slug，由这里做冲突检查。
  if (patch.title !== undefined && patch.title.trim() !== existing.title) {
    await assertNoSiblingTitleClash(repo, existing.parentId ?? null, patch.title, id);
  }
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [Date.now()];
  const assign = (col: string, v: unknown) => { sets.push(col + " = ?"); params.push(v); };
  if (patch.title !== undefined) assign("title", patch.title.trim());
  if (patch.titleEn !== undefined) assign("title_en", patch.titleEn);
  if (patch.slug !== undefined) {
    const nextSlug = (patch.slug ?? "").trim().toLowerCase();
    if (!nextSlug) throw new Error("类目 slug 不能为空");
    if (nextSlug !== existing.slug) {
      const clash = await repo.raw("SELECT id FROM categories WHERE slug = ? AND id <> ? LIMIT 1", [nextSlug, id]);
      if (clash[0]) throw new Error(`类目 slug「${nextSlug}」已被占用`);
    }
    assign("slug", nextSlug);
  }
  if (patch.icon !== undefined) assign("icon", patch.icon);
  if (patch.description !== undefined) assign("description", patch.description);
  if (patch.enabled !== undefined) assign("enabled", patch.enabled ? 1 : 0);
  if (patch.sort !== undefined) assign("sort", patch.sort);
  if (patch.altLabels !== undefined) assign("alt_labels", JSON.stringify(patch.altLabels));
  if (patch.relatedCategories !== undefined) assign("related_categories", JSON.stringify(patch.relatedCategories));
  params.push(id);
  await repo.run(`UPDATE categories SET ${sets.join(", ")} WHERE id = ?`, params);
  return repo.getCategory(id);
}

export async function deleteCategory(repo: Repository, id: string): Promise<void> {
  if (id === UNCATEGORIZED_CATEGORY_ID) throw new Error("「未分类」是兜底类目，不能删除");
  const existing = await repo.getCategory(id);
  if (!existing) return;
  await repo.withTransaction(async () => {
  const now = Date.now();

  // 1. 直接子类目挂到被删类目的父级（根则 parent_id = NULL）
  await repo.run("UPDATE categories SET parent_id = ?, updated_at = ? WHERE parent_id = ?", [existing.parentId, now, id]);

  // 2. 全部后代的 anchor 前缀替换（去掉被删节点那一级）
  if (existing.parentId) {
    const parent = await repo.getCategory(existing.parentId);
    if (parent) await repo.replaceAnchorPrefix(existing.anchor, parent.anchor);
  } else {
    // 挂到根：新前缀为空串，即去掉 "oldAnchor/" 这一段
    const rows = await repo.raw("SELECT id, anchor FROM categories WHERE anchor LIKE ?", [existing.anchor + "/%"]);
    for (const r of rows) {
      const rest = String(r.anchor).slice(existing.anchor.length + 1); // 去掉 "oldAnchor/"
      await repo.run("UPDATE categories SET anchor = ?, updated_at = ? WHERE id = ?", [rest, now, String(r.id)]);
    }
  }

  // 3. 站点移入「未分类」而不是删除
  const fallback = await repo.ensureUncategorized();
  // 搬走的站点子引用要一起清：被提升的后代已不是「未分类」的下级，留着就是父子错配
  await repo.run(
    "UPDATE sites SET category_id = ?, sub_category_id = NULL, updated_at = ? WHERE category_id = ?",
    [fallback, now, id],
  );
  await repo.run("UPDATE sites SET sub_category_id = NULL, updated_at = ? WHERE sub_category_id = ?", [now, id]);

  // 4. 最后删除类目自身
  await repo.run("DELETE FROM categories WHERE id = ?", [id]);
  });
}

/**
 * 获取类目详情及基于 SKOS:related 解析的相关概念分类列表（含站点数）
 */
export async function getCategoryWithSemantic(
  repo: Repository,
  id: string
): Promise<CategorySemanticDetail | null> {
  const cat = await repo.getCategory(id);
  if (!cat) return null;

  const relatedList: CategorySemanticDetail["related"] = [];
  if (Array.isArray(cat.relatedCategories) && cat.relatedCategories.length > 0) {
    for (const relId of cat.relatedCategories) {
      const relCat = await repo.getCategory(relId);
      if (relCat) {
        const countRows = await repo.raw(
          "SELECT COUNT(*) AS c FROM sites WHERE category_id = ? AND deleted_at IS NULL",
          [relId]
        );
        const siteCount = Number(countRows[0]?.c ?? 0);
        relatedList.push({
          id: relCat.id,
          title: relCat.title,
          titleEn: relCat.titleEn,
          icon: relCat.icon,
          siteCount,
        });
      }
    }
  }

  return {
    category: cat,
    related: relatedList,
  };
}

/**
 * 导出全站类目的 SKOS Concept 集合（W3C 标准格式，供互操作与语义交换）
 */
export async function exportSkosConcepts(
  repo: Repository,
  baseUri?: string
): Promise<SkosConcept[]> {
  const all = await repo.listCategories();
  return all.map((c) => categoryToSkosConcept(c, all, baseUri));
}
