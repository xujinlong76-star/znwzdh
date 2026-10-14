/**
 * 站点索引（共享）。
 *
 * server.ts 与 jobs.ts 都要「写站点后重建检索线索」，抽成共享函数避免两份漂移。
 * 向量写入失败不算错误（模型可能不可用），但记进 capabilities.notes，不静默失效。
 */

import { siteEmbeddingText } from "@navhub/ai";
import { hashSiteId } from "@navhub/store";
import type { AppContext } from "./context.ts";

export async function indexSite(
  ctx: AppContext,
  id: string,
  title: string,
  description: string | null,
  url: string,
): Promise<void> {
  if (!ctx.embedding) return;
  try {
    const vec = await ctx.embedding.encode(siteEmbeddingText({ title, description, url }));
    await ctx.vectors.upsert([{ key: hashSiteId(id), siteId: id, vector: vec }]);
    await ctx.repo.saveEmbedding(id, ctx.config.embedding.model, vec);
  } catch (err) {
    ctx.capabilities.notes.push(
      "站点 " + id + " 向量化失败：" + (err instanceof Error ? err.message : String(err)),
    );
  }
}
