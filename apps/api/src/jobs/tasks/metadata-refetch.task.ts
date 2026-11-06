/**
 * 元数据刷新任务（refetch_metadata）。
 *
 * 职责：
 * 抓取站点最新元数据（标题、描述、图标）；支持 LLM 富化并受额度控制。
 */

import { enrichUrl } from "@navhub/ai";
import { sanitizeIconUrl } from "@navhub/core";
import type { AppContext } from "../../context.ts";
import { reserveLlmQuota, settleLlmQuota } from "../../llm-quota.ts";
import { resolveLlm, enrichLlmOf } from "../../llm-config.ts";
import { createEnrichUsageCallback } from "../../llm-usage.ts";
import { indexSite } from "../../index-site.ts";

export async function handleRefetchMetadata(
  ctx: AppContext,
  payload: { siteId?: string; llm?: boolean }
): Promise<void> {
  if (!payload.siteId) throw new Error("refetch_metadata 需要 siteId");
  const site = await ctx.repo.getSite(payload.siteId);
  if (!site) throw new Error("站点不存在: " + payload.siteId);

  const quota = payload.llm === true ? await reserveLlmQuota(ctx, null) : null;
  const useLlm = quota?.ok === true;
  const aiSkipped = quota && !quota.ok ? "quota" : null;
  const hold = quota && quota.ok ? quota.hold : null;
  const resolved = useLlm ? await resolveLlm(ctx) : null;
  const enriched = await enrichUrl(site.url, {
    llm: resolved ? enrichLlmOf(resolved) : undefined,
    guard: ctx.config.fetch,
    heuristicOnly: !useLlm,
    onLlmCall: resolved ? createEnrichUsageCallback(ctx, resolved.source, null, "job_enrich") : undefined,
  }).finally(() => settleLlmQuota(ctx, hold));

  const stale = 30 * 86_400_000;
  const isStale = (updatedAt: number | undefined) => !updatedAt || Date.now() - updatedAt > stale;
  const patch: Record<string, unknown> = {};
  if (!site.description && enriched.description) patch.description = enriched.description;
  if (!site.title && enriched.title) patch.title = enriched.title;

  const enrichedIcon = sanitizeIconUrl(enriched.iconUrl);
  if (!site.iconKey && enrichedIcon) patch.iconKey = enrichedIcon;
  if (isStale(site.updatedAt) && enriched.description && !patch.description) {
    patch.description = enriched.description;
  }
  if (Object.keys(patch).length > 0) {
    await ctx.repo.updateSite(site.id, patch as never);
    await indexSite(ctx, site.id, (patch.title as string) ?? site.title, (patch.description as string) ?? site.description ?? null, site.url);
  }
  await ctx.repo
    .recordEvent("refetch", {
      siteId: site.id,
      meta: { provenance: enriched.provenance, aiSkipped },
    })
    .catch(() => undefined);
}
