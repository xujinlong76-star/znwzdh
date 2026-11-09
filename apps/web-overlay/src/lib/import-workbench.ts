/**
 * `/import` 智能书签工作台的纯函数层（无 React / 无 DOM 依赖，可在 node 里直接单测）。
 *
 * 这里是「一套解析引擎吃透多种格式」的单一事实源：
 *   parseUniversalBookmarks（收藏夹互操作层）负责语法，
 *   本模块负责语义：URL 规范化 → 隐私脱敏 → 公共库去重 → 启发式归类 → 双库分流。
 *
 * 设计红线：
 * 1. 任何站点数、分类数、状态计数都由入参派生，禁止在本文件写死统计数字；
 * 2. 判定为「隐私/内网」的链接永远不可能进入公共投稿集合（publicLocked）；
 * 3. 解析失败/索引缺失一律显式暴露，绝不用空集合伪装成「去重完成」。
 */

import type { ParsedUniversalItem } from './favorites-export-import'

/* ------------------------------------------------------------------ *
 * 1. URL 规范化                                                        *
 * ------------------------------------------------------------------ */

/** 追踪参数：命中即剥离（大小写不敏感），utm_* 全族通配 */
const TRACKING_EXACT = new Set([
  'spm', 'from', 'ref', 'referrer', 'fbclid', 'gclid', 'gbraid', 'wbraid',
  'msclkid', 'igshid', 'mc_cid', 'mc_eid', 'source', 'share_token',
])

/** 展示/提交用的干净 URL：剥追踪参数、去尾斜杠、去 hash，保留协议与 www */
export function normalizeUrl(raw: string): string {
  if (!raw || typeof raw !== 'string') return ''
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    for (const key of Array.from(url.searchParams.keys())) {
      const lower = key.toLowerCase()
      if (lower.startsWith('utm_') || TRACKING_EXACT.has(lower)) url.searchParams.delete(key)
    }
    url.hash = ''
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '')
    }
    // 根路径的 '/' 由 URL 自动补齐，属于等价形式，指纹层会再抹掉一次
    return url.toString()
  } catch {
    return ''
  }
}

/**
 * 比对指纹：协议无关、忽略 www / 默认端口 / 尾斜杠 / 追踪参数，query 按 key 排序。
 * 公共库索引与导入书签都走这一个函数，避免「一边带 www 一边不带」漏判重复。
 */
export function fingerprintUrl(raw: string): string {
  const clean = normalizeUrl(raw)
  if (!clean) return ''
  try {
    const url = new URL(clean)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const port = url.port && !['80', '443'].includes(url.port) ? `:${url.port}` : ''
    let pathname = url.pathname
    if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.replace(/\/+$/, '')
    const query = Array.from(url.searchParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
    return `${host}${port}${pathname}${query ? `?${query}` : ''}`
  } catch {
    return ''
  }
}

/* ------------------------------------------------------------------ *
 * 2. 本地隐私脱敏沙箱                                                  *
 * ------------------------------------------------------------------ */

export interface PrivacyVerdict {
  blocked: boolean
  /** 面向用户的中文原因，blocked=false 时为空串 */
  reason: string
}

const SENSITIVE_PARAM = /token|secret|auth|session|passwd|password|credential|api[-_]?key|access[-_]?key|signature|jwt|sid/i
const PRIVATE_PATH = /^\/(admin|dashboard|console|private|internal|wp-admin|account|settings|manage|backoffice)(\/|$)/i
const PRIVATE_DOC = /(^|\.)(docs\.google\.com|drive\.google\.com|feishu\.cn|larksuite\.com|yuque\.com|notion\.so|shimo\.im)$/i

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (h === 'localhost' || h === '::1' || h.endsWith('.localhost')) return true
  for (const suffix of ['.internal', '.local', '.lan', '.home.arpa', '.test', '.invalid']) {
    if (h.endsWith(suffix)) return true
  }
  // 单标签主机名（router / nas / gitlab）只存在于内网或 hosts 映射
  if (!h.includes('.') && !h.includes(':')) return true
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    const c = Number(v4[3])
    if (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 203 && b === 0 && c === 113)
    ) return true
  }
  // IPv6 ULA / link-local
  if (/^(fc|fd|fe80)/i.test(h)) return true
  return false
}

/**
 * 纯前端隐私拦截。命中任意一条即锁死「提交公共库」，但允许写入个人收藏。
 * 宁可误拦（用户可手动复核），不可漏放（公共库一旦写入即不可撤回）。
 */
export function inspectPrivacy(raw: string): PrivacyVerdict {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { blocked: true, reason: '无法解析的链接' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { blocked: true, reason: `非网页协议（${url.protocol}）` }
  }
  if (isPrivateHost(url.hostname)) {
    return { blocked: true, reason: '内网 / 本地地址' }
  }
  if (url.username || url.password) {
    return { blocked: true, reason: 'URL 内嵌账号密码' }
  }
  for (const [key] of Array.from(url.searchParams.entries())) {
    if (SENSITIVE_PARAM.test(key)) {
      return { blocked: true, reason: `查询参数疑似鉴权凭证（${key}）` }
    }
  }
  if (SENSITIVE_PARAM.test(url.hash) && /[=:]/.test(url.hash)) {
    return { blocked: true, reason: 'Fragment 内含鉴权凭证' }
  }
  if (PRIVATE_PATH.test(url.pathname)) {
    return { blocked: true, reason: '疑似后台 / 管理页面' }
  }
  if (PRIVATE_DOC.test(url.hostname)) {
    return { blocked: true, reason: '疑似个人协作文档' }
  }
  if (url.port && !['80', '443', ''].includes(url.port) && /\.(com|cn|org|net)$/i.test(url.hostname)) {
    return { blocked: true, reason: `非标准端口（:${url.port}）` }
  }
  return { blocked: false, reason: '' }
}

/* ------------------------------------------------------------------ *
 * 3. 公共导航库索引（服务端生成紧凑指纹数组，避免把 2MB 目录塞进浏览器） *
 * ------------------------------------------------------------------ */

export interface PublicIndex {
  fingerprints: string[]
  /** 目录里实际出现的 href 条数（可能大于去重后的指纹数） */
  siteCount: number
  /** 一级大类数量，纯派生 */
  categoryCount: number
}

interface NavNode {
  href?: unknown
  items?: unknown
  subCategories?: unknown
}

function walkNav(node: unknown, visit: (n: NavNode) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walkNav(child, visit)
    return
  }
  if (!node || typeof node !== 'object') return
  const current = node as NavNode
  visit(current)
  if (current.items) walkNav(current.items, visit)
  if (current.subCategories) walkNav(current.subCategories, visit)
}

/** 从目录树里取前 N 个真实 href，供「加载示例书签」生成已收录状态（不编造数据） */
export function collectHrefs(navigation: unknown, limit = 8): string[] {
  const root = (navigation as { navigationItems?: unknown })?.navigationItems ?? navigation
  const hrefs: string[] = []
  walkNav(root, (node) => {
    if (hrefs.length >= limit) return
    if (typeof node.href === 'string' && /^https?:\/\//i.test(node.href)) hrefs.push(node.href)
  })
  return hrefs
}

/** navigation.json 的形状容忍：数组本身 / { navigationItems } / { items } */
export function buildPublicIndex(navigation: unknown): PublicIndex {
  const fingerprints = new Set<string>()
  let siteCount = 0
  const root = (navigation as { navigationItems?: unknown })?.navigationItems ?? navigation
  let categoryCount = 0
  if (Array.isArray(root)) categoryCount = root.length
  walkNav(root, (node) => {
    if (typeof node.href !== 'string' || !node.href.trim()) return
    siteCount++
    const fp = fingerprintUrl(node.href)
    if (fp) fingerprints.add(fp)
  })
  return { fingerprints: Array.from(fingerprints), siteCount, categoryCount }
}

/* ------------------------------------------------------------------ *
 * 4. 启发式归类（一级大类 + 可挂叶子，置信度分级）                     *
 * ------------------------------------------------------------------ */

export interface CategoryNode {
  id: string
  slug: string
  title: string
  parentId: string | null
  enabled?: boolean
}

export type Confidence = 'high' | 'medium' | 'low' | 'none'

export interface CategoryGuess {
  /** 一级大类 slug，仅用于展示与批量改绑 */
  rootSlug: string
  rootTitle: string
  /** 可挂载的叶子 slug；空串 = 交给「暂不分类」，绝不硬塞一级根 */
  suggestedCategorySlug: string
  confidence: Confidence
}

/**
 * 叶子关键词表：slug 全部来自权威分类树的叶子（由 bookmark-import-guard 测试锁定）。
 * 顺序即优先级，垂类在前、泛词在后。
 */
export const CATEGORY_HINTS: Array<{ slug: string; title: string; icon: string; keywords: string[] }> = [
  { slug: 'chat-assistants', title: '对话助手', icon: '💬', keywords: ['chatgpt', 'gpt', 'claude', 'gemini', 'copilot', 'llm', '大模型', '对话机器人', 'chatbot', '文心', 'kimi', 'deepseek'] },
  { slug: 'ai-image-generation', title: 'AI 图像生成', icon: '🎨', keywords: ['midjourney', 'stable diffusion', 'sdxl', 'dall', '文生图', 'ai 绘画', 'ai 作图'] },
  { slug: 'ai-video-generation', title: 'AI 视频生成', icon: '🎬', keywords: ['sora', 'runway', '可灵', '文生视频', 'ai 视频', '数字人'] },
  { slug: 'ai-writing-office', title: 'AI 写作办公', icon: '✍️', keywords: ['ai 写作', 'AI 文案', '智能写作', '秘塔写作'] },
  { slug: 'ai-search-knowledge', title: 'AI 搜索知识', icon: '🔍', keywords: ['perplexity', 'ai 搜索', '秘塔', '深度研究'] },
  { slug: 'code-hosting', title: '代码托管', icon: '📦', keywords: ['github', 'gitlab', 'gitee', 'bitbucket', '代码托管', '仓库'] },
  { slug: 'official-docs', title: '官方文档', icon: '📖', keywords: ['mdn', 'docs', '文档', '手册', '规范', 'reference', 'spec'] },
  { slug: 'qa-communities', title: '问答社区', icon: '❓', keywords: ['stackoverflow', 'segmentfault', 'csdn', '掘金', 'juejin', '问答', '论坛', '社区'] },
  { slug: 'databases-and-storage', title: '数据库与存储', icon: '🗄️', keywords: ['mysql', 'postgres', 'redis', 'mongo', '数据库', 'sqlite', '对象存储', 's3'] },
  { slug: 'containers-and-orchestration', title: '容器与编排', icon: '🐳', keywords: ['docker', 'kubernetes', 'k8s', '容器', 'helm', '编排'] },
  { slug: 'ci-cd-and-releases', title: '持续交付', icon: '🚀', keywords: ['jenkins', 'actions', '流水线', '持续集成', '部署', 'vercel', 'netlify', 'ci/cd'] },
  { slug: 'observability-and-monitoring', title: '可观测与监控', icon: '📈', keywords: ['grafana', 'prometheus', 'sentry', '监控', '日志', '告警', '可观测', 'tracing'] },
  { slug: 'icons-and-typefaces', title: '图标与字体', icon: '🔤', keywords: ['icon', '图标', '字体', 'font', 'glyph', '插画'] },
  { slug: 'color-palettes', title: '配色与色板', icon: '🌈', keywords: ['color', '配色', '色板', 'palette', '对比度'] },
  { slug: 'stock-media', title: '图片视频素材', icon: '🖼️', keywords: ['unsplash', 'pexels', 'pixabay', '图库', '素材', '免版权', 'stock'] },
  { slug: 'prototyping-and-collab', title: '原型与协作', icon: '📐', keywords: ['figma', 'sketch', '原型', '墨刀', 'framer', 'wireframe', '设计交付'] },
  { slug: 'notes-and-pkb', title: '笔记与知识库', icon: '📝', keywords: ['notion', 'obsidian', 'flomo', '印象笔记', '笔记', '知识库', 'wiki'] },
  { slug: 'collaborative-docs', title: '协作文档', icon: '🤝', keywords: ['腾讯文档', '飞书', '语雀', '石墨', 'google docs', '在线文档', '协作文档'] },
  { slug: 'screenshots-and-pdf', title: '截图与 PDF', icon: '📄', keywords: ['pdf', '截图', 'ocr', '扫描', '录屏', '标注'] },
  { slug: 'cloud-drives-and-transfer', title: '网盘与传输', icon: '☁️', keywords: ['网盘', '云盘', 'dropbox', 'onedrive', '下载', '传输', '种子', '磁力'] },
  { slug: 'online-courses', title: '在线课程', icon: '🎓', keywords: ['coursera', 'udemy', '慕课', 'mooc', '课程', '学堂', 'edx'] },
  { slug: 'digital-libraries', title: '数字图书馆', icon: '📚', keywords: ['图书馆', '电子书', '文献', 'kindle', '微信读书', '图书', 'book'] },
  { slug: 'dictionaries-and-translators', title: '词典与翻译', icon: '🌐', keywords: ['翻译', 'translate', 'deepl', '词典', 'dict', '术语'] },
  { slug: 'language-learning', title: '语言学习', icon: '🗣️', keywords: ['多邻国', 'duolingo', '背单词', '外语', '雅思', '托福', 'ielts', 'toefl'] },
  { slug: 'music', title: '音乐', icon: '🎵', keywords: ['音乐', 'music', 'spotify', '网易云', 'qq音乐', '歌词'] },
  { slug: 'anime-and-fandom', title: '动漫与二次元', icon: '📺', keywords: ['动漫', '漫画', '二次元', '番剧', 'anime', 'bilibili', 'b站'] },
  { slug: 'long-video', title: '长视频', icon: '🎞️', keywords: ['电影', '电视剧', 'youtube', '优酷', '爱奇艺', '腾讯视频', 'netflix', '视频'] },
  { slug: 'podcast-and-audiobooks', title: '播客与有声书', icon: '🎧', keywords: ['播客', 'podcast', '有声书', '听书', '小宇宙'] },
  { slug: 'game-platforms', title: '游戏平台', icon: '🎮', keywords: ['steam', 'epic', '游戏', 'game', '攻略'] },
  { slug: 'ecommerce', title: '电商购物', icon: '🛒', keywords: ['淘宝', '京东', '天猫', '拼多多', 'amazon', '购物', '电商', '闲鱼'] },
  { slug: 'grocery-and-delivery', title: '生鲜与外卖', icon: '🍜', keywords: ['外卖', '美团', '饿了么', '生鲜', '买菜', '超市'] },
  { slug: 'travel-and-lodging', title: '旅行与住宿', icon: '✈️', keywords: ['旅行', '旅游', '机票', '酒店', '民宿', '携程', '马蜂窝'] },
  { slug: 'transit-and-mobility', title: '交通与出行', icon: '🚇', keywords: ['地图', '导航', '公交', '地铁', '打车', '高德', '12306', '出行'] },
  { slug: 'weather-and-environment', title: '气象与环境', icon: '🌦️', keywords: ['天气', 'weather', '气象', '空气质量'] },
  { slug: 'general-news-portals', title: '门户综合资讯', icon: '📰', keywords: ['新闻', '资讯', 'news', '头条', '门户', '微博'] },
  { slug: 'healthcare', title: '医疗健康', icon: '🩺', keywords: ['医疗', '健康', '医院', '药', 'dxy', '健身', '减肥'] },
  { slug: 'funds-and-wealth', title: '基金理财', icon: '💰', keywords: ['基金', '理财', '财富', '定投', '余额宝'] },
  { slug: 'securities-and-quotes', title: '证券与行情', icon: '📊', keywords: ['股票', '证券', '行情', 'a股', '期货', '投资', '财报', 'finance', '东方财富', '雪球'] },
  { slug: 'crypto-and-web3', title: '加密与区块链', icon: '🪙', keywords: ['比特币', '加密货币', '区块链', 'crypto', 'web3', '钱包地址'] },
]

/** 一级大类启发式：key 是 slug，不是硬编码统计数字；未命中即「未分类」 */
export const ROOT_CATEGORY_HINTS: Record<string, string[]> = {
  'ai-tools': ['ai', 'gpt', '大模型', 'llm', '人工智能', 'agent', 'copilot'],
  'frontend-development': ['前端', 'react', 'vue', 'css', 'javascript', 'typescript', 'tailwind', 'webpack', 'vite'],
  'backend-and-cloud': ['后端', '云服务', 'serverless', 'aws', 'azure', 'api', 'node.js', 'golang', 'java'],
  'devops-and-security': ['运维', 'devops', 'docker', 'k8s', 'kubernetes', '安全', '监控', 'ci/cd', 'sre'],
  'developer-resources': ['github', 'gitlab', 'stackoverflow', 'mdn', '文档', '开源', '开发者', 'npm'],
  'design-and-creative': ['设计', 'design', 'figma', '配色', '字体', '图标', '插画', 'ui'],
  'office-productivity': ['办公', '效率', '笔记', 'notion', '文档', '协作', 'todo', '日历'],
  'data-and-analytics': ['数据', 'analytics', 'bi', '报表', '数据库', '可视化', 'sql'],
  'learning-growth': ['学习', '课程', '教程', 'mooc', '教育', '考试', '语言'],
  'academic-research': ['论文', '学术', 'arxiv', '科研', '期刊', '文献', 'doi'],
  'news-and-media': ['新闻', '资讯', '媒体', 'news', '门户', '报刊'],
  'content-creation': ['创作', '内容', '剪辑', '视频', '播客', '写作', '自媒体'],
  'jobs-and-career': ['招聘', '求职', '简历', 'jobs', '职场', '猎聘', 'boss'],
  'finance-and-investing': ['财经', '股票', '基金', '投资', '行情', '理财', '证券'],
  'entertainment': ['电影', '音乐', '动漫', '视频', '娱乐', '追剧', 'spotify'],
  'gaming-and-esports': ['游戏', 'steam', '电竞', 'game', '攻略'],
  'consumer-life': ['购物', '电商', '外卖', '旅行', '生活', '美食', '酒店'],
  'public-services': ['政府', '政务', '公共服务', 'gov', '社保', '公积金'],
}

function scoreKeywords(text: string, keywords: string[]): number {
  let score = 0
  for (const keyword of keywords) {
    if (text.includes(keyword)) score += keyword.length >= 4 ? 2 : 1
  }
  return score
}

/** 根类表只摊平一次：原实现在每条书签上都 Object.entries 一遍，200 条即 200 次 */
const ROOT_HINT_ENTRIES: ReadonlyArray<readonly [string, string[]]> = Object.entries(ROOT_CATEGORY_HINTS)

/**
 * 分类树索引按**数组引用**缓存。
 *
 * 原先每条书签都 `new Map(categories.map(...))` 两遍——分类树有 18 个根 + 叶子，
 * 200 条导入就是 400 次 Map 构造，实测占了整条管线 66ms 的大头。
 * 分类树来自服务端 props，同一次渲染里引用稳定，用 WeakMap 缓存是安全的；
 * 若调用方原地改数组，缓存会失真，所以调用方必须换新数组而不是 mutate。
 */
const CATEGORY_INDEX_CACHE = new WeakMap<
  CategoryNode[],
  { byId: Map<string, CategoryNode>; bySlug: Map<string, CategoryNode> }
>()

function categoryIndex(categories: CategoryNode[]): {
  byId: Map<string, CategoryNode>
  bySlug: Map<string, CategoryNode>
} {
  let cached = CATEGORY_INDEX_CACHE.get(categories)
  if (!cached) {
    cached = {
      byId: new Map(categories.map((c) => [c.id, c])),
      bySlug: new Map(categories.map((c) => [c.slug, c])),
    }
    CATEGORY_INDEX_CACHE.set(categories, cached)
  }
  return cached
}

/**
 * 归类输入信号来自三处：原文件夹面包屑（权重最高）、标题、域名。
 * 返回的叶子一定来自 CATEGORY_HINTS（权威叶子表），一级根绝不作为提交值。
 */
export function classifyCategory(
  input: { title: string; url: string; folder?: string; tags?: string[] },
  categories: CategoryNode[] = [],
): CategoryGuess {
  const folder = (input.folder ?? '').toLowerCase()
  const title = input.title.toLowerCase()
  let host = ''
  try { host = new URL(input.url).hostname.toLowerCase() } catch { /* 非法 URL 已在隐私关卡处理 */ }
  const tagText = (input.tags ?? []).join(' ').toLowerCase()
  const broad = `${title} ${host} ${folder} ${tagText}`

  let bestLeaf = ''
  let bestLeafScore = 0
  for (const hint of CATEGORY_HINTS) {
    const s =
      scoreKeywords(folder, hint.keywords) * 3 +
      scoreKeywords(title, hint.keywords) * 2 +
      scoreKeywords(host, hint.keywords) * 2 +
      scoreKeywords(tagText, hint.keywords)
    if (s > bestLeafScore) {
      bestLeafScore = s
      bestLeaf = hint.slug
    }
  }

  let rootSlug = ''
  let rootScore = 0
  for (const [slug, keywords] of ROOT_HINT_ENTRIES) {
    const s =
      scoreKeywords(folder, keywords) * 3 +
      scoreKeywords(title, keywords) * 2 +
      scoreKeywords(host, keywords) * 2 +
      scoreKeywords(broad, keywords)
    if (s > rootScore) {
      rootScore = s
      rootSlug = slug
    }
  }

  // 叶子命中时沿 parentId 链回溯一级根，让展示口径与权威树一致（SSOT）
  if (bestLeaf && categories.length > 0) {
    const { byId, bySlug } = categoryIndex(categories)
    let node = bySlug.get(bestLeaf)
    let guard = 0
    while (node?.parentId && guard++ < 12) {
      const parent = byId.get(node.parentId)
      if (!parent) break
      node = parent
    }
    if (node && !node.parentId) rootSlug = node.slug
  }

  const rootTitle = (categories.length > 0 ? categoryIndex(categories).bySlug.get(rootSlug)?.title : undefined)
    ?? (rootSlug ? rootSlug.replace(/-/g, ' ') : '未分类')

  const confidence: Confidence =
    bestLeafScore >= 5 ? 'high' : bestLeafScore >= 2 ? 'medium' : bestLeafScore > 0 ? 'low' : 'none'

  return {
    rootSlug: rootSlug || 'uncategorized',
    rootTitle,
    suggestedCategorySlug: bestLeaf,
    confidence,
  }
}

/* ------------------------------------------------------------------ *
 * 5. Staging Table：一次解析，双库分流                                 *
 * ------------------------------------------------------------------ */

export type ImportMode = 'split' | 'private' | 'public'
export type StagingStatus = 'ready' | 'duplicate' | 'private'

export interface StagingItem {
  id: string
  title: string
  /** 规范化后的 URL（展示与提交都用它） */
  url: string
  originalUrl: string
  folder?: string
  description?: string
  tags: string[]
  rootSlug: string
  rootTitle: string
  suggestedCategorySlug: string
  confidence: Confidence
  status: StagingStatus
  privacyReason: string
  /** 隐私/内网/已收录时恒为 true，UI 与提交逻辑双重锁定 */
  publicLocked: boolean
  toPrivate: boolean
  toPublic: boolean
}

export interface StagingResult {
  items: StagingItem[]
  /** 同一批次内按指纹去重丢掉的条数，必须报给用户 */
  skippedDuplicates: number
  /** 索引不可用（中枢取数失败）时为 true，UI 必须显式提示去重未生效 */
  dedupeUnavailable: boolean
}

export function buildStagingItems(
  parsed: ParsedUniversalItem[],
  publicIndex: string[] | null,
  categories: CategoryNode[] = [],
  mode: ImportMode = 'split',
): StagingResult {
  const index = publicIndex === null ? null : new Set(publicIndex)
  const seen = new Set<string>()
  let skippedDuplicates = 0
  const items: StagingItem[] = []

  for (const raw of parsed) {
    const url = normalizeUrl(raw.href) || raw.href
    const fp = fingerprintUrl(raw.href)
    const key = fp || url
    if (seen.has(key)) {
      skippedDuplicates++
      continue
    }
    seen.add(key)

    const privacy = inspectPrivacy(url)
    const duplicated = index !== null && fp !== '' && index.has(fp)
    const status: StagingStatus = privacy.blocked ? 'private' : duplicated ? 'duplicate' : 'ready'
    const publicLocked = status !== 'ready'
    const guess = classifyCategory(
      { title: raw.title, url, folder: raw.folderName, tags: raw.tags },
      categories,
    )

    items.push({
      id: raw.siteId || `bm-${items.length}`,
      title: raw.title,
      url,
      originalUrl: raw.href,
      folder: raw.folderName,
      description: raw.description,
      tags: raw.tags ?? [],
      rootSlug: guess.rootSlug,
      rootTitle: guess.rootTitle,
      suggestedCategorySlug: guess.suggestedCategorySlug,
      confidence: guess.confidence,
      status,
      privacyReason: privacy.reason || (duplicated ? '公共导航库已收录' : ''),
      publicLocked,
      toPrivate: mode !== 'public',
      toPublic: mode !== 'private' && !publicLocked,
    })
  }

  return { items, skippedDuplicates, dedupeUnavailable: index === null }
}

/** 切换模式时重算流向：隐私/已收录条目永远不会被塞进公共投稿 */
export function applyMode(items: StagingItem[], mode: ImportMode): StagingItem[] {
  return items.map((item) => ({
    ...item,
    toPrivate: mode !== 'public',
    toPublic: mode !== 'private' && !item.publicLocked,
  }))
}

/* ------------------------------------------------------------------ *
 * 6. 零门槛示例书签（状态由实时公共库索引派生，保证三种状态都出现）    *
 * ------------------------------------------------------------------ */

const READY_CANDIDATES: Array<{ title: string; href: string; folder: string }> = [
  { title: 'Nebula Notes 协同笔记', href: 'https://nebula-notes.app/?utm_source=bookmark', folder: '效率工具' },
  { title: 'Pixel Forge 设计工作室', href: 'https://pixel-forge.studio/', folder: '设计与创意' },
  { title: 'Quanta Metrics 数据看板', href: 'https://quanta-metrics.io/', folder: '数据与分析' },
  { title: 'Orbit 语言学院', href: 'https://orbit-language-academy.com/', folder: '学习成长' },
  { title: 'Leaflet Garden 园艺社区', href: 'https://leaflet-garden.shop/', folder: '生活兴趣' },
  { title: 'Beacon 开源监控', href: 'https://beacon-observability.dev/', folder: '开发运维' },
  { title: 'Atlas 原型协作', href: 'https://atlas-prototyping.design/', folder: '设计与创意' },
  { title: 'Cirrus 云成本分析', href: 'https://cirrus-cloud-cost.tech/', folder: '数据与分析' },
  { title: 'Lumen 电子图书馆', href: 'https://lumen-library.online/', folder: '学习成长' },
  { title: 'Pocket 播客索引', href: 'https://pocket-podcast-index.fm/', folder: '影音娱乐' },
  { title: 'Cobalt 代码片段库', href: 'https://cobalt-snippets.codes/', folder: '开发运维' },
  { title: 'Meadow 独立开发者周刊', href: 'https://meadow-weekly.blog/', folder: '资讯媒体' },
]

const PRIVATE_CANDIDATES: Array<{ title: string; href: string; folder: string }> = [
  { title: '本地开发后台', href: 'http://localhost:3000/admin', folder: '私有 · 内网' },
  { title: '家庭 NAS 管理页', href: 'http://192.168.1.10:8080/', folder: '私有 · 内网' },
  { title: '团队文档（带访问令牌）', href: 'https://docs.google.com/document/d/demo?token=abc123', folder: '私有 · 文档' },
  { title: '路由器控制台', href: 'http://router.internal/dashboard', folder: '私有 · 内网' },
]

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * 生成 20 条示例书签 HTML。
 * 「已收录」用中枢真实 URL，「正常可投稿」从候选池里挑未收录的，
 * 「隐私拦截」固定 4 条 —— 所以任何时刻点击体验都能看到三种状态。
 */
export function buildSampleBookmarks(publicSampleUrls: string[], publicIndex: string[]): string {
  const index = new Set(publicIndex)
  const duplicates = publicSampleUrls.slice(0, 4).map((href, i) => ({
    title: `公共库已收录站点 ${i + 1}`,
    href,
    folder: '已收录 · 示例',
  }))
  const ready = READY_CANDIDATES.filter((c) => !index.has(fingerprintUrl(c.href))).slice(0, 12)
  const all = [...ready, ...duplicates, ...PRIVATE_CANDIDATES].slice(0, 20)

  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ]
  let currentFolder = ''
  for (const item of all) {
    if (item.folder !== currentFolder) {
      if (currentFolder) lines.push('    </DL><p>')
      lines.push(`    <DT><H3>${escapeHtml(item.folder)}</H3>`)
      lines.push('    <DL><p>')
      currentFolder = item.folder
    }
    lines.push(`        <DT><A HREF="${escapeHtml(item.href)}">${escapeHtml(item.title)}</A>`)
  }
  if (currentFolder) lines.push('    </DL><p>')
  lines.push('</DL><p>')
  return lines.join('\n')
}

/** 平台快捷键提示：macOS 与其它平台分开，避免给 Mac 用户错误的导出指引 */
export function platformShortcut(platform: string): { keys: string; hint: string } {
  const isMac = /mac|iphone|ipad|ipod/i.test(platform)
  return isMac
    ? { keys: 'Cmd + Option + B', hint: 'macOS Chrome / Edge 打开书签管理器；Safari 用「文件 → 导出为 → 书签」' }
    : { keys: 'Ctrl + Shift + O', hint: 'Windows / Linux Chrome / Edge 打开书签管理器，点击右上角「导出书签」' }
}
