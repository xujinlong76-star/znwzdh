import { hubGetProbe, type HubProbe } from './hub'
import type { HubPluginAuthorResponse } from '@/lib/navhub-api'

/** 与 API 路由保持同一格式门槛：非法 key 是 404，不是「上游失败」。 */
export const AUTHOR_KEY_RE = /^[a-f0-9]{8,64}$/i

export function loadPluginAuthor(
  key: string,
  revalidate = 60,
): Promise<HubProbe<HubPluginAuthorResponse>> {
  return hubGetProbe<HubPluginAuthorResponse>(
    '/api/plugins/author/' + encodeURIComponent(key) + '?limit=100',
    revalidate,
  )
}
