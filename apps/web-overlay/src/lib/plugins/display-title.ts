/**
 * 插件卡片标题的展示收敛。
 *
 * 问题（2026-11-09 实测）：像
 * `AI 智能体时代旗舰全家桶 (Agentic Future Bundle)` 这样的标题在 3 列布局里
 * 放不进两行，卡片高度又被网格锁死，末尾的 `)` 会被裁掉，屏幕上留下
 * 「…(Agentic Future Bundle」这种半截括号——看起来像数据损坏。
 *
 * 规则：**只在会溢出时**去掉结尾的括注，正文原样保留；全称不丢，
 * 卡片用 title / aria-label 承载完整名称，搜索与详情页也用全称。
 * 不做通用截断（那是 CSS 的事），避免把「…」硬塞进标题里。
 */

/** 结尾括注：中英文括号成对出现在字符串末尾 */
const TRAILING_PAREN = /[（(][^（()）]*[)）]\s*$/

export function cardTitle(name: string, maxChars = 20): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return ''
  // 按码点计数：中文与 emoji 都不能被算成两个字符
  if ([...trimmed].length <= maxChars) return trimmed

  const stripped = trimmed.replace(TRAILING_PAREN, '').trim()
  // 去掉括注后至少还要剩点东西，否则宁可用原名让 CSS 处理
  return [...stripped].length >= 4 ? stripped : trimmed
}
