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
} from "@navhub/core";
import type {
  ApiTokenRecord,
  AuditLogRecord,
  CategoryDistributionItem,
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

export async function listCategories(repo: Repository): Promise<Category[]> {
  const rows = await repo.raw("SELECT * FROM categories ORDER BY sort ASC, title ASC", []);
  return rows.map(rowToCategory);
}

export async function getCategory(repo: Repository, id: string): Promise<Category | null> {
  const rows = await repo.raw("SELECT * FROM categories WHERE id = ? LIMIT 1", [id]);
  const row = rows[0];
  return row ? rowToCategory(row) : null;
}

export async function createCategory(repo: Repository, input: { id?: string; title: string; parentId?: string | null; icon?: string | null; description?: string | null; sort?: number; source?: string | null }): Promise<Category> {
  const id = input.id ?? randomUUID();
  let anchor = id;
  if (input.parentId) {
    const parent = await repo.getCategory(input.parentId);
    if (!parent) throw new Error("父类目不存在: " + input.parentId);
    anchor = parent.anchor + "/" + id;
  }
  const now = Date.now();
  await repo.run(
    "INSERT INTO categories (id, anchor, parent_id, title, description, icon, enabled, sort, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [id, anchor, input.parentId ?? null, input.title, input.description ?? null, input.icon ?? null, 1, input.sort ?? 0, input.source ?? null, now, now],
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

export async function moveCategory(repo: Repository, id: string, parentId: string | null): Promise<Category | null> {
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
  const newAnchor = parent ? parent.anchor + "/" + id : id;
  if (existing.anchor !== newAnchor) {
    await repo.replaceAnchorPrefix(existing.anchor, newAnchor);
  }
  await repo.run("UPDATE categories SET parent_id = ?, updated_at = ? WHERE id = ?", [parentId ?? null, Date.now(), id]);
  return repo.getCategory(id);
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
    "SELECT id FROM categories WHERE anchor = ? OR anchor LIKE ?",
    [source.anchor, source.anchor + "/%"],
  );
  const ids = subtree.map((r) => String(r.id));
  const now = Date.now();
  let moved = 0;
  for (const cid of ids) {
    const sites = await repo.listSites({ categoryId: cid });
    for (const s of sites) {
      await repo.run(
        "UPDATE sites SET category_id = ?, sub_category_id = NULL, updated_at = ? WHERE id = ?",
        [targetId, now, s.id],
      );
      moved++;
    }
  }
  for (const cid of ids) await repo.run("DELETE FROM categories WHERE id = ?", [cid]);
  return { movedSites: moved, removedCategories: ids.length };
  });
}

export async function updateCategory(repo: Repository, id: string, patch: Partial<Pick<Category, "title" | "titleEn" | "icon" | "description" | "enabled" | "sort">>): Promise<Category | null> {
  const existing = await repo.getCategory(id);
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
  await repo.run(`UPDATE categories SET ${sets.join(", ")} WHERE id = ?`, params);
  return repo.getCategory(id);
}

export async function deleteCategory(repo: Repository, id: string): Promise<void> {
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
  const fallback = await repo.ensureCategory("未分类", "api");
  await repo.run("UPDATE sites SET category_id = ?, updated_at = ? WHERE category_id = ?", [fallback, now, id]);

  // 4. 最后删除类目自身
  await repo.run("DELETE FROM categories WHERE id = ?", [id]);
  });
}
