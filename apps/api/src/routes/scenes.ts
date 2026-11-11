/**
 * 场景包只读接口：GET /api/scenes 与 GET /api/scenes/:id
 *
 * 为什么需要：24 个场景包此前只活在 POST /api/ai/find 的进程内展开里，
 * 没有可抓取、可分享的落地页——任务型搜索流量（「做PPT的网站」「做短剧
 * 流程」）全接不住。落地页 /scenes 与 /scenes/{id} 的取数走这里。
 *
 * 口径纪律（与 ai/find 同源，逐条对齐）：
 *  - 数据单一事实源是 ai-finder.ts 的 SCENE_PACKS（定义、说明文案、intro
 *    都在那边），展开逻辑共用 scene-resolve.ts——这里不许再抄一份清单；
 *  - 站点只来自站内混合检索的真实召回（策展词法过滤），查不到的步骤
 *    整步不下发，不编造站点、不给站外 URL；
 *  - 理由文案只用本地拼装（分类 + 简介），不走模型：这是缓存友好的只读
 *    接口，不能让页面内容随模型输出漂移，更不能把本地结果冒充 AI 挑选；
 *  - 检索失败如实以 degraded 标记，不 500、不把部分结果冒充完整。
 */
import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../context.ts";
import { scenePackById } from "../ai-finder.ts";
import { resolveSceneDetail, resolveSceneSummaries } from "../scene-resolve.ts";
import { notFound } from "./shared.ts";

export const scenesRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /** 场景包列表：定义顺序即默认精选顺序，计数全部按本次真实召回算 */
  app.get(
    "/api/scenes",
    { config: { scope: "public", cache: { maxAge: 60, etag: true } } },
    async () => {
      const { scenes, retrievalFailed } = await resolveSceneSummaries(ctx);
      return {
        ok: true,
        degraded: retrievalFailed ? ("error" as const) : null,
        total: scenes.length,
        scenes,
      };
    },
  );

  /** 场景包详情：步骤顺序即建议使用顺序，每步站点均为站内真实召回 */
  app.get(
    "/api/scenes/:id",
    { config: { scope: "public", cache: { maxAge: 60, etag: true } } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const scene = scenePackById(id);
      // 未知 id 如实 404：静默回一个空场景会让落地页生成假页面
      if (!scene) return notFound(reply, `场景包不存在：${id}`);
      const { detail, retrievalFailed } = await resolveSceneDetail(ctx, scene);
      return {
        ok: true,
        degraded: retrievalFailed ? ("error" as const) : null,
        scene: detail,
      };
    },
  );
};
