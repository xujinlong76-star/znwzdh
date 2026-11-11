/**
 * 小猫猫每日简报：按天组版并落库（公共版），在追提醒按用户现算。
 *
 * 数据诚实口径（本模块的立身之本）：
 * - 热榜精选只来自 hotlist 缓存管道的真实抓取（标题/链接/热度/来源/时间
 *   全量透传），缓存里没有的源不出现、过期的如实带 fetchedAt；
 * - 站内「新收录」只来自 sites 真实 created_at：今天真有新增才标
 *   「今日新收录」，没有就标「最近收录」并带每站的收录日期，不冒充今日；
 * - 站内热度**不进简报**：trend_score 是近 7 天点击/收藏重算，没有
 *   「今日」口径，硬塞进来就是编造——简报只用上面两类真实素材；
 * - 小猫猫开场白由 Agnes 生成时必须锚定当天真实条目（校验见
 *   anchoredOpening），不达标就丢弃、用模板句，绝不让模型编条目。
 */
import type { AppContext } from "../context.ts";
import { llmProviderReadyAny, resolveLlm } from "../llm-config.ts";
import { callLlm } from "../llm-usage.ts";
import { HOTLIST_SOURCES } from "../hotlist/sources.ts";
import type { WatchEntryRecord } from "@navhub/store";

/** 简报与热榜的「今天」统一按 Asia/Shanghai 算（本站用户都在国内时区） */
export const BRIEF_TIME_ZONE = "Asia/Shanghai";

const datePartsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: BRIEF_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** epoch ms → Asia/Shanghai 的 YYYY-MM-DD */
export function briefDateKey(ts: number): string {
  return datePartsFmt.format(new Date(ts));
}

/** 某个 Shanghai 日期键的星期（0=周日）：用 UTC 构造该日历日再取 getUTCDay，避免服务器时区干扰 */
function weekdayOfDateKey(dateKey: string): number {
  const parts = dateKey.split("-").map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/* ------------------------------ 在追提醒 ------------------------------ */

/**
 * isReminderDue 的服务端移植：与前端 lib/watchlist.ts 同一判定，
 * 差别只有时区——前端用浏览器本地日期，服务端统一 Asia/Shanghai。
 * 它只断言「按用户标注的节奏，今天是更新日」，不断言平台真更新了。
 */
export function isWatchReminderDue(entry: WatchEntryRecord, now: Date): boolean {
  if (!entry.remind) return false;
  const cadence = entry.cadence;
  const today = briefDateKey(now.getTime());
  const isCadenceDay =
    cadence.kind === "daily"
      ? true
      : cadence.kind === "weekly"
        ? cadence.weekdays.includes(weekdayOfDateKey(today))
        : false;
  if (!isCadenceDay) return false;
  if (entry.dismissedOn === today) return false;
  if (briefDateKey(entry.lastProgressAt) >= today) return false;
  if (briefDateKey(entry.createdAt) > today) return false;
  return true;
}

export interface BriefWatchItem {
  key: string;
  title: string;
  platformTitle: string;
  playUrl: string;
  episode: number;
  priority: "high" | "normal";
}

export interface BriefWatchSection {
  /** 到更新日、今天还没看 */
  due: BriefWatchItem[];
  /** 节奏未标注：只给「去看看」的诚实入口，不说更新了 */
  check: BriefWatchItem[];
}

export async function watchSectionForUser(ctx: AppContext, userId: string, now: Date): Promise<BriefWatchSection> {
  const entries = await ctx.repo.listWatchEntries(userId);
  const due: BriefWatchItem[] = [];
  const check: BriefWatchItem[] = [];
  for (const entry of entries) {
    const item: BriefWatchItem = {
      key: entry.key,
      title: entry.title,
      platformTitle: entry.platformTitle,
      playUrl: entry.playUrl,
      episode: entry.episode,
      priority: entry.priority,
    };
    if (entry.cadence.kind === "finished") continue;
    if (isWatchReminderDue(entry, now)) due.push(item);
    else if (entry.cadence.kind === "unknown" && entry.remind) check.push(item);
  }
  const rank = (e: BriefWatchItem) => (e.priority === "high" ? 0 : 1);
  due.sort((a, b) => rank(a) - rank(b));
  check.sort((a, b) => rank(a) - rank(b));
  return { due, check };
}

/* ------------------------------ 公共组版 ------------------------------ */

export interface BriefHotPick {
  source: string;
  sourceName: string;
  rank: number;
  title: string;
  url: string;
  hotValue: number | null;
  fetchedAt: number;
}

export interface BriefNewSite {
  id: string;
  title: string;
  url: string;
  description: string | null;
  createdAt: number;
  /** 该站的收录日期（与简报日期同口径），前端如实展示 */
  addedOn: string;
}

export interface BriefPayload {
  date: string;
  /** 参与精选的源（注册顺序）与其缓存时间，整版溯源 */
  hotPicks: BriefHotPick[];
  /** 新收录口径：today = 今天真有新增；recent = 没有今日新增、给最近收录 */
  newSitesScope: "today" | "recent";
  newSites: BriefNewSite[];
}

const HOT_PICKS_PER_SOURCE = 5;
const NEW_SITES_LIMIT = 8;

export async function assembleBriefPayload(ctx: AppContext, now: Date): Promise<BriefPayload> {
  const date = briefDateKey(now.getTime());
  const [allEntries, newest] = await Promise.all([
    ctx.repo.listAllHotlistEntries(),
    ctx.repo.newestSites(30),
  ]);

  const bySource = new Map<string, typeof allEntries>();
  for (const entry of allEntries) {
    const list = bySource.get(entry.source) ?? [];
    list.push(entry);
    bySource.set(entry.source, list);
  }
  const hotPicks: BriefHotPick[] = [];
  for (const def of HOTLIST_SOURCES) {
    if (!def.covered) continue;
    const items = (bySource.get(def.id) ?? []).slice(0, HOT_PICKS_PER_SOURCE);
    for (const item of items) {
      hotPicks.push({
        source: def.id,
        sourceName: def.name,
        rank: item.rank,
        title: item.title,
        url: item.url,
        hotValue: item.hotValue,
        fetchedAt: item.fetchedAt,
      });
    }
  }

  const mapped: BriefNewSite[] = newest.map((s) => ({
    id: s.id,
    title: s.title,
    url: s.url,
    description: s.description ?? null,
    createdAt: s.createdAt,
    addedOn: briefDateKey(s.createdAt),
  }));
  const todays = mapped.filter((s) => s.addedOn === date);
  const newSitesScope = todays.length > 0 ? "today" : "recent";
  const newSites = (todays.length > 0 ? todays : mapped).slice(0, NEW_SITES_LIMIT);

  return { date, hotPicks, newSitesScope, newSites };
}

/* ------------------------------ 开场白 -------------------------------- */

/** 模板开场白：只拼真实条目，没有素材就如实说没有 */
export function templateOpening(payload: BriefPayload): string {
  const top = payload.hotPicks[0];
  const fresh = payload.newSites[0];
  if (top && fresh) {
    return `早上好喵～今天全网最热的是「${top.title}」（${top.sourceName}），站里还收录了「${fresh.title}」，都帮你整理好啦。`;
  }
  if (top) {
    return `早上好喵～今天全网最热的是「${top.title}」（${top.sourceName}），各平台的热榜都帮你汇总到这一页啦。`;
  }
  if (fresh) {
    return `早上好喵～热榜还在刷新中，先看看站里新收录的「${fresh.title}」吧。`;
  }
  return "早上好喵～今天的热榜和新收录还在路上，过会儿再来看看。";
}

/**
 * 模型开场白的锚定校验（与 ai/chat 的「候选外站点丢弃」同一立场）：
 *  - 必须提及至少一条当天真实条目（热榜标题或新收录站名，取标题前
 *    8 字内的任意 4 字连续片段命中即算引用到，不要求整句照抄）；
 *  - 长度与形状合格（20–90 字、无链接、无 markdown）。
 * 不达标返回 null，调用方回落模板。
 */
export function anchoredOpening(raw: string, payload: BriefPayload): string | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (text.length < 10 || text.length > 90) return null;
  if (/https?:\/\//.test(text) || /[*#`>]/.test(text)) return null;
  const anchors = [
    ...payload.hotPicks.map((p) => p.title),
    ...payload.newSites.map((s) => s.title),
  ];
  const hit = anchors.some((title) => {
    const head = title.slice(0, 10);
    for (let i = 0; i + 4 <= head.length; i++) {
      if (text.includes(head.slice(i, i + 4))) return true;
    }
    return false;
  });
  return hit ? text : null;
}

export type OpeningCaller = (payload: BriefPayload) => Promise<string | null>;

/** 生产开场白：Agnes 生成 → 锚定校验 → 不过就 null（外层用模板） */
export function makeLlmOpeningCaller(ctx: AppContext): OpeningCaller {
  return async (payload) => {
    const llm = await resolveLlm(ctx, null);
    if (!llmProviderReadyAny(llm)) return null;
    const hotBlock = payload.hotPicks
      .slice(0, 10)
      .map((p) => `- [${p.sourceName}] ${p.title}`)
      .join("\n");
    const freshBlock = payload.newSites
      .slice(0, 3)
      .map((s) => `- ${s.title}：${(s.description ?? "").slice(0, 40)}`)
      .join("\n");
    if (!hotBlock && !freshBlock) return null;
    try {
      const res = await callLlm(ctx, llm, {
        scenario: "daily_brief",
        identity: null,
        messages: [
          {
            role: "system",
            content:
              "你是网址导航站的小猫猫，为「每日简报」写一句话开场白。口吻亲切简短（20-60字），" +
              "只能提及下面给出的真实条目，不许编造任何新条目、新事实或数字，不许带链接与 markdown。" +
              '只输出 JSON：{"opening": "..."}',
          },
          {
            role: "user",
            content: `日期：${payload.date}\n今日热榜条目：\n${hotBlock || "（暂无）"}\n站内新收录：\n${freshBlock || "（暂无）"}`,
          },
        ],
        json: true,
        temperature: 0.5,
        maxTokens: 200,
        deadlineAt: Date.now() + 60_000,
      });
      const parsed = JSON.parse(res.content || "{}") as { opening?: unknown };
      if (typeof parsed.opening !== "string") return null;
      return anchoredOpening(parsed.opening, payload);
    } catch {
      return null;
    }
  };
}

/* ------------------------------ 生成入口 ------------------------------ */

export interface GeneratedBrief {
  date: string;
  generatedAt: number;
  opening: string;
  openingMode: "ai" | "template";
  payload: BriefPayload;
}

/** 组版 + 开场白 + 落库。openingCaller 可注入（测试用），默认走 Agnes */
export async function generateDailyBrief(
  ctx: AppContext,
  opts: { now?: Date; openingCaller?: OpeningCaller } = {},
): Promise<GeneratedBrief> {
  const now = opts.now ?? new Date();
  const payload = await assembleBriefPayload(ctx, now);
  const caller = opts.openingCaller ?? makeLlmOpeningCaller(ctx);
  // 锚定校验在这里再兜一层：无论 caller 是生产模型还是注入实现，
  // 没提及当天真实条目的句子一律丢弃，不让任何路径绕过校验直接落库。
  const rawOpening = await caller(payload).catch(() => null);
  const aiOpening = rawOpening ? anchoredOpening(rawOpening, payload) : null;
  const opening = aiOpening ?? templateOpening(payload);
  const record = {
    date: payload.date,
    generatedAt: now.getTime(),
    opening,
    openingMode: (aiOpening ? "ai" : "template") as "ai" | "template",
    payload: JSON.stringify(payload),
  };
  await ctx.repo.upsertDailyBrief(record);
  return { ...record, payload };
}

/** 读今天的简报；没有就现生成一份（首访/任务未跑时不让页面开天窗） */
export async function getOrGenerateTodayBrief(
  ctx: AppContext,
  opts: { now?: Date; openingCaller?: OpeningCaller } = {},
): Promise<GeneratedBrief> {
  const now = opts.now ?? new Date();
  const date = briefDateKey(now.getTime());
  const existing = await ctx.repo.getDailyBrief(date);
  if (existing) {
    return {
      date: existing.date,
      generatedAt: existing.generatedAt,
      opening: existing.opening,
      openingMode: existing.openingMode,
      payload: JSON.parse(existing.payload) as BriefPayload,
    };
  }
  return generateDailyBrief(ctx, { now, openingCaller: opts.openingCaller });
}
