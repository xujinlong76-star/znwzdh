/**
 * 分类页标签精确匹配。
 *
 * `data-tags` 用单元分隔符（U+001F）拼接小写标签串（生产方见 category-board.tsx，
 * 消费方见 category-site-filter-bar.tsx，两处必须用同一分隔符）。
 * 之所以不用空格拼接：有 3 个标签本身含空格（AI IDE、AI 助手、UI 设计），
 * 空格拼接会让「UI 设计」与「UI」+「设计」无法区分；
 * 之所以不用换行：SSR 输出的 HTML 属性值里换行会被解析器归一为空格；
 * 单元分隔符不在任何标签里出现（控制字符不会进标签数据），且 HTML 解析保留它。
 *
 * 之前用 `tags.includes(tag)` 做子串匹配，两个毛病：
 *  - 点「Java」会命中只打了「JavaScript」的站点，点「Go」命中「Google」，
 *    点「UI」命中「UI 设计 / UI 库 / UI 框架 / UI 组件」；
 *  - 芯片上的数是按精确标签计的（tagCounts 按标签字符串精确计数），
 *    子串筛选筛出的数比芯片数多，数与结果对不上。
 */

/** data-tags 属性内拼接多个标签的分隔符（U+001F，见上）。 */
export const TAG_ATTR_SEPARATOR = "\u001f";

export function matchesSiteTag(tagsAttr: string, tag: string): boolean {
  const needle = tag.trim().toLowerCase();
  if (!needle) return true;
  return tagsAttr
    .toLowerCase()
    .split(TAG_ATTR_SEPARATOR)
    .includes(needle);
}
