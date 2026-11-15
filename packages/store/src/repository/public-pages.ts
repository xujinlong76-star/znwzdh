import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";

/**
 * 公开导航页的仓储层（Batch 3 第 6 项）。
 *
 * 只存「发布关系」（谁、哪个文件夹、什么标题、上下线），不存条目快照：
 * 读时按 owner + folder_id 现算收藏，发布后收藏增删自动跟随——这是与
 * /pack 快照的区分点。公开读绝不返回 owner_identity（路由层也不返回）。
 */

export type PublicPageStatus = "published" | "unpublished";

export interface PublicPage {
  id: string;
  slug: string;
  ownerIdentity: string;
  title: string;
  description: string | null;
  folderId: string | null;
  status: PublicPageStatus;
  createdAt: number;
  updatedAt: number;
}

type PublicPageRow = {
  id: string;
  slug: string;
  owner_identity: string;
  title: string;
  description: string | null;
  folder_id: string | null;
  status: string;
  created_at: number;
  updated_at: number;
};

function rowToPublicPage(row: PublicPageRow): PublicPage {
  return {
    id: row.id,
    slug: row.slug,
    ownerIdentity: row.owner_identity,
    title: row.title,
    description: row.description,
    folderId: row.folder_id,
    status: row.status === "unpublished" ? "unpublished" : "published",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createPublicPage(
  repo: Repository,
  input: {
    slug: string;
    ownerIdentity: string;
    title: string;
    description?: string | null;
    folderId?: string | null;
  },
): Promise<PublicPage> {
  const now = Date.now();
  const id = randomUUID();
  await repo.run(
    "INSERT INTO public_pages (id, slug, owner_identity, title, description, folder_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, input.slug, input.ownerIdentity, input.title, input.description ?? null, input.folderId ?? null, "published", now, now],
  );
  const saved = await getPublicPageById(repo, id);
  if (!saved) throw new Error("保存公开页后无法读回: " + input.slug);
  return saved;
}

export async function getPublicPageById(repo: Repository, id: string): Promise<PublicPage | null> {
  const row = (await repo.raw("SELECT * FROM public_pages WHERE id = ? LIMIT 1", [id]))[0] as PublicPageRow | undefined;
  return row ? rowToPublicPage(row) : null;
}

export async function getPublicPageBySlug(repo: Repository, slug: string): Promise<PublicPage | null> {
  const row = (await repo.raw("SELECT * FROM public_pages WHERE slug = ? LIMIT 1", [slug]))[0] as
    | PublicPageRow
    | undefined;
  return row ? rowToPublicPage(row) : null;
}

/** 仅返回已发布的页：下线页在读端按不存在处理（404 纪律）。 */
export async function getPublishedPublicPageBySlug(repo: Repository, slug: string): Promise<PublicPage | null> {
  const page = await getPublicPageBySlug(repo, slug);
  if (!page || page.status !== "published") return null;
  return page;
}

export async function listPublicPagesByOwner(repo: Repository, ownerIdentity: string): Promise<PublicPage[]> {
  const rows = (await repo.raw(
    "SELECT * FROM public_pages WHERE owner_identity = ? ORDER BY updated_at DESC, created_at DESC",
    [ownerIdentity],
  )) as PublicPageRow[];
  return rows.map(rowToPublicPage);
}

export async function setPublicPageStatus(
  repo: Repository,
  id: string,
  status: PublicPageStatus,
): Promise<PublicPage | null> {
  await repo.run("UPDATE public_pages SET status = ?, updated_at = ? WHERE id = ?", [status, Date.now(), id]);
  return getPublicPageById(repo, id);
}

export async function deletePublicPage(repo: Repository, id: string): Promise<boolean> {
  const before = await getPublicPageById(repo, id);
  if (!before) return false;
  await repo.run("DELETE FROM public_pages WHERE id = ?", [id]);
  return true;
}
