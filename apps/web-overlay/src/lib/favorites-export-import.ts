/**
 * 收藏夹通用多格式导入导出引擎 (Universal Bookmarks Export/Import Engine)
 *
 * 支持格式：
 * 1. Netscape Bookmark HTML (.html)：Chrome, Edge, Safari, Firefox, Arc, Brave 原生兼容
 * 2. Markdown (.md)：结构化分级 Markdown，适配 Obsidian, Notion, GitHub
 * 3. OneTab / 纯文本链接 (.txt)：URL | 标题
 * 4. 纯净 JSON (.json)：NavSphere 规范格式
 */

export interface ExportFolder {
  id: string
  name: string
}

export interface ExportFavoriteItem {
  siteId: string
  title: string
  href: string
  icon?: string
  description?: string
  note?: string
  tags?: string[]
  folderId?: string | null
  createdAt?: number
}

export interface ParsedUniversalItem {
  siteId: string
  title: string
  href: string
  icon?: string
  description?: string
  note?: string
  tags?: string[]
  folderName?: string
  createdAt?: number
}

export interface ParseResult {
  ok: boolean
  format: 'html' | 'markdown' | 'onetab' | 'json' | 'unknown'
  items: ParsedUniversalItem[]
  detectedFolders: string[]
  skippedCount: number
  error?: string
}

function escapeHtml(str: string): string {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** 生成确定性稳定 short ID */
export function generateBookmarkId(href: string): string {
  let h = 5381
  for (let i = 0; i < href.length; i++) {
    h = ((h << 5) + h + href.charCodeAt(i)) | 0
  }
  return 'bm-' + (h >>> 0).toString(36) + '-' + href.length.toString(36)
}

/** 规范化并清洗 URL：只收 http/https 协议，剥离营销追踪参数 */
export function sanitizeBookmarkUrl(raw: string): string {
  if (!raw || typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''

    // 剔除已知追踪参数
    const tracking = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'spm', 'from', 'ref', 'fbclid', 'gclid']
    for (const key of Array.from(url.searchParams.keys())) {
      if (tracking.includes(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
        url.searchParams.delete(key)
      }
    }
    return url.toString()
  } catch {
    return ''
  }
}

/**
 * 导出为标准的 Netscape Bookmarks HTML 格式
 */
export function exportFavoritesToHtml(
  favorites: ExportFavoriteItem[],
  folders: ExportFolder[] = [],
): string {
  const folderMap = new Map<string, string>()
  for (const f of folders) {
    folderMap.set(f.id, f.name)
  }

  // 按文件夹分组
  const groups = new Map<string, ExportFavoriteItem[]>()
  const uncategorized: ExportFavoriteItem[] = []

  for (const item of favorites) {
    if (!item.href || !/^https?:\/\//i.test(item.href)) continue
    if (item.folderId && folderMap.has(item.folderId)) {
      const folderName = folderMap.get(item.folderId)!
      const list = groups.get(folderName) ?? []
      list.push(item)
      groups.set(folderName, list)
    } else {
      uncategorized.push(item)
    }
  }

  const lines: string[] = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>NavSphere Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ]

  // 输出各个文件夹
  for (const [folderName, items] of groups.entries()) {
    if (items.length === 0) continue
    const nowSec = Math.floor(Date.now() / 1000)
    lines.push(`    <DT><H3 ADD_DATE="${nowSec}" LAST_MODIFIED="${nowSec}">${escapeHtml(folderName)}</H3>`)
    lines.push('    <DL><p>')
    for (const item of items) {
      const addDate = Math.floor((item.createdAt || Date.now()) / 1000)
      const iconAttr = item.icon ? ` ICON="${escapeHtml(item.icon)}"` : ''
      const tagsAttr = item.tags && item.tags.length > 0 ? ` TAGS="${escapeHtml(item.tags.join(','))}"` : ''
      lines.push(`        <DT><A HREF="${escapeHtml(item.href)}" ADD_DATE="${addDate}"${iconAttr}${tagsAttr}>${escapeHtml(item.title || item.href)}</A>`)
      const extraDesc = [item.description, item.note ? `[备注] ${item.note}` : null].filter(Boolean).join(' | ')
      if (extraDesc) {
        lines.push(`        <DD>${escapeHtml(extraDesc)}`)
      }
    }
    lines.push('    </DL><p>')
  }

  // 输出未分组书签
  for (const item of uncategorized) {
    const addDate = Math.floor((item.createdAt || Date.now()) / 1000)
    const iconAttr = item.icon ? ` ICON="${escapeHtml(item.icon)}"` : ''
    const tagsAttr = item.tags && item.tags.length > 0 ? ` TAGS="${escapeHtml(item.tags.join(','))}"` : ''
    lines.push(`    <DT><A HREF="${escapeHtml(item.href)}" ADD_DATE="${addDate}"${iconAttr}${tagsAttr}>${escapeHtml(item.title || item.href)}</A>`)
    const extraDesc = [item.description, item.note ? `[备注] ${item.note}` : null].filter(Boolean).join(' | ')
    if (extraDesc) {
      lines.push(`    <DD>${escapeHtml(extraDesc)}`)
    }
  }

  lines.push('</DL><p>')
  return lines.join('\n')
}

/**
 * 导出为结构化 Markdown 格式
 */
export function exportFavoritesToMarkdown(
  favorites: ExportFavoriteItem[],
  folders: ExportFolder[] = [],
): string {
  const folderMap = new Map<string, string>()
  for (const f of folders) {
    folderMap.set(f.id, f.name)
  }

  const groups = new Map<string, ExportFavoriteItem[]>()
  const uncategorized: ExportFavoriteItem[] = []

  for (const item of favorites) {
    if (!item.href || !/^https?:\/\//i.test(item.href)) continue
    if (item.folderId && folderMap.has(item.folderId)) {
      const folderName = folderMap.get(item.folderId)!
      const list = groups.get(folderName) ?? []
      list.push(item)
      groups.set(folderName, list)
    } else {
      uncategorized.push(item)
    }
  }

  const dateStr = new Date().toISOString().slice(0, 10)
  const lines: string[] = [
    '# NavSphere 收藏夹备份与导航清单',
    '',
    `> 导出日期：${dateStr} | 共收录 ${favorites.length} 个站点`,
    '',
  ]

  for (const [folderName, items] of groups.entries()) {
    if (items.length === 0) continue
    lines.push(`## 📂 ${folderName} (${items.length})`)
    lines.push('')
    for (const item of items) {
      let descPart = ''
      if (item.description) descPart += ` - ${item.description}`
      if (item.note) descPart += ` *(备注: ${item.note})*`
      if (item.tags && item.tags.length > 0) descPart += ` [${item.tags.map((t) => `#${t}`).join(' ')}]`
      lines.push(`- [${item.title || item.href}](${item.href})${descPart}`)
    }
    lines.push('')
  }

  if (uncategorized.length > 0) {
    lines.push(`## 📌 未分组 (${uncategorized.length})`)
    lines.push('')
    for (const item of uncategorized) {
      let descPart = ''
      if (item.description) descPart += ` - ${item.description}`
      if (item.note) descPart += ` *(备注: ${item.note})*`
      if (item.tags && item.tags.length > 0) descPart += ` [${item.tags.map((t) => `#${t}`).join(' ')}]`
      lines.push(`- [${item.title || item.href}](${item.href})${descPart}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * 通用多格式解析：自动检测 Netscape HTML, Markdown, OneTab, JSON
 */
export function parseUniversalBookmarks(content: string, limit = 5000): ParseResult {
  const trimmed = content.trim()
  if (!trimmed) {
    return {
      ok: false,
      format: 'unknown',
      items: [],
      detectedFolders: [],
      skippedCount: 0,
      error: '内容为空',
    }
  }

  // 1. 尝试 JSON 格式
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      const rawList: any[] = Array.isArray(parsed) ? parsed : (parsed.items || parsed.favorites || [])
      if (Array.isArray(rawList) && rawList.length > 0) {
        const items: ParsedUniversalItem[] = []
        const folders = new Set<string>()
        let skipped = 0
        const seenUrls = new Set<string>()

        for (const r of rawList) {
          const href = sanitizeBookmarkUrl(r.href || r.url || '')
          if (!href || seenUrls.has(href)) {
            skipped++
            continue
          }
          seenUrls.add(href)
          const title = String(r.title || r.name || href).trim()
          const folderName = r.folderName || r.category || undefined
          if (folderName) folders.add(folderName)

          items.push({
            siteId: r.siteId || generateBookmarkId(href),
            title: title.slice(0, 200),
            href,
            description: r.description ? String(r.description).slice(0, 300) : undefined,
            note: r.note ? String(r.note).slice(0, 200) : undefined,
            tags: Array.isArray(r.tags) ? r.tags.map(String).slice(0, 8) : undefined,
            folderName,
            createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
          })
          if (items.length >= limit) break
        }

        return {
          ok: items.length > 0,
          format: 'json',
          items,
          detectedFolders: Array.from(folders),
          skippedCount: skipped,
        }
      }
    } catch {
      // 不是合规 JSON，继续向下尝试其他格式
    }
  }

  // 2. 尝试 Netscape HTML 格式 (包含 <DT><A HREF= 或 <!DOCTYPE NETSCAPE-Bookmark-file-1>)
  if (/<a\s+[^>]*href=/i.test(trimmed) || /<!DOCTYPE\s+NETSCAPE/i.test(trimmed)) {
    const items: ParsedUniversalItem[] = []
    const folders = new Set<string>()
    const seenUrls = new Set<string>()
    let skipped = 0

    // 分行处理，跟踪当前层级的文件夹 <H3>
    let currentFolder: string | undefined = undefined
    const lines = trimmed.split(/\r?\n/)

    for (const line of lines) {
      // 检查文件夹名 <H3 ...>FolderName</H3>
      const folderMatch = line.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)
      if (folderMatch) {
        const fName = folderMatch[1].replace(/<[^>]+>/g, '').trim()
        if (fName && fName !== 'Bookmarks' && fName !== '书签栏') {
          currentFolder = fName
          folders.add(fName)
        }
      }

      // 提取链接 <A HREF="..." ...>Title</A>
      const aMatches = line.matchAll(/<a\s+([^>]*?)href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/gi)
      for (const m of aMatches) {
        const rawHref = m[2]
        const href = sanitizeBookmarkUrl(rawHref)
        if (!href || seenUrls.has(href)) {
          skipped++
          continue
        }
        seenUrls.add(href)

        const rawTitle = m[4].replace(/<[^>]+>/g, '').trim()
        const title = rawTitle || href

        // 提取 TAGS="..."
        const attrs = (m[1] + ' ' + m[3])
        const tagsMatch = attrs.match(/TAGS="([^"]+)"/i)
        const tags = tagsMatch ? tagsMatch[1].split(',').map((t) => t.trim()).filter(Boolean) : undefined

        items.push({
          siteId: generateBookmarkId(href),
          title: title.slice(0, 200),
          href,
          folderName: currentFolder,
          tags,
          createdAt: Date.now(),
        })

        if (items.length >= limit) break
      }
      if (items.length >= limit) break
    }

    if (items.length > 0) {
      return {
        ok: true,
        format: 'html',
        items,
        detectedFolders: Array.from(folders),
        skippedCount: skipped,
      }
    }
  }

  // 3. 尝试 Markdown 格式 (以 # 标题为分类，- [Title](URL) 为链接)
  if (/\[.*?\]\(https?:\/\/.*?\)/i.test(trimmed) || /^#+\s+/m.test(trimmed)) {
    const items: ParsedUniversalItem[] = []
    const folders = new Set<string>()
    const seenUrls = new Set<string>()
    let currentFolder: string | undefined = undefined
    let skipped = 0

    const lines = trimmed.split(/\r?\n/)
    for (const line of lines) {
      const headerMatch = line.match(/^#{1,3}\s+(?:📂\s*|📌\s*)?([^\n(]+?)(?:\s*\(\d+\))?$/)
      if (headerMatch) {
        const headerTitle = headerMatch[1].trim()
        if (headerTitle && !headerTitle.includes('NavSphere') && !headerTitle.includes('书签')) {
          currentFolder = headerTitle
          folders.add(headerTitle)
        }
        continue
      }

      // 匹配 - [Title](URL) 或 [Title](URL)
      const linkMatch = line.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)(?:\s*-\s*([^\n*[]+))?/i)
      if (linkMatch) {
        const rawHref = linkMatch[2]
        const href = sanitizeBookmarkUrl(rawHref)
        if (!href || seenUrls.has(href)) {
          skipped++
          continue
        }
        seenUrls.add(href)
        const title = linkMatch[1].trim()
        const desc = linkMatch[3] ? linkMatch[3].trim() : undefined

        items.push({
          siteId: generateBookmarkId(href),
          title: title.slice(0, 200),
          href,
          description: desc,
          folderName: currentFolder,
          createdAt: Date.now(),
        })

        if (items.length >= limit) break
      }
    }

    if (items.length > 0) {
      return {
        ok: true,
        format: 'markdown',
        items,
        detectedFolders: Array.from(folders),
        skippedCount: skipped,
      }
    }
  }

  // 4. 尝试 OneTab / 纯文本行格式 (每行: URL | Title 或 URL Title 或单独 URL)
  const items: ParsedUniversalItem[] = []
  const seenUrls = new Set<string>()
  let skipped = 0
  const lines = trimmed.split(/\r?\n/)

  for (const line of lines) {
    const lineTrim = line.trim()
    if (!lineTrim) continue

    // 格式 A: URL | Title
    if (lineTrim.includes('|')) {
      const parts = lineTrim.split('|')
      const first = parts[0].trim()
      const second = parts[1].trim()
      let href = ''
      let title = ''

      if (/^https?:\/\//i.test(first)) {
        href = first
        title = second
      } else if (/^https?:\/\//i.test(second)) {
        href = second
        title = first
      }

      const clean = sanitizeBookmarkUrl(href)
      if (clean && !seenUrls.has(clean)) {
        seenUrls.add(clean)
        items.push({
          siteId: generateBookmarkId(clean),
          title: (title || clean).slice(0, 200),
          href: clean,
          createdAt: Date.now(),
        })
        continue
      }
    }

    // 格式 B: 纯 URL
    const urlMatch = lineTrim.match(/(https?:\/\/[^\s]+)/i)
    if (urlMatch) {
      const clean = sanitizeBookmarkUrl(urlMatch[1])
      if (clean && !seenUrls.has(clean)) {
        seenUrls.add(clean)
        const rest = lineTrim.replace(urlMatch[1], '').trim()
        items.push({
          siteId: generateBookmarkId(clean),
          title: (rest || clean).slice(0, 200),
          href: clean,
          createdAt: Date.now(),
        })
      } else {
        skipped++
      }
    }
  }

  if (items.length > 0) {
    return {
      ok: true,
      format: 'onetab',
      items,
      detectedFolders: [],
      skippedCount: skipped,
    }
  }

  return {
    ok: false,
    format: 'unknown',
    items: [],
    detectedFolders: [],
    skippedCount: 0,
    error: '未能识别出有效的书签或链接，请检查文件格式。',
  }
}

/** 触发浏览器下载指定文本文件 */
export function triggerFileDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
