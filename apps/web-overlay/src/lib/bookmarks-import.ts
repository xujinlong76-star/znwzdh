/**
 * Netscape 书签 HTML 解析（T2：书签互操作「只出不进」的补进）。
 *
 * 浏览器导出的 bookmarks.html 是 <DL><DT><A HREF="…">标题</A> 结构。
 * 这里用宽松的正则提取 <A> 标签：真实文件带属性乱序、注释节点与
 * ICON 数据（体积大头），DOM 解析反而要处理整棵树的噪声。
 * 收藏只能落「本机收藏」（站点若未被站库收录则没有 siteId），
 * 所以产物是 { title, href }，由调用方转成本地收藏条目。
 */

import { fingerprintUrl } from './import-workbench'
import { stripHtmlTags } from './html-text'

export interface ParsedBookmark {
  title: string
  href: string
}

const ANCHOR_RE = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi

/** 稳定短 id：同 URL 重复导入时按 siteId 去重依赖它保持不变 */
export function bookmarkId(href: string): string {
  let h = 5381
  for (let i = 0; i < href.length; i++) {
    h = ((h << 5) + h + href.charCodeAt(i)) | 0
  }
  return 'bm-' + (h >>> 0).toString(36) + '-' + href.length.toString(36)
}

/**
 * 脱标签 + 解实体（先脱后解：`&lt;script&gt;` 是用户想看的字面文本，解一层后
 * 不再当标签吃；顺序与 feed-parse.ts 的 toPlainText 一致）。
 *
 * 脱标签用单遍状态机 stripHtmlTags，不用单次正则 `.replace(/<[^>]+>/g, '')`：
 * 后者对嵌套标签一次删除后外层残片会拼成新标签（CodeQL「不完整的多字符
 * 清理」），且属性内 `>` 会提前截断（见 html-text.ts）。
 */
function stripTags(text: string): string {
  return stripHtmlTags(text).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
}

/** 单次上限与 parseUniversalBookmarks 对齐（总协调人决策 1：5000） */
export function parseNetscapeBookmarks(html: string, limit = 5000): { items: ParsedBookmark[]; truncated: boolean; totalMatched: number } {
  const items: ParsedBookmark[] = []
  // 批内去重键 = fingerprintUrl（SSOT）：原始 href 字符串会把
  // `?utm_source=x` 与无参同一站判成两条；这里只 import，不另写归一化
  const seen = new Set<string>()
  let truncated = false
  // totalMatched 只计 http(s) 锚点：javascript:/data: 锚点本来就不会进
  // 收藏，把它们算进“命中总数”会让超限文案虚报条数
  const totalMatched = [...html.matchAll(/<a\s+[^>]*href="https?:\/\/[^"]+"[^>]*>/gi)].length
  let match: RegExpExecArray | null
  ANCHOR_RE.lastIndex = 0
  while ((match = ANCHOR_RE.exec(html)) !== null) {
    const href = match[1]!.trim()
    // javascript:/data: 等非网页锚点没有收藏价值；只收 http(s)
    if (!/^https?:\/\//i.test(href)) continue
    const fp = fingerprintUrl(href)
    if (!fp || seen.has(fp)) continue
    seen.add(fp)
    const title = stripTags(match[2] ?? '') || href
    if (items.length >= limit) {
      truncated = true
      break
    }
    items.push({ title: title.slice(0, 200), href })
  }
  return { items, truncated, totalMatched }
}
