import { describe, it, expect } from 'vitest'
import {
  detectSocialPlatform,
  parseSocialSaves,
  SOCIAL_PLATFORMS,
  type SocialPlatformId,
} from '../src/lib/social-saves-import'
import { fingerprintUrl } from '../src/lib/import-workbench'

describe('社交收藏本地导入解析器', () => {
  describe('平台判定', () => {
    it('按文件名与内容信号判定平台，拿不准返回 null 而不是猜', () => {
      expect(detectSocialPlatform('window.YTD.tweet.part0 = []', 'tweet.js')).toBe('x')
      expect(detectSocialPlatform('[{"title":"x","string_list_data":[{"href":"https://instagram.com/p/1"}]}]', 'saved_posts.json')).toBe('instagram')
      expect(detectSocialPlatform('<a href="https://news.ycombinator.com/item?id=1">t</a>')).toBe('hackernews')
      expect(detectSocialPlatform('[{"html_url":"https://github.com/a/b","full_name":"a/b"}]')).toBe('github')
      expect(detectSocialPlatform('[{"url":"https://example.com","subreddit":"webdev"}]')).toBe('reddit')
      expect(detectSocialPlatform('just some words')).toBeNull()
    })

    it('六个平台都有中文名、文件夹与取导出文件的方法说明', () => {
      expect(SOCIAL_PLATFORMS.map((p) => p.id).sort()).toEqual(
        ['github', 'hackernews', 'instagram', 'reddit', 'tiktok', 'x'].sort(),
      )
      for (const p of SOCIAL_PLATFORMS) {
        expect(p.label.length).toBeGreaterThan(0)
        expect(p.folder.length).toBeGreaterThan(0)
        expect(p.howTo.length).toBeGreaterThan(0)
      }
    })
  })

  describe('X / Twitter 归档', () => {
    const ytd = `window.YTD.tweet.part0 = [
      {"tweet": {"id_str": "1", "full_text": "好文章 https://example.com/article?utm_source=x", "created_at": "Mon Nov 10 00:00:00 +0000 2025", "entities": {"urls": [{"expanded_url": "https://example.com/article"}], "hashtags": [{"text": "dev"}]}}},
      {"tweet": {"id_str": "2", "full_text": "纯文字，没有链接", "entities": {"urls": [], "hashtags": []}}}
    ]`
    it('解析 entities.urls 的外链，标题去掉链接，标签带上 hashtag', () => {
      const r = parseSocialSaves(ytd, { platform: 'x', filename: 'tweet.js' })
      expect(r.ok).toBe(true)
      expect(r.platform).toBe('x')
      expect(r.format).toBe('ytd-js')
      expect(r.items).toHaveLength(1)
      expect(r.items[0]!.href).toBe('https://example.com/article')
      expect(r.items[0]!.title).toBe('好文章')
      expect(r.items[0]!.folderName).toBe('X / Twitter')
      expect(r.items[0]!.tags).toContain('dev')
    })

    it('纯文字推文不静默丢：进 failures 逐行点名', () => {
      const r = parseSocialSaves(ytd, { platform: 'x', filename: 'tweet.js' })
      expect(r.failures).toHaveLength(1)
      expect(r.failures[0]!.line).toBe(2)
      expect(r.failures[0]!.reason).toContain('没有附带链接')
      expect(r.skippedCount).toBe(1)
    })

    it('like.js 的 expandedUrl 形状也能解析', () => {
      const like = 'window.YTD.like.part0 = [{"like": {"tweetId": "9", "fullText": "点赞的帖子 https://liked.example.com/p", "expandedUrl": "https://liked.example.com/p"}}]'
      const r = parseSocialSaves(like, { platform: 'x', filename: 'like.js' })
      expect(r.ok).toBe(true)
      expect(r.items).toHaveLength(1)
      expect(r.items[0]!.href).toBe('https://liked.example.com/p')
    })

    it('YTD 文件配错平台时报错而不是错解析', () => {
      const r = parseSocialSaves(ytd, { platform: 'reddit', filename: 'tweet.js' })
      expect(r.ok).toBe(false)
      expect(r.error).toContain('X 的归档文件')
    })
  })

  describe('Reddit', () => {
    it('JSON 数组：permalink 补成完整 reddit 链接，subreddit 进标签', () => {
      const r = parseSocialSaves(JSON.stringify([
        { title: 'Cool post', permalink: '/r/webdev/comments/abc/cool/', subreddit: 'webdev' },
        { title: '外链帖', url: 'https://example.com/tool', subreddit: 'selfhosted' },
        { title: '缺链接' },
      ]), { platform: 'reddit' })
      expect(r.ok).toBe(true)
      expect(r.items).toHaveLength(2)
      expect(r.items[0]!.href).toBe('https://www.reddit.com/r/webdev/comments/abc/cool/')
      expect(r.items[0]!.tags).toContain('webdev')
      expect(r.failures).toHaveLength(1)
      expect(r.failures[0]!.reason).toContain('缺少 url')
    })

    it('CSV：表头 url/title/subreddit 列解析，坏行逐行报错', () => {
      const csv = 'url,title,subreddit\nhttps://example.com/a,工具 A,webdev\n,Missing URL,webdev\n'
      const r = parseSocialSaves(csv, { platform: 'reddit' })
      expect(r.ok).toBe(true)
      expect(r.items).toHaveLength(1)
      expect(r.items[0]!.title).toBe('工具 A')
      expect(r.failures).toHaveLength(1)
      expect(r.failures[0]!.line).toBe(3)
    })
  })

  describe('GitHub Stars', () => {
    it('JSON 数组：html_url + full_name + language/topics 进标签', () => {
      const r = parseSocialSaves(JSON.stringify([
        { html_url: 'https://github.com/vercel/next.js', full_name: 'vercel/next.js', description: 'React 框架', language: 'TypeScript', topics: ['react', 'framework'] },
      ]), { platform: 'github' })
      expect(r.ok).toBe(true)
      expect(r.items).toHaveLength(1)
      expect(r.items[0]!.title).toBe('vercel/next.js')
      expect(r.items[0]!.description).toBe('React 框架')
      expect(r.items[0]!.tags).toContain('TypeScript')
      expect(r.items[0]!.tags).toContain('react')
      expect(r.items[0]!.folderName).toBe('GitHub Stars')
    })
  })

  describe('Hacker News', () => {
    it('favorites HTML：外链与 Ask HN 的 item 链接都认，站内导航跳过', () => {
      const html = `<html><body>
        <a href="https://example.com/story">Great story</a>
        <a href="item?id=123">Ask HN: something</a>
        <a href="vote?id=1">upvote</a>
        <a href="user?id=pg">pg</a>
      </body></html>`
      const r = parseSocialSaves(html, { platform: 'hackernews' })
      expect(r.ok).toBe(true)
      expect(r.format).toBe('html')
      expect(r.items).toHaveLength(2)
      expect(r.items[0]!.href).toBe('https://example.com/story')
      expect(r.items[1]!.href).toBe('https://news.ycombinator.com/item?id=123')
    })
  })

  describe('Instagram', () => {
    it('saved_posts.json 的 string_list_data 形状解析', () => {
      const r = parseSocialSaves(JSON.stringify([
        { title: '好看的设计', string_list_data: [{ href: 'https://www.instagram.com/p/ABC123/', timestamp: 1700000000 }] },
        { title: '坏条目', string_list_data: [] },
      ]), { platform: 'instagram' })
      expect(r.ok).toBe(true)
      expect(r.items).toHaveLength(1)
      expect(r.items[0]!.href).toBe('https://www.instagram.com/p/ABC123/')
      expect(r.items[0]!.createdAt).toBe(1700000000000)
      expect(r.failures).toHaveLength(1)
      expect(r.failures[0]!.reason).toContain('string_list_data')
    })
  })

  describe('TikTok（只支持通用格式）', () => {
    it('通用 JSON 数组 / 纯链接文本可以导入', () => {
      const r = parseSocialSaves(JSON.stringify([
        { url: 'https://www.tiktok.com/@someone/video/123', title: '好玩的视频' },
      ]), { platform: 'tiktok' })
      expect(r.ok).toBe(true)
      expect(r.items[0]!.href).toContain('tiktok.com')
      const text = parseSocialSaves('https://www.tiktok.com/@a/video/1 标题\nnot a link\n', { platform: 'tiktok' })
      expect(text.ok).toBe(true)
      expect(text.items).toHaveLength(1)
      expect(text.failures).toHaveLength(1)
      expect(text.failures[0]!.reason).toContain('没有可识别的')
    })

    it('结构化导出（无 url 字段的对象）不编造解析：逐行失败并报错', () => {
      const r = parseSocialSaves(JSON.stringify([
        { videoId: '123', author: 'someone', caption: 'hello' },
      ]), { platform: 'tiktok' })
      expect(r.ok).toBe(false)
      expect(r.items).toHaveLength(0)
      expect(r.failures[0]!.reason).toContain('缺少 url 字段')
    })
  })

  describe('去重与通用行为', () => {
    it('批内重复按 fingerprintUrl 去重：www/尾斜杠/追踪参数视为同一条，进 droppedDuplicates', () => {
      const r = parseSocialSaves(JSON.stringify([
        { url: 'https://example.com/a', title: 'A' },
        { url: 'https://www.example.com/a/?utm_source=tiktok', title: 'A again' },
        { url: 'https://example.com/b', title: 'B' },
      ]), { platform: 'reddit' })
      expect(r.items).toHaveLength(2)
      expect(r.droppedDuplicates).toHaveLength(1)
      expect(fingerprintUrl(r.items[0]!.href)).toBe(fingerprintUrl('https://www.example.com/a/'))
    })

    it('平台无法判定且未手动选时报错，不猜平台', () => {
      const r = parseSocialSaves('hello world', { platform: 'auto' })
      expect(r.ok).toBe(false)
      expect(r.error).toContain('无法识别平台')
    })

    it('空内容报错', () => {
      const r = parseSocialSaves('   ', { platform: 'github' })
      expect(r.ok).toBe(false)
      expect(r.error).toContain('内容为空')
    })

    it('HTML 只认 Hacker News，其他平台明确拒绝', () => {
      const r = parseSocialSaves('<a href="https://example.com">x</a>', { platform: 'github' })
      expect(r.ok).toBe(false)
      expect(r.error).toContain('只支持 Hacker News')
    })

    it('CSV 双引号转义字段能正确解析', () => {
      const csv = 'url,title\n"https://example.com/a","带,逗号的标题"\n'
      const r = parseSocialSaves(csv, { platform: 'github' })
      expect(r.ok).toBe(true)
      expect(r.items[0]!.title).toBe('带,逗号的标题')
    })
  })

  it('所有平台 id 都是合法的 SocialPlatformId', () => {
    const ids: SocialPlatformId[] = ['x', 'reddit', 'github', 'hackernews', 'instagram', 'tiktok']
    expect(SOCIAL_PLATFORMS.map((p) => p.id).sort()).toEqual(ids.sort())
  })
})
