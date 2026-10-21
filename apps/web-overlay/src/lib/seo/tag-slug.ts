/**
 * 标签名 → URL slug。
 *
 * 与 `packages/store/src/repository/dialect.ts` 的 `slugify` **逐字同构**
 * （store 是写入侧的事实源，tags.slug 由它生成）：
 *   trim → lowercase → 空白转连字符 → 只保留 [a-z0-9 中文 -] → 空则兜底 "tag"
 *
 * 为什么客户端也要一份：卡片 `#tag` 要链到 `/tags/{slug}`，而
 * `NavigationSubItem.tags` 只有名字没有 slug。sitemap
 * （`lib/seo/sitemap-entries.ts`）与标签云（`components/tag-cloud.tsx`）
 * 都用 slug 形态——卡片若用名字造 URL（`/tags/AI%20编程`），会与
 * `/tags/ai-编程` 形成**同内容双 URL**，正是 canonical 要消灭的东西。
 *
 * 纪律：改这个函数必须同步 store 侧，并跑 `tag-slug.test.ts` 的契约用例
 * （两侧行为漂移 = 全站标签 URL 悄悄分叉）。
 */
export function tagSlug(name: string): string {
  const s = (name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
  return s.length > 0 ? s : 'tag'
}
