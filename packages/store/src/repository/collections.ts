import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";
import {
  type Collection,
  type CollectionKind,
  type CollectionSiteItem,
} from "@navhub/core";
import {
  rowToCollection,
  rowToSite,
} from "./dialect.ts";

export interface CollectionItemDetail {
  siteId: string;
  sort: number;
  note: string | null;
  title: string | null;
  url: string | null;
  iconKey: string | null;
  enabled: boolean;
}

export async function upsertCollection(repo: Repository, input: {
  id?: string;
  slug: string;
  title: string;
  description?: string | null;
  kind?: CollectionKind;
  icon?: string | null;
  sort?: number;
  enabled?: boolean;
  sites?: Array<string | { site: string; note?: string | null; sort?: number }>;
}): Promise<Collection> {
  const slug = input.slug.trim();
  if (!slug) throw new Error("专题 slug 不能为空");
  const existing = await repo.getCollectionBySlug(slug);
  const id = existing?.id ?? input.id ?? randomUUID();
  const now = Date.now();
  const kind = input.kind ?? "topic";
  const sort = input.sort ?? 0;
  const enabled = input.enabled !== false;
  const icon = input.icon ?? null;
  const description = input.description ?? null;

  await repo.withTransaction(async () => {
    if (existing) {
      await repo.run(
        "UPDATE collections SET title = ?, description = ?, kind = ?, icon = ?, sort = ?, enabled = ?, updated_at = ? WHERE id = ?",
        [input.title, description, kind, icon, sort, enabled, now, id],
      );
    } else {
      await repo.run(
        "INSERT INTO collections (id, slug, title, description, kind, icon, sort, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [id, slug, input.title, description, kind, icon, sort, enabled, now, now],
      );
    }

    if (input.sites && Array.isArray(input.sites)) {
      await repo.run("DELETE FROM collection_items WHERE collection_id = ?", [id]);
      let itemSort = 0;
      for (const item of input.sites) {
        const siteRef = typeof item === "string" ? item : item.site;
        const note = typeof item === "object" && item.note ? item.note : null;
        const assignedSort = typeof item === "object" && typeof item.sort === "number" ? item.sort : itemSort++;
        const site = await repo.getSite(siteRef);
        if (site) {
          await repo.run(
            "INSERT INTO collection_items (collection_id, site_id, sort, note) VALUES (?,?,?,?)",
            [id, site.id, assignedSort, note],
          );
        }
      }
    }
  });

  const saved = await repo.getCollectionBySlug(slug);
  if (!saved) throw new Error("保存专题后无法读回: " + slug);
  return saved;
}

export async function listCollections(repo: Repository, onlyEnabled = true): Promise<Collection[]> {
  const where = onlyEnabled ? `WHERE c.enabled = ${repo.enabledLiteral}` : "";
  const sql =
    `SELECT c.*, COUNT(DISTINCT s.id) AS site_count ` +
    `FROM collections c ` +
    `LEFT JOIN collection_items ci ON ci.collection_id = c.id ` +
    `LEFT JOIN sites s ON s.id = ci.site_id AND s.enabled = ${repo.enabledLiteral} AND s.deleted_at IS NULL ` +
    `${where} ` +
    `GROUP BY c.id ` +
    `ORDER BY c.sort ASC, c.title ASC`;
  const rows = await repo.raw(sql, []);
  return rows.map(rowToCollection);
}

export async function getCollectionBySlug(repo: Repository, slug: string): Promise<Collection | null> {
  const sql =
    `SELECT c.*, COUNT(DISTINCT s.id) AS site_count ` +
    `FROM collections c ` +
    `LEFT JOIN collection_items ci ON ci.collection_id = c.id ` +
    `LEFT JOIN sites s ON s.id = ci.site_id AND s.enabled = ${repo.enabledLiteral} AND s.deleted_at IS NULL ` +
    `WHERE c.slug = ? ` +
    `GROUP BY c.id LIMIT 1`;
  const row = (await repo.raw(sql, [slug]))[0];
  return row ? rowToCollection(row) : null;
}

export async function getCollectionById(repo: Repository, id: string): Promise<Collection | null> {
  const sql =
    `SELECT c.*, COUNT(DISTINCT s.id) AS site_count ` +
    `FROM collections c ` +
    `LEFT JOIN collection_items ci ON ci.collection_id = c.id ` +
    `LEFT JOIN sites s ON s.id = ci.site_id AND s.enabled = ${repo.enabledLiteral} AND s.deleted_at IS NULL ` +
    `WHERE c.id = ? ` +
    `GROUP BY c.id LIMIT 1`;
  const row = (await repo.raw(sql, [id]))[0];
  return row ? rowToCollection(row) : null;
}

export async function updateCollection(
  repo: Repository,
  id: string,
  patch: {
    slug?: string;
    title?: string;
    description?: string | null;
    kind?: CollectionKind;
    icon?: string | null;
    sort?: number;
    enabled?: boolean;
  },
): Promise<Collection | null> {
  const current = await getCollectionById(repo, id);
  if (!current) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.slug !== undefined) {
    const nextSlug = patch.slug.trim().toLowerCase();
    if (!nextSlug) throw new Error("专题 slug 不能为空");
    if (nextSlug !== current.slug) {
      const dup = await getCollectionBySlug(repo, nextSlug);
      if (dup && dup.id !== id) throw new Error(`专题 slug「${nextSlug}」已被占用`);
      sets.push("slug = ?");
      params.push(nextSlug);
    }
  }

  if (patch.title !== undefined) {
    const nextTitle = patch.title.trim();
    if (!nextTitle) throw new Error("专题标题不能为空");
    sets.push("title = ?");
    params.push(nextTitle);
  }

  if (patch.description !== undefined) {
    sets.push("description = ?");
    params.push(patch.description);
  }

  if (patch.kind !== undefined) {
    sets.push("kind = ?");
    params.push(patch.kind);
  }

  if (patch.icon !== undefined) {
    sets.push("icon = ?");
    params.push(patch.icon);
  }

  if (patch.sort !== undefined) {
    sets.push("sort = ?");
    params.push(patch.sort);
  }

  if (patch.enabled !== undefined) {
    sets.push("enabled = ?");
    params.push(Boolean(patch.enabled));
  }

  if (sets.length === 0) return current;

  sets.push("updated_at = ?");
  params.push(Date.now());
  params.push(id);

  await repo.run(`UPDATE collections SET ${sets.join(", ")} WHERE id = ?`, params);
  return getCollectionById(repo, id);
}

export async function deleteCollection(repo: Repository, id: string): Promise<boolean> {
  const col = await getCollectionById(repo, id);
  if (!col) return false;

  await repo.withTransaction(async () => {
    await repo.run("DELETE FROM collection_items WHERE collection_id = ?", [id]);
    await repo.run("DELETE FROM collections WHERE id = ?", [id]);
  });
  return true;
}

export async function listCollectionSites(repo: Repository, slug: string): Promise<CollectionSiteItem[]> {
  const col = await repo.getCollectionBySlug(slug);
  if (!col) return [];
  const baseSql = repo.selectSitesSql();
  const sql =
    baseSql.replace("FROM sites s", ", MAX(ci.note) AS collection_note, MIN(ci.sort) AS collection_sort FROM sites s") +
    " JOIN collection_items ci ON ci.site_id = s.id" +
    " WHERE ci.collection_id = ? AND s.enabled = " + repo.enabledLiteral + " AND s.deleted_at IS NULL" +
    " GROUP BY s.id ORDER BY MIN(ci.sort) ASC, s.title ASC";
  const rows = await repo.raw(sql, [col.id]);
  return rows.map((row: Record<string, any>) => {
    const site = rowToSite(row);
    return {
      ...site,
      collectionNote: row.collection_note != null && String(row.collection_note).trim() ? String(row.collection_note).trim() : null,
      collectionSort: row.collection_sort != null ? Number(row.collection_sort) : undefined,
    };
  });
}

export async function listCollectionItemsDetail(repo: Repository, collectionId: string): Promise<CollectionItemDetail[]> {
  const rows = await repo.raw(
    "SELECT ci.site_id, ci.sort, ci.note, s.title, s.url, s.icon_key, s.enabled " +
      "FROM collection_items ci " +
      "LEFT JOIN sites s ON s.id = ci.site_id " +
      "WHERE ci.collection_id = ? " +
      "ORDER BY ci.sort ASC, ci.site_id ASC",
    [collectionId],
  );
  return rows.map((r: Record<string, any>) => ({
    siteId: String(r.site_id),
    sort: Number(r.sort ?? 0),
    note: r.note != null ? String(r.note) : null,
    title: r.title != null ? String(r.title) : null,
    url: r.url != null ? String(r.url) : null,
    iconKey: r.icon_key != null ? String(r.icon_key) : null,
    enabled: r.enabled !== null && r.enabled !== undefined ? Boolean(r.enabled) : true,
  }));
}

export async function addCollectionItem(
  repo: Repository,
  collectionId: string,
  siteId: string,
  note?: string | null,
  sort?: number,
): Promise<void> {
  const existing = await repo.raw(
    "SELECT sort, note FROM collection_items WHERE collection_id = ? AND site_id = ? LIMIT 1",
    [collectionId, siteId],
  );

  const first = existing[0];
  if (first) {
    const nextNote = note !== undefined ? note : first.note;
    const nextSort = sort !== undefined ? sort : first.sort;
    await repo.run(
      "UPDATE collection_items SET sort = ?, note = ? WHERE collection_id = ? AND site_id = ?",
      [nextSort, nextNote, collectionId, siteId],
    );
    return;
  }

  let finalSort = sort;
  if (finalSort === undefined) {
    const maxSortRow = await repo.raw(
      "SELECT MAX(sort) AS m FROM collection_items WHERE collection_id = ?",
      [collectionId],
    );
    finalSort = (maxSortRow[0]?.m !== null && maxSortRow[0]?.m !== undefined ? Number(maxSortRow[0].m) : -1) + 1;
  }

  await repo.run(
    "INSERT INTO collection_items (collection_id, site_id, sort, note) VALUES (?,?,?,?)",
    [collectionId, siteId, finalSort, note ?? null],
  );
}

export async function updateCollectionItem(
  repo: Repository,
  collectionId: string,
  siteId: string,
  patch: { note?: string | null; sort?: number },
): Promise<boolean> {
  const existing = (await repo.raw(
    "SELECT sort, note FROM collection_items WHERE collection_id = ? AND site_id = ? LIMIT 1",
    [collectionId, siteId],
  ))[0];
  if (!existing) return false;

  const nextNote = patch.note !== undefined ? patch.note : existing.note;
  const nextSort = patch.sort !== undefined ? patch.sort : existing.sort;

  await repo.run(
    "UPDATE collection_items SET sort = ?, note = ? WHERE collection_id = ? AND site_id = ?",
    [nextSort, nextNote, collectionId, siteId],
  );
  return true;
}

export async function removeCollectionItem(repo: Repository, collectionId: string, siteId: string): Promise<boolean> {
  await repo.run("DELETE FROM collection_items WHERE collection_id = ? AND site_id = ?", [collectionId, siteId]);
  return true;
}

export async function listSiteCollections(
  repo: Repository,
  siteId: string,
  onlyEnabled = true,
): Promise<Array<Collection & { collectionNote: string | null; collectionSort: number }>> {
  const where = onlyEnabled ? `AND c.enabled = ${repo.enabledLiteral}` : "";
  const sql =
    `SELECT c.*, ci.note AS collection_note, ci.sort AS collection_sort ` +
    `FROM collections c ` +
    `JOIN collection_items ci ON ci.collection_id = c.id ` +
    `WHERE ci.site_id = ? ${where} ` +
    `ORDER BY c.sort ASC, c.title ASC`;
  const rows = await repo.raw(sql, [siteId]);
  return rows.map((r: Record<string, any>) => ({
    ...rowToCollection(r),
    collectionNote: r.collection_note != null ? String(r.collection_note) : null,
    collectionSort: Number(r.collection_sort ?? 0),
  }));
}
