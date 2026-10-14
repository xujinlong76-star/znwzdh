/**
 * 导航数据导出格式（纯函数，无 DOM 依赖——便于复用与测试）。
 *
 * 此前只有 JSON 导入导出。补两种跨工具可迁移的格式：
 *  - Chrome bookmarks.html：浏览器「导入书签」原生识别的 Netscape 格式
 *  - CSV：表格软件可直接打开，便于盘点与批量编辑
 */

export interface ExportNavItem {
  title: string
  href?: string
  description?: string
}

export interface ExportSubCategory {
  title: string
  items?: ExportNavItem[]
}

export interface ExportCategory {
  title: string
  items?: ExportNavItem[]
  subCategories?: ExportSubCategory[]
}

export interface ExportNavigation {
  navigationItems: ExportCategory[]
}

/** HTML 转义：书签名/描述可能含 `<` `&`，不转义会破坏标签结构甚至注入 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Chrome/Edge/Firefox 通用书签文件（Netscape Bookmark File Format）。
 * 注意 `<!DOCTYPE NETSCAPE-Bookmark-file-1>` 大小写必须原样——
 * 浏览器按字面量识别，改成小写会导入失败。
 */
export function toBookmarksHtml(data: ExportNavigation, now = Date.now()): string {
  const addDate = Math.floor(now / 1000)
  const lines: string[] = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ]

  const writeItems = (items: ExportNavItem[] | undefined, depth: number): void => {
    const pad = '    '.repeat(depth)
    for (const item of items ?? []) {
      if (!item.href) continue
      lines.push(`${pad}<DT><A HREF="${esc(item.href)}" ADD_DATE="${addDate}">${esc(item.title)}</A>`)
      if (item.description) lines.push(`${pad}<DD>${esc(item.description)}`)
    }
  }

  for (const cat of data.navigationItems ?? []) {
    lines.push(`    <DT><H3 ADD_DATE="${addDate}">${esc(cat.title)}</H3>`)
    lines.push('    <DL><p>')
    writeItems(cat.items, 3)
    for (const sub of cat.subCategories ?? []) {
      lines.push(`        <DT><H3 ADD_DATE="${addDate}">${esc(sub.title)}</H3>`)
      lines.push('        <DL><p>')
      writeItems(sub.items, 4)
      lines.push('        </DL><p>')
    }
    lines.push('    </DL><p>')
  }
  lines.push('</DL><p>')
  return lines.join('\n')
}

/**
 * CSV 导出。
 *
 * 两层转义缺一不可：
 *  1. 字段含 `"` `,` 换行 → 用双引号包裹并把 `"` 加倍
 *  2. 以 `= + - @` 开头的字段加前导 `'`——Excel 会把它当公式执行
 *     （CSV 注入是真实攻击面，导航站的站点标题/描述来自用户投稿）
 */
export function toCsv(data: ExportNavigation): string {
  const escCell = (v: unknown): string => {
    let s = v === null || v === undefined ? '' : String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
    return s
  }

  const rows: string[][] = [['分类', '子分类', '标题', '网址', '描述']]
  for (const cat of data.navigationItems ?? []) {
    for (const item of cat.items ?? []) {
      rows.push([cat.title, '', item.title, item.href ?? '', item.description ?? ''])
    }
    for (const sub of cat.subCategories ?? []) {
      for (const item of sub.items ?? []) {
        rows.push([cat.title, sub.title, item.title, item.href ?? '', item.description ?? ''])
      }
    }
  }
  return rows.map((r) => r.map(escCell).join(',')).join('\r\n')
}
