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
  })
})
