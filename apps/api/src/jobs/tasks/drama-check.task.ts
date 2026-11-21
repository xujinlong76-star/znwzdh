/**
 * 短剧新集检查任务（drama_update_check）。
 *
 * 职责：每天跑一轮（DEFAULT_CRON_SCHEDULES intervalMs 86_400_000，
 * enqueueJobIfAbsent 保证一天最多一轮），对 drama-featured.json 里检查
 * 方式可查的剧，用 hotlist 同款 guardedFetch 取检查页解析最新集数；
 * 只对已关注该剧的用户，在最新集数相对上次记录确实变大时才发一条
 * inapp 通知（kind drama_update，幂等键 drama_update:${dramaKey}:${ep}）。
 * 单部失败只记 last_error、保留旧值、不通知、不中断整轮；整轮结果记进事件流。
 *
 * 现状（2026-11-17）：可查的是综艺迷作品资料页（kind
 * "zongyimi-subject"，6 部剧——3 部快手、2 部红果、1 部抖音，作品页 URL
 * 无日期、是稳定地址）与搜短剧详情页（kind "soduanju-subject"，解析器
 * 已建成并以 10 个真实详情页样本验证通过，但当前 0 部剧挂接——18 部
 * 精选里可查的 4 部均已完结、已在 featured.json 填死总集数，无新集可等；
 * 解析器供以后轮换的新剧（连载中）挂接用）；
 * 旧快手日榜 URL（kind "ranking"，写死日期）已失效——2026-11-14 实测
 * 当日榜单页 404，数据里不再有 ranking 检查。migu-list 与 wikipedia
 * 仍是占位 kind，无已证实可查的源。
 *
 * 提醒开关：发通知前按 watch_entries.remind 过滤，关掉提醒的用户不收
 * drama_update 通知；但基线（upsertDramaCheckState）仍对所有关注者
 * 执行，以免重开提醒后把积压的旧增长当“新集”补发。
 *
 * 跳涨护栏：单日“总集数”跳涨 >20 集时只记基线、不通知，并在
 * last_error 与本轮事件的 guarded 清单里记一笔待人工复核——“总集数”
 * 是第三方资料站的口径，未证实等于已播出集数，计划值上调时不能误报新集。
 */
import type { AppContext} from "../../context.ts";
import { makeGuardedHotlistFetch, type HotlistFetch} from "../../hotlist/refresh.ts";
import { dramaKeyFor, loadDramaFeaturedForCheck, type DramaFeatured} from "../../drama/featured.ts";
import { parseRankingEpisode} from "../../drama/ranking.ts";
import { parseZongyimiSubject} from "../../drama/zongyimi.ts";
import { parseSoduanjuSubject} from "../../drama/soduanju.ts";

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

export interface DramaGuardedJump {
 title: string;
 dramaKey: string;
 userId: string;
 from: number;
 to: number;
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
 /** 单日跳涨 >20 集、只记基线未通知的（用户，剧）对，待人工复核。 */
 guarded: DramaGuardedJump[];
 /** 每部查到的剧的资料站“资料更新”日期（dramaKey → YYYY-MM-DD），用于陈旧度记录。 */
 sourceUpdatedAt: Record<string, string>;
}

/** 单日跳涨超过该集数只记基线、不通知（疑似资料站口径变化）。 */
export const DRAMA_EPISODE_JUMP_GUARD = 20;

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
 const loaded = deps.dramas? { dramas: deps.dramas, skipped: 0, path: null as string | null, updatedAt: null, updatedAtStale: true }: loadDramaFeaturedForCheck();
 const summary: DramaCheckSummary = {
 checked: 0,
 updated: 0,
 notified: 0,
 failed: [],
 skipped: 0,
 loadSkipped: loaded.skipped,
 loadedPath: loaded.path,
 guarded: [],
 sourceUpdatedAt: {},
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
 if (res.status!== 200) throw new Error(`检查页返回 HTTP ${res.status}`);
 body = res.body;
} catch (error) {
 const reason = error instanceof Error? error.message: String(error);
 await recordDramaFailure(ctx, dramaKey, now, reason);
 summary.failed.push({ title: drama.title, dramaKey, reason});
 continue;
}
 // 按 kind 分派解析器：综艺迷作品页精确提取“总集数”，搜短剧详情页
 // 提取“全 N 集 / 更新至第 N 集”，其余 kind 沿用旧榜单解析（标题附近找集数）。
 let latest: number | null;
 if (drama.check.kind === "zongyimi-subject") {
 const parsed = parseZongyimiSubject(body, drama.check.titleMatch?? drama.title);
 latest = parsed.episode;
 if (parsed.sourceUpdatedAt) summary.sourceUpdatedAt[dramaKey] = parsed.sourceUpdatedAt;
} else if (drama.check.kind === "soduanju-subject") {
 // 搜短剧详情页的日期是上映日、不是资料更新日，不进 sourceUpdatedAt。
 latest = parseSoduanjuSubject(body)?.episodes?? null;
} else {
 latest = parseRankingEpisode(body, drama.check.titleMatch?? drama.title);
}
 if (latest === null) {
 const reason = drama.check.kind === "zongyimi-subject"? "综艺迷作品页未解析出集数": drama.check.kind === "soduanju-subject"? "搜短剧详情页未解析出集数": "榜单页未解析出集数";
 await recordDramaFailure(ctx, dramaKey, now, reason);
 summary.failed.push({ title: drama.title, dramaKey, reason});
 continue;
}
 summary.checked += 1;
 const followers = await ctx.repo.listDramaFollowersWithRemind(dramaKey);
 for (const { userId, remind} of followers) {
 const prev = await ctx.repo.getDramaCheckState(userId, dramaKey);
 const prevEpisode = prev?.latestEpisode?? null;
 // 跳涨护栏：单日涨 >20 集疑似资料站口径变化，只记基线、不通知，
 // 在 last_error 里留待复核的记录。
 if (prevEpisode!== null && latest - prevEpisode > DRAMA_EPISODE_JUMP_GUARD) {
 const reason = `集数单日跳涨 ${prevEpisode}→${latest} 集（+${latest - prevEpisode}），疑似资料站口径变化，只记基线未通知，待人工复核`;
 await ctx.repo.upsertDramaCheckState(userId, dramaKey, { latestEpisode: latest, lastCheckedAt: now, lastError: reason}, now);
 summary.guarded.push({ title: drama.title, dramaKey, userId, from: prevEpisode, to: latest});
 continue;
}
 const shouldNotify = remind && prevEpisode!== null && latest > prevEpisode;
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
.catch(() => {
  // 审计/遥测类写库是尽力而为：失败不阻断主操作，写失败即丢弃。
});
}
