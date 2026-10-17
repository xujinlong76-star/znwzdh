/**
 * 搜索面板「什么都没显示」时到底该说什么 —— 单一判定点（纯函数，可单测）。
 *
 * 组件头部注释写着的契约是「中枢不可用时明示降级，而不是假装『没有结果』」，
 * 但原实现同时踩了三个坑：
 *
 *  1. **自相矛盾**：零结果时把「检索服务暂时不可用」横幅和
 *     「未找到与 “x” 相关的导航」一起渲染。用户无法判断是故障还是真没有，
 *     只能反复换词白试。
 *  2. **死路**：零结果区块只依赖服务端返回的 suggestions / popular 兜底。
 *     服务端没给（或本身就在降级）时，用户面对一段纯文字，没有任何出口。
 *  3. **被微组件吞掉**：查询命中投机意图 / 技术对比 / 架构配方卡片时，
 *     「导航没有结果」这一整块被 `!speculativeResult && ...` 抑制，
 *     用户看不到「导航检索为空」这个事实。
 *
 * 这里把「显示什么」收敛成一个可测的判定：模式 + 标题 + 提示 + 出口动作。
 */

export type SearchPanelActionKind = 'retry' | 'clear' | 'browse-tags' | 'browse-hot'

export interface SearchPanelAction {
  kind: SearchPanelActionKind
  label: string
  /** 站内跳转动作的目标（retry / clear 没有 href） */
  href?: string
}

/** hidden = 不需要提示块（有结果，或还在检索中） */
export type SearchPanelMode = 'hidden' | 'no-results' | 'outage'

export interface SearchPanelPlan {
  mode: SearchPanelMode
  title: string
  hint: string
  actions: SearchPanelAction[]
}

const BROWSE_TAGS: SearchPanelAction = { kind: 'browse-tags', label: '浏览标签云', href: '/tags' }
const BROWSE_HOT: SearchPanelAction = { kind: 'browse-hot', label: '看看热度榜', href: '/hot' }
const RETRY: SearchPanelAction = { kind: 'retry', label: '重试检索' }
const CLEAR: SearchPanelAction = { kind: 'clear', label: '清空搜索' }

export interface SearchPanelInput {
  loading: boolean
  /** 中枢降级（检索结果不可信 / 只是本地兜底） */
  degraded: boolean
  hitCount: number
  query: string
  /** 是否命中了投机意图 / 技术对比 / 架构配方等即时微组件 */
  hasWidgetResult: boolean
}

export function planSearchPanel(input: SearchPanelInput): SearchPanelPlan {
  const { loading, degraded, hitCount, query, hasWidgetResult } = input

  // 检索中 / 有结果：都不需要提示块（降级横幅由调用方渲染在结果上方）
  if (loading || hitCount > 0) return { mode: 'hidden', title: '', hint: '', actions: [] }

  // 降级且零结果：绝不能说「没有匹配」——我们根本没能问成功
  if (degraded) {
    return {
      mode: 'outage',
      title: '检索服务暂时不可用',
      hint: '已切到降级检索，暂时无法确认是否有匹配结果。可以重试，或先浏览分类。',
      actions: [RETRY, BROWSE_TAGS, BROWSE_HOT],
    }
  }

  // 真的零结果：给出口，且不要因为微组件命中就隐瞒「导航检索为空」
  return {
    mode: 'no-results',
    title: `未找到与 “${query.trim()}” 相关的导航`,
    hint: hasWidgetResult
      ? '上方卡片是根据这句话即时生成的；导航检索没有匹配，可以换更短的关键词。'
      : '试试拼音首字母（如 zgtqw）或描述你的需求',
    actions: [CLEAR, BROWSE_TAGS, BROWSE_HOT],
  }
}
