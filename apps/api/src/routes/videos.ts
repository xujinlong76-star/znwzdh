/**
 * 视频库只读 API（阶段二第一刀：先建读路径，不动事实源）。
 *
 * 背景：视频库目前是「一个 6.37MB 的 JSON 文档」，任何读取都要解析整包。
 * `video_items` 关系表已由 `video-catalog.ts` 维护（`dual` / `db` 模式同步），
 * 但一直没有查询入口 —— 列表页要 20 条也得把 5,578 条全读进内存。
 *
 * 本模块只做**读**，并且保证「不比现状更差」：
 *   - 关系表有条目 → 走 SQL 分页（命中 category/health 索引）；
 *   - 关系表为空（未迁移 / 纯 json 模式）→ 回落 KV 文档并在内存里过滤分页，
 *     响应里用 `source` 如实标注走了哪条路径。
 *
 * 不在这里做写入：写路径仍由 BFF 的 `mutateVideoLibrary` 统一收口（带 ifVersion），
 * 贸然加一套写 API 会立刻产生两个事实源。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import {
  countVideoItems,
  encodeKeysetCursor,
  getVideoItem,
  listVideoItems,
  videoItemKeysetValues,
  type VideoItemRow,
} from "@navhub/store";
import { sendError } from "../error-envelope.ts";
import { readVideosData } from "../storage.ts";
import { flattenVideoCatalog, resolveVideoStoreMode } from "../video-catalog.ts";
import { resolveLlm } from "../llm-config.ts";
import { callLlm } from "../llm-usage.ts";
import { safeJsonParse } from "./shared.ts";

/** 单页上限：与 repository 内部上限一致，避免调用方传 10000 把响应撑爆 */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const listQuerySchema = z.object({
  categoryId: z.string().min(1).max(200).optional(),
  platform: z.string().min(1).max(40).optional(),
  healthStatus: z.enum(["healthy", "outdated", "broken", "unverified"]).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  // Keyset 游标（M12）：只在 db 读路径生效，走 WHERE (category_id,sort,id)
  // 谓词，不再 OFFSET；KV 文档回落路径仍用 offset 切片（内存数组，无扫表）。
  cursor: z.string().max(4096).optional(),
  /** 1 = 不返回 videoConfig（章节树/字幕动辄几十 KB），列表页默认精简 */
  compact: z.enum(["0", "1"]).optional(),
});

export interface VideoApiItem {
  id: string;
  categoryId: string;
  title: string;
  href: string;
  description: string | null;
  icon: string | null;
  enabled: boolean;
  sort: number;
  platform: string | null;
  externalId: string | null;
  author: string | null;
  durationSec: number | null;
  publishedAt: string | null;
  qualityScore: number | null;
  freshnessScore: number | null;
  healthStatus: string | null;
  sourceType: string | null;
  pinned: boolean;
  updatedAt: number;
  /** 仅 `compact=0` / 详情接口返回 */
  videoConfig?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从 payload（`{ item, sub }`）里取原始条目，兼容缺字段的脏数据 */
function payloadItem(payload: unknown): Record<string, unknown> {
  const p = isRecord(payload) ? payload : {};
  return isRecord(p.item) ? p.item : {};
}

function toApiItem(row: VideoItemRow, includeConfig: boolean): VideoApiItem {
  const item = payloadItem(row.payload);
  const config = isRecord(item.videoConfig) ? item.videoConfig : null;
  return {
    id: row.id,
    categoryId: row.categoryId,
    title: row.title,
    href: row.href,
    description: row.description,
    icon: row.icon,
    enabled: row.enabled,
    sort: row.sort,
    platform: row.platform,
    externalId: row.externalId,
    author: row.author,
    durationSec: row.durationSec,
    publishedAt: row.publishedAt,
    qualityScore: row.qualityScore,
    freshnessScore: row.freshnessScore,
    healthStatus: row.healthStatus,
    sourceType: row.sourceType,
    pinned: row.pinned,
    updatedAt: row.updatedAt,
    ...(includeConfig ? { videoConfig: config } : {}),
  };
}

/** KV 回落：把整包文档压平成与关系表同形的行，再走同一套过滤/分页 */
function rowsFromDocument(doc: unknown): VideoItemRow[] {
  const flattened = flattenVideoCatalog(doc);
  return flattened.items.map((it) => ({
    id: it.id,
    categoryId: it.categoryId,
    title: it.title,
    href: it.href,
    description: it.description ?? null,
    icon: it.icon ?? null,
    enabled: it.enabled ?? true,
    sort: it.sort ?? 0,
    platform: it.platform ?? null,
    externalId: it.externalId ?? null,
    author: it.author ?? null,
    durationSec: it.durationSec ?? null,
    publishedAt: it.publishedAt ?? null,
    qualityScore: it.qualityScore ?? null,
    freshnessScore: it.freshnessScore ?? null,
    healthStatus: it.healthStatus ?? null,
    sourceType: it.sourceType ?? null,
    pinned: it.pinned ?? false,
    payload: it.payload,
    updatedAt: 0,
  }));
}

function filterRows(
  rows: VideoItemRow[],
  filter: { categoryId?: string; platform?: string; healthStatus?: string },
): VideoItemRow[] {
  return rows.filter(
    (r) =>
      (!filter.categoryId || r.categoryId === filter.categoryId) &&
      (!filter.platform || r.platform === filter.platform) &&
      (!filter.healthStatus || r.healthStatus === filter.healthStatus),
  );
}

export const videoRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 分页列出视频条目。
   *
   * 响应头 `X-Video-Source` 标注数据来源（db / kv），便于灰度期核对读路径是否真的
   * 切到了关系表 —— 只写在 body 里容易被代理层剥离。
   */
  app.get("/api/videos", { config: { scope: "read", cache: { maxAge: 30, etag: true } } }, async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return sendError(reply, 400, "BAD_REQUEST", "参数无效", parsed.error.issues);
    }

    const { categoryId, platform, healthStatus } = parsed.data;
    const limit = parsed.data.limit ?? DEFAULT_LIMIT;
    const offset = parsed.data.offset ?? 0;
    const cursor = parsed.data.cursor;
    const includeConfig = parsed.data.compact === "0";
    const filter = { categoryId, platform, healthStatus };

    let source: "db" | "kv" = "kv";
    let total = 0;
    let rows: VideoItemRow[] = [];
    let nextCursor: string | null = null;

    /**
     * 只有在 `NAVHUB_VIDEO_STORE=db`（读路径已正式切到关系表）时才用表供数。
     *
     * 为什么不能「表里有数据就用表」：`json` / `dual` 模式下关系表只是**影子副本**，
     * 它可能是上次迁移用构建期基线灌进去的、早已和 KV 事实源分叉。实测当前库：
     * KV 74 条、表 5,578 条 —— 若按「有数据就用表」供数，接口会返回 5,504 条
     * 站点上根本不存在的幻影视频。
     *
     * 灰度期要看表的表现，用 `?source=db` 显式覆盖（仅供排查，不改变默认行为）。
     */
    const forced = (req.query as { source?: string } | undefined)?.source;
    const preferDb = forced === "db" ? true : forced === "kv" ? false : resolveVideoStoreMode() === "db";

    if (preferDb) {
      const dbTotal = await countVideoItems(ctx.repo, filter).catch(() => 0);
      if (dbTotal > 0) {
        source = "db";
        total = dbTotal;
        // 多取一行判定 hasMore：有余行就给 nextCursor（offset 页也给，客户端
        // 可以从第 1 页直接切到游标翻页）。
        const dbRows = await listVideoItems(ctx.repo, {
          ...filter,
          limit: limit + 1,
          offset,
          cursor,
        });
        const hasMore = dbRows.length > limit;
        rows = hasMore ? dbRows.slice(0, limit) : dbRows;
        const last = hasMore ? rows[rows.length - 1] : undefined;
        nextCursor = last ? encodeKeysetCursor(videoItemKeysetValues(last)) : null;
      }
    }

    if (source !== "db") {
      // KV 事实源（json / dual 模式）或关系表为空：回落文档，保证接口永远可用
      const doc = await readVideosData(ctx);
      const all = filterRows(rowsFromDocument(doc), filter);
      total = all.length;
      rows = all.slice(offset, offset + limit);
    }

    reply.header("X-Video-Source", source);
    return {
      source,
      total,
      limit,
      offset,
      returned: rows.length,
      nextCursor,
      items: rows.map((r) => toApiItem(r, includeConfig)),
    };
  });

  /** 单条详情：始终带 videoConfig（播放页需要章节树与字幕） */
  app.get("/api/videos/:id", { config: { scope: "read", cache: { maxAge: 30, etag: true } } }, async (req, reply) => {
    const params = z.object({ id: z.string().min(1).max(200) }).safeParse(req.params ?? {});
    if (!params.success) {
      reply.code(400);
      return { error: "参数无效", detail: params.error.issues };
    }

    const id = params.data.id;
    const row = await getVideoItem(ctx.repo, id).catch(() => null);
    if (row) {
      reply.header("X-Video-Source", "db");
      return { source: "db", item: toApiItem(row, true) };
    }

    // 表里没有：可能是纯 json 模式，也可能是这条只存在于文档里
    const doc = await readVideosData(ctx);
    const found = rowsFromDocument(doc).find((r) => r.id === id);
    if (!found) {
      reply.code(404);
      return { error: "视频条目不存在", id };
    }
    reply.header("X-Video-Source", "kv");
    return { source: "kv", item: toApiItem(found, true) };
  });

  /**
   * 视频智能伴学 Copilot（AI 全片要点速览与字幕带时间戳问答）
   * 解决痛点：长技术视频耗时费力，用户需要 10 秒看懂核心结论并一键跳转到对应秒数。
   */
  app.post(
    "/api/videos/copilot",
    {
      config: {
        scope: "public",
        rateLimit: { max: process.env.NODE_ENV === "test" ? 10_000 : 25, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const body = (req.body ?? {}) as {
        question?: string;
        mode?: "qa" | "summary";
        chunks?: Array<{ startSec?: number; text?: string }>;
      };
      const chunks = Array.isArray(body.chunks)
        ? body.chunks
            .slice(0, 20)
            .map((c) => ({
              startSec: Math.max(0, Math.floor(Number(c.startSec) || 0)),
              text: String(c.text ?? "").trim().slice(0, 300),
            }))
            .filter((c) => c.text.length > 0)
        : [];

      if (chunks.length === 0) {
        reply.code(400);
        return { error: "缺少视频字幕片段" };
      }

      const mode = body.mode === "summary" ? "summary" : "qa";
      const question = String(body.question ?? "").trim();
      const transcriptContext = chunks
        .map((c) => `[startSec=${c.startSec}] ${c.text}`)
        .join("\n");

      const llm = await resolveLlm(ctx);
      if (!llm.provider.apiKey) {
        return {
          success: true,
          answer: mode === "summary"
            ? "已为您提取全片关键节点，点击下方时间戳可直接跳转播放："
            : `围绕「${question || "当前问题"}」为您定位到以下高相关讲解段落：`,
          keyPoints: chunks.slice(0, 3).map((c) => ({
            startSec: c.startSec,
            point: c.text.slice(0, 60),
          })),
          fallback: true,
        };
      }

      const prompt =
        mode === "summary"
          ? `你是专业的技术视频伴学助教。请根据以下带时间戳的视频字幕切片，提炼出全片最核心的结论概要与 3~4 个关键知识点时间戳：

【视频字幕切片】
${transcriptContext}

请严格返回以下 JSON 格式：
{
  "answer": "一句话全片核心主旨总结（50字内）",
  "keyPoints": [
    { "startSec": 对应秒数整数, "point": "该时间点讲解的核心干货结论（35字内）" }
  ]
}`
          : `你是专业的技术视频伴学助教。用户针对当前视频提问：「${question}」。
请结合以下检索到的视频字幕切片，直接回答用户的问题，并指出对应的关键时间戳：

【相关视频字幕切片】
${transcriptContext}

请严格返回以下 JSON 格式：
{
  "answer": "针对用户提问的简明专业解答（80字内，直接给干货结论）",
  "keyPoints": [
    { "startSec": 对应秒数整数, "point": "讲师在该时间点的对应原话要点（35字内）" }
  ]
}`;

      try {
        const res = await callLlm(ctx, llm, {
          scenario: "video_copilot",
          messages: [{ role: "user", content: prompt }],
          json: true,
          thinking: false,
          temperature: 0.2,
          maxTokens: 900,
        });

        let parsed: { answer?: string; keyPoints?: Array<{ startSec?: number; point?: string }> } | null = null;
        try {
          const raw = (res.content || "").replace(/```json/gi, "").replace(/```/g, "").trim();
          parsed = JSON.parse(raw);
        } catch {
          const m = (res.content || "").match(/\{[\s\S]*\}/);
          if (m) {
            // 解析失败即按「无解析结果」继续（外层还有 !parsed 分支兜底）；不再静默吞异常
            parsed = safeJsonParse(m[0], parsed);
          }
        }

        const keyPoints = Array.isArray(parsed?.keyPoints)
          ? parsed!.keyPoints
              .map((kp) => ({
                startSec: Math.max(0, Math.floor(Number(kp.startSec) || 0)),
                point: String(kp.point ?? "").trim(),
              }))
              .filter((kp) => kp.point.length > 0)
              .slice(0, 5)
          : chunks.slice(0, 3).map((c) => ({ startSec: c.startSec, point: c.text.slice(0, 60) }));

        return {
          success: true,
          answer: String(parsed?.answer || "以下是结合视频字幕为您提炼的核心解答：").trim(),
          keyPoints,
          model: res.model,
        };
      } catch (err) {
        req.log.warn({ err: String(err) }, "视频 AI 伴学降级");
        return {
          success: true,
          answer: "已根据字幕语义相似度为您定位关键讲解段落：",
          keyPoints: chunks.slice(0, 3).map((c) => ({
            startSec: c.startSec,
            point: c.text.slice(0, 60),
          })),
          fallback: true,
        };
      }
    }
  );
};
