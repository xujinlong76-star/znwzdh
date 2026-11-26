import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";
import type { SiteComparisonItem } from "@navhub/core";

/**
 * 对照分享的仓储层（Batch 4 Phase 2 P2-4）。
 *
 * 只存「快照的冻结公开副本」：发布时调用方把白名单字段的格子复制进
 * published_json（只含展示字段 value/source/verified/verifiedAt/stale），
 * 公开读只 serving 这份副本——快照本身不可变，副本再加一层冻结，公开后
 * 原快照的状态变化不可能影响已发布页。
 *
 * note / migration 永不可公开：白名单在路由层（SHAREABLE_COMPARE_FIELDS），
 * 仓储层不做字段过滤——调用方只传已投影的 published_json，本文件不碰
 * 快照原文，不解析、不重组格子。
 *
 * snapshot_id UNIQUE：每快照最多一个有效分享行；下线后重发由路由层删旧行
 * 建新行（旧 slug 随行删除，永不复活）。slug UNIQUE：永不复用。
 */

export type ComparisonSnapshotShareStatus = "published" | "unpublished";

export interface ComparisonSnapshotShare {
  id: string;
  snapshotId: string;
  ownerIdentity: string;
  slug: string;
  /** 已发布的白名单字段子集（顺序即发布请求去重后的顺序）。 */
  publishedFields: string[];
  /** 冻结的公开副本：只含白名单格子的展示字段（SiteComparisonItem 的投影）。 */
  publishedJson: PublishedComparisonItem[];
  status: ComparisonSnapshotShareStatus;
  createdAt: number;
  updatedAt: number;
}

type ComparisonSnapshotShareRow = {
  id: string;
  snapshot_id: string;
  owner_identity: string;
  slug: string;
  published_fields: string;
  published_json: string;
  status: string;
  created_at: number;
  updated_at: number;
};

function rowToShare(row: ComparisonSnapshotShareRow): ComparisonSnapshotShare {
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    ownerIdentity: row.owner_identity,
    slug: row.slug,
    publishedFields: JSON.parse(row.published_fields) as string[],
    publishedJson: JSON.parse(row.published_json) as PublishedComparisonItem[],
    status: row.status === "unpublished" ? "unpublished" : "published",
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/** 冻结副本的投影形态：调用方按白名单字段投影后的行（siteId/title/url + 白名单格子）。 */
export type PublishedComparisonItem = Pick<SiteComparisonItem, "siteId" | "title" | "url"> &
  Partial<Pick<SiteComparisonItem, "pricing" | "price" | "platform" | "form" | "maintenance">>;

export async function createComparisonSnapshotShare(
  repo: Repository,
  input: {
    snapshotId: string;
    ownerIdentity: string;
    slug: string;
    publishedFields: string[];
    publishedJson: PublishedComparisonItem[];
  },
): Promise<ComparisonSnapshotShare> {
  const now = Date.now();
  const id = randomUUID();
  await repo.run(
    "INSERT INTO comparison_snapshot_shares (id, snapshot_id, owner_identity, slug, published_fields, published_json, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [
      id,
      input.snapshotId,
      input.ownerIdentity,
      input.slug,
      JSON.stringify(input.publishedFields),
      JSON.stringify(input.publishedJson),
      "published",
      now,
      now,
    ],
  );
  const saved = await getComparisonSnapshotShareById(repo, id);
  if (!saved) throw new Error("保存对照分享后无法读回: " + input.slug);
  return saved;
}

export async function getComparisonSnapshotShareById(
  repo: Repository,
  id: string,
): Promise<ComparisonSnapshotShare | null> {
  const row = (await repo.raw("SELECT * FROM comparison_snapshot_shares WHERE id = ? LIMIT 1", [id]))[0] as
    | ComparisonSnapshotShareRow
    | undefined;
  return row ? rowToShare(row) : null;
}

export async function getComparisonSnapshotShareBySlug(
  repo: Repository,
  slug: string,
): Promise<ComparisonSnapshotShare | null> {
  const row = (await repo.raw("SELECT * FROM comparison_snapshot_shares WHERE slug = ? LIMIT 1", [slug]))[0] as
    | ComparisonSnapshotShareRow
    | undefined;
  return row ? rowToShare(row) : null;
}

/** 仅返回已发布的分享行：下线/不存在在读端按不存在处理（404 纪律，与公开页一致）。 */
export async function getPublishedComparisonSnapshotShareBySlug(
  repo: Repository,
  slug: string,
): Promise<ComparisonSnapshotShare | null> {
  const share = await getComparisonSnapshotShareBySlug(repo, slug);
  if (!share || share.status !== "published") return null;
  return share;
}

/**
 * 列出已发布分享（P13 sitemap 用）：只返回 status = 'published' 的行，
 * 未发布/草稿行永不出现。按 updated_at 倒序（上下线与重发都会刷
 * updated_at，最新状态在前），created_at 倒序兜底同毫秒并列。
 */
export async function listPublishedComparisonSnapshotShares(
  repo: Repository,
  opts: { limit: number; offset: number },
): Promise<ComparisonSnapshotShare[]> {
  const rows = (await repo.raw(
    "SELECT * FROM comparison_snapshot_shares WHERE status = 'published' ORDER BY updated_at DESC, created_at DESC LIMIT ? OFFSET ?",
    [opts.limit, opts.offset],
  )) as ComparisonSnapshotShareRow[];
  return rows.map(rowToShare);
}

export async function getComparisonSnapshotShareBySnapshotId(
  repo: Repository,
  snapshotId: string,
): Promise<ComparisonSnapshotShare | null> {
  const row = (await repo.raw(
    "SELECT * FROM comparison_snapshot_shares WHERE snapshot_id = ? LIMIT 1",
    [snapshotId],
  ))[0] as ComparisonSnapshotShareRow | undefined;
  return row ? rowToShare(row) : null;
}

/**
 * 改状态；重新发布（published）时调用方须同时传重算后的 publishedFields /
 * publishedJson（快照不可删，此处恒可重算；不传则只改状态）。
 */
export async function setComparisonSnapshotShareStatus(
  repo: Repository,
  id: string,
  status: ComparisonSnapshotShareStatus,
  republished?: { publishedFields: string[]; publishedJson: PublishedComparisonItem[] },
): Promise<ComparisonSnapshotShare | null> {
  if (republished) {
    await repo.run(
      "UPDATE comparison_snapshot_shares SET status = ?, published_fields = ?, published_json = ?, updated_at = ? WHERE id = ?",
      [status, JSON.stringify(republished.publishedFields), JSON.stringify(republished.publishedJson), Date.now(), id],
    );
  } else {
    await repo.run("UPDATE comparison_snapshot_shares SET status = ?, updated_at = ? WHERE id = ?", [
      status,
      Date.now(),
      id,
    ]);
  }
  return getComparisonSnapshotShareById(repo, id);
}

/**
 * 删分享行（幂等由路由层保证：无行返回 false，路由仍按 404/200 分流）。
 * slug 随行删除、永不复用：新分享永远分配新 slug。
 */
export async function deleteComparisonSnapshotShare(
  repo: Repository,
  id: string,
): Promise<boolean> {
  const existing = await getComparisonSnapshotShareById(repo, id);
  if (!existing) return false;
  await repo.run("DELETE FROM comparison_snapshot_shares WHERE id = ?", [id]);
  return true;
}
