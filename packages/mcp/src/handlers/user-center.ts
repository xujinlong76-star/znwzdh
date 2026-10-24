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
import {
  GetProfileSummaryInput,
  ListFavoritesInput,
  ListSearchHistoryInput,
  requireScope,
  type ToolContext,
} from "../tools.ts";
import { ok, type HandlerDeps } from "./shared.ts";

function requireOwner(tc: ToolContext): string {
  if (!tc.ownerIdentity) {
    throw new Error("此工具要求用户级个人令牌（api_tokens.owner_identity）；实例级令牌无法读取个人数据");
  }
  return tc.ownerIdentity;
}

export const userCenterHandlers = {
  async list_favorites(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const owner = requireOwner(tc);
    const input = ListFavoritesInput.parse(args ?? {});
    // 收藏量级（人均几十到几百）取全量后在内存过滤分页；上库分页留给量级真到的那天
    const all = await ctx.repo.listFavorites(owner);
    const items = input.folder ? all.filter((f) => f.folderId === input.folder) : all;
    const page = items.slice(input.offset, input.offset + input.limit);
    return ok({
      owner,
      total: items.length,
      hasMore: input.offset + page.length < items.length,
      items: page,
    });
  },

  async list_search_history(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const owner = requireOwner(tc);
    const input = ListSearchHistoryInput.parse(args ?? {});
    const page = await ctx.repo.listSearchHistoryPage(owner, input.limit, input.offset);
    return ok({ owner, hasMore: page.hasMore, items: page.items });
  },

  async get_profile_summary(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const owner = requireOwner(tc);
    GetProfileSummaryInput.parse(args ?? {});
    const profile = await ctx.repo.getUserProfile(owner);
    if (!profile) {
      // 没画像不报错：新用户/关闭个性化时就是没有，如实说明即可
      return ok({ owner, exists: false, reason: "该身份还没有画像数据（新用户或已关闭个性化）" });
    }
    return ok({ owner, exists: true, profile });
  },
};
