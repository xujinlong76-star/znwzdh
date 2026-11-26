/**
 * 全格式智能书签解析、去重与智能分类引擎 (Universal Bookmarks Ingestion Engine)
 * 纯算法实现，0 DOM 依赖，跨 Node.js 与浏览器端通用。
 *
 * 支持格式：
 * 1. Netscape Bookmark File Format (Chrome, Edge, Firefox, Safari 标准 HTML 导出的 bookmarks.html)
 * 2. OneTab 纯文本导出 (URL | Title 列表)
 * 3. 分级 Markdown 书签 (以 # 标题为分类，- [Title](URL) 为链接)
 * 4. URL 规范化清洗与追踪参数剥离 (URL Sanitizer)
 * 5. 跨分类去重与语义合并 (Semantic Deduplication)
 */

export interface ParsedBookmarkItem {
  id?: string
  title: string
  href: string
  description?: string
  icon?: string
  addDate?: number
  categoryTitle?: string
}

export interface ParsedBookmarkFolder {
  id?: string
  title: string
  items: ParsedBookmarkItem[]
  subFolders?: ParsedBookmarkFolder[]
  addDate?: number
}

/**
 * 纯文本剥标签（无 DOM 依赖，Node 与浏览器通用）。
 *
 * 单次正则 `.replace(/<[^>]+>/g, '')` 有两处硬伤（CodeQL「不完整的多字符
 * 清理」，同 apps/web-overlay/src/lib/html-text.ts 的 #138/#139）：
 * 1. 引号盲区：`<a title="x>y">正文</a>` 会在属性内的 `>` 处提前截断；
 * 2. 拼接复活：嵌套标签一次删除后，外层残片可能拼成新的标签形子串。
 *
 * 这里是单遍状态机（与 html-text.ts 的 stripHtmlTags 同语义，core 层不
 * 依赖 overlay 故本地一份）：只把 `<` 后跟字母 / `/` / `!` / `?` 的才当
 * 标签开头，标签内引号里的 `>` 不闭合标签，未闭合标签丢弃剩余部分。
 * 一次扫描即干净，线性时间、无回溯。
 */
export function stripHtmlTags(text: string): string {
  const out: string[] = []
  const n = text.length
  let i = 0
  while (i < n) {
    const ch = text[i]! // i < n 已保证下标有效（core 开 noUncheckedIndexedAccess）
    if (ch !== '<') {
      out.push(ch)
      i++
      continue
    }
    const next = text[i + 1]
    if (next === undefined || !/[A-Za-z/?!]/.test(next)) {
      out.push(ch)
      i++
      continue
    }
    let j = i + 1
    let quote: string | null = null
    while (j < n) {
      const c = text[j]
      if (quote) {
        if (c === quote) quote = null
      } else if (c === '"' || c === "'") {
        quote = c
      } else if (c === '>') {
        break
      }
      j++
    }
    if (j >= n) break // 未闭合标签：丢弃剩余部分
    i = j + 1
  }
  return out.join('').trim()
}

// =========================================================================
// 1. URL 规范化与跟踪参数剥离算法
// =========================================================================

const TRACKING_QUERY_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'spm',
  'spm_id_from',
  'from',
  'ref',
  'fbclid',
  'gclid',
  '_hsenc',
  '_hsmi',
  'mc_cid',
  'mc_eid',
  'source',
])

/**
 * 规范化 URL：
 * 1. 规范协议为小写
 * 2. 移除尾部无意义的斜杠 (路径为根除外)
 * 3. 剥离已知的营销追踪参数 (utm_*, spm, fbclid 等)
 * 4. 排序 query 参数以便哈希/比对查重
 */
export function normalizeBookmarkUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return ''
  const trimmed = rawUrl.trim()
  if (!trimmed) return ''

  // 严禁非 http/https 协议头（如 javascript:, data:, file:, vbscript:, blob:）
  const schemeMatch = trimmed.match(/^([a-zA-Z0-9+.-]+):/)
  if (schemeMatch && schemeMatch[1]) {
    const scheme = schemeMatch[1].toLowerCase()
    if (scheme !== 'http' && scheme !== 'https') {
      return ''
    }
  }

  try {
    const url = new URL(trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`)
    // 只允许 http/https，其他协议直接拒收，避免 XSS/本地文件读取
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    
    // 移除已知的跟踪参数
    const searchParams = new URLSearchParams(url.search)
    const keysToDelete: string[] = []
    searchParams.forEach((_, key) => {
      if (TRACKING_QUERY_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
        keysToDelete.push(key)
      }
    })
    for (const key of keysToDelete) {
      searchParams.delete(key)
    }

    // 重新排序 Query 参数
    searchParams.sort()
    const newSearch = searchParams.toString()

    let pathname = url.pathname
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1)
    }

    return `${url.protocol}//${url.host.toLowerCase()}${pathname}${newSearch ? `?${newSearch}` : ''}${url.hash}`
  } catch {
    // 若无法解析为合法 HTTP URL，安全拒绝
    return ''
  }
}

function sanitizeBookmarkIcon(rawIcon: string | undefined): string | undefined {
  if (!rawIcon || typeof rawIcon !== 'string') return undefined
  const trimmed = rawIcon.trim()
  if (!trimmed) return undefined
  if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,/i.test(trimmed)) {
    return trimmed.length <= 65536 ? trimmed : undefined
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.slice(0, 2048)
  }
  return undefined
}

// =========================================================================
// 2. Netscape Bookmark HTML 解析算法 (Chrome / Edge / Safari / Firefox)
// =========================================================================

/**
 * 单遍解实体：一次正则 + 查表替换，正则引擎不回扫替换结果。
 * 链式 `.replace(/&amp;/g, '&').replace(/&lt;/g, '<')…` 会双重解码
 * （`&amp;lt;` 先变 `&lt;` 再变 `<`，CodeQL「双重解实体」），所以不要拆开写。
 * 实体集合与旧链一致（`&amp; &lt; &gt; &quot; &#39; &nbsp;`）。
 */
const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
}

function decodeHtmlEntities(str: string): string {
  return str.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => HTML_ENTITIES[entity] ?? entity)
}

/**
 * 书签 ADD_DATE 秒/毫秒/微秒自适应：
 * Chrome 为秒（~1.7e9），部分导出为毫秒（1.7e12），Firefox 有微秒（1.7e15）。
 */
export function parseBookmarkDate(raw: string | undefined | null): number {
  if (!raw) return Date.now();
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return Date.now();
  if (n > 1e14) return Math.floor(n / 1000); // 微秒 -> 毫秒
  if (n > 1e12) return n; // 已是毫秒
  return n * 1000; // 秒 -> 毫秒
}

/**
 * 解析 Netscape Bookmarks HTML 格式文本
 */
export function parseNetscapeBookmarksHtml(htmlString: string): ParsedBookmarkFolder[] {
  if (!htmlString || typeof htmlString !== 'string') return []

  const folders: ParsedBookmarkFolder[] = []
  const folderStack: ParsedBookmarkFolder[] = [
    { title: '默认导入书签', items: [], subFolders: [] },
  ]

  // 按行或标签流式正则解析
  // Netscape 结构特征: <DT><H3 ...>FolderName</H3>, <DL><p>, <DT><A HREF="..." ...>Title</A>, <DD>Description, </DL>
  const tokens = htmlString.split(/(<\/?(?:h3|a|dl|dd|dt)[^>]*>)/gi)

  let pendingItem: Partial<ParsedBookmarkItem> | null = null

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]?.trim()
    if (!token) continue

    // 1. 发现文件夹标题 <H3 ...>
    if (/^<h3/i.test(token)) {
      const titleMatch = token.match(/<h3[^>]*>(.*?)<\/h3>/i)
      let title = ''
      if (titleMatch) {
        title = decodeHtmlEntities(titleMatch[1] || '').trim()
      } else {
        // H3 内容可能在紧接着的 token 里
        const nextContent = tokens[i + 1] || ''
        title = decodeHtmlEntities(stripHtmlTags(nextContent)).trim()
      }

      if (!title) title = '书签文件夹'

      const newFolder: ParsedBookmarkFolder = {
        title,
        items: [],
        subFolders: [],
      }

      const current = folderStack[folderStack.length - 1]!
      current.subFolders = current.subFolders || []
      current.subFolders.push(newFolder)
      folderStack.push(newFolder)
      continue
    }

    // 2. 文件夹结束 </DL>
    if (/^<\/dl/i.test(token)) {
      if (folderStack.length > 1) {
        folderStack.pop()
      }
      continue
    }

    // 3. 书签链接项 <A HREF="..." ...>Title</A>
    if (/^<a\s/i.test(token)) {
      const hrefMatch = token.match(/href=["']([^"']+)["']/i)
      const iconMatch = token.match(/icon=["']([^"']+)["']/i)
      const addDateMatch = token.match(/add_date=["']([^"']+)["']/i)

      const href = hrefMatch ? hrefMatch[1] : ''
      let title = ''

      // 提取标题
      const fullMatch = token.match(/<a[^>]*>(.*?)<\/a>/i)
      if (fullMatch) {
        title = decodeHtmlEntities(fullMatch[1] || '').trim()
      } else {
        const nextContent = tokens[i + 1] || ''
        title = decodeHtmlEntities(stripHtmlTags(nextContent)).trim()
      }

      if (href && !/^(place:|javascript:|data:|vbscript:|file:)/i.test(href)) {
        const currentFolder = folderStack[folderStack.length - 1]!
        const cleanHref = normalizeBookmarkUrl(href)
        if (!cleanHref) continue

        const item: ParsedBookmarkItem = {
          title: title || cleanHref,
          href: cleanHref,
          icon: sanitizeBookmarkIcon(iconMatch ? iconMatch[1] : undefined),
          addDate: parseBookmarkDate(addDateMatch?.[1]),
          categoryTitle: currentFolder.title,
        }

        currentFolder.items.push(item)
        pendingItem = item
      }
      continue
    }

    // 4. 描述说明 <DD>Description
    if (/^<dd/i.test(token) && pendingItem) {
      const ddContent = token.replace(/^<dd>/i, '').trim() || tokens[i + 1]?.trim() || ''
      if (ddContent && !ddContent.startsWith('<')) {
        pendingItem.description = decodeHtmlEntities(ddContent)
      }
      pendingItem = null
    }
  }

  // 整理顶层文件夹列表
  const root = folderStack[0]!
  if (root.items.length > 0) {
    folders.push({
      title: '常用书签',
      items: root.items,
    })
  }
  if (root.subFolders) {
    folders.push(...root.subFolders)
  }

  return folders.filter((f) => f.items.length > 0 || (f.subFolders && f.subFolders.length > 0))
}

// =========================================================================
// 3. OneTab 纯文本导出解析算法
// =========================================================================

/**
 * 解析 OneTab 格式纯文本：
 * 每行格式：`https://example.com | 网站标题` 或单纯的 URL
 */
export function parseOneTabExportText(rawText: string, defaultCategory = 'OneTab 收藏'): ParsedBookmarkFolder[] {
  if (!rawText || typeof rawText !== 'string') return []

  const lines = rawText.split(/\r?\n/)
  const items: ParsedBookmarkItem[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue

    const pipeIdx = trimmed.indexOf('|')
    let url = ''
    let title = ''

    if (pipeIdx !== -1) {
      url = trimmed.slice(0, pipeIdx).trim()
      title = trimmed.slice(pipeIdx + 1).trim()
    } else {
      const spaceIdx = trimmed.indexOf(' ')
      if (spaceIdx !== -1 && (trimmed.startsWith('http://') || trimmed.startsWith('https://'))) {
        url = trimmed.slice(0, spaceIdx).trim()
        title = trimmed.slice(spaceIdx + 1).trim()
      } else {
        url = trimmed
        title = trimmed
      }
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
      const cleanUrl = normalizeBookmarkUrl(url)
      if (!cleanUrl) continue
      items.push({
        title: title || cleanUrl,
        href: cleanUrl,
        categoryTitle: defaultCategory,
      })
    }
  }

  if (items.length === 0) return []
  return [{ title: defaultCategory, items }]
}

// =========================================================================
// 4. Markdown 链接列表解析算法
// =========================================================================

/**
 * 解析 Markdown 格式书签：
 * 支持 `# 分类名` 或 `## 分类名`，支持 `- [Title](URL) - Description` 或 `[Title](URL)`
 */
export function parseMarkdownBookmarks(markdownText: string): ParsedBookmarkFolder[] {
  if (!markdownText || typeof markdownText !== 'string') return []

  const lines = markdownText.split(/\r?\n/)
  const folders: ParsedBookmarkFolder[] = []
  let currentFolder: ParsedBookmarkFolder = {
    title: 'Markdown 导入书签',
    items: [],
  }

  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)(?:\s*[-—:]\s*(.+))?/i

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // 匹配 Markdown 标题：# / ## / ###
    const headerMatch = trimmed.match(/^#{1,4}\s+(.+)$/)
    if (headerMatch) {
      if (currentFolder.items.length > 0) {
        folders.push(currentFolder)
      }
      currentFolder = {
        title: (headerMatch[1] || '未命名分类').trim(),
        items: [],
      }
      continue
    }

    // 匹配链接条目
    const linkMatch = trimmed.match(linkRegex)
    if (linkMatch) {
      const title = linkMatch[1]?.trim() || ''
      const url = linkMatch[2]?.trim() || ''
      const desc = linkMatch[3]?.trim()

      if (url) {
        const cleanUrl = normalizeBookmarkUrl(url)
        if (!cleanUrl) continue
        currentFolder.items.push({
          title: title || cleanUrl,
          href: cleanUrl,
          description: desc,
          categoryTitle: currentFolder.title,
        })
      }
    }
  }

  if (currentFolder.items.length > 0) {
    folders.push(currentFolder)
  }

  return folders
}

// =========================================================================
// 5. 跨格式自动嗅探解析器 (Smart Format Sniffer)
// =========================================================================

export type BookmarkSourceFormat = 'netscape_html' | 'onetab_text' | 'markdown' | 'json'

// Markdown 链接探测的针点：`](http://` / `](https://`
const MARKDOWN_LINK_PREFIXES = ['](http://', '](https://'] as const

// 正则 `.` 不匹配的行终止符：`\n \r \u2028 \u2029`（字符码 0x0a / 0x0d / 0x2028 / 0x2029）。
// 行切分须单遍扫描，禁止每行对各终止符重复 indexOf（对行内不存在的
// 终止符每次都会扫到串尾，多行输入下呈 O(k·n) 近平方级增长，CodeQL #20
// 返工 D1）；见下方 hasMarkdownLink。

/**
 * 判断单行内是否存在 Markdown 链接 `[text](http(s)://...)`。
 * 与原正则 /\[.+?\]\(https?:\/\/.+?\)/ 等价（`.` 不跨行）：
 * - `[` 须在 `]` 之前且中间至少 1 字符；
 * - `://` 之后与 `)` 之间至少 1 字符。
 * 全程只用 indexOf 递增扫描，线性时间、无回溯。
 */
function hasMarkdownLinkInLine(line: string): boolean {
  const openIdx = line.indexOf('[')
  if (openIdx === -1) return false
  for (const needle of MARKDOWN_LINK_PREFIXES) {
    let from = 0
    for (;;) {
      const closeIdx = line.indexOf(needle, from)
      if (closeIdx === -1) break
      if (openIdx < closeIdx - 1) {
        if (line.indexOf(')', closeIdx + needle.length + 1) !== -1) return true
        // 该位置之后已无 `)`，更靠后的针点也不可能有，直接结束
        break
      }
      from = closeIdx + 1
    }
  }
  return false
}

/**
 * 线性检测文本中是否存在 Markdown 链接。
 * 原正则对 `[`×n 输入呈平方级回溯（CodeQL #20）；
 * 本实现单遍扫描行终止符：每字符只看一次 charCodeAt，找到终止符
 * 即切一行，整体线性（O(n)）；逐行判定仍走 hasMarkdownLinkInLine。
 */
function hasMarkdownLink(text: string): boolean {
  const len = text.length
  let lineStart = 0
  for (let i = 0; i < len; i++) {
    const code = text.charCodeAt(i)
    if (code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029) {
      if (hasMarkdownLinkInLine(text.slice(lineStart, i))) return true
      lineStart = i + 1
    }
  }
  return hasMarkdownLinkInLine(text.slice(lineStart, len))
}

/**
 * 自动嗅探格式并调用对应解析引擎
 */
export function parseUniversalBookmarks(content: string): {
  format: BookmarkSourceFormat
  folders: ParsedBookmarkFolder[]
  totalItems: number
} {
  const trimmed = content.trim()

  // 1. 尝试 JSON 格式
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      // 如果是 NavHub 标准 DIY Config
      if (parsed.customCategories && Array.isArray(parsed.customCategories)) {
        const folders = parsed.customCategories
          .map((c: any) => ({
            title: String(c.title || '自定义分类'),
            items: (c.items || [])
              .map((i: any) => {
                const href = normalizeBookmarkUrl(String(i.href || ''))
                return {
                  title: String(i.title || href),
                  href,
                  description: i.description ? String(i.description) : undefined,
                }
              })
              .filter((it: { href: string }) => Boolean(it.href)),
          }))
          .filter((f: { items: unknown[] }) => f.items.length > 0)
        const total = folders.reduce((acc: number, f: any) => acc + f.items.length, 0)
        return { format: 'json', folders, totalItems: total }
      }
    } catch {}
  }

  // 2. 检查是否为 Netscape HTML
  if (/<h3|<dl|<dt|<a\s/i.test(trimmed) && (trimmed.includes('DOCTYPE NETSCAPE') || trimmed.includes('<A HREF='))) {
    const folders = parseNetscapeBookmarksHtml(trimmed)
    const total = folders.reduce((acc, f) => acc + f.items.length, 0)
    return { format: 'netscape_html', folders, totalItems: total }
  }

  // 3. 检查是否为 Markdown 格式（含 # 和 [title](url)）
  // 注意：链接探测不用正则 /\[.+?\]\(https?:\/\/.+?\)/——该式对 `[`×n
  // 输入呈平方级回溯（CodeQL #20，100KB 全 `[` 阻塞事件循环约 4 秒）；
  // 改用 hasMarkdownLink 线性扫描（indexOf 递增），语义等价。
  if (/^#{1,4}\s+/m.test(trimmed) || hasMarkdownLink(trimmed)) {
    const folders = parseMarkdownBookmarks(trimmed)
    const total = folders.reduce((acc, f) => acc + f.items.length, 0)
    return { format: 'markdown', folders, totalItems: total }
  }

  // 4. 回退为 OneTab / 纯 URL 文本流
  const folders = parseOneTabExportText(trimmed)
  const total = folders.reduce((acc, f) => acc + f.items.length, 0)
  return { format: 'onetab_text', folders, totalItems: total }
}

// =========================================================================
// 6. 查重与语义清洗合并算法 (Deduplication & Semantic Fusion)
// =========================================================================

export interface DeduplicateResult<T extends { href: string; title: string }> {
  unique: T[]
  duplicates: T[]
  stats: {
    totalIncoming: number
    addedCount: number
    duplicateCount: number
  }
}

/**
 * 书签列表精准与模糊查重算法：
 * 1. 精准比对：规范化 URL（去除 utm 参、小写 host、尾斜杠对齐、去 www. 前缀）
 * 2. 弱匹配比对：若标题与已有站点完全一致且域名相同
 */
export function canonicalBookmarkKey(href: string): string {
  const norm = normalizeBookmarkUrl(href);
  if (!norm) return '';
  try {
    const u = new URL(norm.startsWith('http') ? norm : `https://${norm}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return `${u.protocol}//${host}${u.pathname}${u.search}${u.hash}`;
  } catch { return norm.toLowerCase().replace(/^https?:\/\/(www\.)?/, 'https://'); }
}
export function deduplicateBookmarkItems<
  T extends { href: string; title: string },
  E extends { href: string; title: string } = { href: string; title: string }
>(
  existingItems: E[],
  incomingItems: T[]
): DeduplicateResult<T> {
  const existingUrlSet = new Set<string>()
  const existingTitleDomainSet = new Set<string>()

  for (const item of existingItems) {
    const norm = canonicalBookmarkKey(item.href);
    if (norm) existingUrlSet.add(norm)
    try {
      const u = new URL(norm.startsWith('http') ? norm : `https://${norm}`)
      existingTitleDomainSet.add(`${u.hostname}::${item.title.trim().toLowerCase()}`)
    } catch {}
  }

  const unique: T[] = []
  const duplicates: T[] = []
  const seenInBatch = new Set<string>()

  for (const item of incomingItems) {
    const norm = canonicalBookmarkKey(item.href);
    if (!norm) continue

    let isDuplicate = existingUrlSet.has(norm) || seenInBatch.has(norm)

    if (!isDuplicate) {
      try {
        const u = new URL(norm.startsWith('http') ? norm : `https://${norm}`)
        const titleKey = `${u.hostname}::${item.title.trim().toLowerCase()}`
        if (existingTitleDomainSet.has(titleKey)) {
          isDuplicate = true
        } else {
          existingTitleDomainSet.add(titleKey)
        }
      } catch {}
    }

    if (isDuplicate) {
      duplicates.push(item)
    } else {
      unique.push(item)
      seenInBatch.add(norm)
      existingUrlSet.add(norm)
    }
  }

  return {
    unique,
    duplicates,
    stats: {
      totalIncoming: incomingItems.length,
      addedCount: unique.length,
      duplicateCount: duplicates.length,
    },
  }
}
