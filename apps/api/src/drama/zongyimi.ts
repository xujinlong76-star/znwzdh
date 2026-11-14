/**
 * 综艺迷作品资料页解析（kind: "zongyimi-subject"）。
 *
 * 页面为服务端渲染的静态 HTML，剧目信息在 `<dl class="facts">` 里：
 * `<dt>总集数</dt><dd>80 集</dd>`、`<dt>资料更新</dt><dd>2026-11-14</dd>`。
 *
 * 规则（保守）：优先精确提取 `<dt>总集数</dt>` 后的数字；同一页出现多个
 * “总集数”值且不一致时返回 null（不编数字、不猜）；精确提取失败时回退
 * 到旧榜单解析 parseRankingEpisode（标题附近找集数）。“资料更新”日期
 * 顺带提取，用于在每日检查事件里记录陈旧度——资料站停更时（如某剧
 * 2026-11-06 后再未动）不要长期拿冻结数充当“在查”。
 */
import { parseRankingEpisode } from "./ranking.ts";

export interface ZongyimiSubjectResult {
  episode: number | null;
  /** 页内“资料更新”日期（YYYY-MM-DD），提不到时为 null。 */
  sourceUpdatedAt: string | null;
}

export function parseZongyimiSubject(html: string, titleMatch: string): ZongyimiSubjectResult {
  const updatedMatch = html.match(/<dt>\s*资料更新\s*<\/dt>\s*<dd>\s*(\d{4}-\d{2}-\d{2})\s*<\/dd>/);
  const sourceUpdatedAt = updatedMatch?.[1] ?? null;
  if (!html) return { episode: null, sourceUpdatedAt };
  const values: number[] = [];
  const totalRe = /<dt>\s*总集数\s*<\/dt>\s*<dd>\s*(\d+)\s*集\s*<\/dd>/g;
  for (const match of html.matchAll(totalRe)) {
    const value = match[1];
    if (value !== undefined) values.push(Number(value));
  }
  if (values.length > 0) {
    const first = values[0];
    if (first === undefined || !values.every((value) => value === first)) {
      return { episode: null, sourceUpdatedAt };
    }
    return { episode: first, sourceUpdatedAt };
  }
  // 精确提取失败：回退旧榜单解析（标题附近 1500 字符内找集数）。
  return { episode: parseRankingEpisode(html, titleMatch), sourceUpdatedAt };
}
