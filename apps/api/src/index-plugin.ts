/**
 * 插件语义索引（共享）。
 *
 * 与 index-site.ts 同构：审核上架 / 导入 / 种子导入后重建插件向量；
 * 向量写入失败不算错误（模型可能不可用），但记进 capabilities.notes，不静默失效。
 *
 * 与站点的关键差异：插件使用**独立的向量表**（plugins_vec / plugin_embeddings），
 * 不与站点共享 top-N 名额；业务 id 统一为 "plugin:<slug>"（见 @navhub/store 的
 * pluginVectorId），search 结果靠该前缀无歧义映射回插件。
 */

import { pluginEmbeddingText } from "@navhub/ai";
import { hashSiteId, pluginVectorId } from "@navhub/store";
import type { PluginManifest } from "@navhub/core";
import type { AppContext } from "./context.ts";

export interface IndexPluginItem {
  slug: string;
  name: string;
  description: string | null;
  kind: string;
  tags: string[];
  /** site-pack 的站点标题样例（强语义信号；取前 12 个） */
  sampleTitles?: string[];
}

/** 从已校验清单构造索引条目（审核 / 导入 / 种子 / reindex 共用，避免多份漂移） */
export function indexItemFromManifest(slug: string, manifest: PluginManifest): IndexPluginItem {
  const payload = manifest.payload as { sites?: Array<{ title?: string }> } | undefined;
  const sampleTitles =
    manifest.kind === "site-pack" && Array.isArray(payload?.sites)
      ? payload.sites
          .map((s) => s?.title)
          .filter((t): t is string => Boolean(t))
          .slice(0, 12)
      : undefined;
  return {
    slug,
    name: manifest.name,
    description: manifest.description ?? null,
    kind: manifest.kind,
    tags: manifest.tags ?? [],
    sampleTitles,
  };
}

export async function indexPlugin(ctx: AppContext, item: IndexPluginItem): Promise<void> {
  await indexPluginsBatch(ctx, [item]);
}

export async function indexPluginsBatch(
  ctx: AppContext,
  plugins: IndexPluginItem[],
): Promise<void> {
  if (!ctx.embedding || plugins.length === 0) return;
  try {
    const texts = plugins.map((p) =>
      pluginEmbeddingText({
        name: p.name,
        description: p.description,
        kind: p.kind,
        tags: p.tags,
        sampleTitles: p.sampleTitles,
      })
    );
    const vecs =
      typeof ctx.embedding.encodeBatch === "function"
        ? await ctx.embedding.encodeBatch(texts)
        : await Promise.all(texts.map((t) => ctx.embedding!.encode(t)));

    const vectorRecords = plugins
      .map((p, idx) => {
        const v = vecs[idx];
        return v
          ? { key: hashSiteId(pluginVectorId(p.slug)), siteId: pluginVectorId(p.slug), vector: v }
          : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (vectorRecords.length > 0) {
      await ctx.pluginVectors.upsert(vectorRecords);
      await ctx.repo.withTransaction(async () => {
        for (let i = 0; i < plugins.length; i++) {
          const v = vecs[i];
          const p = plugins[i];
          if (v && p) {
            await ctx.repo.savePluginEmbedding(p.slug, ctx.config.embedding.model, v);
          }
        }
      });
    }
  } catch (err) {
    ctx.capabilities.notes.push(
      "插件向量化失败：" + (err instanceof Error ? err.message : String(err))
    );
  }
}

/**
 * 插件离开上架状态（驳回 / 下架 / 更新回待审）时清掉向量。
 * 检索侧本就有 published 门禁，这里清掉是为了不让陈旧向量继续占 KNN 名额。
 */
export async function removePluginIndex(ctx: AppContext, slug: string): Promise<void> {
  try {
    await ctx.pluginVectors.remove([pluginVectorId(slug)]);
    await ctx.repo.deletePluginEmbedding(slug);
  } catch (err) {
    ctx.capabilities.notes.push(
      "插件向量清理失败：" + (err instanceof Error ? err.message : String(err))
    );
  }
}
