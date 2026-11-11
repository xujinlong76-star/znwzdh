/**
 * `/graph` 的 `?category=` 入口参数解析（纯函数，可单测）。
 *
 * 背景：首页每个分类区的「查看该领域技术生态图谱」按钮带着
 * `?category={分类 id}` 跳到图谱页。2026-11-10 之前的实现从不读这个参数；
 * 2125ad08 改成按分类标题关键词映射到图谱内部分类（dev/design/ai/efficiency）
 * 并预选桶——14 个一级分类里 7 个（运维与安全/学习成长/学术科研/资讯媒体/
 * 影音娱乐/消费生活/公共服务/短剧……）没有任何关键词能命中，点进来仍是
 * 「全部」，等于假跳转；命中的 7 个也只是全局抽样后再按桶过滤，看到的并
 * 不是该分类自己的站点。
 *
 * 本轮改成「分类域」：参数按 id 精确匹配一级或二级分类，图谱只抽样该分类
 * 自己的站点（不混入预设示例节点）；匹配不上、或该分类在 live 数据里 0 站
 * 点时，调用方保持全局视图，不假装过滤成功。
 */

export interface GraphNavCategory {
  id?: unknown
  title?: unknown
  enabled?: unknown
  items?: unknown
  subCategories?: unknown
}

export interface GraphCategoryFocus {
  /** 匹配到的分类 id（可能是二级 id，如 reg-chat-assistants） */
  id: string
  /** 所属顶级分类 id（本身就是顶级时与 id 相同） */
  topId: string
  title: string
  /** 该分类下所有容器 id（顶级 + 其二级），用于过滤展平后的站点列表 */
  memberIds: string[]
}

function asId(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null
  if (typeof value === 'number') return String(value)
  return null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * 按 id 精确匹配一级或二级分类。只认 id，不猜标题关键词：
 * 传标题、传不存在的 id、传空值一律返回 null，调用方保持全局视图。
 * 被禁用（enabled === false）的分类不参与匹配。
 */
export function resolveGraphCategory(
  wanted: string | null | undefined,
  items: unknown,
): GraphCategoryFocus | null {
  if (!wanted || typeof wanted !== 'string') return null
  for (const raw of asArray(items)) {
    if (!raw || typeof raw !== 'object') continue
    const cat = raw as GraphNavCategory
    if (cat.enabled === false) continue
    const topId = asId(cat.id)
    if (!topId) continue
    const memberIds: string[] = [topId]
    for (const rawSub of asArray(cat.subCategories)) {
      if (!rawSub || typeof rawSub !== 'object') continue
      const sub = rawSub as GraphNavCategory
      if (sub.enabled === false) continue
      const subId = asId(sub.id)
      if (subId) memberIds.push(subId)
    }
    if (topId === wanted) {
      return { id: topId, topId, title: String(cat.title ?? topId), memberIds }
    }
    for (const rawSub of asArray(cat.subCategories)) {
      if (!rawSub || typeof rawSub !== 'object') continue
      const sub = rawSub as GraphNavCategory
      if (sub.enabled === false) continue
      const subId = asId(sub.id)
      if (subId && subId === wanted) {
        return { id: subId, topId, title: String(sub.title ?? subId), memberIds: [subId] }
      }
    }
  }
  return null
}

/**
 * 均匀抽样：步长取整后按下标取点再截断，保证不只反映列表前段。
 * 与图谱原有的全局抽样同一规则（`flat.filter((_, i) => i % stride === 0).slice(0, max)`），
 * 抽出来单独成函数是为了让分类域与全局域共用同一规则、可单测。
 */
export function sampleUniform<T>(items: readonly T[], max: number): T[] {
  if (max <= 0) return []
  if (items.length <= max) return [...items]
  const stride = Math.max(1, Math.floor(items.length / max))
  return items.filter((_, i) => i % stride === 0).slice(0, max)
}
