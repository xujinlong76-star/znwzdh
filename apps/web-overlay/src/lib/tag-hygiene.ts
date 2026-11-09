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
 * 泛化标签白名单校验。
 *
 * 不是「一律删掉所有宽泛标签」，而是：这类标签只有在白名单里才允许上卡片。
 * 目前白名单为空——`ai赋能` 属于自动化打标的历史遗留误标，无检索价值。
 * 将来若真要给某类站点加统一标记，在这里登记即可，规则可读、可测。
 */
export const GENERIC_TAG_ALLOWLIST: ReadonlySet<string> = new Set<string>([])

/** 已知会被自动化脚本泛打的标签（归一化后的形式）。 */
export const GENERIC_TAG_DENYLIST: ReadonlySet<string> = new Set<string>([
  'ai赋能',
])

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

/** 判断某个标签是否应当从卡片上剔除。 */
export function isPollutedTag(tag: string, categoryNames: ReadonlySet<string>): boolean {
  const key = normalizeTag(tag)
  if (!key) return true
  // 与所属分类（或其 slug 化变体）同名
  if (categoryNames.has(key)) return true
  // 泛化标签：在白名单里就放行，否则看黑名单
  if (GENERIC_TAG_ALLOWLIST.has(key)) return false
  if (GENERIC_TAG_DENYLIST.has(key)) return true
  return false
}

/**
 * 过滤站点标签，返回新数组（不改入参）。
 * 去重也在这里做：同一标签的中英文/连字符变体不该占两个位置。
 */
export function filterDisplayTags(
  tags: readonly string[] | undefined,
  categoryNames: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of tags) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim()
    if (!tag || isPollutedTag(tag, categoryNames)) continue
    const key = normalizeTag(tag)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(tag)
  }
  return result
}

/**
 * 生成一个 tags 已清洗的浅拷贝，供卡片直接消费。
 * 站点对象里没有 tags 时原样返回，避免为每条记录都分配新对象。
 */
export function sanitizeSiteTags<T extends object>(
  item: T,
  categoryNames: ReadonlySet<string>,
): T {
  const tags = (item as { tags?: unknown }).tags
  if (!Array.isArray(tags)) return item
  const cleaned = filterDisplayTags(tags as readonly string[], categoryNames)
  if (cleaned.length === tags.length && cleaned.every((t, i) => t === tags[i])) {
    return item
  }
  return { ...item, tags: cleaned } as T
}
