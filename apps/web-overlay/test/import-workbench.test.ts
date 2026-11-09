import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isRegistryLeaf } from '../../../packages/core/src/category-registry.ts'
import { parseUniversalBookmarks } from '../src/lib/favorites-export-import'
import {
  CATEGORY_HINTS,
  ROOT_CATEGORY_HINTS,
  applyMode,
  buildPublicIndex,
  buildSampleBookmarks,
  buildStagingItems,
  classifyCategory,
  fingerprintUrl,
  inspectPrivacy,
  normalizeUrl,
  platformShortcut,
  type CategoryNode,
} from '../src/lib/import-workbench'

const SRC = readFileSync(
  fileURLToPath(new URL('../src/lib/import-workbench.ts', import.meta.url)),
  'utf8',
)

const CATEGORIES: CategoryNode[] = [
  { id: 'r-ai', slug: 'ai-tools', title: 'AI 工具', parentId: null },
  { id: 'l-chat', slug: 'chat-assistants', title: '对话助手', parentId: 'r-ai' },
  { id: 'r-dev', slug: 'developer-resources', title: '开发者资源', parentId: null },
  { id: 'l-docs', slug: 'official-docs', title: '官方文档', parentId: 'r-dev' },
  { id: 'r-uncat', slug: 'uncategorized', title: '未分类', parentId: null },
]

describe('URL 规范化与比对指纹', () => {
  it('剥离 utm_* / spm / hash 与末级尾斜杠，但保留业务查询参数', () => {
    expect(normalizeUrl('https://www.example.com/docs/?utm_source=x&spm=a&q=rust#part')).toBe(
      'https://www.example.com/docs?q=rust',
    )
    expect(normalizeUrl('javascript:alert(1)')).toBe('')
    expect(normalizeUrl('not a url')).toBe('')
  })

  it('www / 尾斜杠 / 追踪参数 / 默认端口都收敛到同一指纹', () => {
    const a = fingerprintUrl('https://www.github.com/features/copilot/?utm_source=bookmark')
    const b = fingerprintUrl('https://github.com/features/copilot')
    expect(a).toBe(b)
    expect(a).not.toBe('')
  })

  it('不同路径与不同业务参数不会被误判为同一个站点', () => {
    expect(fingerprintUrl('https://example.com/a')).not.toBe(fingerprintUrl('https://example.com/b'))
    expect(fingerprintUrl('https://example.com/x?q=1')).not.toBe(
      fingerprintUrl('https://example.com/x?q=2'),
    )
  })
})

describe('纯前端隐私脱敏沙箱', () => {
  const privateUrls = [
    'http://localhost:3000/admin',
    'http://127.0.0.1:8080/',
    'http://192.168.1.10/',
    'http://10.0.0.8/',
    'http://router.internal/dashboard',
    'https://console.example.com/dashboard?token=abc',
    'https://example.com/api?api_key=secret',
    'https://example.com/private/session?session=xyz',
    'https://docs.google.com/document/d/123/edit',
    'https://user:pass@example.com/',
    'ftp://example.com/file',
    'https://example.com/wp-admin/',
  ]
  for (const url of privateUrls) {
    it(`拦截 ${url}`, () => {
      const verdict = inspectPrivacy(url)
      expect(verdict.blocked).toBe(true)
      expect(verdict.reason.length).toBeGreaterThan(0)
    })
  }

  it('普通公开站点放行，且不误伤 utm 参数', () => {
    expect(inspectPrivacy('https://www.rust-lang.org/?utm_source=bookmark').blocked).toBe(false)
    expect(inspectPrivacy('https://example.com/blog/post-1').blocked).toBe(false)
  })
})

describe('公共库索引由目录树派生', () => {
  it('递归收集 subCategories / items 下的 href 并去重', () => {
    const nav = {
      navigationItems: [
        {
          title: 'AI 工具',
          subCategories: [
            { title: '对话助手', items: [{ href: 'https://gemini.google.com/' }, { href: 'https://gemini.google.com?utm_source=x' }] },
          ],
        },
        { title: '开发者资源', items: [{ href: 'https://github.com/' }, { href: 'https://github.com/' }] },
      ],
    }
    const index = buildPublicIndex(nav)
    expect(index.siteCount).toBe(4)
    expect(index.categoryCount).toBe(2)
    expect(index.fingerprints).toHaveLength(2)
    expect(index.fingerprints).toContain(fingerprintUrl('https://www.gemini.google.com'))
  })

  it('索引不可用时返回空集合，由 Staging 层显式标记而不是假装去重成功', () => {
    expect(buildPublicIndex(null).fingerprints).toEqual([])
    expect(buildPublicIndex({ navigationItems: [] }).siteCount).toBe(0)
  })
})

describe('启发式归类与置信度', () => {
  it('建议值全部是权威树的可挂叶子，绝不返回一级根', () => {
    const guesses = [
      classifyCategory({ title: 'Claude AI 对话助手', url: 'https://claude.ai', folder: 'AI 工具' }, CATEGORIES),
      classifyCategory({ title: 'MDN 官方文档', url: 'https://developer.mozilla.org', folder: '开发' }, CATEGORIES),
      classifyCategory({ title: '随便一个站', url: 'https://unknown-site.example' }, CATEGORIES),
    ]
    for (const guess of guesses) {
      if (guess.suggestedCategorySlug) {
        expect(isRegistryLeaf(guess.suggestedCategorySlug)).toBe(true)
        expect(guess.rootSlug).not.toBe(guess.suggestedCategorySlug)
      }
    }
    expect(CATEGORY_HINTS.every((h) => isRegistryLeaf(h.slug))).toBe(true)
    expect(new Set(CATEGORY_HINTS.map((h) => h.slug)).size).toBe(CATEGORY_HINTS.length)
  })

  it('文件夹面包屑权重高于标题，命中多个信号时置信度为 high', () => {
    const guess = classifyCategory(
      { title: 'Claude', url: 'https://claude.ai', folder: 'ChatGPT / 大模型 对话机器人' },
      CATEGORIES,
    )
    expect(guess.suggestedCategorySlug).toBe('chat-assistants')
    expect(guess.confidence).toBe('high')
    expect(guess.rootSlug).toBe('ai-tools')
    expect(guess.rootTitle).toBe('AI 工具')
  })

  it('没有任何信号时留空分类（不硬塞一级根），置信度 none', () => {
    const guess = classifyCategory({ title: 'zzz', url: 'https://zzz-unlisted.invalid' }, CATEGORIES)
    expect(guess.suggestedCategorySlug).toBe('')
    expect(guess.confidence).toBe('none')
    expect(guess.rootSlug).toBe('uncategorized')
  })

  it('18+ 一级大类启发式表覆盖权威一级分类', () => {
    expect(Object.keys(ROOT_CATEGORY_HINTS).length).toBeGreaterThanOrEqual(18)
  })
})

describe('Staging：一次解析、双库分流', () => {
  const publicIndex = [fingerprintUrl('https://gemini.google.com/')]
  const parsed = parseUniversalBookmarks(
    [
      '<DT><H3>AI 工具</H3>',
      '<DT><A HREF="https://gemini.google.com/?utm_source=x">Google Gemini</A>',
      '<DT><A HREF="https://nebula-notes.app/">Nebula Notes</A>',
      '<DT><A HREF="http://192.168.1.10/">NAS</A>',
      // 解析器只按字面 URL 去重；www / 追踪参数这类「语义重复」留给指纹层处理
      '<DT><A HREF="https://www.nebula-notes.app/?utm_source=dup">Nebula Notes 重复</A>',
    ].join('\n'),
  )

  it('解析出 4 条并同时产出三种状态', () => {
    expect(parsed.ok).toBe(true)
    const result = buildStagingItems(parsed.items, publicIndex, CATEGORIES)
    // 4 条解析结果里 www + utm 变体被指纹层判为语义重复，落到 3 条 staging
    expect(result.items).toHaveLength(3)
    expect(result.skippedDuplicates).toBe(1)
    expect(result.dedupeUnavailable).toBe(false)
    const statuses = result.items.map((i) => i.status)
    expect(statuses).toContain('ready')
    expect(statuses).toContain('duplicate')
    expect(statuses).toContain('private')
  })

  it('隐私与已收录条目的公共投稿被双重锁死，但仍可进个人收藏', () => {
    const { items } = buildStagingItems(parsed.items, publicIndex, CATEGORIES)
    for (const item of items.filter((i) => i.publicLocked)) {
      expect(item.toPublic).toBe(false)
      expect(item.toPrivate).toBe(true)
      expect(item.privacyReason.length).toBeGreaterThan(0)
    }
    // 即使强行切换成「仅公共库」，锁定项也绝不进投稿集合
    const publicOnly = applyMode(items, 'public')
    expect(publicOnly.filter((i) => i.publicLocked && i.toPublic)).toEqual([])
    expect(publicOnly.every((i) => i.toPrivate === false)).toBe(true)
  })

  it('仅个人收藏模式下全部条目的公共投稿开关关闭', () => {
    const { items } = buildStagingItems(parsed.items, publicIndex, CATEGORIES)
    expect(applyMode(items, 'private').every((i) => !i.toPublic && i.toPrivate)).toBe(true)
  })

  it('索引缺失时标记 dedupeUnavailable，且不把任何条目标成「已收录」', () => {
    const result = buildStagingItems(parsed.items, null, CATEGORIES)
    expect(result.dedupeUnavailable).toBe(true)
    expect(result.items.some((i) => i.status === 'duplicate')).toBe(false)
  })
})

describe('零门槛示例书签', () => {
  it('20 条示例经同一解析器后必定呈现三种状态', () => {
    const known = [
      'https://gemini.google.com/',
      'https://claude.ai',
      'https://www.doubao.com/',
      'https://kimi.moonshot.cn/',
    ]
    const index = known.map(fingerprintUrl)
    const html = buildSampleBookmarks(known, index)
    const parsed = parseUniversalBookmarks(html)
    expect(parsed.ok).toBe(true)
    expect(parsed.items).toHaveLength(20)
    const staged = buildStagingItems(parsed.items, index, CATEGORIES)
    const statuses = new Set(staged.items.map((i) => i.status))
    expect(statuses.has('ready')).toBe(true)
    expect(statuses.has('duplicate')).toBe(true)
    expect(statuses.has('private')).toBe(true)
  })

  it('示例里含带 utm 的链接，用于验证规范化确实生效', () => {
    const html = buildSampleBookmarks(['https://gemini.google.com/'], [fingerprintUrl('https://gemini.google.com/')])
    expect(html).toContain('utm_source=bookmark')
    const parsed = parseUniversalBookmarks(html)
    expect(parsed.items.some((i) => i.href.includes('utm_'))).toBe(false)
  })
})

describe('平台提示与 SSOT 红线', () => {
  it('macOS 与 Windows/Linux 给出不同快捷键', () => {
    expect(platformShortcut('MacIntel').keys).toBe('Cmd + Option + B')
    expect(platformShortcut('Win32').keys).toBe('Ctrl + Shift + O')
  })

  it('纯函数层不硬编码站点数 / 插件数等统计数字', () => {
    expect(SRC).not.toMatch(/\b(4639|4839|77)\b/)
    expect(SRC).toContain('siteCount')
    expect(SRC).toContain('dedupeUnavailable')
    expect(SRC).toContain('publicLocked')
  })
})
