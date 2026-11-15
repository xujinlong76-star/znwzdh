import { describe, it, expect } from 'vitest'
import {
  exportFavoritesToHtml,
  exportFavoritesToMarkdown,
  parseUniversalBookmarks,
  generateBookmarkId,
  sanitizeBookmarkUrl,
} from '../src/lib/favorites-export-import'

describe('Universal Bookmarks Export & Import Engine', () => {
  const sampleFolders = [
    { id: 'f1', name: '开发工具' },
    { id: 'f2', name: '设计灵感' },
  ]

  const sampleFavorites = [
    {
      siteId: 'site-github',
      title: 'GitHub',
      href: 'https://github.com',
      description: '代码托管平台',
      folderId: 'f1',
      tags: ['git', 'code'],
      note: '常用工作平台',
      createdAt: 1700000000000,
    },
    {
      siteId: 'site-figma',
      title: 'Figma',
      href: 'https://figma.com',
      description: '在线协作设计工具',
      folderId: 'f2',
      tags: ['design'],
      createdAt: 1700000001000,
    },
    {
      siteId: 'site-google',
      title: 'Google',
      href: 'https://google.com',
      description: '全球搜索',
      folderId: null,
      createdAt: 1700000002000,
    },
  ]

  describe('HTML Export (Netscape Bookmark Format)', () => {
    it('应包含 Netscape HTML 标准头部与 DOCTYPE', () => {
      const html = exportFavoritesToHtml(sampleFavorites, sampleFolders)
      expect(html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>')
      expect(html).toContain('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">')
      expect(html).toContain('<H1>Bookmarks</H1>')
    })

    it('应按文件夹组织 <H3> 节点并包含链接与描述', () => {
      const html = exportFavoritesToHtml(sampleFavorites, sampleFolders)
      expect(html).toContain('<H3 ADD_DATE=')
      expect(html).toContain('>开发工具</H3>')
      expect(html).toContain('>设计灵感</H3>')
      expect(html).toContain('<A HREF="https://github.com"')
      expect(html).toContain('>GitHub</A>')
      expect(html).toContain('<DD>代码托管平台 | [备注] 常用工作平台')
      expect(html).toContain('TAGS="git,code"')
    })

    it('应包含未分组书签', () => {
      const html = exportFavoritesToHtml(sampleFavorites, sampleFolders)
      expect(html).toContain('<A HREF="https://google.com"')
      expect(html).toContain('>Google</A>')
    })
  })

  describe('Markdown Export', () => {
    it('应生成结构化分级 Markdown', () => {
      const md = exportFavoritesToMarkdown(sampleFavorites, sampleFolders)
      expect(md).toContain('# NavSphere 收藏夹备份与导航清单')
      expect(md).toContain('## 📂 开发工具 (1)')
      expect(md).toContain('- [GitHub](https://github.com) - 代码托管平台 *(备注: 常用工作平台)* [#git #code]')
      expect(md).toContain('## 📂 设计灵感 (1)')
      expect(md).toContain('## 📌 未分组 (1)')
      expect(md).toContain('- [Google](https://google.com) - 全球搜索')
    })
  })

  describe('URL Sanitization', () => {
    it('应剥离跟踪参数并保留有效协议', () => {
      const dirty = 'https://github.com/trending?utm_source=twitter&utm_medium=social&ref=123&foo=bar'
      const clean = sanitizeBookmarkUrl(dirty)
      expect(clean).toBe('https://github.com/trending?foo=bar')
    })

    it('应过滤非 http/https 协议', () => {
      expect(sanitizeBookmarkUrl('javascript:alert(1)')).toBe('')
      expect(sanitizeBookmarkUrl('data:text/html,bad')).toBe('')
    })
  })

  describe('Universal Parser', () => {
    it('应正确解析 Netscape HTML 书签并提取文件夹', () => {
      const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>前端开发</H3>
  <DL><p>
    <DT><A HREF="https://react.dev" TAGS="react,frontend">React 官方文档</A>
    <DT><A HREF="https://vuejs.org">Vue.js</A>
  </DL><p>
  <DT><A HREF="https://developer.mozilla.org">MDN Web Docs</A>
</DL><p>`

      const result = parseUniversalBookmarks(html)
      expect(result.ok).toBe(true)
      expect(result.format).toBe('html')
      expect(result.items.length).toBe(3)
      expect(result.detectedFolders).toContain('前端开发')
      expect(result.items[0].href).toBe('https://react.dev/')
      expect(result.items[0].folderName).toBe('前端开发')
      expect(result.items[0].tags).toEqual(['react', 'frontend'])
    })

    it('应正确解析 Markdown 格式书签并提取分类', () => {
      const md = `# 个人书签
## 📂 人工智能
- [ChatGPT](https://chat.openai.com) - OpenAI 对话助手
- [Claude](https://claude.ai) - Anthropic AI

## 工具
- [Vercel](https://vercel.com) - 云部署
`
      const result = parseUniversalBookmarks(md)
      expect(result.ok).toBe(true)
      expect(result.format).toBe('markdown')
      expect(result.items.length).toBe(3)
      expect(result.detectedFolders).toContain('人工智能')
      expect(result.detectedFolders).toContain('工具')
      expect(result.items[0].title).toBe('ChatGPT')
      expect(result.items[0].description).toBe('OpenAI 对话助手')
      expect(result.items[0].folderName).toBe('人工智能')
    })

    it('应正确解析 OneTab / 纯文本行格式', () => {
      const text = `https://nextjs.org | Next.js by Vercel
https://tailwindcss.com | Tailwind CSS
https://turbopack.org/`

      const result = parseUniversalBookmarks(text)
      expect(result.ok).toBe(true)
      expect(result.format).toBe('onetab')
      expect(result.items.length).toBe(3)
      expect(result.items[0].title).toBe('Next.js by Vercel')
      expect(result.items[0].href).toBe('https://nextjs.org/')
    })

    it('应正确生成确定性 ID', () => {
      const id1 = generateBookmarkId('https://github.com')
      const id2 = generateBookmarkId('https://github.com')
      const id3 = generateBookmarkId('https://google.com')
      expect(id1).toBe(id2)
      expect(id1).not.toBe(id3)
    })

    it('JSON 透传快捷链接字段：合法模板原样保留', () => {
      const json = JSON.stringify({
        version: 1,
        items: [
          {
            siteId: 'site-github',
            title: 'GitHub',
            href: 'https://github.com',
            quickPrefix: '!GH',
            templateUrl: 'https://github.com/search?q={q}',
          },
        ],
      })
      const result = parseUniversalBookmarks(json)
      expect(result.ok).toBe(true)
      expect(result.format).toBe('json')
      expect(result.items[0]).toMatchObject({
        siteId: 'site-github',
        quickPrefix: 'gh',
        templateUrl: 'https://github.com/search?q={q}',
      })
      expect(result.skippedCount).toBe(0)
    })

    it('JSON 里模板非法整条计入 skipped：javascript: / 缺 {q} 都不静默丢模板', () => {
      const json = JSON.stringify({
        version: 1,
        items: [
          { siteId: 'bad-js', title: '坏模板', href: 'https://js.example.com', quickPrefix: 'gh', templateUrl: 'javascript:alert({q})' },
          { siteId: 'bad-noq', title: '缺占位符', href: 'https://noq.example.com', quickPrefix: 'gh', templateUrl: 'https://github.com/search' },
          { siteId: 'good', title: '好模板', href: 'https://good.example.com', quickPrefix: 'gh', templateUrl: 'https://github.com/search?q={q}' },
        ],
      })
      const result = parseUniversalBookmarks(json)
      expect(result.ok).toBe(true)
      expect(result.items.map((i) => i.siteId)).toEqual(['good'])
      expect(result.skippedCount).toBe(2)
    })

    it('HTML / Markdown 导出不写模板字段（JSON 是唯一保真格式）', () => {
      const withQuicklink = [
        {
          siteId: 'site-github',
          title: 'GitHub',
          href: 'https://github.com',
          quickPrefix: 'gh',
          templateUrl: 'https://github.com/search?q={q}',
        },
      ]
      expect(exportFavoritesToHtml(withQuicklink)).not.toContain('{q}')
      expect(exportFavoritesToHtml(withQuicklink)).not.toContain('templateUrl')
      expect(exportFavoritesToMarkdown(withQuicklink)).not.toContain('{q}')
      expect(exportFavoritesToMarkdown(withQuicklink)).not.toContain('templateUrl')
    })

    it('B-3：单文件内同一链接出现两次——被丢的重复条进 droppedDuplicates，不再只剩一个数字', () => {
      const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>工作</H3>
  <DL><p>
    <DT><A HREF="https://dup.example.com/">第一条标题</A>
    <DT><A HREF="https://dup.example.com/">第二条标题</A>
    <DT><A HREF="https://other.example.com/">别的站</A>
  </DL><p>
</DL><p>`
      const result = parseUniversalBookmarks(html)
      expect(result.ok).toBe(true)
      expect(result.items).toHaveLength(2)
      expect(result.droppedDuplicates).toHaveLength(1)
      expect(result.droppedDuplicates![0]).toMatchObject({
        href: 'https://dup.example.com/',
        title: '第二条标题',
        folderName: '工作',
      })
      // 重复条不再计入 skipped：两处数字互不重叠，不双算
      expect(result.skippedCount).toBe(0)
    })

    it('B-3：Markdown / 纯文本的重复条同样进 droppedDuplicates', () => {
      const md = `# 书签
## 阅读
- [站 A](https://dup.example.com/)
- [站 A 换个标题](https://dup.example.com/)
- [站 B](https://b.example.com/)
`
      const mdResult = parseUniversalBookmarks(md)
      expect(mdResult.items).toHaveLength(2)
      expect(mdResult.droppedDuplicates).toHaveLength(1)
      expect(mdResult.droppedDuplicates![0]!.title).toBe('站 A 换个标题')
      expect(mdResult.skippedCount).toBe(0)

      // 纯文本格式 A（URL | 标题）重复：记入 droppedDuplicates，不进 skipped
      const textA = `https://dup.example.com/ | 第一标题
https://dup.example.com/ | 第二标题
https://b.example.com/ | 站 B`
      const textResult = parseUniversalBookmarks(textA)
      expect(textResult.items).toHaveLength(2)
      expect(textResult.droppedDuplicates).toHaveLength(1)
      expect(textResult.droppedDuplicates![0]!.title).toBe('第二标题')
      expect(textResult.skippedCount).toBe(0)

      // 纯文本格式 B（裸 URL）重复：同样进 droppedDuplicates
      const textB = `https://dup.example.com/ 第一标题
https://dup.example.com/ 第二标题`
      const textBResult = parseUniversalBookmarks(textB)
      expect(textBResult.items).toHaveLength(1)
      expect(textBResult.droppedDuplicates).toHaveLength(1)
      expect(textBResult.skippedCount).toBe(0)
    })

    it('B-3：JSON 分支重复条进 droppedDuplicates，标题/文件夹原样保留', () => {
      const json = JSON.stringify({
        version: 1,
        items: [
          { siteId: 'a1', title: '第一条', href: 'https://dup.example.com/', folderName: '工作' },
          { siteId: 'a2', title: '第二条', href: 'https://dup.example.com/', folderName: '阅读' },
          { siteId: 'b1', title: '站 B', href: 'https://b.example.com/' },
        ],
      })
      const result = parseUniversalBookmarks(json)
      expect(result.items).toHaveLength(2)
      expect(result.droppedDuplicates).toHaveLength(1)
      expect(result.droppedDuplicates![0]).toMatchObject({ title: '第二条', folderName: '阅读' })
      expect(result.skippedCount).toBe(0)
    })

    it('非阻塞 #5：JSON 模板非法不占去重槽位——非法条后的同链接有效条目仍能进来', () => {
      const json = JSON.stringify({
        version: 1,
        items: [
          { siteId: 'bad', title: '坏模板', href: 'https://same.example.com/', quickPrefix: 'gh', templateUrl: 'javascript:alert({q})' },
          { siteId: 'good', title: '好条目', href: 'https://same.example.com/' },
        ],
      })
      const result = parseUniversalBookmarks(json)
      expect(result.items.map((i) => i.siteId)).toEqual(['good'])
      expect(result.skippedCount).toBe(1)
      expect(result.droppedDuplicates ?? []).toHaveLength(0)
    })
  })
})
