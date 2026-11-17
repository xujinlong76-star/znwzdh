/**
 * 短剧真榜单：搜短剧热播榜 / 热搜榜 / 收藏榜解析 + 快照 + 视图。
 *
 * 数据源（2026-11-17 探针实测，见 U-D1 探针记录）：
 *   https://www.soduanju.com/paihang/rebo.html     （热播榜，SSR，25 条）
 *   https://www.soduanju.com/paihang/reso.html     （热搜榜，SSR，34 条）
 *   https://www.soduanju.com/paihang/shoucang.html （收藏榜，SSR，99 条）
 *   robots 全站 Allow（/paihang/* 未禁）；三榜与预约榜同站同结构族。
 *
 * 卡片结构（实测，三榜一致）：
 *   <a href="/(duanju|manju)/<slug>.html" title="短剧《标题》"
 *      class="group card card-hover overflow-hidden">…</a>
 *   海报左下浮层：热度数（如 5001万热度 / 115万热搜 / 13866万最高热度）；
 *   海报右下浮层：全 N 集；标题行后一行 mt-2：评分 / 收藏 / 分享 / 点赞
 *   （四项各自可能缺失，缺失留 null，不编）；再一行 mt-1：题材 / 演员 / 演员
 *   （题材为第一段；格式词开头的行先去格式词再取题材，见 FORMAT_TOKENS；
 *   有的卡只有“热度 N万热度”一行、无题材行，此时题材为 null）。
 *   排名 = 卡片在 HTML 里的出现顺序（前三名的徽章数字已核对与顺序一致）。
 *
 * 诚实口径（与开播日历同一套规则）：
 *   - 数字缺失留 null：评分、收藏、分享、点赞各自可能没有，不拿别的数凑；
 *   - 标题长度 < 2 的疑似截断行丢弃并计数（12 月名单“不”字单字标题就是这类脏数据）；
 *   - 单榜解析条目过少（< 20）视为疑似改版，不覆盖该榜快照，只记 lastError；
 *   - 失败下发上一日快照并标 stale；从未抓到过时 status empty，不编榜单。
 *
 * 注意：三榜 SSR 条数并不都是 99——实测热播榜 25 条、热搜榜 34 条、收藏榜 99 条。
 * 展示上限 30 条/榜是本文件的 DISPLAY_LIMIT，与“每榜 99 条”的旧说法无关。
 */
import { normalizeDramaTitle } from "./featured.ts";

export type RankingListKind = "rebo" | "reso" | "shoucang";

export interface RankingListConfig {
  kind: RankingListKind;
  /** 榜单中文名（热播榜 / 热搜榜 / 收藏榜）。 */
  label: string;
  /** 本榜主数字的口径（热度 / 热搜 / 收藏）。 */
  metricLabel: string;
  url: string;
  sourceName: string;
}

export const RANKING_LISTS: RankingListConfig[] = [
  {
    kind: "rebo",
    label: "热播榜",
    metricLabel: "热度",
    url: "https://www.soduanju.com/paihang/rebo.html",
    sourceName: "搜短剧热播榜",
  },
  {
    kind: "reso",
    label: "热搜榜",
    metricLabel: "热搜",
    url: "https://www.soduanju.com/paihang/reso.html",
    sourceName: "搜短剧热搜榜",
  },
  {
    kind: "shoucang",
    label: "收藏榜",
    metricLabel: "收藏",
    url: "https://www.soduanju.com/paihang/shoucang.html",
    sourceName: "搜短剧收藏榜",
  },
];

/** 三榜总入口（视图层来源链接）。 */
export const RANKINGS_INDEX_URL = "https://www.soduanju.com/paihang/index.html";
export const RANKINGS_SOURCE_NAME = "搜短剧";
/** 快照在 system_states 里的键。 */
export const DRAMA_RANKINGS_SNAPSHOT_KEY = "drama:rankings:snapshot";
/** 单榜解析条目过少的疑似改版阈值（实测热播 25 / 热搜 34 / 收藏 99）。 */
export const RANKINGS_MIN_ENTRIES = 20;
/** 每榜展示上限。 */
export const RANKINGS_DISPLAY_LIMIT = 30;

export interface RankingEntry {
  /** 榜内名次（卡片出现顺序，从 1 开始）。 */
  rank: number;
  /** 剧名（榜单原文，去空白）。 */
  title: string;
  /** 归一化剧名（与 featured.ts 口径一致，供榜单与清单按标题匹配）。 */
  key: string;
  /** 搜短剧详情页绝对地址（/duanju/ 或 /manju/，榜单行点开即此页）。 */
  detailUrl: string;
  /** 海报左下浮层的主数字（万人）；榜单没写时为 null，不编。 */
  metric: number | null;
  /** 主数字的口径原文（热度 / 热搜 / 最高热度）。 */
  metricLabel: string | null;
  /** 评分（0–10）；榜单没写时为 null。 */
  rating: number | null;
  /** 收藏数（万人）；没写时为 null。 */
  favorites: number | null;
  /** 分享数（万人）；没写时为 null。 */
  shares: number | null;
  /** 点赞数（万人）；没写时为 null。 */
  likes: number | null;
  /** 全 N 集；没写时为 null。 */
  totalEpisodes: number | null;
  /** 题材（卡片题材行第一段）；无题材行时为 null。 */
  genre: string | null;
  /** 主演（题材行除题材外的段）。 */
  actors: string[];
}

/** 单榜快照。 */
export interface RankingListSnapshot {
  kind: RankingListKind;
  label: string;
  sourceUrl: string;
  sourceName: string;
  /** 本次成功抓取时间（毫秒）。 */
  fetchedAt: number;
  /** 源站 JSON-LD dateModified（榜单自身的更新时间），抓不到为 null。 */
  sourceDateModified: string | null;
  /** 本轮解析到的全部条目（展示时再截前 30）。 */
  entries: RankingEntry[];
  /** 本轮丢弃的疑似截断行数（标题长度 < 2）。 */
  droppedTitles: number;
  /** 最近一次失败原因；成功时为 null。失败不清空 entries。 */
  lastError: string | null;
  /** 最近一次成功抓取时间（毫秒）；从未成功为 null。 */
  lastOkAt: number | null;
}

export interface DramaRankingsSnapshot {
  version: 1;
  source: "soduanju-rankings";
  /** 本次刷新任务跑完的时间（毫秒）。 */
  fetchedAt: number;
  lists: Record<RankingListKind, RankingListSnapshot>;
}

const CARD_RE =
  /<a href="\/(duanju|manju)\/([a-z0-9-]+\.html)" title="短剧《([^"]+)》" class="group card card-hover overflow-hidden">/g;
const LEFT_RE = /<div class="absolute bottom-2 left-2[^>]*>([^<]+)<\/div>/;
const RIGHT_RE = /<div class="absolute bottom-2 right-2[^>]*>([^<]+)<\/div>/;
const META_RE = /<div class="mt-2 line-clamp-1 text-sm[^>]*>([^<]+)<\/div>/;
const TAG_RE = /<div class="mt-1 line-clamp-1 text-xs[^>]*>([^<]+)<\/div>/g;
const METRIC_RE = /([\d.]+)万(.+)$/;
const TOTAL_RE = /全\s*(\d+)\s*集/;
const RATING_RE = /评分\s*([\d.]+)/;
const FAVORITES_RE = /([\d.]+)万收藏/;
const SHARES_RE = /([\d.]+)万分享/;
const LIKES_RE = /([\d.]+)万次点赞/;
const DATE_MODIFIED_RE = /"dateModified"\s*:\s*"([^"]+)"/;

/**
 * 题材行开头的格式词（不是题材）：有的卡题材行以“真人剧 / 爱情 / …”或
 * “漫剧 / 玄幻 / …”开头，格式词在前、题材在后；“3D / 演员 / 演员”这类
 * 卡则根本没有题材段。解析时先去掉开头的格式词，再取第一段作题材；
 * 去完后无段可取时题材为 null（不拿格式词或演员名冒充题材）。
 */
const FORMAT_TOKENS: ReadonlySet<string> = new Set([
  "真人剧",
  "漫剧",
  "AI剧",
  "3D",
  "2D",
]);

function parseWanNumber(text: string, re: RegExp): number | null {
  const m = re.exec(text);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * 解析一张榜单页 HTML。
 *
 * 卡片无嵌套 <a>，取 anchor 起点到第一个 </a> 即一张卡；排名取出现顺序。
 * 题材行判定：取卡内第一行含“ / ”分隔的 mt-1 行（题材 / 演员 / 演员），
 * 以“热度”开头的行是热度徽标行、不是题材行，直接跳过；单段无分隔的行
 * （如“玄幻”）也认作题材；三行都没有时题材为 null。
 */
export function parseRankingList(
  html: string,
  _kind: RankingListKind,
): { entries: RankingEntry[]; droppedTitles: number } {
  const entries: RankingEntry[] = [];
  let droppedTitles = 0;
  if (!html) return { entries, droppedTitles };
  const seen = new Set<string>();
  CARD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CARD_RE.exec(html)) !== null) {
    const detailKind = m[1] ?? "duanju";
    const slug = m[2] ?? "";
    const title = (m[3] ?? "").trim();
    if (title.length < 2) {
      droppedTitles += 1;
      continue;
    }
    const key = normalizeDramaTitle(title);
    if (seen.has(key)) continue;
    seen.add(key);
    const end = html.indexOf("</a>", m.index);
    const slice = end === -1 ? html.slice(m.index) : html.slice(m.index, end);
    const left = (LEFT_RE.exec(slice)?.[1] ?? "").trim();
    const right = (RIGHT_RE.exec(slice)?.[1] ?? "").trim();
    const meta = (META_RE.exec(slice)?.[1] ?? "").trim();
    const metricMatch = METRIC_RE.exec(left);
    let genre: string | null = null;
    let actors: string[] = [];
    TAG_RE.lastIndex = 0;
    let tag: RegExpExecArray | null;
    while ((tag = TAG_RE.exec(slice)) !== null) {
      const text = (tag[1] ?? "").trim();
      if (text.startsWith("热度")) continue;
      const parts = text
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean);
      // 题材行有四种实测形状：[题材 / 演员 / 演员]、[格式 / 题材 / 演员 / 演员]、
      // [格式 / 演员 / 演员]（无题材段）、[题材]（单段）。格式词在前时，
      // 去掉后剩 3 段才是“题材 + 两演员”，剩 2 段只是两演员、题材为 null。
      if (FORMAT_TOKENS.has(parts[0] ?? "")) {
        parts.shift();
        if (parts.length >= 3) {
          genre = parts[0] ?? null;
          actors = parts.slice(1);
        } else {
          genre = null;
          actors = parts;
        }
      } else {
        genre = parts[0] ?? null;
        actors = parts.slice(1);
      }
      break;
    }
    entries.push({
      rank: entries.length + 1,
      title,
      key,
      detailUrl: `https://www.soduanju.com/${detailKind}/${slug}`,
      metric: metricMatch?.[1] ? Number(metricMatch[1]) : null,
      metricLabel: metricMatch?.[2]?.trim() || null,
      rating: parseWanNumber(meta, RATING_RE),
      favorites: parseWanNumber(meta, FAVORITES_RE),
      shares: parseWanNumber(meta, SHARES_RE),
      likes: parseWanNumber(meta, LIKES_RE),
      totalEpisodes: parseWanNumber(right, TOTAL_RE),
      genre,
      actors,
    });
  }
  return { entries, droppedTitles };
}

/** 源站 JSON-LD 的 dateModified（榜单自身更新时间）。 */
export function extractRankingsDateModified(html: string): string | null {
  const m = DATE_MODIFIED_RE.exec(html);
  return m?.[1] ?? null;
}

/**
 * 用新一轮解析结果生成快照：单榜失败不拖垮整份快照。
 *
 * - 某榜解析条目 >= 20 → 替换该榜 entries，lastError 清空；
 * - 某榜解析条目 < 20 → 疑似改版，保留上一轮 entries，只记 lastError；
 * - 某榜抓取失败（parsed 为 null）→ 同上，保留上一轮 entries，只记 lastError；
 * - 从未有过快照的榜 → 建一条空快照（entries []，lastError 为失败原因）。
 */
export function buildRankingsSnapshot(
  prev: DramaRankingsSnapshot | null,
  parsed: Partial<
    Record<
      RankingListKind,
      { entries: RankingEntry[]; droppedTitles: number } | null
    >
  >,
  fetchedAt: number,
  dateModified: Partial<Record<RankingListKind, string | null>>,
  errors: Partial<Record<RankingListKind, string>>,
): DramaRankingsSnapshot {
  const lists = {} as Record<RankingListKind, RankingListSnapshot>;
  for (const config of RANKING_LISTS) {
    const kind = config.kind;
    const prevList = prev?.lists[kind];
    const next = parsed[kind];
    const error = errors[kind];
    if (next && next.entries.length >= RANKINGS_MIN_ENTRIES) {
      lists[kind] = {
        kind,
        label: config.label,
        sourceUrl: config.url,
        sourceName: config.sourceName,
        fetchedAt,
        sourceDateModified: dateModified[kind] ?? prevList?.sourceDateModified ?? null,
        entries: next.entries,
        droppedTitles: next.droppedTitles,
        lastError: null,
        lastOkAt: fetchedAt,
      };
    } else {
      const reason =
        error ??
        (next
          ? `${config.label}解析条目过少（${next.entries.length} 条，正常 ${kind === "rebo" ? "约 25" : kind === "reso" ? "约 34" : "约 99"} 条），疑似改版，保留上一日快照`
          : `${config.label}未抓到，保留上一日快照`);
      lists[kind] = {
        kind,
        label: config.label,
        sourceUrl: config.url,
        sourceName: config.sourceName,
        fetchedAt: prevList?.fetchedAt ?? fetchedAt,
        sourceDateModified: prevList?.sourceDateModified ?? null,
        entries: prevList?.entries ?? [],
        droppedTitles: prevList?.droppedTitles ?? 0,
        lastError: reason,
        lastOkAt: prevList?.lastOkAt ?? null,
      };
    }
  }
  return { version: 1, source: "soduanju-rankings", fetchedAt, lists };
}

/* --------------------------- 视图层（供 /api/drama/rankings） --------------------------- */

export interface RankingListView {
  kind: RankingListKind;
  label: string;
  /** 本榜主数字的口径（热度 / 热搜 / 收藏）。 */
  metricLabel: string;
  sourceUrl: string;
  sourceName: string;
  /** ok = 最新快照成功；stale = 最近一次失败、下发上一日快照；empty = 从未抓到过。 */
  status: "ok" | "stale" | "empty";
  fetchedAt: number | null;
  sourceDateModified: string | null;
  lastError: string | null;
  /** 前 30 部（榜单原文顺序）。 */
  entries: RankingEntry[];
}

export interface DramaRankingsView {
  /** ok = 三榜都成功；stale = 任一榜失败；empty = 三榜都从未抓到过。 */
  status: "ok" | "stale" | "empty";
  fetchedAt: number | null;
  sourceName: string;
  sourceUrl: string;
  lists: RankingListView[];
}

/** 由快照算出 /drama 展示用的视图（纯函数）。 */
export function buildDramaRankingsView(
  snapshot: DramaRankingsSnapshot | null,
): DramaRankingsView {
  const lists: RankingListView[] = RANKING_LISTS.map((config) => {
    const list = snapshot?.lists[config.kind];
    const entries = (list?.entries ?? []).slice(0, RANKINGS_DISPLAY_LIMIT);
    const status: RankingListView["status"] =
      !list || list.entries.length === 0
        ? "empty"
        : list.lastError
          ? "stale"
          : "ok";
    return {
      kind: config.kind,
      label: config.label,
      metricLabel: config.metricLabel,
      sourceUrl: config.url,
      sourceName: config.sourceName,
      status,
      fetchedAt: list?.fetchedAt ?? null,
      sourceDateModified: list?.sourceDateModified ?? null,
      lastError: list?.lastError ?? null,
      entries,
    };
  });
  const anyOk = lists.some((l) => l.status === "ok");
  const anyStale = lists.some((l) => l.status === "stale");
  return {
    status: anyOk ? (anyStale ? "stale" : "ok") : anyStale ? "stale" : "empty",
    fetchedAt: snapshot?.fetchedAt ?? null,
    sourceName: RANKINGS_SOURCE_NAME,
    sourceUrl: RANKINGS_INDEX_URL,
    lists,
  };
}
