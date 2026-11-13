/**
 * 短剧新集检查任务（drama_update_check）。
 *
 * 职责：每天跑一轮（DEFAULT_CRON_SCHEDULES intervalMs 86_400_000，
 * enqueueJobIfAbsent 保证一天最多一轮），对 drama-featured.json 里检查
 * 方式可查（ranking / migu-list / wikipedia）的剧，用 hotlist 同款
 * guardedFetch 取榜单/列表页解析最新集数；只对已关注该剧的用户，
 * 在最新集数相对上次记录确实变大时才发一条 inapp 通知（kind
 * drama_update，幂等键 drama_update:${dramaKey}:${ep}）。单部失败只记
 * last_error、保留旧值、不通知、不中断整轮；整轮结果记进事件流。
 *
 * 注意：v1 数据里只有 ranking 是可查的（3 部快手榜剧）；migu-list 与
 * wikipedia 也走同一“标题附近找集数”解析，解析不出只记失败不通知。
 */
import type { AppContext} from "../../context.ts";
import { makeGuardedHotlistFetch, type HotlistFetch} from "../../hotlist/refresh.ts";
import { dramaKeyFor, loadDramaFeaturedForCheck, type DramaFeatured} from "../../drama/featured.ts";
import { parseRankingEpisode} from "../../drama/ranking.ts";

export interface DramaCheckDeps {
 fetchImpl?: HotlistFetch;
 dramas?: DramaFeatured[];
 now?: () => number;
}

export interface DramaFailure {
 title: string;
 dramaKey: string;
 reason: string;
}

export interface DramaCheckSummary {
 checked: number;
 updated: number;
 notified: number;
 failed: DramaFailure[];
 skipped: number;
 loadSkipped: number;
 loadedPath: string | null;
 loadError?: string;
}

/** 单部失败：给每个关注者记 last_error、保留旧集数，不通知。 */
async function recordDramaFailure(ctx: AppContext, dramaKey: string, now: number, reason: string): Promise<void> {
 const followers = await ctx.repo.listDramaFollowers(dramaKey);
 for (const userId of followers) {
 const prev = await ctx.repo.getDramaCheckState(userId, dramaKey);
 await ctx.repo.upsertDramaCheckState(userId, dramaKey, { latestEpisode: prev?.latestEpisode?? null, lastCheckedAt: now, lastError: reason}, now);
}
}

export async function handleDramaUpdateCheck(ctx: AppContext, deps: DramaCheckDeps = {}): Promise<void> {
 const now = (deps.now?? Date.now)();
 const fetchImpl = deps.fetchImpl?? makeGuardedHotlistFetch(ctx);
 const loaded = deps.dramas? { dramas: deps.dramas, skipped: 0, path: null as string | null}: loadDramaFeaturedForCheck();
 const summary: DramaCheckSummary = {
 checked: 0,
 updated: 0,
 notified: 0,
 failed: [],
 skipped: 0,
 loadSkipped: loaded.skipped,
 loadedPath: loaded.path,
};
 if (loaded.error) summary.loadError = loaded.error;
 for (const drama of loaded.dramas) {
 const dramaKey = dramaKeyFor(drama.platformSiteId, drama.title);
 if (drama.check.kind === "none") {
 summary.skipped += 1;
 continue;
}
 const checkUrl = drama.check.url;
 if (!checkUrl) {
 summary.failed.push({ title: drama.title, dramaKey, reason: "检查描述缺 URL"});
 continue;
}
 let body: string;
 try {
 const res = await fetchImpl(checkUrl, {
 "User-Agent": ctx.config.fetch.userAgent,
 "Accept-Language": "zh-CN,zh;q=0.9",
 Accept: "text/html,application/xhtml+xml",
});
 if (res.status!== 200) throw new Error(`榜单页返回 HTTP ${res.status}`);
 body = res.body;
} catch (error) {
 const reason = error instanceof Error? error.message: String(error);
 await recordDramaFailure(ctx, dramaKey, now, reason);
 summary.failed.push({ title: drama.title, dramaKey, reason});
 continue;
}
 const latest = parseRankingEpisode(body, drama.check.titleMatch?? drama.title);
 if (latest === null) {
 const reason = "榜单页未解析出集数";
 await recordDramaFailure(ctx, dramaKey, now, reason);
 summary.failed.push({ title: drama.title, dramaKey, reason});
 continue;
}
 summary.checked += 1;
 const followers = await ctx.repo.listDramaFollowers(dramaKey);
 for (const userId of followers) {
 const prev = await ctx.repo.getDramaCheckState(userId, dramaKey);
 const prevEpisode = prev?.latestEpisode?? null;
 const shouldNotify = prevEpisode!== null && latest > prevEpisode;
 await ctx.repo.upsertDramaCheckState(userId, dramaKey, { latestEpisode: latest, lastCheckedAt: now, lastError: null}, now);
 if (shouldNotify) {
 summary.updated += 1;
 await ctx.repo.emitNotification({
 identity: userId,
 kind: "drama_update",
 idempotencyKey: `drama_update:${dramaKey}:${latest}`,
 title: `《${drama.title}》更新至第 ${latest} 集`,
 body: `${drama.platformTitle} · 已更 ${latest} 集（上次记录 ${prevEpisode} 集）。`,
});
 summary.notified += 1;
}
}
}
 await ctx.repo
.recordEvent("drama_update_check", { meta: summary})
.catch(() => undefined);
}
