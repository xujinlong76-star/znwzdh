import { hubGetProbe, type HubProbe } from './hub'
import type { HubPluginItem } from '@/lib/navhub-api'

/** /api/plugins/:slug 的公开摘要；具体字段随插件类型变化，但页面只读常用计数。 */
export type PluginSummary = {
  siteCount?: number
  categoryCount?: number
  engineCount?: number
  themeTokenCount?: number
  boardCount?: number
  bundleItemCount?: number
  enginePrefixes?: string[]
  hosts?: string[]
  [key: string]: unknown
}

export type PluginDetail = {
  plugin: HubPluginItem
  summary: PluginSummary | null
}

/**
 * 插件详情统一走中枢直连，不再通过公开域名自取 /api/hub/plugins：
 * 自取会无条件调用 headers()，把详情页、metadata 和 OG 都钉成动态渲染。
 * 三态 probe 让「确认不存在」走 404，「中枢抖动」保留降级渲染。
 */
export function loadPluginDetail(slug: string, revalidate = 60): Promise<HubProbe<PluginDetail>> {
  return hubGetProbe<PluginDetail>('/api/plugins/' + encodeURIComponent(slug), revalidate)
}
