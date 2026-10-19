/**
 * AI 模型配置路由（管理端系统级 + 用户级个人配置）。
 *
 * - 管理端：读/写/重置系统默认模型 + 连通性测试（scope: admin）
 * - 用户端：读/写/删除个人模型 + 连通性测试（按身份隔离，不暴露他人配置）
 *
 * 密钥任何情况下都不回显明文；写操作失败时只透出可读原因，不抛出内部堆栈。
 */
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { LlmError, chatCompletion } from "@navhub/ai";
import { z } from "zod";
import {
  LlmProviderInputSchema,
  SystemLlmConfigInputSchema,
  deleteUserLlmConfig,
  getSystemLlmConfigView,
  getUserLlmConfigView,
  resetSystemLlmConfig,
  resolveLlm,
  saveSystemLlmConfig,
  saveUserLlmConfig,
  testLlmProvider,
} from "../llm-config.ts";
import { identityAllowed, identityOf, unauthorized } from "./shared.ts";
import type { AppContext } from "../context.ts";

export const aiConfigRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /** 统一把 SSRF/配置类失败转成 400（其余异常交给全局兜底） */
  function replyLlmError(reply: FastifyReply, err: unknown): { error: string; code?: string } {
    if (err instanceof LlmError) {
      reply.code(400);
      return { error: err.message, code: err.code };
    }
    throw err;
  }

  /* ------------------------------ 管理端 ------------------------------ */

  app.get("/api/admin/ai/config", { config: { scope: "admin" } }, async () => {
    const config = await getSystemLlmConfigView(ctx);
    const resolved = await resolveLlm(ctx);
    return {
      config,
      effective: {
        source: resolved.source,
        model: resolved.provider.model,
        hasApiKey: Boolean(resolved.provider.apiKey),
      },
    };
  });

  app.put("/api/admin/ai/config", { config: { scope: "admin" } }, async (req, reply) => {
    const body = SystemLlmConfigInputSchema.safeParse(req.body ?? {});
    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }
    try {
      const config = await saveSystemLlmConfig(ctx, body.data, req.auth.actor, req.ip);
      return { config };
    } catch (err) {
      return replyLlmError(reply, err);
    }
  });

  app.post("/api/admin/ai/config/reset", { config: { scope: "admin" } }, async (req) => {
    const config = await resetSystemLlmConfig(ctx, req.auth.actor, req.ip);
    return { config };
  });

  app.post(
    "/api/admin/ai/config/test",
    { config: { scope: "admin", rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = SystemLlmConfigInputSchema.safeParse(req.body ?? {});
      if (!body.success) {
        reply.code(400);
        return { error: "参数无效", detail: body.error.issues };
      }
      try {
        // identity=null：未填密钥时回退系统级已存密钥
        const result = await testLlmProvider(ctx, body.data, null);
        return { result };
      } catch (err) {
        return replyLlmError(reply, err);
      }
    },
  );

  /* ------------------------------ 用户端 ------------------------------ */

  app.get("/api/user/ai/config", { config: { scope: "public" } }, async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) {
      reply.code(400);
      return { error: "缺少 userId 或 anonId" };
    }
    if (!identityAllowed(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
    return { config: await getUserLlmConfigView(ctx, identity) };
  });

  app.put("/api/user/ai/config", { config: { scope: "public" } }, async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) {
      reply.code(400);
      return { error: "缺少 userId 或 anonId" };
    }
    if (!identityAllowed(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");

    const body = LlmProviderInputSchema.safeParse(req.body ?? {});
    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }
    try {
      const config = await saveUserLlmConfig(ctx, identity, body.data, req.ip);
      return { config };
    } catch (err) {
      return replyLlmError(reply, err);
    }
  });

  app.delete("/api/user/ai/config", { config: { scope: "public" } }, async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) {
      reply.code(400);
      return { error: "缺少 userId 或 anonId" };
    }
    if (!identityAllowed(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
    const config = await deleteUserLlmConfig(ctx, identity, req.ip);
    return { config };
  });

  app.post(
    "/api/user/ai/config/test",
    { config: { scope: "public", rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const identity = identityOf(req as never);
      if (!identity) {
        reply.code(400);
        return { error: "缺少 userId 或 anonId" };
      }
      if (!identityAllowed(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");

      const body = LlmProviderInputSchema.safeParse(req.body ?? {});
      if (!body.success) {
        reply.code(400);
        return { error: "参数无效", detail: body.error.issues };
      }
      try {
        const result = await testLlmProvider(ctx, body.data, identity);
        return { result };
      } catch (err) {
        return replyLlmError(reply, err);
      }
    },
  );

  /* ---------------------------- 个人试聊 ---------------------------- */

  /**
   * 个人 AI 对话：按解析链选用模型（个人 → 系统 → 环境），主模型失败自动走备用池。
   * 只接受 user/assistant 消息（不允许客户端注入 system 指令），限流 10 次/分钟。
   */
  const ChatBody = z.object({
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().min(1).max(8000),
        }),
      )
      .min(1)
      .max(20),
    maxTokens: z.number().int().min(16).max(1024).optional(),
  });

  app.post(
    "/api/user/ai/chat",
    { config: { scope: "public", rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const identity = identityOf(req as never);
      if (!identity) {
        reply.code(400);
        return { error: "缺少 userId 或 anonId" };
      }
      if (!identityAllowed(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");

      const body = ChatBody.safeParse(req.body ?? {});
      if (!body.success) {
        reply.code(400);
        return { error: "参数无效", detail: body.error.issues };
      }

      const resolved = await resolveLlm(ctx, identity);
      if (!resolved.provider.apiKey) {
        reply.code(400);
        return { error: "尚未配置可用的模型密钥", code: "config" };
      }

      const candidates = [resolved.provider, ...resolved.fallbacks];
      let lastError: LlmError | null = null;
      for (const candidate of candidates) {
        try {
          const result = await chatCompletion(candidate, {
            messages: body.data.messages,
            maxTokens: body.data.maxTokens ?? 512,
          });
          await ctx.repo
            .recordEvent("ai_chat", {
              identity,
              meta: {
                model: result.model,
                source: resolved.source,
                tokens: result.usage.totalTokens,
                latencyMs: result.latencyMs,
              },
            })
            .catch(() => undefined);
          return {
            reply: result.content,
            model: result.model,
            source: resolved.source,
            usage: result.usage,
            latencyMs: result.latencyMs,
          };
        } catch (err) {
          if (!(err instanceof LlmError)) throw err;
          lastError = err;
          // 鉴权/参数类错误换备用模型也无意义，直接失败
          if (err.code === "auth" || err.code === "config" || err.code === "ssrf") break;
        }
      }

      reply.code(502);
      return {
        error: "模型调用失败",
        code: lastError?.code ?? "network",
        detail: lastError?.message ?? "未知错误",
      };
    },
  );
};
