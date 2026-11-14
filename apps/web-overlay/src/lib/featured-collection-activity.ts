// 精选专题互动的纯逻辑：收藏整部合集、订阅更新、逛站进度。
// 仅操作本地存储键名与纯数据，不直接读写浏览器存储，便于单测。

export const FAVORITE_COLLECTIONS_KEY = "navhub_favorite_collections";
export const SUBSCRIBED_COLLECTIONS_KEY = "navhub_subscribed_collections";

export function visitedCollectionKey(slug: string): string {
  return `navhub_collection_visited:${slug}`;
}

export function parseSlugList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function toggleSlug(list: string[], slug: string): string[] {
  return list.includes(slug) ? list.filter((item) => item !== slug) : [...list, slug];
}

export function markVisited(visited: string[], siteId: string): string[] {
  return visited.includes(siteId) ? visited : [...visited, siteId];
}

export interface VisitProgress {
  visited: number;
  total: number;
  percent: number;
  done: boolean;
}

export function visitedProgress(visitedCount: number, total: number): VisitProgress {
  const totalSafe = Math.max(0, total);
  const visitedSafe = Math.min(Math.max(0, visitedCount), totalSafe);
  const percent = totalSafe === 0 ? 0 : Math.round((visitedSafe / totalSafe) * 100);
  return { visited: visitedSafe, total: totalSafe, percent, done: totalSafe > 0 && visitedSafe === totalSafe };
}

export function visitProgressLabel(progress: VisitProgress): string {
  return `已逛 ${progress.visited}/${progress.total} 站`;
}
