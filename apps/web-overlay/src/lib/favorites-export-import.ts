/**
 * 收藏夹通用多格式导入导出引擎 (Universal Bookmarks Export/Import Engine)
 *
 * 支持格式：
 * 1. Netscape Bookmark HTML (.html)：Chrome, Edge, Safari, Firefox, Arc, Brave 原生兼容
 * 2. Markdown (.md)：结构化分级 Markdown，适配 Obsidian, Notion, GitHub
 * 3. OneTab / 纯文本链接 (.txt)：URL | 标题
 * 4. 纯净 JSON (.json)：NavSphere 规范格式
 *
 * 快捷链接模板只随 JSON 透传：JSON 是唯一保真格式，HTML / Markdown
 * 导出不写模板字段（导入时也不会从它们读出模板）。
 */

import { validateQuicklink } from './quicklinks'
import { fingerprintUrl } from './import-workbench'
import { stripHtmlTags } from './html-text'

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
  /** 快捷链接前缀（归一后小写、不含 `!`）；JSON 导出/导入透传，HTML/Markdown 不写 */
  quickPrefix?: string
  /** 快捷链接模板（含恰好一个 `{q}`）；JSON 透传，HTML/Markdown 不写 */
  templateUrl?: string
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
  quickPrefix?: string
  templateUrl?: string
}

export interface ParseResult {
  ok: boolean
  format: 'html' | 'markdown' | 'onetab' | 'json' | 'unknown'
  items: ParsedUniversalItem[]
  detectedFolders: string[]
  /**
   * 解析跳过的无效条数（无法归一化 / 非 http(s) / 模板非法）。
   * 批内重复不计在这里——被丢的重复条目进 `droppedDuplicates`，
   * 两处数字互不重叠（“批内重复丢弃 N 条”与“解析跳过 N 条”不再双算同一条）。
   */
  skippedCount: number
  /**
   * 解析层按指纹丢掉的批内重复条目（标题/文件夹原样保留）。
   * 它们不进 `items`，但去重报告要拿它们判 `intra-file-dup`：
   * 单文件内同一链接出现两次时，报告里可见、可逐条改判，而不是只剩
   * 一个“解析跳过 N 条”数字。
   */
  droppedDuplicates?: ParsedUniversalItem[]
  error?: string
  /** 达到 limit 被截断时为 true（与 limit 对齐的 5000 条上限） */
  truncated?: boolean
  /** 候选链接的真实命中总数（超限文案用）；拿不到时不填，不许编数字 */
  totalMatched?: number
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
        // 批内去重键 = fingerprintUrl（SSOT）：sanitize 结果仍保留 hash/
        // 尾斜杠/www 差异，比对会漏判；这里只 import，不另写归一化
        const seenFingerprints = new Set<string>()
        const totalMatched = rawList.length
        let consumed = 0
        // 批内重复不计 skipped：被丢的条目原样留给去重报告判 intra-file-dup
        const droppedDuplicates: ParsedUniversalItem[] = []

        for (const r of rawList) {
          consumed++
          const href = sanitizeBookmarkUrl(r.href || r.url || '')
          const fp = fingerprintUrl(href)
          const title = String(r.title || r.name || href).trim()
          const folderName = r.folderName || r.category || undefined
          if (!href || !fp) {
            skipped++
            continue
          }
          if (seenFingerprints.has(fp)) {
            droppedDuplicates.push({
              siteId: r.siteId || generateBookmarkId(href),
              title: title.slice(0, 200),
              href,
              description: r.description ? String(r.description).slice(0, 300) : undefined,
              note: r.note ? String(r.note).slice(0, 200) : undefined,
              tags: Array.isArray(r.tags) ? r.tags.map(String).slice(0, 8) : undefined,
              folderName,
              createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
            })
            continue
          }
          if (folderName) folders.add(folderName)
          // 快捷链接只随 JSON 透传：模板非法整条计入 skipped（与
          // useFavorites.importJson 同口径），不静默丢模板；
          // 模板绝不走 sanitizeBookmarkUrl——它是搜索模板不是站点地址，
          // sanitize 会把 `{q}` 当脏参数处理。
          const templateUrl = typeof r.templateUrl === 'string' ? r.templateUrl.trim() : ''
          let quickPrefix: string | undefined
          if (templateUrl) {
            const checked = validateQuicklink({
              prefix: typeof r.quickPrefix === 'string' ? r.quickPrefix : '',
              templateUrl,
            })
            if (!checked.ok) {
              skipped++
              continue
            }
            quickPrefix = checked.prefix
          }
          // 模板非法不占去重槽位：上一条非法模板不能把后来的同链接有效条目挤成“重复”
          seenFingerprints.add(fp)

          items.push({
            siteId: r.siteId || generateBookmarkId(href),
            title: title.slice(0, 200),
            href,
            description: r.description ? String(r.description).slice(0, 300) : undefined,
            note: r.note ? String(r.note).slice(0, 200) : undefined,
            tags: Array.isArray(r.tags) ? r.tags.map(String).slice(0, 8) : undefined,
            folderName,
            createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
            quickPrefix,
            templateUrl: templateUrl || undefined,
          })
          if (items.length >= limit) break
        }

        return {
          ok: items.length > 0,
          format: 'json',
          items,
          detectedFolders: Array.from(folders),
          skippedCount: skipped,
          droppedDuplicates,
          truncated: consumed < rawList.length,
          totalMatched,
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
    const seenFingerprints = new Set<string>()
    let skipped = 0
    // 批内重复不计 skipped：被丢的条目原样留给去重报告判 intra-file-dup
    const droppedDuplicates: ParsedUniversalItem[] = []
    // 真实命中总数先数出来：超限文案必须用真数，拿不到就写“可能还有更多”
    const totalMatched = [...trimmed.matchAll(/<a\s+[^>]*href="[^"]+"[^>]*>/gi)].length

    // 分行处理，跟踪当前层级的文件夹 <H3>
    let currentFolder: string | undefined = undefined
    const lines = trimmed.split(/\r?\n/)

    for (const line of lines) {
      // 检查文件夹名 <H3 ...>FolderName</H3>
      const folderMatch = line.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)
      if (folderMatch) {
        const fName = stripHtmlTags(folderMatch[1]).trim()
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
        const fp = fingerprintUrl(href)
        const rawTitle = stripHtmlTags(m[4]).trim()
        const title = rawTitle || href

        // 提取 TAGS="..."
        const attrs = (m[1] + ' ' + m[3])
        const tagsMatch = attrs.match(/TAGS="([^"]+)"/i)
        const tags = tagsMatch ? tagsMatch[1].split(',').map((t) => t.trim()).filter(Boolean) : undefined

        if (!href || !fp) {
          skipped++
          continue
        }
        if (seenFingerprints.has(fp)) {
          droppedDuplicates.push({
            siteId: generateBookmarkId(href),
            title: title.slice(0, 200),
            href,
            folderName: currentFolder,
            tags,
            createdAt: Date.now(),
          })
          continue
        }
        seenFingerprints.add(fp)

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
        droppedDuplicates,
        truncated: items.length >= limit && totalMatched > items.length + skipped + droppedDuplicates.length,
        totalMatched,
      }
    }
  }

  // 3. 尝试 Markdown 格式 (以 # 标题为分类，- [Title](URL) 为链接)
  if (/\[.*?\]\(https?:\/\/.*?\)/i.test(trimmed) || /^#+\s+/m.test(trimmed)) {
    const items: ParsedUniversalItem[] = []
    const folders = new Set<string>()
    const seenFingerprints = new Set<string>()
    let currentFolder: string | undefined = undefined
    let skipped = 0
    // 批内重复不计 skipped：被丢的条目原样留给去重报告判 intra-file-dup
    const droppedDuplicates: ParsedUniversalItem[] = []
    const totalMatched = [...trimmed.matchAll(/\[[^\]]+\]\(https?:\/\/[^\s)]+\)/gi)].length

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
        const fp = fingerprintUrl(href)
        const title = linkMatch[1].trim()
        const desc = linkMatch[3] ? linkMatch[3].trim() : undefined
        if (!href || !fp) {
          skipped++
          continue
        }
        if (seenFingerprints.has(fp)) {
          droppedDuplicates.push({
            siteId: generateBookmarkId(href),
            title: title.slice(0, 200),
            href,
            description: desc,
            folderName: currentFolder,
            createdAt: Date.now(),
          })
          continue
        }
        seenFingerprints.add(fp)

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
        droppedDuplicates,
        truncated: items.length >= limit && totalMatched > items.length + skipped + droppedDuplicates.length,
        totalMatched,
      }
    }
  }

  // 4. 尝试 OneTab / 纯文本行格式 (每行: URL | Title 或 URL Title 或单独 URL)
  const items: ParsedUniversalItem[] = []
  const seenFingerprints = new Set<string>()
  let skipped = 0
  // 批内重复不计 skipped：被丢的条目原样留给去重报告判 intra-file-dup
  const droppedDuplicates: ParsedUniversalItem[] = []
  const totalMatched = [...trimmed.matchAll(/https?:\/\/[^\s|]+/gi)].length
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
      const fp = fingerprintUrl(clean)
      if (clean && fp && !seenFingerprints.has(fp)) {
        seenFingerprints.add(fp)
        items.push({
          siteId: generateBookmarkId(clean),
          title: (title || clean).slice(0, 200),
          href: clean,
          createdAt: Date.now(),
        })
        if (items.length >= limit) break
        continue
      }
      if (!clean || !fp) skipped++
      else {
        // 格式 A 的重复条：记入 droppedDuplicates 后直接下一行——不能再
        // 掉进格式 B，否则同一条会在 skipped 里再被数一次
        droppedDuplicates.push({
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
      const fp = fingerprintUrl(clean)
      if (clean && fp && !seenFingerprints.has(fp)) {
        seenFingerprints.add(fp)
        const rest = lineTrim.replace(urlMatch[1], '').trim()
        items.push({
          siteId: generateBookmarkId(clean),
          title: (rest || clean).slice(0, 200),
          href: clean,
          createdAt: Date.now(),
        })
        if (items.length >= limit) break
      } else if (clean && fp) {
        const rest = lineTrim.replace(urlMatch[1], '').trim()
        droppedDuplicates.push({
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
      droppedDuplicates,
      truncated: items.length >= limit && totalMatched > items.length + skipped + droppedDuplicates.length,
      totalMatched,
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
