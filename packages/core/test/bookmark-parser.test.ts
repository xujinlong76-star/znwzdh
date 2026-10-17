import { describe, it, expect } from 'vitest'
import {
  normalizeBookmarkUrl,
  parseNetscapeBookmarksHtml,
  parseOneTabExportText,
  parseMarkdownBookmarks,
  parseUniversalBookmarks,
  deduplicateBookmarkItems,
} from '../src/bookmark-parser'

describe('全格式书签智能解析与语义去重清洗引擎 (Universal Bookmarks Parser & Deduplication)', () => {
  it('URL 规范化：自动剥离 utm_* 与 spm 等营销追踪参数，规范协议与结尾斜杠', () => {
    const dirtyUrl1 = 'https://Example.com/path/?utm_source=twitter&utm_medium=social&page=1'
    expect(normalizeBookmarkUrl(dirtyUrl1)).toBe('https://example.com/path?page=1')

    const dirtyUrl2 = 'http://GitHub.com/navhub/repo/?spm=123.456&ref=hackernews'
    expect(normalizeBookmarkUrl(dirtyUrl2)).toBe('http://github.com/navhub/repo')

    // 纯根路径保留
    expect(normalizeBookmarkUrl('https://Vercel.com/')).toBe('https://vercel.com/')

    // 严禁非 http/https 协议（防止 Stored XSS 与本地路径泄露）
    expect(normalizeBookmarkUrl('javascript:alert(1)')).toBe('')
    expect(normalizeBookmarkUrl('data:text/html,<script>alert(1)</script>')).toBe('')
    expect(normalizeBookmarkUrl('file:///etc/passwd')).toBe('')
    expect(normalizeBookmarkUrl('vbscript:msgbox(1)')).toBe('')
  })

  it('Netscape Bookmarks HTML：精准解析 Chrome / Edge 导出的层级结构与元数据', () => {
    const mockHtml = `
      <!DOCTYPE NETSCAPE-Bookmark-file-1>
      <TITLE>Bookmarks</TITLE>
      <H1>Bookmarks</H1>
      <DL><p>
        <DT><H3 ADD_DATE="1600000000">前端开发工具</H3>
        <DL><p>
          <DT><A HREF="https://react.dev/?utm_source=chrome" ADD_DATE="1600000100" ICON="data:image/png;base64,abc">React &amp; Next.js 官网</A>
          <DD>现代化组件与应用框架
          <DT><A HREF="https://tailwindcss.com/">Tailwind CSS</A>
        </DL><p>
        <DT><H3>人工智能与算法</H3>
        <DL><p>
          <DT><A HREF="https://claude.ai/">Claude 3.7</A>
        </DL><p>
        <DT><A HREF="https://google.com/">Google Search</A>
      </DL><p>
    `

    const folders = parseNetscapeBookmarksHtml(mockHtml)
    expect(folders.length).toBeGreaterThanOrEqual(2)

    const devFolder = folders.find((f) => f.title === '前端开发工具')
    expect(devFolder).toBeDefined()
    expect(devFolder?.items).toHaveLength(2)

    const reactItem = devFolder?.items[0]
    expect(reactItem?.title).toBe('React & Next.js 官网') // HTML 实体反转义
    expect(reactItem?.href).toBe('https://react.dev/') // utm 参数已被剥离
    expect(reactItem?.description).toBe('现代化组件与应用框架')
    expect(reactItem?.icon).toBe('data:image/png;base64,abc')

    const aiFolder = folders.find((f) => f.title === '人工智能与算法')
    expect(aiFolder?.items).toHaveLength(1)
    expect(aiFolder?.items[0]?.title).toBe('Claude 3.7')
  })

  it('OneTab 文本解析：正确提取 URL | 标题格式与纯 URL 格式', () => {
    const rawOneTab = `
      https://nextjs.org | Next.js 应用框架
      https://vitest.dev/ | 极速单元测试框架
      https://v2ex.com
      # 忽略注释
      invalid string line
    `

    const folders = parseOneTabExportText(rawOneTab, 'OneTab 收藏集')
    expect(folders).toHaveLength(1)
    expect(folders[0].title).toBe('OneTab 收藏集')
    expect(folders[0].items).toHaveLength(3)

    expect(folders[0].items[0].title).toBe('Next.js 应用框架')
    expect(folders[0].items[0].href).toBe('https://nextjs.org/')
    expect(folders[0].items[1].title).toBe('极速单元测试框架')
    expect(folders[0].items[2].title).toBe('https://v2ex.com')
  })

  it('Markdown 格式解析：以标题作为分类名，提取标准链接语法', () => {
    const markdown = `
# 架构与微服务
- [Docker Hub](https://hub.docker.com/?ref=md) - 容器镜像分发平台
- [Kubernetes 文档](https://kubernetes.io/docs/)

## 灵感与设计
- [Dribbble](https://dribbble.com) - 全球设计师作品社区
    `

    const folders = parseMarkdownBookmarks(markdown)
    expect(folders).toHaveLength(2)

    expect(folders[0].title).toBe('架构与微服务')
    expect(folders[0].items).toHaveLength(2)
    expect(folders[0].items[0].title).toBe('Docker Hub')
    expect(folders[0].items[0].href).toBe('https://hub.docker.com/')
    expect(folders[0].items[0].description).toBe('容器镜像分发平台')

    expect(folders[1].title).toBe('灵感与设计')
    expect(folders[1].items[0].title).toBe('Dribbble')
  })

  it('通用格式自动嗅探器 (parseUniversalBookmarks)', () => {
    // 嗅探 HTML
    const htmlResult = parseUniversalBookmarks('<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><A HREF="https://a.com">A</A></DL>')
    expect(htmlResult.format).toBe('netscape_html')
    expect(htmlResult.totalItems).toBe(1)

    // 嗅探 OneTab
    const oneTabResult = parseUniversalBookmarks('https://b.com | B Site\nhttps://c.com')
    expect(oneTabResult.format).toBe('onetab_text')
    expect(oneTabResult.totalItems).toBe(2)

    // 嗅探 Markdown
    const mdResult = parseUniversalBookmarks('# My Category\n- [Test](https://test.com)')
    expect(mdResult.format).toBe('markdown')
    expect(mdResult.totalItems).toBe(1)
  })

  it('精准与弱语义查重清洗 (deduplicateBookmarkItems)', () => {
    const existing = [
      { id: '1', title: 'React 官网', href: 'https://react.dev' },
      { id: '2', title: 'Vue.js', href: 'https://vuejs.org/' },
    ]

    const incoming = [
      { title: 'React 官网新版', href: 'https://react.dev/?utm_source=google' }, // URL 规范化后重复
      { title: 'Vue.js', href: 'https://vuejs.org' }, // 重复
      { title: 'Svelte 框架', href: 'https://svelte.dev' }, // 全新
      { title: 'SolidJS', href: 'https://solidjs.com' }, // 全新
      { title: 'SolidJS 重复项', href: 'https://solidjs.com/' }, // 批次内部自我重复
    ]

    const result = deduplicateBookmarkItems(existing, incoming)

    expect(result.unique).toHaveLength(2)
    expect(result.unique.map((i) => i.title)).toEqual(['Svelte 框架', 'SolidJS'])
    expect(result.duplicates).toHaveLength(3)
    expect(result.stats.addedCount).toBe(2)
    expect(result.stats.duplicateCount).toBe(3)
  })
})
