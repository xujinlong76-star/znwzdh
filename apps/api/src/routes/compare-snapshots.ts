/**
 * 对照快照（Batch 4 Phase 2 P2-3）：保存 / 列出 / 逐格 diff。
 *
 * 快照就是保存那一刻 GET /api/compare 返回的那张表（2–4 站 × 7 维，
 * 每格 { value, source, verified, verifiedAt }），冻结存入
 * comparison_snapshots，之后一格都不动。
 *
 * 不可变：只有 POST（新增）与 GET，没有任何改写已存快照的接口。
 * 只比本人收藏：身份口径抄 compare.ts（requireAskIdentity，匿名 401）；
 * 任一站点不在本人可比收藏里 → 整单通用 404，不点名是哪个 id。
 * 跨身份读快照一律 404，不泄露存在性。
 *
 * diff 只标事实变化，不生成结论句、不打分、不排名：
 *   - value_changed      值变了（两格都有值且不同，或有值的一格变空）
 *   - became_verified    从未验证变成已验证（旧格未验证 → 新格已验证且有值）
 *   - verification_added 新增了验证（值相同、都已验证，新格的核实时间更新）
 * 未变的格子不进 changes；diff 响应里没有任何结论性文字。
 *
 * 缓存：快照与 diff 响应一律 private, max-age=60 + etag；
 * Vary 含全部身份头（抄 compare.ts 的 COMPARE_VARY，防串用户）；
 * POST（201）由 server.ts 的 onSend hook 强制 no-store。
 */
import type { FastifyPluginAsync } from "fastify";
import { buildSiteComparison, CompareSitesInput, type SiteComparisonItem } from "@navhub/core";
import type { ComparisonSnapshot } from "@navhub/store";
import type { AppContext } from "../context.ts";
import { sendError } from "../error-envelope.ts";
import { requireAskIdentity } from "./ask.ts";
import { loadVerifiedProfiles } from "./compare.ts";

/** 与 /api/compare 的 COMPARE_VARY 同款：响应因人而异，必须逐身份头分缓存键。 */
const COMPARE_VARY = ["x-navhub-anon-id", "x-user-id", "x-navhub-user-id", "authorization", "cookie"];

/** 对照表的七个维度（顺序即表内行顺序，与 lib/compare.ts 的 COMPARE_DIMENSIONS 同源）。 */
export const SNAPSHOT_DIMENSIONS = ["pricing", "price", "platform", "form", "maintenance", "note", "migration"] as const;
export type SnapshotDimensionKey = (typeof SNAPSHOT_DIMENSIONS)[number];

/** diff 只标的三种事实变化（再无第四种；没有“谁赢了”）。 */
export type SnapshotDiffKind = "value_changed" | "became_verified" | "verification_added";

export interface SnapshotDiffChange {
  siteId: string;
  title: string;
  dimension: SnapshotDimensionKey;
  kind: SnapshotDiffKind;
  /** 归一化后的值：数组已排序连接；null = 未验证/无值。只陈述事实，不作评价。 */
  oldValue: string | null;
  newValue: string | null;
  oldVerified: boolean;
  newVerified: boolean;
}

export interface SnapshotDiff {
  base: { id: string; createdAt: number };
  against: { id: string; createdAt: number };
  /** 只有变了的格子在里面；未变的格子不列出。 */
  changes: SnapshotDiffChange[];
}

type ComparisonCellLike = SiteComparisonItem[SnapshotDimensionKey];

/** 格子值归一成可比字符串：null 保持 null（未验证），数组排序后连接（与 lib/compare.ts 同规则）。 */
export function normalizeSnapshotCellValue(cell: ComparisonCellLike | null | undefined): string | null {
  if (!cell) return null;
  const { value } = cell;
  if (value == null) return null;
  if (Array.isArray(value)) {
    const parts = value.map((v) => String(v).trim()).filter(Boolean);
    if (parts.length === 0) return null;
    return [...parts].sort().join("、");
  }
  const text = String(value).trim();
  return text ? text : null;
}

/** 缺格（某站只在其中一张快照里）按“未验证的空格”处理，不编造值。 */
function unverifiedCell(): ComparisonCellLike {
  return { value: null, source: "", verified: false, verifiedAt: null };
}

/**
 * 两快照逐格 diff（纯函数，不碰仓储与身份）。
 * base = 旧快照，against = 新快照；changes 只含变了的格子。
 */
export function diffComparisonSnapshots(base: ComparisonSnapshot, against: ComparisonSnapshot): SnapshotDiff {
  const baseBySite = new Map(base.items.map((item) => [item.siteId, item]));
  const againstBySite = new Map(against.items.map((item) => [item.siteId, item]));
  const siteIds = [...base.siteIds];
  for (const id of against.siteIds) if (!siteIds.includes(id)) siteIds.push(id);

  const changes: SnapshotDiffChange[] = [];
  for (const siteId of siteIds) {
    const baseItem = baseBySite.get(siteId);
    const againstItem = againstBySite.get(siteId);
    const title = baseItem?.title ?? againstItem?.title ?? siteId;
    for (const dimension of SNAPSHOT_DIMENSIONS) {
      const oldCell = baseItem?.[dimension] ?? unverifiedCell();
      const newCell = againstItem?.[dimension] ?? unverifiedCell();
      const oldValue = normalizeSnapshotCellValue(oldCell);
      const newValue = normalizeSnapshotCellValue(newCell);
      const sameValue = oldValue === newValue;
      const sameVerified = oldCell.verified === newCell.verified;
      if (sameValue && sameVerified) {
        // 值相同且验证状态相同：只有新格的核实时间更新了，才算“新增了验证”。
        const oldAt = oldCell.verifiedAt ?? 0;
        const newAt = newCell.verifiedAt ?? 0;
        if (oldCell.verified && newCell.verified && newAt > oldAt) {
          changes.push({ siteId, title, dimension, kind: "verification_added", oldValue, newValue, oldVerified: true, newVerified: true });
        }
        continue;
      }
      // 旧格未验证 → 新格已验证且有值：从未验证变成已验证（值是否同时变了不另立名目）。
      if (!oldCell.verified && newCell.verified && newValue !== null) {
        changes.push({ siteId, title, dimension, kind: "became_verified", oldValue, newValue, oldVerified: false, newVerified: true });
        continue;
      }
      changes.push({ siteId, title, dimension, kind: "value_changed", oldValue, newValue, oldVerified: oldCell.verified, newVerified: newCell.verified });
    }
  }
  return {
    base: { id: base.id, createdAt: base.createdAt },
    against: { id: against.id, createdAt: against.createdAt },
    changes,
  };
}

/** 快照对外形态：不含 owner_identity（自己的快照也不必回显身份）。 */
function snapshotView(snapshot: ComparisonSnapshot) {
  return {
    id: snapshot.id,
    siteIds: [...snapshot.siteIds],
    items: snapshot.items,
    createdAt: snapshot.createdAt,
  };
}

export const compareSnapshotsRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 保存当前对照表为快照：服务端按 siteIds 现算对照表（与 GET /api/compare
   * 同一组装），冻结存入；请求体里不接受调用方自带的格子——快照只存服务端
   * 算出来的表，调用方编不出假格子。
   */
  app.post(
    "/api/compare/snapshots",
    {
      config: {
        scope: "public",
        rateLimit: { max: 60, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const identity = await requireAskIdentity(ctx, req, reply);
      if (!identity) {
        return sendError(reply, 401, "UNAUTHORIZED", "对照快照只对登录用户开放，请先登录后再保存。");
      }

      const raw = (req.body ?? {}) as Record<string, unknown>;
      const ids = Array.isArray(raw.siteIds)
        ? raw.siteIds.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean)
        : [];
      const parsed = CompareSitesInput.safeParse({ siteIds: [...new Set(ids)] });
      if (!parsed.success) {
        return sendError(reply, 400, "BAD_REQUEST", "请勾选 2–4 个已收藏站点进行保存。");
      }
      const siteIds = parsed.data.siteIds;

      // 与 GET /api/compare 同口径：可比集合 = 本人收藏 ∩ 站点存在 ∩ 非 pending/archived。
      const favorites = await ctx.repo.listFavorites(identity);
      const favBySite = new Map(favorites.map((f) => [f.siteId, f]));
      const sites = await ctx.repo.getSitesByIds(siteIds);
      const comparable = siteIds.every((id) => {
        const site = sites.get(id);
        return Boolean(
          favBySite.get(id) && site && site.status !== "pending" && site.status !== "archived",
        );
      });
      if (!comparable) {
        return sendError(reply, 404, "NOT_FOUND", "其中有站点不在你的收藏里，或已不在可对比状态。");
      }

      // 价格数值（P2-2）：与 GET /api/compare 同口径一次批量取数，快照存下的
      // items 自带 price 格；diff 按 SNAPSHOT_DIMENSIONS 遍历（含 'price'）。
      const prices = await ctx.repo.getSitePricesBySiteIds(identity, siteIds);
      // 档案四格（Batch0-02 R10）：与 GET /api/compare 同口径，只传 verified 行。
      const profiles = await loadVerifiedProfiles(ctx, siteIds);

      const items = buildSiteComparison(
        siteIds.map((id) => {
          const site = sites.get(id)!;
          const fav = favBySite.get(id)!;
          return {
            site,
            favorite: { siteId: id, note: fav.note, tags: fav.tags, updatedAt: fav.updatedAt },
            price: prices.get(id) ?? null,
            profile: profiles.get(id) ?? null,
          };
        }),
      );
      const snapshot = await ctx.repo.createComparisonSnapshot({ ownerIdentity: identity, siteIds, items });
      reply.code(201);
      return { ok: true, snapshot: snapshotView(snapshot) };
    },
  );

  /** 列出本人的快照（最新在前，含冻结全表；别人的快照不在这里）。 */
  app.get(
    "/api/compare/snapshots",
    {
      config: {
        scope: "public",
        rateLimit: { max: 120, timeWindow: "1 minute" },
        cache: { maxAge: 60, etag: true, vary: COMPARE_VARY },
      },
    },
    async (req, reply) => {
      const identity = await requireAskIdentity(ctx, req, reply);
      if (!identity) {
        return sendError(reply, 401, "UNAUTHORIZED", "对照快照只对登录用户开放，请先登录后再查看。");
      }
      const snapshots = await ctx.repo.listComparisonSnapshotsByOwner(identity);
      return { ok: true, snapshots: snapshots.map(snapshotView) };
    },
  );

  /**
   * 两快照逐格 diff：`?against=<另一快照 id>`。两张都必须是本人的，
   * 任一张不存在或属于他人 → 同一个 404，不点名是哪一张。
   */
  app.get(
    "/api/compare/snapshots/:id/diff",
    {
      config: {
        scope: "public",
        rateLimit: { max: 120, timeWindow: "1 minute" },
        cache: { maxAge: 60, etag: true, vary: COMPARE_VARY },
      },
    },
    async (req, reply) => {
      const identity = await requireAskIdentity(ctx, req, reply);
      if (!identity) {
        return sendError(reply, 401, "UNAUTHORIZED", "对照快照只对登录用户开放，请先登录后再查看。");
      }
      const { id } = req.params as { id: string };
      const againstId = (req.query as Record<string, unknown> | undefined)?.against;
      if (typeof againstId !== "string" || !againstId.trim()) {
        return sendError(reply, 400, "BAD_REQUEST", "请用 ?against=<快照 id> 指定要对比的另一张快照。");
      }
      if (againstId.trim() === id) {
        return sendError(reply, 400, "BAD_REQUEST", "不能把一张快照与它自己对比。");
      }
      const base = await ctx.repo.getComparisonSnapshotById(id);
      const against = await ctx.repo.getComparisonSnapshotById(againstId.trim());
      if (!base || !against || base.ownerIdentity !== identity || against.ownerIdentity !== identity) {
        return sendError(reply, 404, "NOT_FOUND", "快照不存在或不属于你。");
      }
      return { ok: true, diff: diffComparisonSnapshots(base, against) };
    },
  );
};
