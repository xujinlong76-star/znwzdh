/**
 * 短剧专区剧目数据：apps/web-overlay/src/navsphere/content/drama-featured.json。
 *
 * 这份文件只描述“专区首屏展示哪几部剧、每部剧的来源链接是什么、能不能查新集”——
 * 它不是追剧清单（追剧清单是 watch_entries，由用户自己加），也不是视频库。
 * 校验口径（parseDramaFeatured）：只收字段齐全的行，坏行跳过并计数；
 * 面板不为一行坏数据整个掉。首屏最多展示 12 部。
 *
 * 诚实口径在类型上：linkNote 必须如实标注链接是剧目页、榜单页、报道页
 * 还是百科页；榜单页 / 报道页 / 百科页不是正片，卡片不许写成“点开即看”。
 * 集数只须核实过的，没核实的留 null，不许编。
 */
import featuredRaw from "../navsphere/content/drama-featured.json";
import { dramaKeyFor } from "./watchlist";

export type DramaCheckKind = "migu-list" | "wikipedia" | "ranking" | "none";

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
  check: DramaCheck;
}
export interface DramaFeaturedFile {
  version: number;
  updatedAt: string;
  dramas: DramaFeatured[];
}

export const DRAMA_FEATURED_MAX = 12;

const CHECK_KINDS: ReadonlySet<string> = new Set([
  "migu-list",
  "wikipedia",
  "ranking",
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
    check,
  };
}

export interface ParsedDramaFeatured {
  dramas: DramaFeatured[];
  /** 因字段不全 / 自相矛盾被跳过的行数 */
  skipped: number;
}

/**
 * 校验整份剧目文件：坏行跳过并计数；首屏只取前 12 部有效剧目。
 * 顶层不是对象、没有 dramas 数组时返回空列表（页面照常渲染平台区）。
 */
export function parseDramaFeatured(raw: unknown): ParsedDramaFeatured {
  if (!isRecord(raw) || !Array.isArray(raw.dramas)) {
    return { dramas: [], skipped: 0 };
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
  return { dramas, skipped };
}

/** 与追剧清单同一把键：platformSiteId:归一化剧名（见 lib/watchlist）。 */
export function featuredDramaKey(drama: DramaFeatured): string {
  return dramaKeyFor(drama.platformSiteId, drama.title);
}

/** 读随仓库发布的剧目文件（构建期静态导入，带校验）。 */
export function loadDramaFeatured(): ParsedDramaFeatured {
  return parseDramaFeatured(featuredRaw);
}
