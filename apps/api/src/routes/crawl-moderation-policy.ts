import type { FastifyPluginAsync } from "fastify";
import { CrawlAiModerationPolicySchema, CRAWL_AI_MODERATION_POLICY_KEY, DEFAULT_CRAWL_AI_MODERATION_POLICY } from "../crawl-moderation-policy.ts";
import type { AppContext } from "../context.ts";

export const crawlModerationPolicyRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  app.get("/api/admin/crawl-moderation/policy", { config: { scope: "admin", cache: { maxAge: 0 } } }, async () => {
    const stored = await ctx.repo.getSystemState<unknown>(CRAWL_AI_MODERATION_POLICY_KEY);
    const parsed = stored == null ? DEFAULT_CRAWL_AI_MODERATION_POLICY : CrawlAiModerationPolicySchema.safeParse(stored);
    return {
      ok: true,
      policy: parsed === DEFAULT_CRAWL_AI_MODERATION_POLICY ? parsed : parsed.success ? parsed.data : DEFAULT_CRAWL_AI_MODERATION_POLICY,
      configured: stored != null && parsed !== DEFAULT_CRAWL_AI_MODERATION_POLICY && parsed.success,
    };
  });

  app.put("/api/admin/crawl-moderation/policy", { config: { scope: "admin", rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = CrawlAiModerationPolicySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: "AI 审核规则参数无效", details: parsed.error.issues };
    }
    const previous = await ctx.repo.getSystemState<unknown>(CRAWL_AI_MODERATION_POLICY_KEY);
    await ctx.repo.setSystemState(CRAWL_AI_MODERATION_POLICY_KEY, parsed.data);
    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "crawl.ai_moderation_policy.update",
      target: CRAWL_AI_MODERATION_POLICY_KEY,
      diff: { previous: previous ?? DEFAULT_CRAWL_AI_MODERATION_POLICY, next: parsed.data },
    });
    return { ok: true, policy: parsed.data };
  });
};
