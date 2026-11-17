/**
 * /drama 页内搜剧 + 题材筛选的纯函数（U-D2）。
 *
 * 语料 = 热门 18 部（题材只取 featured.json 里核实过的 genres）
 *       + 三榜条目（题材取榜单卡题材行）
 *       + 日历标题（无题材标签，只参与搜剧名、不参与题材筛选）。
 * 筛选与搜索可叠加；空结果由调用方如实写“这个题材暂无收录”/
 * “没找到叫「xxx」的剧”，这里只返回空数组、不拿别的题材凑数。
 */
import type { DramaFeatured } from "./drama-featured";
import type {
  DramaCalendarResponse,
  DramaRankingsResponse,
} from "./rest-contracts.generated";
import { normalizeDramaTitle } from "./watchlist";

/** 搜剧名匹配：归一化后包含即命中；比对时再去掉全部空白——用户敲不敲
 * 剧名里的空格都应命中（只影响搜索比对，不动共享的 normalizeDramaTitle
 * 算法，dramaKey 不变）。 */
export function dramaTitleMatches(title: string, query: string): boolean {
  if (query === "") return true;
  const norm = (s: string) => normalizeDramaTitle(s).replace(/\s+/g, "");
  return norm(title).includes(norm(query));
}

/** 热门剧过滤：题材（无题材的剧不参与题材筛选）+ 剧名。 */
export function filterFeaturedDramas(
  dramas: DramaFeatured[],
  query: string,
  genre: string,
): DramaFeatured[] {
  const q = query.trim();
  return dramas.filter(
    (d) =>
      (genre === "" || (d.genres ?? []).includes(genre)) &&
      dramaTitleMatches(d.title, q),
  );
}

/** 题材 chips：热门 18 + 三榜条目的题材并集，按出现次数倒序。 */
export function dramaGenreOptions(
  dramas: DramaFeatured[],
  rankings: DramaRankingsResponse | null,
): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const drama of dramas) {
    for (const g of drama.genres ?? []) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  if (rankings) {
    for (const list of rankings.lists) {
      for (const entry of list.entries) {
        if (entry.genre) counts.set(entry.genre, (counts.get(entry.genre) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
}

export interface RankingSearchHit {
  title: string;
  label: string;
  detailUrl: string;
  genre: string | null;
}

export interface CalendarSearchHit {
  title: string;
  label: string;
}

export interface DramaExtraResults {
  ranking: RankingSearchHit[];
  calendar: CalendarSearchHit[];
}

/**
 * 榜单与日历里的相关剧：只在筛选/搜索激活时由调用方取用。
 * 题材筛选时日历标题不参与（无题材标签）；搜剧名时三者都参与。
 */
export function collectDramaExtraResults(
  rankings: DramaRankingsResponse | null,
  calendar: DramaCalendarResponse | null,
  query: string,
  genre: string,
): DramaExtraResults {
  const q = query.trim();
  const ranking: RankingSearchHit[] = [];
  if (rankings) {
    for (const list of rankings.lists) {
      for (const entry of list.entries) {
        if (genre !== "" && entry.genre !== genre) continue;
        if (!dramaTitleMatches(entry.title, q)) continue;
        ranking.push({
          title: entry.title,
          label: `${list.label}第 ${entry.rank} 名`,
          detailUrl: entry.detailUrl,
          genre: entry.genre,
        });
      }
    }
  }
  const calendarHits: CalendarSearchHit[] = [];
  if (calendar && genre === "") {
    const seen = new Set<string>();
    const push = (title: string, label: string) => {
      const key = normalizeDramaTitle(title);
      if (seen.has(key)) return;
      seen.add(key);
      if (dramaTitleMatches(title, q)) calendarHits.push({ title, label });
    };
    for (const day of calendar.days) {
      for (const item of day.items) push(item.title, `预计 ${item.premiereDate} 上线`);
    }
    for (const group of calendar.monthPending) {
      for (const item of group.items) push(item.title, `${group.label}待上线`);
    }
    for (const item of calendar.expired) {
      push(item.title, `原定 ${item.premiereDate} 上线，未兑现`);
    }
  }
  return { ranking, calendar: calendarHits };
}
