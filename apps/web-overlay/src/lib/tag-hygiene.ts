/**
 * 卡片标签展示的单一事实源（2026-11-09）。
 *
 * 审计实测（/api/home/navigation，19 个一级大类 / 217 个子类 / 4,839 站点）：
 *   - 一级分类名被批量注入标签：消费生活 273、公共服务 258、金融财经 253、
 *     学习成长 238、影音娱乐 210……这些在卡片上与所属分类标题完全重复；
 *   - 子分类名的 slug 化变体：#组件与-ui-体系、#wasm-与-rust、#浏览器与-pwa、
 *     #ai-工具、#ai-硬件与具身、#ai-安全与对齐……同样是分类名的复读；
 *   - 泛化标签 ai赋能 出现 157 次，跨前端开发 / 无障碍检测等不相干站点误打。
 *
 * 每张卡片只展示 2~3 个标签，这些复读项会挤掉真正有检索价值的属性
 * （#开源 / #Rust / #CLI / #本地优先）。分类入口本身已在侧栏与目录带，
 * 不需要在卡片里再写一遍。
 *
 * 放在渲染前而不是清洗种子数据：导航数据由 API 种子 + 本地默认 JSON 双源提供，
 * 改任何一份都只覆盖一半路径；在展示层收敛才是唯一对所有数据源都生效的位置。
 */

/**
 * 显式规范映射表（2026-11-09）：解决技术标签特殊符号与连字符混淆痛点。
 * 如 C# 与 C 语言混淆、.NET 被切成 net 等。
 */
export const SPECIAL_TAG_MAPPING: Record<string, string> = {
  'c#': 'csharp',
  'c++': 'cpp',
  '.net': 'dotnet',
  'node.js': 'nodejs',
  'vue.js': 'vuejs',
}

/** 归一化：去连字符/下划线/空白、统一小写，让 `组件与-ui-体系` 与 `组件与 UI 体系` 相等。 */
export function normalizeTag(value: string): string {
  const raw = (value || '').trim().replace(/^#+/, '').toLowerCase()
  if (SPECIAL_TAG_MAPPING[raw]) {
    return SPECIAL_TAG_MAPPING[raw]
  }
  return raw
    .replace(/[\s\-_/·、，,]+/g, '')
}

/**
 * 同义词归一化字典（2026-11-20 数据治理）：
 * 键为 normalizeTag() 后的归一化形态，值为简短、无连字符的标准展示标签（≤5 汉字）。
 * 解决分类头与站点卡片同时出现 `#视频生成` / `#AI视频`、`#ai-编程` / `#AI编程` 等同义重复问题。
 */
export const TAG_SYNONYM_MAP: Readonly<Record<string, string>> = {
  // AI 模态与场景同义归并
  'ai视频': 'AI视频',
  '视频生成': 'AI视频',
  'ai视频生成': 'AI视频',
  '文生视频': 'AI视频',
  'ai音乐': 'AI音乐',
  '音乐生成': 'AI音乐',
  'ai作曲': 'AI音乐',
  'ai绘图': 'AI绘图',
  'ai绘画': 'AI绘图',
  '图像生成': 'AI绘图',
  '文生图': 'AI绘图',
  'ai编程': 'AI编程',
  '编程助手': 'AI编程',
  '代码助手': 'AI编程',
  'agenticide': 'AI编程',
  'ai搜索': 'AI搜索',
  '智能搜索': 'AI搜索',
  'ai配音': 'AI配音',
  '语音合成': 'AI配音',
  'ai语音': 'AI配音',
  'tts': 'AI配音',
  'ai短剧': '短剧',
  '短剧创作': '短剧',
  '大语言模型': '大模型',
  'llm': '大模型',
  'ui设计': 'UI设计',
  '云文档': '在线文档',
  // 正交决策属性同义归并
  '开源免费': '开源',
  'opensource': '开源',
  '免费版': '免费额度',
  '免费试用': '免费额度',
  'freemium': '免费额度',
  '国内直连': '国产直连',
  '国内可用': '国产直连',
  '免翻墙': '国产直连',
  '需代理': '需魔法',
  '需翻墙': '需魔法',
  '科学上网': '需魔法',
  'api': '支持 API',
  'api接口': '支持 API',
  '开放api': '支持 API',
  '私有部署': '自托管',
  '本地部署': '自托管',
  'selfhosted': '自托管',
  '企业版': '企业级',
}

/**
 * 正交决策属性标签（优先级顺序）：
 * 相比描述“是什么品类”，这类标签直接回答“能不能用、怎么收费、能否集成/私有化”，
 * 在卡片仅展示 2–3 个标签时优先保留在最前面。
 */
export const ORTHOGONAL_ATTRIBUTE_TAGS: readonly string[] = [
  '开源',
  '免费额度',
  '免费',
  '国产直连',
  '需魔法',
  '支持 API',
  '自托管',
  '企业级',
  '本地优先',
]

const ORTHOGONAL_PRIORITY_MAP: ReadonlyMap<string, number> = new Map(
  ORTHOGONAL_ATTRIBUTE_TAGS.map((tag, idx) => [normalizeTag(tag), idx]),
)

/** 泛化标签白名单校验。 */
export const GENERIC_TAG_ALLOWLIST: ReadonlySet<string> = new Set<string>([])

/** 已知会被自动化脚本泛打的标签（归一化后的形式）。 */
export const GENERIC_TAG_DENYLIST: ReadonlySet<string> = new Set<string>([
  'ai赋能',
])

/**
 * 将原始标签归一化为标准展示文案（去 `#` 与首尾空白，命中同义词表则归并）。
 */
export function canonicalizeTag(raw: string): string {
  const trimmed = (raw || '').trim().replace(/^#+/, '').trim()
  if (!trimmed) return ''
  const key = normalizeTag(trimmed)
  if (!key) return ''
  return TAG_SYNONYM_MAP[key] ?? trimmed
}

/**
 * 检测包含连字符的机器化 slug 标签（如 `#ai-音频与语音`、`#向量库与-rag-应用`）。
 * 规则：
 *   - 含连字符且包含中文字符（中英/中文连字符 slug 几乎全部是分类 slug 泄露）；
 *   - 或包含 2 个及以上连字符的多段英文 slug（如 `ai-code-review-tool`）。
 *   - 命中显式特殊标签映射或同义词表的短词在调用处会先归一化，不会被误杀。
 */
export function isHyphenatedSlugTag(raw: string): boolean {
  const trimmed = (raw || '').trim().replace(/^#+/, '').trim()
  if (!trimmed || !trimmed.includes('-')) return false
  if (/[\u4e00-\u9fff]/.test(trimmed)) return true
  const hyphenCount = (trimmed.match(/-/g) || []).length
  return hyphenCount >= 2
}

/**
 * 计算两个归一化字符串的字符二元组 Sørensen–Dice 相似度（范围 0~1）。
 * 用于识别与所属一级/二级分类名称相似度 > 70% 的复读标签
 * （例如 `#模型与数据集社区` vs `模型与数据集` → 0.83，`#ai-安全与对齐研究` vs `AI 安全与对齐` → 0.86）。
 */
export function computeTagSimilarity(a: string, b: string): number {
  const na = normalizeTag(a)
  const nb = normalizeTag(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.length < 2 || nb.length < 2) return 0

  const bigramsA = new Map<string, number>()
  for (let i = 0; i < na.length - 1; i++) {
    const bg = na.slice(i, i + 2)
    bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1)
  }
  let intersection = 0
  const totalB = nb.length - 1
  for (let i = 0; i < totalB; i++) {
    const bg = nb.slice(i, i + 2)
    const count = bigramsA.get(bg) || 0
    if (count > 0) {
      intersection++
      bigramsA.set(bg, count - 1)
    }
  }
  return (2 * intersection) / (na.length - 1 + totalB)
}

/** 由当前一级/二级分类标题构造归一化集合（运行时派生，禁止硬编码分类名）。 */
export function buildCategoryNameIndex(
  categoryTitle: string,
  subCategoryTitles: readonly string[] = [],
): Set<string> {
  const index = new Set<string>()
  for (const title of [categoryTitle, ...subCategoryTitles]) {
    const key = normalizeTag(title)
    if (key) index.add(key)
  }
  return index
}

/** 判断标签是否与所属一级/二级分类名称完全重复或相似度高于阈值（默认 0.70）。 */
export function isCategoryDuplicateTag(
  tag: string,
  categoryNames: ReadonlySet<string>,
  similarityThreshold = 0.7,
): boolean {
  const key = normalizeTag(tag)
  if (!key) return true
  if (categoryNames.has(key)) return true
  for (const catKey of categoryNames) {
    if (computeTagSimilarity(key, catKey) > similarityThreshold) {
      return true
    }
  }
  return false
}

/** 判断某个标签是否应当从卡片上剔除。 */
export function isPollutedTag(tag: string, categoryNames: ReadonlySet<string>): boolean {
  const trimmed = (tag || '').trim().replace(/^#+/, '').trim()
  const key = normalizeTag(trimmed)
  if (!key) return true
  // 泛化标签：在白名单里就放行，否则看黑名单
  if (GENERIC_TAG_ALLOWLIST.has(key)) return false
  if (GENERIC_TAG_DENYLIST.has(key)) return true
  // 与所属分类（或其 slug 化变体）同名或相似度 > 70%
  if (isCategoryDuplicateTag(key, categoryNames)) return true
  // 未命中同义词表的连字符机器化 slug（如 #ai-搜索与知识、#向量库与-rag-应用）
  if (isHyphenatedSlugTag(trimmed) && !TAG_SYNONYM_MAP[key]) return true
  // 同义词归一化后的标准名若与所属分类重复，同样剔除
  const canonical = TAG_SYNONYM_MAP[key]
  if (canonical && isCategoryDuplicateTag(canonical, categoryNames)) return true
  return false
}

export interface FilterDisplayTagsOptions {
  /** 可选：限制单卡最多展示标签数（如 3 个） */
  maxTags?: number
  /** 是否将正交决策属性标签优先排在前面（默认 true） */
  prioritizeOrthogonal?: boolean
}

/**
 * 过滤、归一化并排序站点标签，返回新数组（不改入参）。
 * 1. 同义词归并（如 `视频生成` / `AI视频` → `AI视频`）；
 * 2. 剔除分类重复/相似度 > 70% / 连字符 slug / 泛化黑名单标签；
 * 3. 去重后按“正交决策属性优先”排序。
 */
export function filterDisplayTags(
  tags: readonly string[] | undefined,
  categoryNames: ReadonlySet<string>,
  options: FilterDisplayTagsOptions = {},
): string[] {
  if (!Array.isArray(tags)) return []
  const { maxTags, prioritizeOrthogonal = true } = options
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of tags) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed || isPollutedTag(trimmed, categoryNames)) continue
    const canonical = canonicalizeTag(trimmed)
    if (!canonical) continue
    const key = normalizeTag(canonical)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(canonical)
  }
  if (prioritizeOrthogonal && result.length > 1) {
    result.sort((a, b) => {
      const pa = ORTHOGONAL_PRIORITY_MAP.get(normalizeTag(a)) ?? Number.POSITIVE_INFINITY
      const pb = ORTHOGONAL_PRIORITY_MAP.get(normalizeTag(b)) ?? Number.POSITIVE_INFINITY
      return pa - pb
    })
  }
  return typeof maxTags === 'number' && maxTags > 0 ? result.slice(0, maxTags) : result
}

/**
 * 生成一个 tags 已清洗的浅拷贝，供卡片直接消费。
 * 站点对象里没有 tags 时原样返回，避免为每条记录都分配新对象。
 */
export function sanitizeSiteTags<T extends object>(
  item: T,
  categoryNames: ReadonlySet<string>,
  options?: FilterDisplayTagsOptions,
): T {
  const tags = (item as { tags?: unknown }).tags
  if (!Array.isArray(tags)) return item
  const cleaned = filterDisplayTags(tags as readonly string[], categoryNames, options)
  if (cleaned.length === tags.length && cleaned.every((t, i) => t === tags[i])) {
    return item
  }
  return { ...item, tags: cleaned } as T
}
