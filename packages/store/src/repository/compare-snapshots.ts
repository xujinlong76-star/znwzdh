import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";
import type { SiteComparisonItem } from "@navhub/core";

/**
 * 对照快照的仓储层（Batch 4 Phase 2 P2-3）。
 *
 * 只存「冻结的对照表」（保存那一刻 GET /api/compare 返回的 items 全表），
 * 不存活引用：保存后收藏/分面/巡检再变，已存快照一格都不动。
 * 不可变：只有 create，没有 update——没有任何写路径能改写已存行。
 */

export interface ComparisonSnapshot {
  id: string;
  ownerIdentity: string;
  siteIds: string[];
  /** 冻结的对照表：SiteComparisonItem[]（7 维 × 每格 { value, source, verified, verifiedAt }）。 */
  items: SiteComparisonItem[];
  createdAt: number;
}

type ComparisonSnapshotRow = {
  id: string;
  owner_identity: string;
  site_ids: string;
  snapshot_json: string;
  created_at: number;
};

function rowToSnapshot(row: ComparisonSnapshotRow): ComparisonSnapshot {
  return {
    id: row.id,
    ownerIdentity: row.owner_identity,
    siteIds: JSON.parse(row.site_ids) as string[],
    items: JSON.parse(row.snapshot_json) as SiteComparisonItem[],
    createdAt: row.created_at,
  };
}

export async function createComparisonSnapshot(
  repo: Repository,
  input: {
    ownerIdentity: string;
    siteIds: string[];
    items: SiteComparisonItem[];
  },
): Promise<ComparisonSnapshot> {
  const now = Date.now();
  const id = randomUUID();
  await repo.run(
    "INSERT INTO comparison_snapshots (id, owner_identity, site_ids, snapshot_json, created_at) VALUES (?,?,?,?,?)",
    [id, input.ownerIdentity, JSON.stringify(input.siteIds), JSON.stringify(input.items), now],
  );
  const saved = await getComparisonSnapshotById(repo, id);
  if (!saved) throw new Error("保存对照快照后无法读回: " + id);
  return saved;
}

export async function getComparisonSnapshotById(
  repo: Repository,
  id: string,
): Promise<ComparisonSnapshot | null> {
  const row = (await repo.raw("SELECT * FROM comparison_snapshots WHERE id = ? LIMIT 1", [id]))[0] as
    | ComparisonSnapshotRow
    | undefined;
  return row ? rowToSnapshot(row) : null;
}

/** 仅列出某身份自己的快照：最新在前；跨身份读一律不在这里发生（路由层先验 owner）。 */
export async function listComparisonSnapshotsByOwner(
  repo: Repository,
  ownerIdentity: string,
): Promise<ComparisonSnapshot[]> {
  const rows = (await repo.raw(
    "SELECT * FROM comparison_snapshots WHERE owner_identity = ? ORDER BY created_at DESC, id DESC",
    [ownerIdentity],
  )) as ComparisonSnapshotRow[];
  return rows.map(rowToSnapshot);
}
