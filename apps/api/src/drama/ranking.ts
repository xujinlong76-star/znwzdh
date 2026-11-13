/**
 * 榜单页集数解析。
 *
 * 规则（保守）：取标题的全部出现位置，每处向后 1500 字符内找第一个
 * `(\d+)\s*集`；全部非空结果必须一致才采信，否则返回 null（不可解析，
 * 记 last_error，不通知）。榜单页的 head/meta/JSON-LD 区域常无集数，只有
 * 表格行有一无匹配也返回 null，不编数字。
 */
export function parseRankingEpisode(html: string, titleMatch: string): number | null {
 if (!html ||!titleMatch) return null;
 const values: number[] = [];
 let from = 0;
 for (;;) {
 const idx = html.indexOf(titleMatch, from);
 if (idx === -1) break;
 const match = html.slice(idx, idx + 1500).match(/(\d+)\s*集/);
 if (match) values.push(Number(match[1]));
 from = idx + titleMatch.length;
}
 if (values.length === 0) return null;
 const first = values[0];
 if (first === undefined) return null;
 return values.every((value) => value === first)? first: null;
}
