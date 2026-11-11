/**
 * 每日简报生成任务（daily_brief）。
 *
 * 职责：组版当天简报（热榜精选 + 站内新收录 + 小猫猫开场白）并落库。
 *
 * 为什么任务走 generateDailyBrief 强制重组、而不是 getOrGenerate 的
 * 「有缓存直读」：凌晨若已有请求抢先触发生成（那时热榜还是昨夜的缓存、
 * 甚至空缓存），直读会把那份早期版冻结一整天——05:00 的正点版必须以
 * 最新榜单为准重出一版覆盖它。重组前先补一轮热榜刷新保证素材新鲜
 * （刷新失败不阻断组版：用现有缓存如实组版，源状态会在页面上标注）。
 * 请求路径（GET /api/brief/today）仍走 getOrGenerate：有缓存直读、
 * 没缓存才补生成，页面永不开天窗。
 */

import type { AppContext } from "../../context.ts";
import { generateDailyBrief } from "../../brief/brief.ts";
import { refreshHotlist } from "../../hotlist/refresh.ts";

export async function handleDailyBrief(ctx: AppContext): Promise<void> {
  await refreshHotlist(ctx).catch(() => undefined);
  const brief = await generateDailyBrief(ctx);
  await ctx.repo
    .recordEvent("daily_brief", {
      meta: { date: brief.date, openingMode: brief.openingMode, hotPicks: brief.payload.hotPicks.length },
    })
    .catch(() => undefined);
}
