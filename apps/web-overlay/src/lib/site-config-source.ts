import { getFileContentWithStatus } from '@/lib/github'
import { normalizeSettings, SITE_CONTENT_PATH, type SiteSettings } from '@/lib/site-settings'

/**
 * 站点设置的服务端读取入口（布局 / 页脚 / manifest / SEO 共用一份）。
 *
 * 这里不用 react `cache()`：manifest 与 metadata 路由不完全在 RSC 渲染上下文里，
 * 而 `getFileContent` 自带 2.5 秒进程内缓存 + Next Data Cache（`revalidateS`），
 * 重复调用本来就不会打中枢。用一个普通 async 函数反而各处都能用。
 */
export async function readSiteSettings(): Promise<SiteSettings> {
  return (await readSiteSettingsWithStatus()).settings
}

export async function readSiteSettingsWithStatus(): Promise<{
  settings: SiteSettings
  degraded: boolean
}> {
  try {
    const { data, degraded } = await getFileContentWithStatus<unknown>(SITE_CONTENT_PATH)
    return { settings: normalizeSettings(data), degraded }
  } catch {
    // normalizeSettings 不抛，getFileContent 也不抛；这里只是最后一道保险：
    // 配置读不出来时页面要用默认值，而不是整页 500。
    return { settings: normalizeSettings(null), degraded: true }
  }
}
