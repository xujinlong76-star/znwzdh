/**
 * 热榜刷新任务（hotlist_refresh）。
 *
 * 职责：逐源拉取各平台公开热榜 → 解析 → 整表替换 hotlist 缓存。
 * 失败口径在 hotlist/refresh.ts：单源失败只标 failed 并保留旧缓存，
 * 本任务只负责把整轮结果记进事件流，不因单源失败整轮报错。
 */

import type { AppContext } from "../../context.ts";
import { refreshHotlist } from "../../hotlist/refresh.ts";

export async function handleHotlistRefresh(ctx: AppContext): Promise<void> {
  const summary = await refreshHotlist(ctx);
  await ctx.repo
    .recordEvent("hotlist_refresh", {
      meta: {
        ok: summary.okCount,
        total: summary.entries.length,
        failed: summary.entries.filter((e) => !e.ok).map((e) => e.source),
      },
    })
    .catch(() => undefined);
}
