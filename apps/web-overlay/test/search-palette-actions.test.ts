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
  matchPaletteFavorites,
  matchPaletteTools,
  toolSampleParses,
  type PaletteFavoriteLike,
} from '@/lib/palette-actions'
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
  it('空查询返回全部 4 个操作（空面板直接展示，不走匹配）', () => {
    const items = matchPaletteActions('', OPTS)
    expect(items.map((i) => i.id)).toEqual(['theme', 'elder', 'add-site', 'density'])
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

  it('四个操作行都有「执行后会发生什么」的描述，没有空文案', () => {
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

describe('buildPaletteNavItems', () => {
  it('键盘顺序：建议 → DIY → 收藏 → 操作 → 工具 → 插件 → 站点', () => {
    const items = buildPaletteNavItems({
      suggestionIds: ['suggestion-history:react'],
      diyIds: ['diy-edit'],
      favoriteIds: ['favorite-gh'],
      actionIds: ['action-theme'],
      toolIds: ['tool-json'],
      pluginIds: ['plugin-1'],
      siteIds: ['site-2'],
    })
    expect(items.map((i) => i.kind)).toEqual([
      'suggestion',
      'diy',
      'favorite',
      'action',
      'tool',
      'plugin',
      'site',
    ])
    expect(items.map((i) => i.id)).toEqual([
      'suggestion-history:react',
      'diy-edit',
      'favorite-gh',
      'action-theme',
      'tool-json',
      'plugin-1',
      'site-2',
    ])
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
