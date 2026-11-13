/**
 * ⌘K 万能栏：操作 / 极速工具 / 收藏夹的纯匹配层（research P1 #8）。
 *
 * 覆盖核查（review-before-building，2026-11-13）：
 * 搜索面板此前已有站点（五路召回）+ 历史 / 专题建议 + DIY 操作 + 插件
 * + 动作意图卡，但 grep + 通读确认缺三组：① 主题 / 长辈模式 / 添加自定义
 * 站点这类「操作」；② 19 个零 RTT 工具（只有空面板里的 7 枚示例 chips，
 * 其中 `@b64 Hello` 与 `now` 填进输入框后 parseSpeculativeIntent 返回
 * null，是既有死 chips，本文件不碰）；③ 收藏夹只被当作星标状态读，
 * 从未作为结果行出现。本文件补的就是这三组，现有分组一字不动。
 *
 * 19 个工具的口径 —— 不是编出来的数字：`lib/speculative` 的
 * `SpeculativeIntentType` 共 21 个类型；Base64 编 / 解码与 URL 编 / 解码
 * 各是一面（抽屉里也是同一个 tab），合并后恰好 19 个面向用户的工具。
 * 每个工具条目都带 `types`（它覆盖的 speculative 类型）与 `sampleQuery`
 *（填进输入框就能让已有的 SpeculativeIntentCard 立即算出结果的真实例子，
 * 全部来自抽屉默认值 / 空面板 chips / 既有单测）；`toolSampleParses`
 * 用 `parseSpeculativeIntent` 当场验算，类型集合变了测试会先红。
 *
 * 运行模型 —— 不造新执行器：
 *  - 操作：只做匹配与文案，执行留在组件里，复用各开关已有的 handler
 *   （next-themes 的 setTheme、lib/elder-mode 的 setElderMode、
 *    useDensity 的 cycleDensity、AddSiteDialog + addSiteToCustomCategory）。
 *  - 工具：回车即把 `sampleQuery` 填回输入框（面板不关闭），已有的
 *    0-RTT 卡片当场算出结果，用户直接改示例继续算。抽屉的 7 个 tab 是
 *    同一引擎的另一套 UI，不在本文件另起入口。
 *  - 收藏夹：只匹配用户自己的收藏（title / href / 描述 / 标签），
 *    打开走站点行同款的安全闸与记录。
 *
 * 匹配 —— 与现有分组同一套容错（`matchSuggestionText`）：归一化子串
 * 为主，Latin token 再加 Levenshtein 容错。拼音：本仓库没有拼音转换
 * 基础设施（中枢的拼音通道只负责服务端站点召回），本地匹配不做拼音
 * 转写；折中是关键词里给中文名配了罗马化写法（如主题 zhuti），打
 * 拼音也能命中操作与工具。中文收藏标题的拼音不在此列，见测试注释。
 */

import { matchSuggestionText } from './search-suggestions'
import { safeHref } from './safe-url'
import { parseSpeculativeIntent, type SpeculativeIntentType } from './speculative'

/* ------------------------------ 快捷操作 ------------------------------ */

export type PaletteActionId = 'theme' | 'elder' | 'add-site' | 'density'

export interface PaletteActionEntry {
  id: PaletteActionId
  /** 行标题（随当前状态变，如「切换到深色模式」/「关闭长辈模式」） */
  label: string
  /** 一眼能看出的作用：执行后会发生什么 */
  description: string
  /** 匹配用词：中文名 + 常见说法 + 罗马化 + 英文，空格分隔 */
  keywords: string
  /** 快捷键提示（只有真实存在的才写，没有不编） */
  hint?: string
}

export interface PaletteActionOptions {
  /** 当前是不是深色主题（next-themes resolvedTheme === 'dark'） */
  isDark: boolean
  /** 长辈模式当前是否开启 */
  elderOn: boolean
  /** 当前卡片密度短标签（useDensity 的 densityLabel，如「舒适」） */
  densityLabel: string
}

/** 四个操作行（含随状态变的标题 / 描述）。空查询返回全部，供空面板直接展示。 */
export function buildPaletteActions(opts: PaletteActionOptions): PaletteActionEntry[] {
  return [
    {
      id: 'theme',
      label: opts.isDark ? '切换到浅色模式' : '切换到深色模式',
      description: opts.isDark ? '当前深色，点一下回到浅色' : '当前浅色，点一下进入深色',
      keywords: '主题 深色 浅色 切换主题 换肤 夜间模式 zhuti theme dark light',
    },
    {
      id: 'elder',
      label: opts.elderOn ? '关闭长辈模式' : '开启长辈模式',
      description: opts.elderOn
        ? '恢复开启前的字号，期间手动改过的字号会保留'
        : '特大字 + 宽松间距 + 44px 触控目标，关闭后恢复之前的字号',
      keywords: '长辈模式 适老 大字 老人模式 zhangbei elder accessibility',
    },
    {
      id: 'add-site',
      label: '添加自定义站点',
      description: '打开录入弹窗，把网址收录进你的专属分类',
      keywords: '添加 添加站点 添加网址 自定义站点 录入网址 tianjia add site',
    },
    {
      id: 'density',
      label: `切换卡片密度（当前：${opts.densityLabel}）`,
      description: '紧凑 / 舒适 / 宽松三档循环切换，立即生效',
      keywords: '密度 卡片密度 切换密度 紧凑 舒适 宽松 midu density',
    },
  ]
}

/**
 * 操作匹配：与 DIY 操作同一条规矩——空查询返回全部（空面板直接展示），
 * 单字查询不匹配（一个字母什么都说明不了），其余走容错匹配。
 */
export function matchPaletteActions(query: string, opts: PaletteActionOptions): PaletteActionEntry[] {
  const q = query.trim()
  if (!q) return buildPaletteActions(opts)
  if (q.length < 2) return []
  const all = buildPaletteActions(opts)
  return all.filter((action) => matchSuggestionText(q, `${action.label} ${action.description} ${action.keywords}`))
}

/* ------------------------------ 极速工具 ------------------------------ */

export interface PaletteToolEntry {
  /** 稳定 id（`tool-${id}` 进键盘导航） */
  id: string
  label: string
  /** 一眼能看出的作用 + 运行方式（填示例、即时出结果） */
  description: string
  /** 匹配用词：中文名 + 英文名 + 通用词「工具」，空格分隔 */
  keywords: string
  /** 填进输入框的真实例子：parseSpeculativeIntent 它必须返回 types 之一 */
  sampleQuery: string
  /** 该工具覆盖的 speculative 类型（Base64 / URL 各占两个） */
  types: SpeculativeIntentType[]
}

/**
 * 19 个零 RTT 工具 —— 与 `SpeculativeIntentType` 的 21 个类型一一对应
 *（Base64 编/解码、URL 编/解码各并为一个工具）。示例全部取自抽屉默认值、
 * 空面板 chips 或既有单测；`toolSampleParses` 在测试里逐条验算。
 */
export const ZERO_RTT_TOOLS: readonly PaletteToolEntry[] = [
  {
    id: 'math',
    label: '算术计算',
    description: '填入示例算式，即时出结果，可直接改着算',
    keywords: '计算器 算术 数学 计算 math calculator jisuan 工具',
    sampleQuery: '2^10 * 8',
    types: ['math'],
  },
  {
    id: 'json',
    label: 'JSON 格式化',
    description: '填入示例 JSON，即时校验并美化，可直接改着算',
    keywords: 'JSON 格式化 美化 压缩 jsonformat json格式化 json format 工具',
    sampleQuery: '{"name":"znwzdh","a":1}',
    types: ['json_format'],
  },
  {
    id: 'base64',
    label: 'Base64 编解码',
    description: '填入 b64e: 文本编码，或 b64: 密文解码，即时出结果',
    keywords: 'Base64 编解码 编码 解码 base64 base64编解码 工具',
    sampleQuery: 'b64e:Hello',
    types: ['base64_encode', 'base64_decode'],
  },
  {
    id: 'uuid',
    label: 'UUID 解析',
    description: '填入示例 UUID，即时解析版本与变体',
    keywords: 'UUID 唯一标识 解析 uuid 工具',
    sampleQuery: '550e8400-e29b-41d4-a716-446655440000',
    types: ['uuid'],
  },
  {
    id: 'timestamp',
    label: '时间戳转换',
    description: '填入 10 位或 13 位时间戳，即时转可读时间',
    keywords: '时间戳 转换 时间 shijianchuo timestamp time 工具',
    sampleQuery: '1700000000',
    types: ['timestamp'],
  },
  {
    id: 'date-to-ts',
    label: '日期转时间戳',
    description: '填入示例日期，即时转秒级 / 毫秒级时间戳',
    keywords: '日期转时间戳 日期 时间戳 date timestamp 工具',
    sampleQuery: '2026-01-01',
    types: ['date_to_ts'],
  },
  {
    id: 'color',
    label: '颜色速览',
    description: '填入示例色值，即时看 HEX / RGB / HSL 互转',
    keywords: '颜色 色值 取色 color yanse 工具',
    sampleQuery: '#3b82f6',
    types: ['color'],
  },
  {
    id: 'regex',
    label: '正则校验',
    description: '填入示例正则，即时校验语法是否有效',
    keywords: '正则 正则表达式 校验 regex zhengze 工具',
    sampleQuery: '/^[a-z0-9_-]+$/i',
    types: ['regex'],
  },
  {
    id: 'semver',
    label: '版本兼容判定',
    description: '填入示例版本范围，即时判定是否满足',
    keywords: '版本 兼容 语义化版本 semver banben 工具',
    sampleQuery: 'semver: ^1.2.0 vs 1.4.0',
    types: ['semver'],
  },
  {
    id: 'http-status',
    label: 'HTTP 状态码',
    description: '填入示例状态码，即时看含义与排查建议',
    keywords: '状态码 HTTP 418 http status zhuangtaima 工具',
    sampleQuery: '418',
    types: ['http_status'],
  },
  {
    id: 'hash-detect',
    label: '哈希指纹识别',
    description: '填入示例摘要，即时识别是哪种哈希算法',
    keywords: '哈希 指纹 识别 摘要 hash haxi 工具',
    sampleQuery: 'd41d8cd98f00b204e9800998ecf8427e',
    types: ['hash_detect'],
  },
  {
    id: 'hash-calc',
    label: '哈希计算',
    description: '填入 md5: 文本，即时算出摘要（也支持 sha1/sha256/sha512:）',
    keywords: '哈希 计算 摘要 MD5 SHA hash haxi 工具',
    sampleQuery: 'md5:hello',
    types: ['hash_calc'],
  },
  {
    id: 'ip',
    label: 'IP 地址识别',
    description: '填入示例 IP，即时识别公网 / 私网',
    keywords: 'IP 地址 识别 ip 工具',
    sampleQuery: '8.8.8.8',
    types: ['ip_detect'],
  },
  {
    id: 'cidr',
    label: 'CIDR 子网计算',
    description: '填入示例网段，即时算出可用地址范围',
    keywords: 'CIDR 子网 网段 计算 cidr ziwang 工具',
    sampleQuery: '192.168.1.0/24',
    types: ['cidr'],
  },
  {
    id: 'byte-size',
    label: '字节单位换算',
    description: '填入示例容量，即时换算 B / KiB / MiB / GiB',
    keywords: '字节 单位换算 容量 大小 byte size zije 工具',
    sampleQuery: '1.5GB',
    types: ['byte_size'],
  },
  {
    id: 'jwt',
    label: 'JWT 透视',
    description: '填入示例 Token，即时解码 Header / Payload 与过期时间',
    keywords: 'JWT 透视 Token 令牌 jwt 工具',
    sampleQuery:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJuYXZodWItZGV2IiwiaXNzIjoibmF2aHViLmh1YiIsImV4cCI6OTk5OTk5OTk5OX0.signature',
    types: ['jwt'],
  },
  {
    id: 'cron',
    label: 'Cron 推演',
    description: '填入示例表达式，即时推演下次执行时间',
    keywords: 'Cron 定时 表达式 计划任务 cron 工具',
    sampleQuery: '*/5 * * * *',
    types: ['cron'],
  },
  {
    id: 'curl',
    label: 'Curl 转 Fetch',
    description: '填入示例命令，即时生成 Fetch 代码',
    keywords: 'Curl 转 Fetch 请求 代码 curl fetch 工具',
    sampleQuery: 'curl -X POST https://api.navhub.local/v1/search -d "{\\"q\\":\\"ai\\"}"',
    types: ['curl_to_fetch'],
  },
  {
    id: 'url',
    label: 'URL 编解码',
    description: '填入 urle: 文本编码，或 % 编码解码，即时出结果',
    keywords: 'URL 编解码 编码 解码 url url编解码 工具',
    sampleQuery: 'urle:hello world',
    types: ['url_encode', 'url_decode'],
  },
]

/** 该工具的示例是不是真的能算出结果（且类型在它声明的覆盖里）。 */
export function toolSampleParses(tool: PaletteToolEntry): boolean {
  const result = parseSpeculativeIntent(tool.sampleQuery)
  return result !== null && tool.types.includes(result.type)
}

/**
 * 工具匹配：空查询与单字查询不匹配（空面板已有 7 枚示例 chips，19 行
 * 全铺会把面板撑爆；工具靠打字召回）。通用词「工具」命中全部 19 个。
 */
export function matchPaletteTools(query: string): PaletteToolEntry[] {
  const q = query.trim()
  if (!q || q.length < 2) return []
  return ZERO_RTT_TOOLS.filter((tool) =>
    matchSuggestionText(q, `${tool.label} ${tool.description} ${tool.keywords}`),
  )
}

/* ------------------------------ 收藏夹 ------------------------------ */

/** 收藏夹结果行需要的最小形态（LocalFavorite 的结构子集，不依赖 hooks 层） */
export interface PaletteFavoriteLike {
  siteId: string
  title: string
  href: string
  icon?: string
  description?: string
  tags?: string[]
}

export interface PaletteFavoriteItem extends PaletteFavoriteLike {
  /** 导航列表里的稳定 key（`favorite-${siteId}`），渲染与键盘导航共用 */
  key: string
}

export interface MatchPaletteFavoritesOptions {
  /** 每组上限（默认 5 条，面板里收藏只是其中一组，不能挤掉站点） */
  limit?: number
  /** 已在站点结果里出现过的 siteId（同一条不出现两次） */
  excludeSiteIds?: ReadonlySet<string>
}

/**
 * 收藏夹匹配：只在有查询词时召回（空查询的收藏在空面板另有入口）。
 * 匹配面是用户自己的数据——标题 / 网址 / 描述 / 标签；单字查询不匹配。
 * 拼音：中文标题的拼音不在此列（无拼音转换基础设施），标题里的 Latin
 * 词（如 GitHub）走子串 + 容错。
 */
export function matchPaletteFavorites(
  query: string,
  favorites: readonly PaletteFavoriteLike[],
  opts: MatchPaletteFavoritesOptions = {},
): PaletteFavoriteItem[] {
  const q = query.trim()
  if (!q || q.length < 2) return []
  const limit = opts.limit ?? 5
  const out: PaletteFavoriteItem[] = []
  for (const fav of favorites) {
    if (out.length >= limit) break
    if (opts.excludeSiteIds?.has(fav.siteId)) continue
    // 不安全 href（javascript: / data: / 带 userinfo / 含控制字符）直接跳过：
    // 这类收藏进了结果会占一个键盘导航位，渲染行却因安全闸不出现——
    // ↑↓ 走到它上面高亮无处可落、回车也打不开，是死导航位；而且
    // safeHref 默认回落 '#'，组件里的 `if (!href)` 守卫对它永远不触发，
    // 点一下还会往离线记录里写一条 '#' 的假访问。源头过滤，不占 5 条名额。
    if (!safeHref(fav.href, '')) continue
    const haystack = `${fav.title} ${fav.href} ${fav.description ?? ''} ${(fav.tags ?? []).join(' ')}`
    if (!matchSuggestionText(q, haystack)) continue
    out.push({ ...fav, key: `favorite-${fav.siteId}` })
  }
  return out
}

/* --------------------------- 键盘导航顺序 ---------------------------- */

export type PaletteNavKind =
  | 'suggestion'
  | 'diy'
  | 'favorite'
  | 'action'
  | 'tool'
  | 'plugin'
  | 'site'

export interface PaletteNavEntry {
  /** 渲染行 `data-nav-index` 对应的 id（如 `tool-json`） */
  id: string
  kind: PaletteNavKind
}

export interface PaletteNavGroups {
  suggestionIds: string[]
  diyIds: string[]
  favoriteIds: string[]
  actionIds: string[]
  toolIds: string[]
  pluginIds: string[]
  siteIds: string[]
}

/**
 * 键盘可导航项的唯一顺序来源（组件渲染顺序必须与这里一致，否则
 * ↑↓ 会跳到另一行）。新三组插在 DIY 之后、插件之前：DIY 仍置顶，
 * 自己的收藏 / 操作 / 工具排在插件与站点之前。
 */
export function buildPaletteNavItems(groups: PaletteNavGroups): PaletteNavEntry[] {
  const entries: PaletteNavEntry[] = []
  for (const id of groups.suggestionIds) entries.push({ id, kind: 'suggestion' })
  for (const id of groups.diyIds) entries.push({ id, kind: 'diy' })
  for (const id of groups.favoriteIds) entries.push({ id, kind: 'favorite' })
  for (const id of groups.actionIds) entries.push({ id, kind: 'action' })
  for (const id of groups.toolIds) entries.push({ id, kind: 'tool' })
  for (const id of groups.pluginIds) entries.push({ id, kind: 'plugin' })
  for (const id of groups.siteIds) entries.push({ id, kind: 'site' })
  return entries
}
