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

import { externalSearchEngineName, externalSearchUrl, type SearchEngineId } from './user-settings'
import { submitPrefillHref } from './submit-prefill'

export type SearchPanelActionKind =
  | 'retry'
  | 'clear'
  | 'browse-tags'
  | 'browse-hot'
  | 'external-search'
  /** 零结果出口：唤起 AI 找站抽屉，查询词自动发过去（无 href，走按钮动作） */
  | 'ai-find'
  /** 零结果出口：跳投稿页，查询词按 submit-prefill 规则预填（带 href，走 <Link>） */
  | 'submit-site'
  /** 零结果出口：存为待找（登录态调 API，匿名走本地存储，走按钮动作） */
  | 'save-wanted'
  /** 零结果出口：新建收藏（打开 AddSiteDialog 预填弹窗，走按钮动作） */
  | 'save-favorite'

export interface SearchPanelAction {
  kind: SearchPanelActionKind
  label: string
  /** 站内跳转动作的目标（retry / clear 没有 href） */
  href?: string
  /** true = href 是站外地址，必须渲染成 <a target="_blank">，不能用 <Link> 做客户端路由 */
  external?: boolean
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
/** 零结果第一出口：清空查询词并聚焦输入框，让用户换个关键词再搜 */
const CHANGE_KEYWORD: SearchPanelAction = { kind: 'clear', label: '换关键词' }

export interface SearchPanelInput {
  loading: boolean
  /** 中枢降级（检索结果不可信 / 只是本地兜底） */
  degraded: boolean
  hitCount: number
  query: string
  /** 是否命中了投机意图 / 技术对比 / 架构配方等即时微组件 */
  hasWidgetResult: boolean
  /** 用户中心里的「默认搜索引擎」，决定零结果时给哪一个站外出口 */
  searchEngine?: SearchEngineId
}

/**
 * 站外出口只在用户显式选了外部引擎时出现（`internal` → null）。
 * 顺带一条真实收益：降级态下用户依然有路可走，而不是干等检索服务恢复。
 */
function externalAction(engine: SearchEngineId | undefined, query: string): SearchPanelAction | null {
  if (!engine) return null
  const url = externalSearchUrl(engine, query)
  if (!url) return null
  const name = externalSearchEngineName(engine)
  return {
    kind: 'external-search',
    label: `用 ${name} 搜索「${query.trim()}」`,
    href: url,
    external: true,
  }
}

export function planSearchPanel(input: SearchPanelInput): SearchPanelPlan {
  const { loading, degraded, hitCount, query, hasWidgetResult, searchEngine } = input

  // 检索中 / 有结果：都不需要提示块（降级横幅由调用方渲染在结果上方）
  if (loading || hitCount > 0) return { mode: 'hidden', title: '', hint: '', actions: [] }

  const external = externalAction(searchEngine, query)

  // 降级且零结果：绝不能说「没有匹配」——我们根本没能问成功
  if (degraded) {
    return {
      mode: 'outage',
      title: '检索服务暂时不可用',
      hint: '已切到降级检索，暂时无法确认是否有匹配结果。可以重试，或先浏览分类。',
      actions: [RETRY, ...(external ? [external] : []), BROWSE_TAGS, BROWSE_HOT],
    }
  }

  // 真的零结果：给出口，且不要因为微组件命中就隐瞒「导航检索为空」。
  // 2026-11-20 搜索假空态修复（William 点名）：空态文案固定为"没有找到相关站点"，
  // 0 条结果明示；两个出口排最前——换关键词（清空并聚焦输入框）、去 AI 找站
  // （查询词自动发过去）；投稿收录、存为待找、新建收藏随后；清空/浏览是次要出口，
  // 放后面。降级（outage）时不给这两条：我们连「有没有」都没问成功，AI 找站
  // 同样走中枢、一样没谱。
  const trimmed = query.trim()
  // 按钮文案只露前 24 字（查询词最长 256 字，全塞进胶囊会撑爆面板）；
  // 发给 AI 的仍是完整查询词（runPanelAction 用组件内的 query，不读 label）。
  const labelQuery = trimmed.length > 24 ? `${trimmed.slice(0, 24)}…` : trimmed
  const aiFind: SearchPanelAction = { kind: 'ai-find', label: `去 AI 找站「${labelQuery}」` }
  const submitSite: SearchPanelAction = {
    kind: 'submit-site',
    label: '投稿收录这个站',
    href: submitPrefillHref(trimmed),
  }
  // 容错纠错两出口：排在 ai-find/submit-site 之后、浏览类之前。
  const saveWanted: SearchPanelAction = { kind: 'save-wanted', label: '存为待找' }
  const saveFavorite: SearchPanelAction = { kind: 'save-favorite', label: '新建收藏' }
  return {
    mode: 'no-results',
    title: '没有找到相关站点',
    hint: hasWidgetResult
      ? '0 条结果。上方卡片是根据这句话即时生成的；导航检索没有匹配，可以换更短的关键词。'
      : '0 条结果。试试拼音首字母（如 zgtqw）或描述你的需求',
    actions: [CHANGE_KEYWORD, aiFind, submitSite, saveWanted, saveFavorite, ...(external ? [external] : []), BROWSE_TAGS, BROWSE_HOT],
  }
}
