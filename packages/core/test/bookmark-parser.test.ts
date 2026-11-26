import { describe, it, expect } from 'vitest'
import {
  normalizeBookmarkUrl,
  parseNetscapeBookmarksHtml,
  parseOneTabExportText,
  parseMarkdownBookmarks,
  parseUniversalBookmarks,
  deduplicateBookmarkItems,
  stripHtmlTags,
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

  it('解实体只做单遍：双重转义 `&amp;lt;` 不得再解成 `<`（R7 判别项）', () => {
    const mockHtml = `
      <!DOCTYPE NETSCAPE-Bookmark-file-1>
      <DL><p>
        <DT><A HREF="https://example.com/a">A &amp;lt;tag&amp;gt; B</A>
        <DT><A HREF="https://example.com/b">Fish &amp;amp; Chips</A>
        <DT><A HREF="https://example.com/c">Tom &amp; Jerry &amp;nbsp; Spaced</A>
        <DT><A HREF="https://example.com/d">It&#39;s &quot;quoted&quot;</A>
      </DL><p>
    `
    const folders = parseNetscapeBookmarksHtml(mockHtml)
    const items = folders[0]?.items ?? []
    expect(items).toHaveLength(4)
    // 判别项：旧链式 replace 会把 `&amp;lt;` 两次解成 `<`，单遍只解一层
    expect(items[0]?.title).toBe('A &lt;tag&gt; B')
    expect(items[1]?.title).toBe('Fish &amp; Chips')
    expect(items[2]?.title).toBe('Tom & Jerry &nbsp; Spaced')
    // pin 项：单层实体照常解，与旧链行为相同
    expect(items[3]?.title).toBe(`It's "quoted"`)
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

  it('Markdown 嗅探：链接探测是线性的，100KB 全 `[` 不阻塞（CodeQL #20）', () => {
    const input = '['.repeat(100000)
    const t0 = Date.now()
    const result = parseUniversalBookmarks(input)
    const elapsed = Date.now() - t0
    expect(result.format).toBe('onetab_text')
    // 旧正则 /\[.+?\]\(https?:\/\/.+?\)/ 在此输入上约 4 秒；线性实现应远低于此
    expect(elapsed).toBeLessThan(1000)
  })

  it('Markdown 嗅探：链接探测覆盖边界形态（与旧正则等价）', () => {
    const cases: Array<[string, 'markdown' | 'onetab_text']> = [
      ['[Test](https://test.com)', 'markdown'],
      ['- [Test](http://test.com)', 'markdown'],
      ['[a](http://))', 'markdown'], // `)` 可作链接文本
      ['[a[](http://x)', 'markdown'], // 外层 `[` 与后一个 `]` 配对
      ['[](http://x)', 'onetab_text'], // 空文本不是链接
      ['[a](http://)', 'onetab_text'], // URL 部分为空
      ['[a](http://x)', 'markdown'],
      ['[a]\n(http://x)', 'onetab_text'], // 链接不能跨行
      ['https://plain-url.com', 'onetab_text'], // 裸 URL 不是 Markdown 链接
      ['[a](https://x) [b](http://y)', 'markdown'],
    ]
    for (const [input, expected] of cases) {
      expect(parseUniversalBookmarks(input).format).toBe(expected)
    }
  })

  it('Markdown 嗅探：链接探测与旧正则逐字等价（定种子随机语料，CodeQL #20）', () => {
    const oldLinkRe = /\[.+?\]\(https?:\/\/.+?\)/
    // 定种子伪随机，保证可复现；字母表含链接构件与行终止符
    let seed = 0xc0de20
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }
    const alphabet = ['[', ']', '(', ')', 'h', 't', 'p', ':', '/', 's', 'a', ' ', '\n', '\r', 'x']
    for (let i = 0; i < 500; i += 1) {
      const len = 1 + Math.floor(next() * 60)
      let input = ''
      for (let j = 0; j < len; j += 1) input += alphabet[Math.floor(next() * alphabet.length)]
      // 排除会触发 JSON/HTML/标题分支的输入，只比链接探测
      if (input.includes('#') || input.includes('<') || input.startsWith('{')) continue
      const expected = oldLinkRe.test(input) ? 'markdown' : 'onetab_text'
      expect(parseUniversalBookmarks(input).format).toBe(expected)
    }
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

describe('stripHtmlTags（状态机剥标签：书签标题回退路径）', () => {
  it('普通行内标签剥干净', () => {
    expect(stripHtmlTags('<b>bold</b>')).toBe('bold')
    expect(stripHtmlTags('plain text')).toBe('plain text')
    expect(stripHtmlTags('')).toBe('')
  })

  it('引号内的 > 不闭合标签：旧正则会输出 y">kept', () => {
    expect(stripHtmlTags('<a title="x>y">kept</a>')).toBe('kept')
    expect(stripHtmlTags(`<a title='a>b'>kept</a>`)).toBe('kept')
  })

  it('嵌套标签删一次后不留活标签', () => {
    const out = stripHtmlTags('<scr<script>ipt>alert(1)</scr</script>ipt>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<scr')
    expect(out).toContain('alert(1)')
  })

  it('纯文本小于号保留：a < b 不被吞掉', () => {
    expect(stripHtmlTags('a < b > c')).toBe('a < b > c')
  })

  it('未闭合标签丢弃剩余部分', () => {
    expect(stripHtmlTags('hello <b')).toBe('hello')
  })

  it('标题回退路径：嵌套标签标题剥干净不留活标签', () => {
    const html = '<DL><DT><H3>Folder</H3><DL><DT><A HREF="https://example.com">x</A></DT></DL></DL>'
    const parsed = parseNetscapeBookmarksHtml(html)
    expect(parsed.find((f) => f.title === 'Folder')).toBeDefined()
    const nested = '<DL><DT><A HREF="https://example.com"><scr<script>ipt>Title</scr</script>ipt></A></DT></DL>'
    const parsedNested = parseNetscapeBookmarksHtml(nested)
    const titles: string[] = []
    const walk = (folders: ReturnType<typeof parseNetscapeBookmarksHtml>) => {
      for (const f of folders) {
        titles.push(f.title)
        for (const item of f.items) titles.push(item.title)
        if (f.subFolders) walk(f.subFolders)
      }
    }
    walk(parsedNested)
    expect(titles.length).toBeGreaterThan(0)
    for (const t of titles) expect(t).not.toContain('<script')
    expect(titles.some((t) => t.includes('Title'))).toBe(true)
  })
})
