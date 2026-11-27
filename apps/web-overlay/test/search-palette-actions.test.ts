/**
 * P1 #8：⌘K 万能栏 —— 操作 / 极速工具 / 收藏夹的纯匹配层。
 * 只测 lib/palette-actions.ts 的纯函数；执行（setTheme / setElderMode /
 * cycleDensity / AddSiteDialog 提交）复用各开关与对话框已有的 handler，
 * 不在这里重复测。
 *
 * 工具真实性是本文件的核心契约：19 个工具不是手写的愿望清单，
 * 每个 sampleQuery 都必须经 parseSpeculativeIntent 算出它声明的类型
 *（工具类型集合变了、示例失效了，测试先红）。Base64 / URL 各并了
 * 编解码两面，两面的示例都要验。
 */
import { describe, expect, it } from 'vitest'
import {
  ZERO_RTT_TOOLS,
  buildPaletteActions,
  buildPaletteNavItems,
  matchPaletteActions,
  matchPaletteCustomLinks,
  matchPaletteFavorites,
  matchPaletteQuicklinks,
  matchPaletteTools,
  toolSampleParses,
  type PaletteCustomLinkLike,
  type PaletteFavoriteLike,
} from '@/lib/palette-actions'
import { quicklinkFromFavorite, type QuicklinkEntry } from '@/lib/quicklinks'
import { parseSpeculativeIntent } from '@/lib/speculative'

const OPTS = { isDark: false, elderOn: false, densityLabel: '舒适' }

const FAVORITES: PaletteFavoriteLike[] = [
  { siteId: 'gh', title: 'GitHub', href: 'https://github.com', description: '代码托管', tags: ['开发'] },
  { siteId: 'mdn', title: 'MDN Web Docs', href: 'https://developer.mozilla.org', description: 'Web 开发文档' },
  { siteId: 'zhihu', title: '知乎', href: 'https://www.zhihu.com', description: '中文问答社区' },
  { siteId: 'bili', title: '哔哩哔哩', href: 'https://www.bilibili.com', tags: ['视频'] },
  { siteId: 'ruanyifeng', title: '阮一峰的网络日志', href: 'https://www.ruanyifeng.com/blog/', description: '科技随笔' },
  { siteId: 'x6', title: '多余的第六条', href: 'https://example.com/6' },
  { siteId: 'x7', title: '多余的第七条', href: 'https://example.com/7' },
]

describe('matchPaletteActions', () => {
  it('空查询返回全部 6 个操作（空面板直接展示，不走匹配）', () => {
    const items = matchPaletteActions('', OPTS)
    expect(items.map((i) => i.id)).toEqual(['theme', 'elder', 'add-site', 'density', 'personal-export', 'personal-clear'])
  })

  it('「导出」「清除」命中「我的常用」本地数据操作（2026-11-20 W9）', () => {
    expect(matchPaletteActions('导出', OPTS).map((i) => i.id)).toEqual(['personal-export'])
    expect(matchPaletteActions('清除', OPTS).map((i) => i.id)).toEqual(['personal-clear'])
    expect(matchPaletteActions('daochu', OPTS).map((i) => i.id)).toEqual(['personal-export'])
  })

  it('单字查询不匹配', () => {
    expect(matchPaletteActions('切', OPTS)).toEqual([])
    expect(matchPaletteActions('t', OPTS)).toEqual([])
  })

  it('「主题」「切换主题」命中主题切换，标题随当前主题变', () => {
    const light = matchPaletteActions('切换主题', OPTS)
    expect(light.map((i) => i.id)).toEqual(['theme'])
    expect(light[0]!.label).toBe('切换到深色模式')
    const dark = matchPaletteActions('主题', { ...OPTS, isDark: true })
    expect(dark[0]!.label).toBe('切换到浅色模式')
    expect(dark[0]!.description).toContain('深色')
  })

  it('长辈模式标题随开关状态变，描述说清后果', () => {
    expect(matchPaletteActions('长辈模式', OPTS)[0]!.label).toBe('开启长辈模式')
    expect(matchPaletteActions('长辈模式', { ...OPTS, elderOn: true })[0]!.label).toBe('关闭长辈模式')
    expect(matchPaletteActions('长辈模式', OPTS)[0]!.description).toContain('特大字')
  })

  it('「添加」只命中添加自定义站点；密度行标题带当前档位', () => {
    expect(matchPaletteActions('添加', OPTS).map((i) => i.id)).toEqual(['add-site'])
    const density = matchPaletteActions('密度', OPTS)
    expect(density.map((i) => i.id)).toEqual(['density'])
    expect(density[0]!.label).toContain('舒适')
    expect(density[0]!.description).toContain('三档循环切换')
  })

  it('拼音能命中操作（zhuti / zhangbei），无拼音转换基础设施下的折中', () => {
    expect(matchPaletteActions('zhuti', OPTS).map((i) => i.id)).toEqual(['theme'])
    expect(matchPaletteActions('zhangbei', OPTS).map((i) => i.id)).toEqual(['elder'])
  })

  it('无关查询不命中', () => {
    expect(matchPaletteActions('github', OPTS)).toEqual([])
    expect(matchPaletteActions('天气预报', OPTS)).toEqual([])
  })

  it('六个操作行都有「执行后会发生什么」的描述，没有空文案', () => {
    for (const action of buildPaletteActions(OPTS)) {
      expect(action.label.trim().length).toBeGreaterThan(0)
      expect(action.description.trim().length).toBeGreaterThan(0)
      expect(action.keywords.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('ZERO_RTT_TOOLS', () => {
  it('恰好 19 个工具，id 与标题都不重复', () => {
    expect(ZERO_RTT_TOOLS).toHaveLength(19)
    expect(new Set(ZERO_RTT_TOOLS.map((t) => t.id)).size).toBe(19)
    expect(new Set(ZERO_RTT_TOOLS.map((t) => t.label)).size).toBe(19)
  })

  it('19 个工具覆盖 speculative 的全部 21 个类型，不多不少不重复', () => {
    const covered = ZERO_RTT_TOOLS.flatMap((t) => t.types)
    expect(covered).toHaveLength(21)
    expect(new Set(covered).size).toBe(21)
    // 类型集合是口径本身：Base64 / URL 各占两面，其余一面
    const byId = new Map(ZERO_RTT_TOOLS.map((t) => [t.id, t.types] as const))
    expect(byId.get('base64')).toEqual(['base64_encode', 'base64_decode'])
    expect(byId.get('url')).toEqual(['url_encode', 'url_decode'])
    expect(byId.get('math')).toEqual(['math'])
    expect(byId.get('jwt')).toEqual(['jwt'])
    expect(byId.get('curl')).toEqual(['curl_to_fetch'])
  })

  it('每个工具的示例都能经 0-RTT 引擎算出它声明的类型（不是编的例子）', () => {
    for (const tool of ZERO_RTT_TOOLS) {
      expect(tool.sampleQuery.trim().length).toBeGreaterThan(0)
      expect(toolSampleParses(tool)).toBe(true)
    }
  })

  it('并为一面的两面，另一面示例同样真实', () => {
    expect(parseSpeculativeIntent('b64:SGVsbG8=')?.type).toBe('base64_decode')
    expect(parseSpeculativeIntent('%E4%B8%AD%E6%96%87')?.type).toBe('url_decode')
  })

  it('每个工具都有「执行后会发生什么」的描述', () => {
    for (const tool of ZERO_RTT_TOOLS) {
      expect(tool.description).toContain('填入')
      expect(tool.description).toContain('即时')
    }
  })
})

describe('matchPaletteTools', () => {
  it('空查询与单字查询不匹配（空面板已有示例 chips，不另铺 19 行）', () => {
    expect(matchPaletteTools('')).toEqual([])
    expect(matchPaletteTools('j')).toEqual([])
    expect(matchPaletteTools('工')).toEqual([])
  })

  it('通用词「工具」命中全部 19 个', () => {
    expect(matchPaletteTools('工具')).toHaveLength(19)
  })

  it('英文名命中对应工具，拼写打错一个字母仍命中（容错）', () => {
    expect(matchPaletteTools('json').map((t) => t.id)).toEqual(['json'])
    expect(matchPaletteTools('jso').map((t) => t.id)).toEqual(['json'])
    expect(matchPaletteTools('base64').map((t) => t.id)).toEqual(['base64'])
    expect(matchPaletteTools('cron').map((t) => t.id)).toEqual(['cron'])
  })

  it('中文名命中对应工具，带空格与不带空格都命中', () => {
    expect(matchPaletteTools('JSON 格式化').map((t) => t.id)).toEqual(['json'])
    expect(matchPaletteTools('json格式化').map((t) => t.id)).toEqual(['json'])
    expect(matchPaletteTools('时间戳').map((t) => t.id)).toContain('timestamp')
    expect(matchPaletteTools('哈希').map((t) => t.id)).toEqual(['hash-detect', 'hash-calc'])
  })

  it('无关查询不命中', () => {
    expect(matchPaletteTools('github')).toEqual([])
    expect(matchPaletteTools('天气预报')).toEqual([])
  })
})

describe('matchPaletteFavorites', () => {
  it('空查询与单字查询不匹配（空面板的收藏另有入口）', () => {
    expect(matchPaletteFavorites('', FAVORITES)).toEqual([])
    expect(matchPaletteFavorites('g', FAVORITES)).toEqual([])
  })

  it('标题 / 网址 / 描述 / 标签都能命中，大小写不敏感', () => {
    expect(matchPaletteFavorites('github', FAVORITES).map((f) => f.siteId)).toEqual(['gh'])
    expect(matchPaletteFavorites('GitHub', FAVORITES).map((f) => f.siteId)).toEqual(['gh'])
    expect(matchPaletteFavorites('代码托管', FAVORITES).map((f) => f.siteId)).toEqual(['gh'])
    expect(matchPaletteFavorites('视频', FAVORITES).map((f) => f.siteId)).toEqual(['bili'])
    expect(matchPaletteFavorites('bilibili.com', FAVORITES).map((f) => f.siteId)).toEqual(['bili'])
  })

  it('默认每组至多 5 条；已在站点结果里出现的不重复出现', () => {
    const all = matchPaletteFavorites('https', FAVORITES)
    expect(all).toHaveLength(5)
    expect(all.map((f) => f.key)).toEqual([
      'favorite-gh',
      'favorite-mdn',
      'favorite-zhihu',
      'favorite-bili',
      'favorite-ruanyifeng',
    ])
    const deduped = matchPaletteFavorites('https', FAVORITES, {
      excludeSiteIds: new Set(['gh', 'mdn']),
    })
    expect(deduped.map((f) => f.siteId)).toEqual(['zhihu', 'bili', 'ruanyifeng', 'x6', 'x7'])
  })

  it('无关查询不命中', () => {
    expect(matchPaletteFavorites('天气预报', FAVORITES)).toEqual([])
  })

  it('不安全 href 的收藏不出现：不占导航位、不占 5 条名额', () => {
    const dirty: PaletteFavoriteLike[] = [
      { siteId: 'js', title: 'GitHub 镜像', href: 'javascript:alert(1)' },
      { siteId: 'data', title: 'GitHub 存档', href: 'data:text/html,<h1>x</h1>' },
      { siteId: 'phish', title: 'GitHub 登录', href: 'https://github.com@evil.example/' },
      { siteId: 'ctrl', title: 'GitHub 笔记', href: 'https://github.com/\t/evil' },
      ...FAVORITES,
    ]
    // 四条脏数据标题都含 GitHub 却一条都不出现；且没吃掉 5 条名额，
    // 'https' 仍能取满 5 条真收藏（gh/mdn/zhihu/bili/ruanyifeng）。
    expect(matchPaletteFavorites('github', dirty).map((f) => f.siteId)).toEqual(['gh'])
    expect(matchPaletteFavorites('https', dirty)).toHaveLength(5)
    expect(matchPaletteFavorites('https', dirty).map((f) => f.siteId)).toEqual([
      'gh',
      'mdn',
      'zhihu',
      'bili',
      'ruanyifeng',
    ])
  })
})

describe('matchPaletteCustomLinks', () => {
  const CUSTOM_LINKS: PaletteCustomLinkLike[] = [
    { id: 'cl-1', name: '我的博客', url: 'https://blog.example.com' },
    { id: 'cl-2', name: 'GitHub 收藏', url: 'https://github.com/collections' },
    { id: 'cl-3', name: '公司内网', url: 'https://intra.example.corp/home' },
    { id: 'cl-4', name: '周报', url: 'https://docs.example.com/weekly' },
    { id: 'cl-5', name: '日报', url: 'https://docs.example.com/daily' },
    { id: 'cl-6', name: '月报', url: 'https://docs.example.com/monthly' },
    { id: 'cl-7', name: '年报', url: 'https://docs.example.com/yearly' },
    { id: 'cl-8', name: '季报', url: 'https://docs.example.com/quarterly' },
  ]

  it('空查询与单字查询不匹配（空面板「我的常用」区另有全量入口）', () => {
    expect(matchPaletteCustomLinks('', CUSTOM_LINKS)).toEqual([])
    expect(matchPaletteCustomLinks('博', CUSTOM_LINKS)).toEqual([])
  })

  it('名称 / 网址都能命中，大小写不敏感', () => {
    expect(matchPaletteCustomLinks('博客', CUSTOM_LINKS).map((l) => l.id)).toEqual(['cl-1'])
    expect(matchPaletteCustomLinks('github', CUSTOM_LINKS).map((l) => l.id)).toEqual(['cl-2'])
    expect(matchPaletteCustomLinks('GITHUB', CUSTOM_LINKS).map((l) => l.id)).toEqual(['cl-2'])
    expect(matchPaletteCustomLinks('blog.example.com', CUSTOM_LINKS).map((l) => l.id)).toEqual(['cl-1'])
  })

  it('默认每组至多 5 条（先按 §6 总分排、再切，不挤掉站点）', () => {
    const all = matchPaletteCustomLinks('example.com', CUSTOM_LINKS)
    expect(all).toHaveLength(5)
    expect(all.map((l) => l.key)).toEqual([
      'custom-link-cl-1',
      'custom-link-cl-4',
      'custom-link-cl-5',
      'custom-link-cl-6',
      'custom-link-cl-7',
    ])
  })

  it('无关查询不命中', () => {
    expect(matchPaletteCustomLinks('天气预报', CUSTOM_LINKS)).toEqual([])
  })

  it('不安全 href 的链接不出现：不占导航位、不占 5 条名额', () => {
    const dirty: PaletteCustomLinkLike[] = [
      { id: 'js', name: 'GitHub 镜像', url: 'javascript:alert(1)' },
      { id: 'data', name: 'GitHub 存档', url: 'data:text/html,<h1>x</h1>' },
      { id: 'phish', name: 'GitHub 登录', url: 'https://github.com@evil.example/' },
      { id: 'ctrl', name: 'GitHub 笔记', url: 'https://github.com/\t/evil' },
      ...CUSTOM_LINKS,
    ]
    // 四条脏数据标题都含 GitHub 却一条都不出现；且没吃掉 5 条名额，
    // 'https' 仍能取满 5 条真链接。
    expect(matchPaletteCustomLinks('github', dirty).map((l) => l.id)).toEqual(['cl-2'])
    expect(matchPaletteCustomLinks('https', dirty)).toHaveLength(5)
    expect(matchPaletteCustomLinks('https', dirty).map((l) => l.id)).toEqual([
      'cl-1',
      'cl-2',
      'cl-3',
      'cl-4',
      'cl-5',
    ])
  })
})

describe('matchPaletteQuicklinks', () => {
  const GH_ENTRY: QuicklinkEntry = {
    siteId: 'gh',
    title: 'GitHub',
    href: 'https://github.com',
    quickPrefix: 'gh',
    templateUrl: 'https://github.com/search?q={q}',
  }

  it('!gh react 与 gh react 各命中一条，key 与 url 稳定', () => {
    for (const q of ['!gh react', 'gh react']) {
      const items = matchPaletteQuicklinks(q, [GH_ENTRY])
      expect(items).toHaveLength(1)
      expect(items[0]).toEqual({
        key: 'quicklink-gh',
        entry: GH_ENTRY,
        arg: 'react',
        url: 'https://github.com/search?q=react',
      })
    }
  })

  it('!gh 无参命中落地页；裸 gh / 未知前缀 / 拼错前缀不命中', () => {
    expect(matchPaletteQuicklinks('!gh', [GH_ENTRY])[0]?.url).toBe('https://github.com/search?q=')
    expect(matchPaletteQuicklinks('gh', [GH_ENTRY])).toEqual([])
    expect(matchPaletteQuicklinks('!unknown x', [GH_ENTRY])).toEqual([])
    expect(matchPaletteQuicklinks('githb react', [GH_ENTRY])).toEqual([])
  })

  it('模板非法（javascript: 模板）的收藏不进 quicklink 行', () => {
    const evil = quicklinkFromFavorite({
      siteId: 'evil',
      title: 'GitHub 镜像',
      href: 'https://evil.example',
      quickPrefix: 'gh',
      templateUrl: 'javascript:alert({q})',
    })
    expect(evil).toBeNull()
    // 即使调用方直接传了非法 entry，代入失败也不进面板
    const raw: QuicklinkEntry = {
      siteId: 'evil',
      title: 'GitHub 镜像',
      href: 'https://evil.example',
      quickPrefix: 'ev',
      templateUrl: 'javascript:alert({q})',
    }
    expect(matchPaletteQuicklinks('!ev x', [raw])).toEqual([])
  })

  it('命令命中时同一 siteId 不再出现在收藏分组里（去重走 excludeSiteIds）', () => {
    const hit = matchPaletteQuicklinks('!gh react', [GH_ENTRY])
    expect(hit).toHaveLength(1)
    const excluded = new Set([hit[0]!.entry.siteId])
    expect(matchPaletteFavorites('github', FAVORITES, { excludeSiteIds: excluded })).toEqual([])
    expect(matchPaletteFavorites('github', FAVORITES).map((f) => f.siteId)).toEqual(['gh'])
  })
})

describe('buildPaletteNavItems', () => {
  it('键盘顺序：建议 → DIY → 收藏 → 我的链接 → 操作 → 工具 → 插件 → 站点', () => {
    const items = buildPaletteNavItems({
      suggestionIds: ['suggestion-history:react'],
      diyIds: ['diy-edit'],
      favoriteIds: ['favorite-gh'],
      customLinkIds: ['custom-link-cl-1'],
      actionIds: ['action-theme'],
      toolIds: ['tool-json'],
      pluginIds: ['plugin-1'],
      siteIds: ['site-2'],
    })
    expect(items.map((i) => i.kind)).toEqual([
      'suggestion',
      'diy',
      'favorite',
      'customLink',
      'action',
      'tool',
      'plugin',
      'site',
    ])
    expect(items.map((i) => i.id)).toEqual([
      'suggestion-history:react',
      'diy-edit',
      'favorite-gh',
      'custom-link-cl-1',
      'action-theme',
      'tool-json',
      'plugin-1',
      'site-2',
    ])
  })

  it('快捷链接排在建议之后、DIY 之前（命令命中时它是回车第一目标）', () => {
    const items = buildPaletteNavItems({
      suggestionIds: ['suggestion-history:react'],
      quicklinkIds: ['quicklink-gh'],
      diyIds: ['diy-edit'],
      favoriteIds: ['favorite-gh'],
      customLinkIds: ['custom-link-cl-1'],
      actionIds: ['action-theme'],
      toolIds: ['tool-json'],
      pluginIds: ['plugin-1'],
      siteIds: ['site-2'],
    })
    expect(items.map((i) => i.kind)).toEqual([
      'suggestion',
      'quicklink',
      'diy',
      'favorite',
      'customLink',
      'action',
      'tool',
      'plugin',
      'site',
    ])
    expect(items.find((i) => i.kind !== 'suggestion')).toEqual({
      id: 'quicklink-gh',
      kind: 'quicklink',
    })
  })

  it('无高亮回车默认打开第一条非建议结果：有收藏时是收藏，没有时顺延到操作 / 工具', () => {
    const withFavorite = buildPaletteNavItems({
      suggestionIds: ['suggestion-history:react'],
      diyIds: [],
      favoriteIds: ['favorite-gh'],
      actionIds: ['action-theme'],
      toolIds: ['tool-json'],
      pluginIds: [],
      siteIds: ['site-2'],
    })
    expect(withFavorite.find((i) => i.kind !== 'suggestion')).toEqual({
      id: 'favorite-gh',
      kind: 'favorite',
    })
    const actionsOnly = buildPaletteNavItems({
      suggestionIds: [],
      diyIds: [],
      favoriteIds: [],
      actionIds: ['action-theme'],
      toolIds: ['tool-json'],
      pluginIds: [],
      siteIds: ['site-2'],
    })
    expect(actionsOnly.find((i) => i.kind !== 'suggestion')).toEqual({
      id: 'action-theme',
      kind: 'action',
    })
  })

  it('空分组不产生空位', () => {
    expect(
      buildPaletteNavItems({
        suggestionIds: [],
        diyIds: [],
        favoriteIds: [],
        actionIds: [],
        toolIds: [],
        pluginIds: [],
        siteIds: [],
      }),
    ).toEqual([])
  })
})
