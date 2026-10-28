/**
 * 搜索通道降级状态归一化：统一「站点语义」「插件语义」两条副通道的口径。
 *
 * 背景（两个入口曾各写各的判断，结论互相矛盾）：
 *   1. navhub-api 在任何网络失败时都返回 `degraded: true` 的兜底值、不抛错。
 *      只监听 catch 的组件会把「中枢挂了」显示成「未找到相关结果」——谎报；
 *      SearchPalette 读 degraded、Spotlight 只读 catch，两处对同一故障给出不同文案。
 *   2. 插件检索在语义模型不可用时自动关键词回退并置 `degraded: true`；
 *      不展示这一点的组件会让用户以为拿到的是语义结果。
 *
 * 这里把「通道失败」与「语义回退」拆成两个明确信号，组件只负责渲染。
 * `pluginsFailed` 需要调用方通过 searchPlugins 的 onDegraded 回调标记——
 * 只看响应体无法区分「请求没到达」与「服务端关键词回退」。
 */

export interface SearchChannelInput {
  /** 站点检索结果（null = 还没返回） */
  sites: { degraded?: boolean; semanticAvailable?: boolean } | null
  /** 站点请求是否直接失败（API 层通常已折算成 degraded，这里两种都认） */
  sitesFailed?: boolean
  plugins: { degraded?: boolean; mode?: 'semantic' | 'keyword' } | null
  /** 插件请求是否直接失败（经 onDegraded 回调标记） */
  pluginsFailed?: boolean
}

export interface SearchChannelStatus {
  /** 站点通道不可用：零结果时不能说「没搜到」 */
  sitesUnavailable: boolean
  /** 站点语义未就绪：当前是关键词 / 拼音 / 全文混合召回 */
  semanticUnavailable: boolean
  /** 插件通道请求失败：与「插件市场没有匹配」区分 */
  pluginUnavailable: boolean
  /** 插件语义未就绪：返回的是关键词回退结果 */
  pluginSemanticFallback: boolean
}

export function searchChannelStatus(input: SearchChannelInput): SearchChannelStatus {
  const sitesUnavailable = input.sitesFailed === true || input.sites?.degraded === true
  const pluginUnavailable = input.pluginsFailed === true
  return {
    sitesUnavailable,
    // 通道整个挂了时别再说「语义未就绪」：那是另一个故障，先报大的
    semanticUnavailable: !sitesUnavailable && input.sites != null && input.sites.semanticAvailable === false,
    pluginUnavailable,
    pluginSemanticFallback:
      !pluginUnavailable &&
      input.plugins != null &&
      input.plugins.degraded === true &&
      input.plugins.mode === 'keyword',
  }
}
