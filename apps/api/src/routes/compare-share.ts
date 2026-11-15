/**
 * 对照表分享（Batch 4 Phase 2 P2-4）：把一张冻结的快照分享出去，而不是
 * 把活数据公开。
 *
 * 分享的对象是 P2-3 快照的冻结副本，不是实时对照接口、不是 /pub 的 live
 * 文件夹引用：发布时把白名单字段的格子复制进 published_json，公开读只
 * serving 这份副本——快照本身不可变，副本再加一层冻结，公开后原快照的
 * 状态变化不可能影响已发布页。
 *
 * 与 /pub 的偏差（显式记录）：不沿用 /pub 的 resolvePublicPageItems live
 * 解析器（发布后收藏增删自动跟随，与“分享冻结快照”语义冲突）；只复用
 * slug 分配（allocatePublicSlug）、404 纪律、publicView 剥离模式。
 *
 * 字段白名单（硬编码，服务端唯一事实源）：
 *   可公开：pricing / platform / form / maintenance / price
 *   永不可公开：note / migration——白名单里没有这两个键，请求里出现即
 *   400，不给开关（收紧定稿：如需放宽须 Ryan 显式拍板，执行方不得自定）。
 * published_json 只含白名单维度的格子展示字段（value / source / verified /
 * verifiedAt / stale）：P2-2 在快照 price 格里多带的原始记录字段
 * （amountMinor / currency / period / freeTierLimit）与 sourceUrl、
 * maintenance 格的 lastCheckedAt 一律不复制。
 *
 * 公开读缓存：public, max-age=60 + etag（与 /pub 同口径——下线后最多
 * 60 秒 CDN 侧残留，与 /pub 一致，不另设 no-store）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { SiteComparisonItem } from "@navhub/core";
import type { ComparisonSnapshot } from "@navhub/store";
import type { PublishedComparisonItem } from "@navhub/store";
import type { AppContext } from "../context.ts";
import { sendError } from "../error-envelope.ts";
import { requireAskIdentity } from "./ask.ts";
import { allocatePublicSlug } from "./public-pages.ts";

/**
 * 可公开的对照字段（硬编码白名单，服务端唯一事实源）。
 * note / migration 永不在此列：migration 格的值就是备注原文或标签，
 * 公开它等于换名公开备注；/pub 的文件头注释已立规矩——“公开读绝不返回
 * note 字段……不要给这个加开关”。
 */
export const SHAREABLE_COMPARE_FIELDS = ["pricing", "platform", "form", "maintenance", "price"] as const;
export type ShareableCompareField = (typeof SHAREABLE_COMPARE_FIELDS)[number];

const SHAREABLE_SET = new Set<string>(SHAREABLE_COMPARE_FIELDS);

const statusBody = z.object({
  status: z.enum(["published", "unpublished"]),
});

/**
 * 白名单字段校验：须为白名单子集、至少 1 项、去重。
 * 空数组 → 400；含 note / migration / 未知键（包括 "__proto__"）→ 400。
 * 返回去重后保持请求顺序的字段列表；不合法返回 null（调用方 400）。
 */
export function parseShareableFields(raw: unknown): ShareableCompareField[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ShareableCompareField[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") return null;
    if (!SHAREABLE_SET.has(entry)) return null;
    if (!out.includes(entry as ShareableCompareField)) out.push(entry as ShareableCompareField);
  }
  if (out.length === 0) return null;
  return out;
}

/** 格子展示字段：只留 value / source / verified / verifiedAt / stale。 */
function projectCell(
  cell: SiteComparisonItem[ShareableCompareField] | null | undefined,
): { value: string | string[] | null; source: string; verified: boolean; verifiedAt: number | null; stale?: boolean } | null {
  if (!cell || typeof cell !== "object") return null;
  const projected: {
    value: string | string[] | null;
    source: string;
    verified: boolean;
    verifiedAt: number | null;
    stale?: boolean;
  } = {
    value: cell.value ?? null,
    source: typeof cell.source === "string" ? cell.source : "",
    verified: cell.verified === true,
    verifiedAt: typeof cell.verifiedAt === "number" ? cell.verifiedAt : null,
  };
  // stale 只在 price 格 90–180 天时为 true：只在 true 时保留该键。
  if (cell.stale === true) projected.stale = true;
  return projected;
}

/**
 * 把快照 items 按白名单字段投影成冻结的公开副本（纯函数，不碰仓储与身份，
 * 可单元测试）。
 * 未勾选的键在结果里不存在（不是 null）；siteId / title / url 保留；
 * note / migration 格永远不进结果；原始记录字段（amountMinor / currency /
 * period / freeTierLimit / sourceUrl / lastCheckedAt）一律不复制。
 */
export function buildPublishedItems(
  items: SiteComparisonItem[],
  fields: readonly ShareableCompareField[],
): PublishedComparisonItem[] {
  return items.map((item) => {
    const projected: Record<string, unknown> = {
      siteId: item.siteId,
      title: item.title,
      url: item.url,
    };
    for (const field of fields) {
      const cell = projectCell(item[field]);
      if (cell) projected[field] = cell;
    }
    return projected as PublishedComparisonItem;
  });
}

/** 分享对外形态：不含 owner_identity（公开读与 owner 读共用同一剥离）。 */
function shareView(share: {
  slug: string;
  publishedFields: string[];
  status: string;
  createdAt: number;
  updatedAt: number;
}) {
  return {
    slug: share.slug,
    fields: [...share.publishedFields],
    status: share.status,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
  };
}

/** 快照对外形态（公开读用）：不含 owner_identity，只含冻结副本。 */
function publicSnapshotView(snapshot: ComparisonSnapshot, publishedJson: PublishedComparisonItem[]) {
  return {
    id: snapshot.id,
    siteIds: [...snapshot.siteIds],
    items: publishedJson,
    createdAt: snapshot.createdAt,
  };
}

/**
 * 唯一约束冲突识别（与 packages/store/src/repository/events.ts 的
 * isUniqueViolation 同口径；路由层不跨包 import store 内部模块，故本地镜像）：
 * SQLite（better-sqlite3）给 SQLITE_CONSTRAINT_UNIQUE，PG 给 SQLSTATE 23505，
 * libsql 只带文本。只认唯一约束——其余错误必须原样抛出，不可把“表不存在”
 * 之类也当成重复而静默吞掉。
 */
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = String((err as { code?: unknown }).code ?? "");
  if (code === "23505" || code === "SQLITE_CONSTRAINT_UNIQUE") return true;
  const message = String((err as { message?: unknown }).message ?? "");
  return /UNIQUE constraint failed/i.test(message);
}

export const compareShareRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 发布一张快照的对照表：把白名单格子复制进 published_json，status:
   * published，201 回 slug 与 /pub/compare/<slug> 链接。
   * 快照不存在或非本人 → 通用 404；匿名 401。
   * 同一快照已有已发布的分享 → 409（先下线或删除再重发）；
   * 已有已下线的分享行 → 删旧行建新行（新 slug，旧 slug 永不复活）。
   */
  app.post(
    "/api/compare/snapshots/:id/publish",
    {
      config: {
        scope: "public",
        rateLimit: { max: 60, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const identity = await requireAskIdentity(ctx, req, reply);
      if (!identity) {
        return sendError(reply, 401, "UNAUTHORIZED", "对照分享只对登录用户开放，请先登录后再发布。");
      }
      const { id } = req.params as { id: string };
      const raw = (req.body ?? {}) as Record<string, unknown>;
      const fields = parseShareableFields(raw.fields);
      if (!fields) {
        return sendError(
          reply,
          400,
          "BAD_REQUEST",
          "请选择至少 1 个可公开的对照字段（计费方式、支持平台、形态、是否还在维护、价格数值）；备注与迁移成本永不公开。",
        );
      }
      const snapshot = await ctx.repo.getComparisonSnapshotById(id);
      if (!snapshot || snapshot.ownerIdentity !== identity) {
        return sendError(reply, 404, "NOT_FOUND", "快照不存在或不属于你。");
      }
      const existing = await ctx.repo.getComparisonSnapshotShareBySnapshotId(id);
      if (existing) {
        if (existing.status === "published") {
          return sendError(reply, 409, "CONFLICT", "这张快照已经发布过了，先下线或删除现有分享再重新发布。");
        }
        // 已下线的旧行：删掉再建新行（新 slug；旧 slug 随行删除，永不复活）。
        await ctx.repo.deleteComparisonSnapshotShare(existing.id);
      }

      // slug 分配复用 /pub 的 allocatePublicSlug（"compare" 为基底）；
      // 再验分享表：两表 slug 命名空间不同，撞车概率极低，撞了就重试一次分配。
      let slug: string | null = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = await allocatePublicSlug(ctx, "compare", null);
        if (!candidate) break;
        if (!(await ctx.repo.getComparisonSnapshotShareBySlug(candidate))) {
          slug = candidate;
          break;
        }
      }
      if (!slug) {
        return sendError(reply, 409, "CONFLICT", "分享链接分配失败，请稍后重试。");
      }
      const publishedJson = buildPublishedItems(snapshot.items, fields);
      // 并发 publish：两请求可同时通过上面的 existing == null 检查，第二条
      // INSERT 撞 snapshot_id UNIQUE。按“已发布重复 409”的既有口径回 409，
      // 不抛 500：重读确认确有已发布行才报“已经发布过”，否则是 slug 撞车，
      // 报分配失败请重试；非唯一约束错误原样抛出。
      let share;
      try {
        share = await ctx.repo.createComparisonSnapshotShare({
          snapshotId: snapshot.id,
          ownerIdentity: identity,
          slug,
          publishedFields: [...fields],
          publishedJson,
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const raced = await ctx.repo.getComparisonSnapshotShareBySnapshotId(snapshot.id);
        if (raced) {
          return sendError(reply, 409, "CONFLICT", "这张快照已经发布过了，先下线或删除现有分享再重新发布。");
        }
        return sendError(reply, 409, "CONFLICT", "分享链接分配失败，请稍后重试。");
      }
      reply.code(201);
      return {
        ok: true,
        share: { ...shareView(share), url: `/pub/compare/${share.slug}` },
      };
    },
  );

  /**
   * 公开读：免登。只返回已发布的分享；不存在/已下线一律 404。
   * 响应体永不含 owner；items 即 published_json 原样。
   * 缓存 public, max-age=60 + s-maxage=60 + etag（与 /pub 同口径的 60 秒
   * 档位，但本路由内容与身份无关——匿名请求拿到的是全体同一份数据，
   * 故配 sharedMaxAge 走共享缓存；带身份头的请求由 onSend hook 降级
   * private。下线后最多 60 秒 CDN 侧残留，与 /pub 一致，不另设 no-store）。
   */
  app.get(
    "/api/compare/shares/:slug",
    { config: { scope: "public", cache: { maxAge: 60, sharedMaxAge: 60, etag: true } } },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const share = await ctx.repo.getPublishedComparisonSnapshotShareBySlug(slug);
      if (!share) return sendError(reply, 404, "NOT_FOUND", "分享不存在或已下线");
      const snapshot = await ctx.repo.getComparisonSnapshotById(share.snapshotId);
      if (!snapshot) return sendError(reply, 404, "NOT_FOUND", "分享不存在或已下线");
      return {
        ok: true,
        share: {
          slug: share.slug,
          fields: [...share.publishedFields],
          createdAt: share.createdAt,
        },
        snapshot: publicSnapshotView(snapshot, share.publishedJson),
      };
    },
  );

  /**
   * 上下线：owner 才可（跨 owner 一律 404）。
   * 重新发布须重算：按已存 publishedFields 从快照重算 published_json
   * （快照不可删，此条恒真，写作防御）；unpublished 后源站立即 404，
   * 共享缓存最多残留 60 秒（公开读 max-age=60，见上）。
   */
  app.patch(
    "/api/compare/shares/:slug",
    {
      config: {
        scope: "public",
        rateLimit: { max: 120, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const identity = await requireAskIdentity(ctx, req, reply);
      if (!identity) {
        return sendError(reply, 401, "UNAUTHORIZED", "对照分享只对登录用户开放，请先登录后再操作。");
      }
      const parsed = statusBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return sendError(reply, 400, "BAD_REQUEST", "参数无效", parsed.error.flatten());
      }
      const { slug } = req.params as { slug: string };
      const share = await ctx.repo.getComparisonSnapshotShareBySlug(slug);
      if (!share || share.ownerIdentity !== identity) {
        return sendError(reply, 404, "NOT_FOUND", "分享不存在");
      }
      if (parsed.data.status === "published") {
        const snapshot = await ctx.repo.getComparisonSnapshotById(share.snapshotId);
        if (!snapshot) return sendError(reply, 404, "NOT_FOUND", "分享不存在");
        const fields = parseShareableFields(share.publishedFields);
        if (!fields) return sendError(reply, 400, "BAD_REQUEST", "已存的分享字段无效，无法重新发布。");
        const updated = await ctx.repo.setComparisonSnapshotShareStatus(share.id, "published", {
          publishedFields: [...fields],
          publishedJson: buildPublishedItems(snapshot.items, fields),
        });
        if (!updated) return sendError(reply, 404, "NOT_FOUND", "分享不存在");
        return { ok: true, share: shareView(updated) };
      }
      const updated = await ctx.repo.setComparisonSnapshotShareStatus(share.id, "unpublished");
      if (!updated) return sendError(reply, 404, "NOT_FOUND", "分享不存在");
      return { ok: true, share: shareView(updated) };
    },
  );

  /** 删除分享行：owner 才可（跨 owner 一律 404）；slug 永不复用。 */
  app.delete(
    "/api/compare/shares/:slug",
    {
      config: {
        scope: "public",
        rateLimit: { max: 120, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const identity = await requireAskIdentity(ctx, req, reply);
      if (!identity) {
        return sendError(reply, 401, "UNAUTHORIZED", "对照分享只对登录用户开放，请先登录后再操作。");
      }
      const { slug } = req.params as { slug: string };
      const share = await ctx.repo.getComparisonSnapshotShareBySlug(slug);
      if (!share || share.ownerIdentity !== identity) {
        return sendError(reply, 404, "NOT_FOUND", "分享不存在");
      }
      await ctx.repo.deleteComparisonSnapshotShare(share.id);
      return { ok: true };
    },
  );
};
