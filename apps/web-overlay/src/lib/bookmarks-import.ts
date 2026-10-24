/**
 * Netscape 书签 HTML 解析（T2：书签互操作「只出不进」的补进）。
 *
 * 浏览器导出的 bookmarks.html 是 <DL><DT><A HREF="…">标题</A> 结构。
 * 这里用宽松的正则提取 <A> 标签：真实文件带属性乱序、注释节点与
 * ICON 数据（体积大头），DOM 解析反而要处理整棵树的噪声。
 * 收藏只能落「本机收藏」（站点若未被站库收录则没有 siteId），
 * 所以产物是 { title, href }，由调用方转成本地收藏条目。
 */

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

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
}

export function parseNetscapeBookmarks(html: string, limit = 10000): { items: ParsedBookmark[]; truncated: boolean } {
  const items: ParsedBookmark[] = []
  const seen = new Set<string>()
  let truncated = false
  let match: RegExpExecArray | null
  ANCHOR_RE.lastIndex = 0
  while ((match = ANCHOR_RE.exec(html)) !== null) {
    const href = match[1]!.trim()
    // javascript:/data: 等非网页锚点没有收藏价值；只收 http(s)
    if (!/^https?:\/\//i.test(href)) continue
    if (seen.has(href)) continue
    seen.add(href)
    const title = stripTags(match[2] ?? '') || href
    if (items.length >= limit) {
      truncated = true
      break
    }
    items.push({ title: title.slice(0, 200), href })
  }
  return { items, truncated }
}
