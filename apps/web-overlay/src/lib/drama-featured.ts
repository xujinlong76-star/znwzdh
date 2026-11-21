/**
 * 短剧专区剧目数据：apps/web-overlay/src/navsphere/content/drama-featured.json。
 *
 * 这份文件只描述“专区首屏展示哪几部剧、每部剧的来源链接是什么、能不能查新集”——
 * 它不是追剧清单（追剧清单是 watch_entries，由用户自己加），也不是视频库。
 * 校验口径（parseDramaFeatured）：只收字段齐全的行，坏行跳过并计数；
 * 面板不为一行坏数据整个掉。首屏最多展示 18 部。
 *
 * 诚实口径在类型上：linkNote 必须如实标注链接是剧目页、榜单页、报道页
 * 还是百科页；榜单页 / 报道页 / 百科页不是正片，卡片不许写成“点开即看”。
 * 集数只须核实过的，没核实的留 null，不许编。
 */
import featuredRaw from "../navsphere/content/drama-featured.json";
import { dramaKeyFor } from "./watchlist";

export type DramaCheckKind = "migu-list" | "wikipedia" | "ranking" | "zongyimi-subject" | "soduanju-subject" | "none";

export interface DramaCheck {
  kind: DramaCheckKind;
  /** 检查用的 URL；kind 为 none 时不填 */
  url?: string;
  /** 在检查页里定位这部剧的匹配串（默认用剧名本身） */
  titleMatch?: string;
  /** kind 为 none 时必填：为什么不检查（写明原因，不许含糊） */
  reason?: string;
}
export interface DramaFeatured {
  title: string;
  platformSiteId: string;
  platformTitle: string;
  /** 来源链接：剧目页、榜单页、报道页或百科页都可能；linkNote 必须如实标注 */
  url: string;
  /** 链接性质：榜单页 / 报道页 / 百科页不是正片 */
  linkNote: "剧目页" | "榜单页" | "报道页" | "百科页";
  /** 已更集数（核实过的才填；没核实的留 null，不许编） */
  episodesKnown: number | null;
  /** 总集数（核实过的才填；连载中、未核实的留 null） */
  totalEpisodes: number | null;
  /** 题材标签（核实过的才填；详情页首个标签 chip 为主 题材；没核实的留空） */
  genres?: string[];
  check: DramaCheck;
}
export interface DramaFeaturedFile {
  version: number;
  updatedAt: string;
  dramas: DramaFeatured[];
}

export const DRAMA_FEATURED_MAX = 18;

/**
 * 新鲜度哨兵（U-378 小步）：drama-featured.json 顶层的 updatedAt 是
 * “热门”榜单上次被人工复核 / 刷新的日期；短剧日更、榜单声称当日热度，
 * 超过 N 天不更新即视为过期，测试里红。
 *
 * N = 3 的理由（2026-11-22 定）：
 * - 本文件自身的维护节律：updatedAt 2026-11-14 → 11-15 → 11-17 → 11-18，
 *   两次更新之间最长只隔 2 天；
 * - 新集检查任务每天跑一轮（apps/api drama-check.task，intervalMs 86_400_000），
 *   榜单刷新本应跟得上日更节奏；
 * - N 取历史最大间隔 2 天 + 1 天宽限：3 天整仍算新鲜，第 4 天起过期。
 *   实盘现状 updatedAt 2026-11-18，截至 2026-11-22 已 4 天，哨兵应红——
 *   绿它的办法是中步真正重核 18 部剧并刷新数据，不是改这个数字、不是只改时间戳。
 * - updatedAt 只有日粒度（YYYY-MM-DD），按 Asia/Shanghai 自然日算整天数：
 *   本站日期口径（brief.ts BRIEF_TIME_ZONE / drama/calendar.ts：源站是中国站、
 *   榜单日期是北京时间）；按 UTC 算会在北京时间上午少算一天——2026-11-22 03:19 CST
 *   是 UTC 11-21，UTC 口径下 11-18 只算 3 天（新鲜），上海口径算 4 天（过期），
 *   后者才符合“已过期多日”的实盘判断；缺失 / 非法 updatedAt 按过期处理
 *   （fail-closed：新鲜度未知 ≠ 新鲜）。
 * 完结剧下沉与轮换位规则不在本线范围（“热门”排序口径未定），本哨兵只拦过期。
 */
export const DRAMA_FEATURED_MAX_AGE_DAYS = 3;

const DAY_MS = 86_400_000;

/** 本站日期口径：now 落在 Asia/Shanghai 的哪一天（YYYY-MM-DD），与 brief/calendar 一致。 */
const shanghaiDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function shanghaiDateKey(now: Date | number): string {
  return shanghaiDateFmt.format(new Date(now));
}

/** 接受 YYYY-MM-DD 或 ISO 日期时间；返回归一化的日期（YYYY-MM-DD，ISO 时间按 Asia/Shanghai 取日），非法返回 null。 */
export function parseDramaFeaturedUpdatedAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length === 0) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly !== null) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const ms = Date.UTC(year, month - 1, day);
    const check = new Date(ms);
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) {
      return null;
    }
    return text;
  }
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  return shanghaiDateKey(ms);
}

/** updatedAt 距 now 的整天数（Asia/Shanghai 自然日之差）；updatedAt 缺失 / 非法返回 null；未来日期为负数。 */
export function dramaFeaturedAgeDays(
  updatedAt: string | null,
  now: Date | number = new Date(),
): number | null {
  if (updatedAt === null) return null;
  const updatedMs = Date.parse(`${updatedAt}T00:00:00.000Z`);
  if (!Number.isFinite(updatedMs)) return null;
  const nowMs = Date.parse(`${shanghaiDateKey(now)}T00:00:00.000Z`);
  return Math.floor((nowMs - updatedMs) / DAY_MS);
}

/** 超过 DRAMA_FEATURED_MAX_AGE_DAYS 天未更新、或 updatedAt 缺失 / 非法，即过期。 */
export function isDramaFeaturedUpdatedAtStale(
  updatedAt: string | null,
  now: Date | number = new Date(),
): boolean {
  const age = dramaFeaturedAgeDays(updatedAt, now);
  return age === null || age > DRAMA_FEATURED_MAX_AGE_DAYS;
}

const CHECK_KINDS: ReadonlySet<string> = new Set([
  "migu-list",
  "wikipedia",
  "ranking",
  "zongyimi-subject",
  "soduanju-subject",
  "none",
]);
const LINK_NOTES: ReadonlySet<string> = new Set([
  "剧目页",
  "榜单页",
  "报道页",
  "百科页",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function asHttpUrl(value: unknown): string | null {
  const text = asNonEmptyString(value);
  if (text === null || !/^https?:\/\//.test(text)) return null;
  return text;
}

/** 集数：缺失为 null；非整数、负数或超过 10 万集为坏数据（返回 undefined 表示整行跳过）。 */
function asEpisodeCount(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  if (value < 0 || value > 100000) return undefined;
  return value;
}

/** 校验一行剧目；字段不全或自相矛盾时返回 null（调用方跳过并计数）。 */
function parseDramaEntry(raw: unknown): DramaFeatured | null {
  if (!isRecord(raw)) return null;
  const title = asNonEmptyString(raw.title);
  if (title === null || title.length > 80) return null;
  const platformSiteId = asNonEmptyString(raw.platformSiteId);
  const platformTitle = asNonEmptyString(raw.platformTitle);
  if (platformSiteId === null || platformTitle === null) return null;
  const url = asHttpUrl(raw.url);
  if (url === null) return null;
  const linkNote = asNonEmptyString(raw.linkNote);
  if (linkNote === null || !LINK_NOTES.has(linkNote)) return null;
  const episodesKnown = asEpisodeCount(raw.episodesKnown);
  const totalEpisodes = asEpisodeCount(raw.totalEpisodes);
  if (episodesKnown === undefined || totalEpisodes === undefined) return null;
  // 题材：可选字段；数组里每项须为非空短串，否则整字段丢弃（不因此跳过整行）。
  let genres: string[] | undefined;
  if (Array.isArray(raw.genres)) {
    const list = raw.genres
      .map((g) => (typeof g === "string" ? g.trim() : ""))
      .filter((g) => g.length > 0 && g.length <= 8);
    if (list.length > 0 && list.length <= 4) genres = [...new Set(list)];
  }
  if (
    episodesKnown !== null &&
    totalEpisodes !== null &&
    totalEpisodes < episodesKnown
  ) {
    return null;
  }
  if (!isRecord(raw.check)) return null;
  const checkKind = asNonEmptyString(raw.check.kind);
  if (checkKind === null || !CHECK_KINDS.has(checkKind)) return null;
  const check: DramaCheck = { kind: checkKind as DramaCheckKind };
  if (checkKind === "none") {
    const reason = asNonEmptyString(raw.check.reason);
    if (reason === null) return null;
    check.reason = reason;
  } else {
    const checkUrl = asHttpUrl(raw.check.url);
    if (checkUrl === null) return null;
    check.url = checkUrl;
    const titleMatch = asNonEmptyString(raw.check.titleMatch);
    if (titleMatch !== null) check.titleMatch = titleMatch;
  }
  return {
    title,
    platformSiteId,
    platformTitle,
    url,
    linkNote: linkNote as DramaFeatured["linkNote"],
    episodesKnown,
    totalEpisodes,
    ...(genres !== undefined ? { genres } : {}),
    check,
  };
}

export interface ParsedDramaFeatured {
  dramas: DramaFeatured[];
  /** 因字段不全 / 自相矛盾被跳过的行数 */
  skipped: number;
  /** 顶层 updatedAt（归一化为 YYYY-MM-DD）；缺失 / 非法为 null */
  updatedAt: string | null;
  /** updatedAt 超过 DRAMA_FEATURED_MAX_AGE_DAYS 天未更新、或缺失 / 非法 */
  updatedAtStale: boolean;
}

/**
 * 校验整份剧目文件：坏行跳过并计数；首屏只取前 18 部有效剧目。
 * 顶层不是对象、没有 dramas 数组时返回空列表（页面照常渲染平台区）。
 * 同时读顶层 updatedAt 并算新鲜度（哨兵只报过期、不丢剧目行）。
 * now 仅供测试注入“今天”，默认真实当前时间。
 */
export function parseDramaFeatured(
  raw: unknown,
  now: Date | number = new Date(),
): ParsedDramaFeatured {
  const updatedAt = isRecord(raw)
    ? parseDramaFeaturedUpdatedAt(raw.updatedAt)
    : null;
  const updatedAtStale = isDramaFeaturedUpdatedAtStale(updatedAt, now);
  if (!isRecord(raw) || !Array.isArray(raw.dramas)) {
    return { dramas: [], skipped: 0, updatedAt, updatedAtStale };
  }
  const dramas: DramaFeatured[] = [];
  let skipped = 0;
  for (const entry of raw.dramas) {
    const parsed = parseDramaEntry(entry);
    if (parsed === null) {
      skipped += 1;
      continue;
    }
    if (dramas.length < DRAMA_FEATURED_MAX) dramas.push(parsed);
  }
  return { dramas, skipped, updatedAt, updatedAtStale };
}

/** 与追剧清单同一把键：platformSiteId:归一化剧名（见 lib/watchlist）。 */
export function featuredDramaKey(drama: DramaFeatured): string {
  return dramaKeyFor(drama.platformSiteId, drama.title);
}

/** 读随仓库发布的剧目文件（构建期静态导入，带校验）。now 仅供测试注入。 */
export function loadDramaFeatured(
  now: Date | number = new Date(),
): ParsedDramaFeatured {
  return parseDramaFeatured(featuredRaw, now);
}
