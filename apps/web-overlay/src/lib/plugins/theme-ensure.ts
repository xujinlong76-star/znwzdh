/**
 * 皮肤「安装 + 拉取 + 应用」的可复用路径。
 *
 * 从 skin-picker.tsx 的 choose() 抽出（行为不变）：未安装先 installPlugin，
 * 再 fetchPluginDetail 取 manifest payload（tokens/accent），最后
 * setActiveTheme。场景切换的主题预检复用同一条路——绝不能只写
 * THEME_STORAGE_KEY（那样 tokens 不注入、事件不派发、深色守卫不走）。
 *
 * 网络层可注入：测试里塞假的 install/fetch，不必发真请求。
 */
import { fetchPluginDetail, installPlugin } from '@/lib/navhub-api'
import { setActiveTheme, type ActiveThemeConfig } from '@/lib/plugins/theme-runtime'

export interface ThemeEnsureDeps {
  installPlugin?: (slug: string) => Promise<unknown>
  fetchPluginDetail?: (slug: string) => Promise<{
    plugin: { name: string; manifest?: { payload?: { tokens?: Record<string, string>; accent?: ActiveThemeConfig['accent'] } } }
  } | null>
  /** 已装 slug 集合；不传时一律视为未安装（先装后取，安装已装皮肤是幂等操作） */
  installedSlugs?: ReadonlySet<string>
  /** 已知皮肤名（市场列表里的名字）；不传时用详情里的名字 */
  knownName?: string
  setActiveTheme?: (config: Omit<ActiveThemeConfig, 'appliedAt'>) => void
}

export interface ThemePrepareResult {
  ok: boolean
  /** 拉到的主题配置（未应用；调用方在 DIY 提交后再 setActiveTheme） */
  theme?: ActiveThemeConfig
  failedStep?: 'install' | 'fetch' | 'payload'
  reason?: string
}

/**
 * 预检用：只安装 + 拉取，不应用。场景切换必须先走这一步（唯一走网络
 * 的步骤），确认皮肤可用后再动任何可见状态；应用留在 DIY 提交之后。
 */
export async function prepareTheme(
  slug: string,
  deps: ThemeEnsureDeps = {},
): Promise<ThemePrepareResult> {
  const doInstall = deps.installPlugin ?? installPlugin
  const doFetch = deps.fetchPluginDetail ?? fetchPluginDetail
  try {
    if (!deps.installedSlugs || !deps.installedSlugs.has(slug)) {
      await doInstall(slug)
    }
  } catch (err) {
    return {
      ok: false,
      failedStep: 'install',
      reason: `皮肤安装失败：${err instanceof Error ? err.message : String(err)}`,
    }
  }
  let detail: Awaited<ReturnType<typeof doFetch>>
  try {
    detail = await doFetch(slug)
  } catch (err) {
    return {
      ok: false,
      failedStep: 'fetch',
      reason: `皮肤详情拉取失败：${err instanceof Error ? err.message : String(err)}`,
    }
  }
  const payload = detail?.plugin?.manifest?.payload
  if (!payload) {
    return { ok: false, failedStep: 'payload', reason: '无法启用皮肤：未能加载清单配置' }
  }
  return {
    ok: true,
    theme: {
      slug,
      name: deps.knownName ?? detail?.plugin.name ?? slug,
      tokens: payload.tokens,
      accent: payload.accent,
      appliedAt: Date.now(),
    },
  }
}

export interface ThemeEnsureResult {
  ok: boolean
  /** 应用后的主题配置（供 toast 点名皮肤名 / accent 对齐用） */
  theme?: ActiveThemeConfig
  /** 失败时哪一步失败（install / fetch / payload） */
  failedStep?: 'install' | 'fetch' | 'payload'
  reason?: string
}

/**
 * 确保皮肤可用并应用：先装（未安装时）→ 拉取详情 → 应用。
 * 任一步失败返回 !ok，调用方在动任何可见状态之前中止切换。
 */
export async function ensureThemeAvailable(
  slug: string,
  deps: ThemeEnsureDeps = {},
): Promise<ThemeEnsureResult> {
  const prepared = await prepareTheme(slug, deps)
  if (!prepared.ok || !prepared.theme) {
    return { ok: false, failedStep: prepared.failedStep, reason: prepared.reason }
  }
  const apply = deps.setActiveTheme ?? setActiveTheme
  apply({
    slug: prepared.theme.slug,
    name: prepared.theme.name,
    tokens: prepared.theme.tokens,
    accent: prepared.theme.accent,
  })
  return { ok: true, theme: prepared.theme }
}
