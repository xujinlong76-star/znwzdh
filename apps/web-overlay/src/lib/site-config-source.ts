import { cache } from 'react'
import { getFileContentWithStatus } from '@/lib/github'
import { normalizeSettings, SITE_CONTENT_PATH, type SiteSettings } from '@/lib/site-settings'

export async function readSiteSettings(): Promise<SiteSettings> {
  return (await readSiteSettingsWithStatus()).settings
}

// 仅在一次 RSC 渲染内复用。
// 这里必须是**可缓存**的读（带 HUB_CACHE_TAG 的 Data Cache），不能是 readStorageFresh：
// 根布局出现在所有静态页的渲染树里，一次 `cache: 'no-store'` 就会让整棵树在运行时
// 被判成动态（实测 /category/[slug]/p/[n] 500 "Page changed from static to dynamic"）。
// 「保存后刷新即见新值」由 /api/site 写成功后的 revalidateTag 负责，不靠绕过缓存。
export const readSiteSettingsWithStatus = cache(async (): Promise<{
  settings: SiteSettings
  degraded: boolean
}> => {
  const { data, degraded } = await getFileContentWithStatus(SITE_CONTENT_PATH)
  return { settings: normalizeSettings(data), degraded }
})
