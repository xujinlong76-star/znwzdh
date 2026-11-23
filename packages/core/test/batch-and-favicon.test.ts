import { describe, it, expect } from 'vitest'
import {
  fnv1aHash,
  getDeterministicGradient,
  extractFaviconMonogram,
  generateDeterministicSvg,
  generateDeterministicSvgDataUrl,
  resolveSiteIcon,
  isThirdPartyIconUrl,
  sanitizeIconUrl,
  batchSetPinnedSitesInCategory,
  batchMoveSitesBetweenCustomCategories,
  batchDeleteSitesFromCustomCategories,
  batchExportSitesToMarkdown,
  batchExportSitesToOneTab,
  type BatchCategoryHolder,
} from '../src/index'

describe('确定性渐变徽标与自适应 Favicon 生成管线 (Deterministic Favicon Pipeline)', () => {
  it('FNV-1a 哈希：对相同输入保持 100% 确定性，微小变化产生不同哈希', () => {
    const hash1 = fnv1aHash('https://github.com')
    const hash2 = fnv1aHash('https://github.com')
    expect(hash1).toBe(hash2)
    expect(typeof hash1).toBe('number')

    const hash3 = fnv1aHash('https://gitlab.com')
    expect(hash1).not.toBe(hash3)
  })

  it('确定性渐变提取：返回高辨识度双色及合法的 CSS 线性渐变', () => {
    const grad = getDeterministicGradient('https://nextjs.org')
    expect(grad.from).toMatch(/^#[0-9a-f]{6}$/i)
    expect(grad.to).toMatch(/^#[0-9a-f]{6}$/i)
    expect(grad.textColor).toBe('#ffffff')
    expect(grad.cssGradient).toContain('linear-gradient(')
    expect(grad.cssGradient).toContain(grad.from)
    expect(grad.cssGradient).toContain(grad.to)
  })

  it('Monogram 字符提取：智能处理中文、英文、数字与 www 前缀过滤', () => {
    expect(extractFaviconMonogram('GitHub')).toBe('G')
    expect(extractFaviconMonogram('react.dev')).toBe('R')
    expect(extractFaviconMonogram('阿里云计算')).toBe('阿')
    expect(extractFaviconMonogram('✨ Notion 笔记')).toBe('N')
    expect(extractFaviconMonogram('1024 开发者社区')).toBe('1')

    // 标题为空时退避使用 url
    expect(extractFaviconMonogram('', 'https://www.v2ex.com/t/123')).toBe('V')
    expect(extractFaviconMonogram('', 'https://bilibili.com')).toBe('B')
  })

  it('SVG 与 Data URL 渲染：生成合法、现代轻量级的纯矢量 SVG', () => {
    const svg = generateDeterministicSvg('Docker', 'https://hub.docker.com', 48)
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('width="48"')
    expect(svg).toContain('height="48"')
    expect(svg).toContain('<rect')
    expect(svg).toContain('<text')
    expect(svg).toContain('D') // Monogram

    const dataUrl = generateDeterministicSvgDataUrl('Docker', 'https://hub.docker.com', 48)
    expect(dataUrl.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
  })

  it('智能解析站点图标：本地品牌资产 → 标题关键词 → 站点自身 favicon (resolveSiteIcon)', () => {
    // 1. 显式自定义图标优先级最高
    expect(resolveSiteIcon('https://github.com', 'GitHub', 'https://custom.icon/gh.png')).toBe('https://custom.icon/gh.png')

    // 2. 本地高画质 Logo 映射 (ChatGPT, Claude, Vercel, Figma)
    // U-389 分层修法（2026-11-21）：旧值 /assets/images/logos/* 指向仓库内
    // 无落盘的上游 vendor 目录；P1/P2/P3 已迁入 git 跟踪的 brand-icons/，
    // 缺的文件按 served 树字节原样落盘（不只改路径）；文件名按既有品牌
    // 资产改（chatgpt.svg / claude.svg / vercel.png 等）。本项是资产归属
    // 问题，不是运行时 404。
    expect(resolveSiteIcon('https://chatgpt.com', 'ChatGPT')).toBe('/brand-icons/chatgpt.svg')
    expect(resolveSiteIcon('https://claude.ai', 'Claude')).toBe('/brand-icons/claude.svg')
    expect(resolveSiteIcon('https://vercel.com', 'Vercel')).toBe('/brand-icons/vercel.png')
    expect(resolveSiteIcon('https://figma.com', 'Figma')).toBe('/brand-icons/figma.svg')
    expect(resolveSiteIcon('https://fonts.google.com', 'Google Fonts')).toBe('/brand-icons/Materialicons.webp')
    // U-389：core 侧独有的重命名映射（overlay 侧同键早已走 brand-icons 裸文件名）。
    expect(resolveSiteIcon('https://flaticon.com', 'Flaticon')).toBe('/brand-icons/flaticon.png')
    expect(resolveSiteIcon('https://fontawesome.com', 'Font Awesome')).toBe('/brand-icons/font-awesome.svg')
    expect(resolveSiteIcon('https://gemini.google.com', 'Gemini')).toBe('/brand-icons/gemini.svg')
    expect(resolveSiteIcon('https://iconfont.cn', 'Iconfont')).toBe('/brand-icons/iconfont.svg')
    expect(resolveSiteIcon('https://leonardo.ai', 'Leonardo.Ai')).toBe('/brand-icons/leonardo.png')

    // U-389 P2/P3：死键按分层修法迁入 brand-icons/（不删；文件已落盘），
    // 解析值与迁前同名文件一致（只改目录前缀 + P2 指定的两个重命名）。
    expect(resolveSiteIcon('https://chat.openai.com', 'ChatGPT')).toBe('/brand-icons/chatgpt.svg')
    expect(resolveSiteIcon('https://anthropic.com', 'Anthropic')).toBe('/brand-icons/claude.svg')
    expect(resolveSiteIcon('https://framer.com', 'Framer')).toBe('/brand-icons/framer.webp')
    expect(resolveSiteIcon('https://producthunt.com', 'Product Hunt')).toBe('/brand-icons/producthunt.webp')

    // 3. 通用域名直取站点自身 favicon（历史上的 icon.horse CDN 已移除：不再外泄浏览记录）
    expect(resolveSiteIcon('https://github.com/features/copilot', 'GitHub Copilot')).toBe('https://github.com/favicon.ico')
    expect(resolveSiteIcon('https://bilibili.com', '哔哩哔哩')).toBe('https://bilibili.com/favicon.ico')
    expect(resolveSiteIcon('https://taobao.com', '淘宝')).toBe('https://taobao.com/favicon.ico')

    // 4. 显式传入第三方图标服务 (如 icon.horse) 时被拦截阻断，回退到站点自身 favicon.ico
    expect(resolveSiteIcon('https://v2ex.com', 'V2EX', 'https://icon.horse/icon/v2ex.com')).toBe('https://v2ex.com/favicon.ico')

    // 5. 黑名单判定本身可独立复用（存储层写入/快照输出用它净化脏值）
    expect(isThirdPartyIconUrl('https://icon.horse/icon/v2ex.com')).toBe(true)
    expect(isThirdPartyIconUrl('https://cdn.icon.horse/icon/a.com')).toBe(true)
    expect(isThirdPartyIconUrl('https://www.google.com/s2/favicons?domain=x.com')).toBe(true)
    expect(isThirdPartyIconUrl('https://icons.duckduckgo.com/ip3/x.com.ico')).toBe(true)
    expect(isThirdPartyIconUrl('https://github.com/favicon.ico')).toBe(false)
    // U-389（2026-11-21）：相对路径示例随同名引用迁入 brand-icons/，仍为相对路径。
    expect(isThirdPartyIconUrl('/brand-icons/chatgpt.svg')).toBe(false) // 相对路径不误伤

    // 6. 机器生成的 icon URL 净化：第三方服务 -> null（视同没有），其余去空白保留
    expect(sanitizeIconUrl('https://icon.horse/icon/v2ex.com')).toBeNull()
    expect(sanitizeIconUrl('  https://github.com/favicon.ico  ')).toBe('https://github.com/favicon.ico')
    expect(sanitizeIconUrl('')).toBeNull()
    expect(sanitizeIconUrl(null)).toBeNull()
    expect(sanitizeIconUrl(undefined)).toBeNull()
  })
})

describe('多选批量编排纯算法 (Multi-Selection Batch Operations)', () => {
  it('批量设置分类内卡片置顶 (batchSetPinnedSitesInCategory)', () => {
    const initialMap: Record<string, string[]> = {
      cat1: ['site-a'],
    }

    // 1. 批量追加置顶
    const pinned = batchSetPinnedSitesInCategory(initialMap, 'cat1', ['site-b', 'site-c'], 'pin')
    expect(pinned['cat1']).toEqual(['site-a', 'site-b', 'site-c'])

    // 2. 批量取消置顶
    const unpinned = batchSetPinnedSitesInCategory(pinned, 'cat1', ['site-a', 'site-c'], 'unpin')
    expect(unpinned['cat1']).toEqual(['site-b'])

    // 3. 批量切换置顶 (toggle: 当不全置顶时全置顶，全置顶时全取消)
    const toggled1 = batchSetPinnedSitesInCategory(unpinned, 'cat1', ['site-b', 'site-x'], 'toggle')
    expect(toggled1['cat1']).toEqual(['site-b', 'site-x'])

    const toggled2 = batchSetPinnedSitesInCategory(toggled1, 'cat1', ['site-b', 'site-x'], 'toggle')
    expect(toggled2['cat1']).toEqual([])
  })

  it('跨自建分类批量移动卡片 (batchMoveSitesBetweenCustomCategories)', () => {
    const mockCategories: BatchCategoryHolder[] = [
      {
        id: 'cat-src',
        title: '来源分类',
        items: [
          { id: 's1', title: 'Site 1', href: 'https://s1.com' },
          { id: 's2', title: 'Site 2', href: 'https://s2.com' },
          { id: 's3', title: 'Site 3', href: 'https://s3.com' },
        ],
      },
      {
        id: 'cat-target',
        title: '目标分类',
        items: [
          { id: 's4', title: 'Site 4', href: 'https://s4.com' },
        ],
      },
    ]

    const res = batchMoveSitesBetweenCustomCategories(mockCategories, ['s1', 's2'], 'cat-target')
    expect(res.movedCount).toBe(2)

    const src = res.categories.find((c) => c.id === 'cat-src')!
    expect(src.items).toHaveLength(1)
    expect(src.items[0]!.id).toBe('s3')

    const target = res.categories.find((c) => c.id === 'cat-target')!
    expect(target.items).toHaveLength(3)
    expect(target.items.map((i) => i.id)).toEqual(['s4', 's1', 's2'])
  })

  it('批量删除自建分类卡片 (batchDeleteSitesFromCustomCategories)', () => {
    const mockCategories: BatchCategoryHolder[] = [
      {
        id: 'cat1',
        title: '分类 1',
        items: [
          { id: 's1', title: 'Site 1', href: 'https://s1.com' },
          { id: 's2', title: 'Site 2', href: 'https://s2.com' },
        ],
      },
    ]

    const res = batchDeleteSitesFromCustomCategories(mockCategories, ['s1'])
    expect(res.deletedCount).toBe(1)
    expect(res.categories[0]!.items).toHaveLength(1)
    expect(res.categories[0]!.items[0]!.id).toBe('s2')
  })

  it('批量导出为 Markdown 与 OneTab (batchExportSites)', () => {
    const sites = [
      { id: 's1', title: 'Next.js', href: 'https://nextjs.org', description: 'React 生产级框架' },
      { id: 's2', title: 'Vercel', href: 'https://vercel.com' },
    ]

    const md = batchExportSitesToMarkdown(sites, { categoryTitle: '前端工程' })
    expect(md).toContain('# 前端工程')
    expect(md).toContain('- [Next.js](https://nextjs.org) - React 生产级框架')
    expect(md).toContain('- [Vercel](https://vercel.com)')

    const onetab = batchExportSitesToOneTab(sites)
    expect(onetab).toContain('https://nextjs.org | Next.js')
    expect(onetab).toContain('https://vercel.com | Vercel')
  })
})
