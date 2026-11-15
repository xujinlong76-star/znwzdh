/**
 * scene-apply 的浏览器侧接线（默认 deps）。
 *
 * 纯编排在 scene-apply.ts（可注入假实现做测试）；这里只把真实的
 * 浏览器入口拼起来：DIY 共享状态 + 皮肤运行时 + 快照存储 +
 * next-themes（由调用组件经 useTheme 传入 setMode/getMode）。
 *
 * 工作区筛选不直接调 navigation-content 的 state：派发
 * `navhub:scene-workspace-change` 事件，navigation-content 监听后
 * 走已有的 handleWorkspaceChange 同一路（切筛选 + 折叠分类）。
 */
import { commitHomeDiyConfig, getHomeDiySnapshot } from './home-diy-storage'
import { browserDiySnapshotStorage, saveDiySnapshot } from './diy-snapshots'
import { fetchInstalledPlugins } from '@/lib/navhub-api'
import { getActiveTheme, isDarkMode, resetTheme, setActiveTheme } from '@/lib/plugins/theme-runtime'
import type { ThemeEnsureDeps } from '@/lib/plugins/theme-ensure'
import { publishSharedLayoutSync } from './use-home-diy-grid'
import type { SceneApplyDeps } from './scene-apply'
import { getRegisteredSceneSiteIndex } from './scene-apply'

export const SCENE_WORKSPACE_CHANGE_EVENT = 'navhub:scene-workspace-change'

export function dispatchSceneWorkspaceChange(
  filter: 'all' | 'dev' | 'design' | 'ai' | 'efficiency',
): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(SCENE_WORKSPACE_CHANGE_EVENT, { detail: { filter } }))
}

export interface LiveSceneDepsOptions {
  getMode: () => string | null
  setMode: (mode: string) => void
  /**
   * 已装皮肤 slug 集合：传了就经 themeDeps 交给 prepareTheme，已装皮肤
   * 跳过 installPlugin 直接拉详情。口径与 skin-picker 相同
   *（fetchInstalledPlugins 取 kind==='theme' 的 slug，见 fetchInstalledThemeSlugs）。
   */
  installedSlugs?: ReadonlySet<string>
  /** 皮肤预检网络层注入（测试用；生产默认走真实 installPlugin/fetchPluginDetail） */
  themeDeps?: ThemeEnsureDeps
  /** 已装集合查询注入（测试用；生产默认走 fetchInstalledThemeSlugs） */
  fetchInstalledSlugs?: () => Promise<ReadonlySet<string>>
}

/** 生产用的 deps：DIY 提交后顺带跨标签广播（与 use-home-diy 的 persistConfig 同口径） */
export function buildLiveSceneDeps(opts: LiveSceneDepsOptions): SceneApplyDeps {
  // installedSlugs 为 undefined 时不覆盖调用方 themeDeps 里自带的集合
  const themeDeps: ThemeEnsureDeps | undefined =
    opts.themeDeps || opts.installedSlugs
      ? { ...opts.themeDeps, ...(opts.installedSlugs ? { installedSlugs: opts.installedSlugs } : {}) }
      : undefined
  return {
    getDiyConfig: () => getHomeDiySnapshot().config,
    commitDiy: (updater) => {
      const result = commitHomeDiyConfig(updater)
      if (result.ok) {
        publishSharedLayoutSync({ config: result.config, clocks: result.clocks })
      }
      return result
    },
    getActiveTheme,
    setActiveTheme,
    resetTheme,
    getMode: opts.getMode,
    setMode: opts.setMode,
    isDarkMode,
    saveSnapshot: (config, name) => {
      const storage = browserDiySnapshotStorage()
      if (!storage) return null
      return saveDiySnapshot(storage, config, name)
    },
    siteIndex: getRegisteredSceneSiteIndex(),
    onWorkspaceChange: (filter) => dispatchSceneWorkspaceChange(filter),
    themeDeps,
  }
}

/**
 * 默认已装查询：与 skin-picker 同口径（fetchInstalledPlugins，取
 * kind==='theme' 的 slug）。降级时 fetchInstalledPlugins 回空列表——
 * 空集只会让 prepareTheme 走「先安装」（installPlugin 幂等），不会把
 * 已装皮肤误标成未安装后跳过安装，安全回落。
 */
export async function fetchInstalledThemeSlugs(): Promise<ReadonlySet<string>> {
  const res = await fetchInstalledPlugins()
  return new Set(res.items.filter((item) => item.kind === 'theme').map((item) => item.slug))
}

/**
 * 带已装集合的 deps：有皮肤的切换先拉一次已装列表，已装皮肤跳过安装
 * 直接用；拉取失败时回落到不传集合（旧行为：先安装，installPlugin
 * 幂等），切换不因此失败。
 */
export async function buildLiveSceneDepsAsync(opts: LiveSceneDepsOptions): Promise<SceneApplyDeps> {
  let installedSlugs = opts.installedSlugs
  if (!installedSlugs) {
    try {
      installedSlugs = await (opts.fetchInstalledSlugs ?? fetchInstalledThemeSlugs)()
    } catch {
      installedSlugs = undefined
    }
  }
  return buildLiveSceneDeps({ ...opts, installedSlugs })
}
