/**
 * B 站视频「问 AI」摘要路由：POST /api/videos/bili-summary
 *
 * 场景：用户在 B 站视频页点「问 AI」，要一段视频要点摘要。
 *
 *  grounding（绝不编造）：
 *  - 摘要只依据调用方随请求带来的真实资料：视频标题、简介、章节标题、
 *    字幕摘录。模型不得编造没给的细节；资料不足时如实 400，不出假摘要。
 *  - 评论不在资料之列：B 站评论接口匿名调用实测返回 -352（需登录态），
 *    简介接口直连也 -412（出口 IP 被禁）。简介走站内已有的 bili-parse
 *    第三方引擎（星之阁 / 米人，实测均返回 151 字简介），不在本路由里
 *    直连 B 站——前端在简介缺失时先调 /api/videos/bili-parse 刷新，
 *    再把简介随请求带来。
 *  - 界面必须如实标注「非全文稿」：摘要是简介 + 章节 + 字幕摘录的要点
 *    提炼，不是看完全片的总结。
 *
 * 降级：未配密钥 / 额度用完 / 模型出错都不崩页，mode:"local" +
 * degraded 标注，并把简介与章节当原文要点原样下发，前端照实展示。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import { llmProviderReadyAny, resolveLlm } from "../llm-config.ts";
import { reserveLlmQuota, settleLlmQuota } from "../llm-quota.ts";
import { callLlm, INTERACTIVE_LLM_BUDGET_MS } from "../llm-usage.ts";
import { identityTrusted, requestIdentityOf } from "./shared.ts";

/** 摘要永远带这句标注：是要点提炼，不是全文稿。 */
export const VIDEO_SUMMARY_NOTE =
  "本摘要由 AI 根据视频简介与站内资料（章节、字幕摘录）生成，是要点提炼，非全文稿；原视频内容以原站为准。";

const BVID_RE = /^BV[0-9A-Za-z]{10}$/;

const chapterSchema = z.object({
  title: z.string().min(1).max(120),
  startSec: z.number().finite().min(0).max(24 * 3600),
});

const transcriptLineSchema = z.object({
  startSec: z.number().finite().min(0).max(24 * 3600),
  text: z.string().min(1).max(1000),
});

const summarySchema = z.object({
  bvid: z
    .string()
    .regex(BVID_RE, "bvid 格式不对")
    .optional(),
  title: z.string().min(1, "先给视频标题").max(200, "标题太长了"),
  description: z.string().max(8000).optional(),
  chapters: z.array(chapterSchema).max(60).optional(),
  transcript: z.array(transcriptLineSchema).max(300).optional(),
});

export type VideoSummaryInput = z.infer<typeof summarySchema>;

export type VideoSummarySource = "desc" | "chapters" | "transcript";

export interface VideoSummaryMaterial {
  title: string;
  description: string;
  chapterTitles: string[];
  transcriptExcerpt: string;
  sources: VideoSummarySource[];
}

/** 简介截断预算：太长只会把模型注意力与等待时间一起拉长。 */
const DESC_BUDGET_CHARS = 1500;
/** 字幕摘录预算：按行截断到预算内，宁可少行不要掐半句。 */
const TRANSCRIPT_BUDGET_CHARS = 3000;
/** 章节只取前 40 个标题参与提示词。 */
const CHAPTER_BUDGET = 40;

function truncateText(text: string, budget: number): string {
  const trimmed = text.trim();
  return trimmed.length > budget ? trimmed.slice(0, budget) + "…" : trimmed;
}

function truncateTranscriptLines(lines: Array<{ startSec: number; text: string }>): string {
  let out = "";
  for (const line of lines) {
    const piece = `[${Math.floor(line.startSec / 60)}:${String(Math.floor(line.startSec % 60)).padStart(2, "0")}] ${line.text.trim()}`;
    if (out.length + piece.length + 1 > TRANSCRIPT_BUDGET_CHARS) break;
    out += (out ? "\n" : "") + piece;
  }
  return out;
}

/**
 * 把请求资料收敛成提示词素材（纯函数，单元测试直接测）。
 * 返回 false 的资料 = 不足以做摘要，路由如实 400。
 */
export function buildVideoSummaryMaterial(input: VideoSummaryInput): VideoSummaryMaterial | null {
  const description = truncateText(input.description ?? "", DESC_BUDGET_CHARS);
  const chapterTitles = (input.chapters ?? []).slice(0, CHAPTER_BUDGET).map((c) => c.title.trim()).filter(Boolean);
  const transcriptExcerpt = truncateTranscriptLines(input.transcript ?? []);
  const sources: VideoSummarySource[] = [];
  if (description) sources.push("desc");
  if (chapterTitles.length > 0) sources.push("chapters");
  if (transcriptExcerpt) sources.push("transcript");
  if (sources.length === 0) return null;
  return { title: input.title.trim(), description, chapterTitles, transcriptExcerpt, sources };
}

const VIDEO_SUMMARY_SYSTEM_PROMPT = [
  "你是视频要点摘要助手。用户给你一段视频的标题、简介、章节标题、字幕摘录，请用中文给出 3-5 条要点摘要，总长不超过 300 字。",
  "硬约束：只写资料里有的内容，不编造没有提到的人名、数字、结论；资料没说清的不要脑补，直接略过。",
  "不要复述简介原文，不要加与视频无关的建议，不要输出解释性前言，直接给要点。",
].join("\n");

export function buildVideoSummaryPrompt(material: VideoSummaryMaterial): { system: string; user: string } {
  const parts = [`标题：${material.title}`];
  if (material.description) parts.push(`简介：\n${material.description}`);
  if (material.chapterTitles.length > 0) {
    parts.push(`章节：\n${material.chapterTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")}`);
  }
  if (material.transcriptExcerpt) parts.push(`字幕摘录：\n${material.transcriptExcerpt}`);
  return { system: VIDEO_SUMMARY_SYSTEM_PROMPT, user: parts.join("\n\n") };
}

function cleanSummary(raw: string): string | null {
  const text = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*#>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 10) return null;
  return text.length > 1200 ? text.slice(0, 1200) + "…" : text;
}

export const videoBiliSummaryRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  app.post(
    "/api/videos/bili-summary",
    { config: { scope: "public", rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = summarySchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: "INVALID_REQUEST", message: parsed.error.issues[0]?.message || "请求参数错误" };
      }
      const material = buildVideoSummaryMaterial(parsed.data);
      if (!material) {
        reply.code(400);
        return {
          error: "INVALID_REQUEST",
          message: "这个视频没有可用来做摘要的简介、章节或字幕资料",
        };
      }
      const startedAt = Date.now();

      const identity = identityTrusted(ctx, req as never) ? requestIdentityOf(req as never) : null;
      const llm = await resolveLlm(ctx, identity);
      const quota = await reserveLlmQuota(ctx, identity, { source: llm.source });
      const quotaInfo = quota.ok ? null : {
        scope: quota.error.scope,
        metric: quota.error.metric,
        limit: quota.error.limit,
        used: quota.error.used,
        retryAfterSeconds: Math.max(1, Math.ceil(quota.error.retryAfterMs / 1000)),
      };
      if (!quota.ok) reply.header("retry-after", String(quotaInfo?.retryAfterSeconds));

      try {
        let mode: "ai" | "local" = "local";
        let degraded: "unconfigured" | "quota" | "error" | null =
          quotaInfo ? "quota" : llmProviderReadyAny(llm) ? null : "unconfigured";
        let summary: string | null = null;

        if (!degraded) {
          try {
            const prompt = buildVideoSummaryPrompt(material);
            const res = await callLlm(ctx, llm, {
              scenario: "video_summary",
              identity,
              messages: [
                { role: "system", content: prompt.system },
                { role: "user", content: prompt.user },
              ],
              temperature: 0.3,
              maxTokens: 600,
              deadlineAt: startedAt + INTERACTIVE_LLM_BUDGET_MS,
            });
            summary = cleanSummary(res.content || "");
            if (summary) {
              mode = "ai";
            } else {
              degraded = "error";
            }
          } catch {
            degraded = "error";
          }
        }

        return {
          ok: true,
          mode,
          degraded,
          summary,
          sources: material.sources,
          note: VIDEO_SUMMARY_NOTE,
          // 降级时把原文要点原样下发，前端照实展示「未经过 AI 整理」，
          // 不把简介本身冒充成摘要。
          fallback: {
            description: material.description || null,
            chapters: material.chapterTitles,
          },
          ...(quotaInfo ? { quota: quotaInfo } : {}),
        };
      } finally {
        await settleLlmQuota(ctx, quota.ok ? quota.hold : null);
      }
    },
  );
};
