/**
 * 用户域只读工具（第五批 B2）：让「用户级个人令牌」能在 MCP 客户端里读自己的
 * 收藏 / 搜索历史 / 画像摘要。
 *
 * 边界（与 T20 的 token 归属模型一致）：
 *  - 数据范围 = ctx.ownerIdentity（令牌的 owner），不是调用方传参——杜绝越权；
 *  - 实例级令牌（ownerIdentity 为 null）一律拒绝：它们是给站点管理用的，
 *    不应该能读任何个人的数据；
 *  - 全部只读、不落审计（与其它 read 工具一致）。
 */
import { buildSiteComparison, CompareSitesInput } from "@navhub/core";
import {
  GetProfileSummaryInput,
  ListFavoriteFoldersInput,
  ListFavoritesInput,
  ListSearchHistoryInput,
  SearchFavoritesInput,
  requireScope,
  type ToolContext,
} from "../tools.ts";
import { fail, ok, requireOwnerIdentity, type HandlerDeps } from "./shared.ts";
import { retrieveFavoriteCandidates } from "./favorites-retrieval.ts";

export const userCenterHandlers = {
  async list_favorites(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const owner = requireOwnerIdentity(tc);
    const input = ListFavoritesInput.parse(args ?? {});
    // 收藏量级（人均几十到几百）取全量后在内存过滤分页；上库分页留给量级真到的那天
    const all = await ctx.repo.listFavorites(owner);
    const items = input.folder ? all.filter((f) => f.folderId === input.folder) : all;
    const page = items.slice(input.offset, input.offset + input.limit);
    // 收藏行本身只有 note/tags：标题/网址/描述在 sites 表，JOIN 后补上
    // （与 /api/ask 的 loadAskCorpus 同一 JOIN 思路；站点已删的行标题等为 null，
    //  行本身保留——收藏还在，只是站点没了，不静默丢弃）。
    const sites = await ctx.repo.getSitesByIds(page.map((f) => f.siteId));
    return ok({
      owner,
      total: items.length,
      hasMore: input.offset + page.length < items.length,
      items: page.map((f) => {
        const site = sites.get(f.siteId);
        return {
          ...f,
          title: site?.title ?? null,
          url: site?.url ?? null,
          description: site?.description ?? null,
        };
      }),
    });
  },

  /**
   * 在本人收藏内检索（只读，不做 LLM 问答）。
   *
   * 检索实现见 ./favorites-retrieval.ts：与 POST /api/ask 的问答检索同款
   * 两路召回（词法 + 语义、词法优先、阈值 0.4/0.55、词法 0 命中时纠错一次），
   * 只返回候选，不调模型、不写库。
   */
  async search_favorites(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const owner = requireOwnerIdentity(tc);
    const input = SearchFavoritesInput.parse(args ?? {});
    // 空白查询不报错、返回空结果（与 /api/ask 的 retrieveAskCandidates 同口径）；
    // 超长查询（>256 字）由 zod 在 parse 时直接拒绝。
    if (!input.query.trim()) {
      const total = (await ctx.repo.listFavorites(owner)).length;
      return ok({
        owner,
        query: input.query,
        totalFavorites: total,
        count: 0,
        correction: null,
        semanticAvailable: false,
        lexicalCount: 0,
        semanticCount: 0,
        results: [],
      });
    }
    // 两路召回各取 top 20 再合并：offset 在合并排序后切；多取 1 条当 hasMore 探针
    // （offset+limit 超过合并池时返回池内剩余条数——收藏子集的召回本就是取
    // 最相关的前 40 条，翻页只在池内有效）。
    const found = await retrieveFavoriteCandidates(ctx, owner, input.query, {
      folder: input.folder,
      tag: input.tag,
      limit: input.offset + input.limit + 1,
    });
    const results = found.hits.slice(input.offset, input.offset + input.limit);
    return ok({
      owner,
      query: input.query,
      totalFavorites: found.totalFavorites,
      count: results.length,
      hasMore: found.hits.length > input.offset + input.limit,
      correction: found.correction,
      semanticAvailable: found.semanticAvailable,
      lexicalCount: found.lexicalCount,
      semanticCount: found.semanticCount,
      results,
    });
  },

  async list_favorite_folders(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const owner = requireOwnerIdentity(tc);
    ListFavoriteFoldersInput.parse(args ?? {});
    const folders = await ctx.repo.listFavoriteFolders(owner);
    const all = await ctx.repo.listFavorites(owner);
    const counts = new Map<string, number>();
    let unfiledCount = 0;
    for (const f of all) {
      if (f.folderId) counts.set(f.folderId, (counts.get(f.folderId) ?? 0) + 1);
      else unfiledCount += 1;
    }
    return ok({
      owner,
      count: folders.length,
      unfiledCount,
      folders: folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        sort: folder.sort,
        createdAt: folder.createdAt,
        count: counts.get(folder.id) ?? 0,
      })),
    });
  },

  async list_search_history(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const owner = requireOwnerIdentity(tc);
    const input = ListSearchHistoryInput.parse(args ?? {});
    const page = await ctx.repo.listSearchHistoryPage(owner, input.limit, input.offset);
    return ok({ owner, hasMore: page.hasMore, items: page.items });
  },

  async get_profile_summary(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const owner = requireOwnerIdentity(tc);
    GetProfileSummaryInput.parse(args ?? {});
    const profile = await ctx.repo.getUserProfile(owner);
    if (!profile) {
      // 没画像不报错：新用户/关闭个性化时就是没有，如实说明即可
      return ok({ owner, exists: false, reason: "该身份还没有画像数据（新用户或已关闭个性化）" });
    }
    return ok({ owner, exists: true, profile });
  },

  /**
   * 横向对照本人收藏里的 2–4 个站点（Batch 4 Phase 1 第 4 项，只读，不落审计；Batch 4 Phase 2 P2-6 上限 3 → 4）。
   *
   * 取数与 GET /api/compare 同口径：一次 listFavorites + 一次 getSitesByIds，
   * 内存求交后统一判定；任一 id 不在本人可比收藏里（不存在、他人收藏、
   * pending/archived 指向、站点行缺失）→ 整单通用 fail，不点名是哪个 id，
   * 不返回部分结果。维度组装复用 core 的 buildSiteComparison，与 REST 共用
   * 同一份逻辑与返回体（每格 { value, source, verified, verifiedAt }，无 winner；
   * note 只来自本人收藏，天然只在 owner 绑定下返回；price 格（P2-2）同样
   * 只取令牌归属人自己的 site_prices 记录）。
   */
  async compare_sites(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const owner = requireOwnerIdentity(tc);
    // 重复先去重再校验（与 REST 路由侧同口径）：[a, a, b, c] 按 3 站对照；
    // 去重后不足 2 个 / 超过 4 个由 schema 直接拒绝。
    const rawIds = (args as { siteIds?: unknown } | null | undefined)?.siteIds;
    const deduped = Array.isArray(rawIds) ? [...new Set(rawIds)] : rawIds;
    const input = CompareSitesInput.parse({ siteIds: deduped });
    const siteIds = input.siteIds;

    const favorites = await ctx.repo.listFavorites(owner);
    const favBySite = new Map(favorites.map((f) => [f.siteId, f]));
    const sites = await ctx.repo.getSitesByIds(siteIds);
    // 统一判定：可比集合 = 本人收藏 ∩ 站点存在 ∩ 非 pending/archived。
    // pending/archived 站点不在导航可见集合内，不可比；broken 站点仍可比
    // （“是否还在维护”正是要对照的维度，巡检失败由 maintenance 格如实呈现）。
    const comparable = siteIds.every((id) => {
      const site = sites.get(id);
      return Boolean(
        favBySite.get(id) && site && site.status !== "pending" && site.status !== "archived",
      );
    });
    if (!comparable) {
      return fail("其中有站点不在你的收藏里，或已不在可对比状态。");
    }

    // 价格数值（P2-2）：与 REST 同口径一次批量取数，传进同一份组装。
    const prices = await ctx.repo.getSitePricesBySiteIds(owner, siteIds);

    const items = buildSiteComparison(
      siteIds.map((id) => {
        const site = sites.get(id)!;
        const fav = favBySite.get(id)!;
        return {
          site,
          favorite: { siteId: id, note: fav.note, tags: fav.tags, updatedAt: fav.updatedAt },
          price: prices.get(id) ?? null,
        };
      }),
    );
    return ok({ owner, count: items.length, items });
  },
};
