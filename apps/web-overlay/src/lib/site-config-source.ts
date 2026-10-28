import { cache } from 'react'
import { readStorageFresh } from '@/lib/github'
import { normalizeSettings, SITE_CONTENT_PATH, type SiteSettings } from '@/lib/site-settings'

export async function readSiteSettings(): Promise<SiteSettings> {
  return (await readSiteSettingsWithStatus()).settings
}

// 仅在一次 RSC 渲染内复用，不能把已保存的旧品牌配置带到下一个请求。
export const readSiteSettingsWithStatus = cache(async (): Promise<{
  settings: SiteSettings
  degraded: boolean
}> => {
  try {
    return { settings: normalizeSettings(await readStorageFresh(SITE_CONTENT_PATH)), degraded: false }
  } catch {
    return { settings: normalizeSettings(null), degraded: true }
  }
})
