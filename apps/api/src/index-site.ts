/**
 * 站点索引（共享）。
 *
 * server.ts 与 jobs.ts 都要「写站点后重建检索线索」，抽成共享函数避免两份漂移。
 * 向量写入失败不算错误（模型可能不可用），但记进 capabilities.notes，不静默失效。
 */

import { siteEmbeddingText } from "@navhub/ai";
import { hashSiteId } from "@navhub/store";
import type { AppContext } from "./context.ts";

export interface IndexSiteItem {
  id: string;
  title: string;
  description: string | null;
  url: string;
}

export async function indexSite(
  ctx: AppContext,
  id: string,
  title: string,
  description: string | null,
  url: string,
): Promise<void> {
  await indexSitesBatch(ctx, [{ id, title, description, url }]);
}

export async function indexSitesBatch(
  ctx: AppContext,
  sites: IndexSiteItem[],
): Promise<void> {
  if (!ctx.embedding || sites.length === 0) return;
  try {
    const texts = sites.map((s) =>
      siteEmbeddingText({ title: s.title, description: s.description, url: s.url })
    );
    const vecs =
      typeof ctx.embedding.encodeBatch === "function"
        ? await ctx.embedding.encodeBatch(texts)
        : await Promise.all(texts.map((t) => ctx.embedding!.encode(t)));

    const vectorRecords = sites
      .map((s, idx) => {
        const v = vecs[idx];
        return v ? { key: hashSiteId(s.id), siteId: s.id, vector: v } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (vectorRecords.length > 0) {
      await ctx.vectors.upsert(vectorRecords);
      await ctx.repo.withTransaction(async () => {
        for (let i = 0; i < sites.length; i++) {
          const v = vecs[i];
          const site = sites[i];
          if (v && site) {
            await ctx.repo.saveEmbedding(site.id, ctx.config.embedding.model, v);
          }
        }
      });
    }
  } catch (err) {
    ctx.capabilities.notes.push(
      "批量向量化失败：" + (err instanceof Error ? err.message : String(err))
    );
  }
}

