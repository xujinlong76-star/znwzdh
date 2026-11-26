/**
 * 场景切换编排：预检 → 备份 → 一次提交 → 失败回滚。
 *
 * 跨三个存储键（DIY 配置 / 皮肤 / 明暗模式）没有真事务；能做到的最接
 * 近原子的形态就是这套：唯一可能失败的网络步骤（皮肤安装/拉取）挪到
 * 所有可见写入之前；DIY 与明暗写入本身是同步 localStorage 操作；
 * 一旦失败就用切换前备份全量还原，activeSceneId 保持原值。
 *
 * 本模块不直接碰 window/localStorage/React：所有外部效应经 deps 注入，
 * 测试里塞假实现即可断言「半切换否决 / 回滚」。生产接线见
 * lib/modular/scene-apply-live.ts（浏览器侧的默认 deps）。
 */
import type { HomeDIYConfig, AccentColor } from './home-diy-storage'
import {
  derivePinnedSites,
  markSceneUsed,
  validateSceneLayout,
  type LastSwitchBackup,
  type SceneSiteEntry,
  type UserScene,
  type UserScenesDoc,
} from './user-scenes'
import { prepareTheme, type ThemeEnsureDeps } from '@/lib/plugins/theme-ensure'
import type { ActiveThemeConfig } from '@/lib/plugins/theme-runtime'

/** 皮肤 accent → DIY accentColor 的映射（只有这 4 个是 DIY 的合法值） */
const SKIN_ACCENT_TO_DIY: Record<string, AccentColor> = {
  violet: 'violet',
  emerald: 'emerald',
  amber: 'amber',
  rose: 'rose',
}

export interface SceneApplyDeps {
  /** 当前 DIY 配置（切换前备份用） */
  getDiyConfig: () => HomeDIYConfig
  /** 唯一正确的 DIY 写入口；返回 ok=false 时按失败回滚 */
  commitDiy: (updater: (prev: HomeDIYConfig) => HomeDIYConfig) => { ok: boolean }
  getActiveTheme: () => ActiveThemeConfig | null
  setActiveTheme: (config: Omit<ActiveThemeConfig, 'appliedAt'>) => void
  resetTheme: () => void
  /** 当前明暗模式（next-themes 的 theme 值，如 'light'/'dark'/'system'） */
  getMode: () => string | null
  setMode: (mode: string) => void
  isDarkMode: () => boolean
  /** 切换前自动备份（复用 diy-snapshots 的 saveDiySnapshot）；失败返回 null */
  saveSnapshot: (config: HomeDIYConfig, name: string) => unknown
  /** 站点索引（id → 标题 + 所属分类），由 navigation-content 注册 */
  siteIndex: Map<string, SceneSiteEntry>
  /** 工作区筛选：走 navigation-content 已有的 handleWorkspaceChange 同一路 */
  onWorkspaceChange?: (filter: 'all' | 'dev' | 'design' | 'ai' | 'efficiency') => void
  /** 皮肤预检的网络层（默认走真实 installPlugin/fetchPluginDetail） */
  themeDeps?: ThemeEnsureDeps
}

export interface SceneSwitchPreview {
  ok: boolean
  scene: UserScene
  /** 清洗后的布局（预检通过时） */
  layout?: HomeDIYConfig
  dockIds?: string[]
  byCategory?: Record<string, string[]>
  removed?: Array<{ id: string; title?: string }>
  /** 预检拉到的皮肤（未应用；应用留在 DIY 提交之后） */
  theme?: ActiveThemeConfig | null
  failedStep?: 'layout' | 'theme-install' | 'theme-fetch' | 'theme-payload'
  reason?: string
}

/** 预检（动任何可见状态之前）：布局校验 → 置顶过滤 → 皮肤可用性 */
export async function previewSceneSwitch(
  scene: UserScene,
  deps: SceneApplyDeps,
): Promise<SceneSwitchPreview> {
  const layoutCheck = validateSceneLayout(scene.layout)
  if (!layoutCheck.valid || !layoutCheck.config) {
    return { ok: false, scene, failedStep: 'layout', reason: '场景数据已损坏：布局无法校验通过' }
  }
  const derived = derivePinnedSites(scene.pinnedSiteIds, deps.siteIndex)
  let theme: ActiveThemeConfig | null = null
  if (scene.theme.skinSlug) {
    const prepared = await prepareTheme(scene.theme.skinSlug, {
      ...deps.themeDeps,
      knownName: scene.theme.skinName ?? undefined,
    })
    if (!prepared.ok || !prepared.theme) {
      const step =
        prepared.failedStep === 'install'
          ? 'theme-install'
          : prepared.failedStep === 'fetch'
            ? 'theme-fetch'
            : 'theme-payload'
      return { ok: false, scene, failedStep: step, reason: prepared.reason ?? '皮肤不可用' }
    }
    theme = prepared.theme
  }
  return {
    ok: true,
    scene,
    layout: layoutCheck.config,
    dockIds: derived.dockIds,
    byCategory: derived.byCategory,
    removed: derived.removed,
    theme,
  }
}

export interface SceneSwitchResult {
  ok: boolean
  /** 成功时：已更新 activeSceneId / lastUsedAt / lastSwitchBackup 的 doc */
  doc?: UserScenesDoc
  /** 切换前备份（内存里的一份；失败回滚与删除回落都用它） */
  backup?: LastSwitchBackup
  /** 本次切换没有自动备份时为 false（配额满仍可继续，但要 toast 警告） */
  backupSaved?: boolean
  /** 成功 toast 点名三件套用的事实 */
  summary?: {
    pinnedCount: number
    skinName: string | null
    layoutName: string
    mode: string | null
    suspended: boolean
  }
  removed?: Array<{ id: string; title?: string }>
  failedStep?: 'layout' | 'theme-install' | 'theme-fetch' | 'theme-payload' | 'diy-commit' | 'theme-apply' | 'mode-apply'
  reason?: string
  /** 失败时是否已回滚到切换前状态 */
  rolledBack?: boolean
}

/**
 * 切换场景：预检 → 备份 → 一次 DIY 提交 → 皮肤 → 明暗 → 写 doc。
 * 任一步失败 → 立即用备份恢复三件套，activeSceneId 不改。
 */
export async function applyScene(
  scene: UserScene,
  doc: UserScenesDoc,
  deps: SceneApplyDeps,
): Promise<SceneSwitchResult> {
  const preview = await previewSceneSwitch(scene, deps)
  if (!preview.ok || !preview.layout || !preview.dockIds || !preview.byCategory) {
    return { ok: false, failedStep: preview.failedStep, reason: preview.reason, rolledBack: false }
  }

  // 2. 备份：当前 DIY → 快照（复用 saveDiySnapshot）；主题 + 明暗记内存
  const beforeDiy = deps.getDiyConfig()
  const beforeTheme = deps.getActiveTheme()
  const beforeMode = deps.getMode()
  const backup: LastSwitchBackup = {
    diyConfig: beforeDiy,
    theme: beforeTheme,
    mode: beforeMode,
    activeSceneId: doc.activeSceneId,
    createdAt: Date.now(),
  }
  let backupSaved = true
  try {
    const saved = deps.saveSnapshot(beforeDiy, '切换前自动备份')
    if (!saved) backupSaved = false
  } catch {
    backupSaved = false
  }

  // 3a. 先写 DIY：一次提交 = 撤销栈里只有一步，Ctrl+Z 一次即回到切换前布局。
  // 皮肤 accent 优先：皮肤 accent 能映射到 DIY 强调色时，布局里的
  // accentColor 直接写成它（use-home-diy 的 effect 见同名守卫，不再二次覆盖）。
  const nextLayout: HomeDIYConfig = {
    ...preview.layout,
    speedDialPinnedIds: preview.dockIds,
    speedDialEnabled: preview.dockIds.length > 0,
    pinnedSiteIdsByCategory: preview.byCategory,
    updatedAt: Date.now(),
  }
  if (preview.theme?.accent && SKIN_ACCENT_TO_DIY[preview.theme.accent]) {
    nextLayout.accentColor = SKIN_ACCENT_TO_DIY[preview.theme.accent]
  }
  try {
    const committed = deps.commitDiy(() => nextLayout)
    if (!committed.ok) throw new Error('DIY 配置提交失败（本地存储不可用）')
  } catch (err) {
    const rolledBack = rollbackSceneSwitch(backup, deps)
    return {
      ok: false,
      backup,
      backupSaved,
      failedStep: 'diy-commit',
      reason: err instanceof Error ? err.message : 'DIY 配置提交失败',
      rolledBack,
    }
  }

  // 3b. 再写主题（skinSlug 为空时 resetTheme 回系统默认）
  try {
    if (preview.theme) {
      deps.setActiveTheme({
        slug: preview.theme.slug,
        name: preview.theme.name,
        tokens: preview.theme.tokens,
        accent: preview.theme.accent,
      })
    } else {
      deps.resetTheme()
    }
  } catch (err) {
    const rolledBack = rollbackSceneSwitch(backup, deps)
    return {
      ok: false,
      backup,
      backupSaved,
      failedStep: 'theme-apply',
      reason: err instanceof Error ? err.message : '皮肤应用失败',
      rolledBack,
    }
  }

  // 3c. 再写明暗（mode 为空不动；场景切换不改账号级 themePreference）
  try {
    if (scene.theme.mode) deps.setMode(scene.theme.mode)
  } catch (err) {
    const rolledBack = rollbackSceneSwitch(backup, deps)
    return {
      ok: false,
      backup,
      backupSaved,
      failedStep: 'mode-apply',
      reason: err instanceof Error ? err.message : '明暗模式切换失败',
      rolledBack,
    }
  }

  // 3d. 工作区筛选（非空时走 handleWorkspaceChange 同一路）
  if (scene.workspaceFilter) {
    try {
      deps.onWorkspaceChange?.(scene.workspaceFilter)
    } catch {
      // 筛选只是呈现层联动，失败不回滚整次切换（DIY/主题/明暗已生效）
    }
  }

  // 3e. 写场景 doc
  const nextDoc: UserScenesDoc = {
    ...markSceneUsed(doc, scene.id),
    lastSwitchBackup: backup,
  }
  // suspended 按切换后的目标状态算，不读切换瞬间的 document class：
  // setMode 只是调 next-themes，class 更新在 React effect 之后，同步读
  // isDarkMode() 拿到的是切换前的值（light→dark 漏提示、dark→light 多提示）
  const suspended = resolvePostSwitchDark(scene, deps) && preview.theme !== null
  return {
    ok: true,
    doc: nextDoc,
    backup,
    backupSaved,
    summary: {
      pinnedCount: preview.dockIds.length,
      skinName: preview.theme ? preview.theme.name : null,
      layoutName: layoutDisplayName(preview.layout),
      mode: scene.theme.mode,
      suspended,
    },
    removed: preview.removed,
  }
}

/**
 * 切换后是否深色：从场景 theme.mode 推导，不读切换瞬间的 document class。
 * light → 否；dark → 是；system → 现算 matchMedia；null（不动模式）→
 * 保持切换前状态（isDarkMode）。matchMedia 不可用时回落到切换前状态。
 */
export function resolvePostSwitchDark(scene: UserScene, deps: SceneApplyDeps): boolean {
  const mode = scene.theme.mode
  if (mode === 'dark') return true
  if (mode === 'light') return false
  if (mode === 'system') {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches
      } catch {
        return deps.isDarkMode()
      }
    }
    return deps.isDarkMode()
  }
  return deps.isDarkMode()
}

/** 用备份还原三件套：DIY 还原 + 主题还原 + 明暗还原（尽力而为，不抛） */
export function rollbackSceneSwitch(backup: LastSwitchBackup, deps: SceneApplyDeps): boolean {
  try {
    deps.commitDiy(() => backup.diyConfig)
  } catch {
    return false
  }
  try {
    if (backup.theme) {
      deps.setActiveTheme({
        slug: backup.theme.slug,
        name: backup.theme.name,
        tokens: backup.theme.tokens,
        accent: backup.theme.accent,
      })
    } else {
      deps.resetTheme()
    }
  } catch {
    return false
  }
  try {
    if (backup.mode) deps.setMode(backup.mode)
  } catch {
    return false
  }
  return true
}

/** 布局的人话名（toast 点名用）：视图 + 背景，如「经典全景流 · 网格背景」 */
export function layoutDisplayName(layout: HomeDIYConfig): string {
  const view =
    layout.viewMode === 'classic' ? '经典全景流' : layout.viewMode === 'workbench' ? '沉浸工作台' : '混合首页'
  const bg =
    layout.canvasBackground === 'mesh'
      ? '网格背景'
      : layout.canvasBackground === 'dots'
        ? '圆点背景'
        : layout.canvasBackground === 'grid'
          ? '方格背景'
          : layout.canvasBackground === 'aurora'
            ? '极光背景'
            : '干净背景'
  return `${view} · ${bg}`
}

/** 切换成功 toast 的主文案：三件套点名，禁止只报「已切换到工作」 */
export function sceneSwitchSuccessText(sceneName: string, summary: NonNullable<SceneSwitchResult['summary']>): string {
  const parts: string[] = [`置顶 ${summary.pinnedCount} 个站点`]
  parts.push(summary.skinName ? `皮肤「${summary.skinName}」` : '皮肤恢复系统默认')
  parts.push(`布局「${summary.layoutName}」`)
  if (summary.mode === 'dark') parts.push('深色模式')
  else if (summary.mode === 'light') parts.push('浅色模式')
  let text = `已切换到「${sceneName}」：${parts.join(' · ')}`
  if (summary.suspended) text += '。皮肤在深色模式下暂停，切回浅色自动恢复'
  return text
}

/* ------------------------------------------------------------------ *
 * 删除当前生效场景的回落链
 * ------------------------------------------------------------------ */

export type DeleteFallback =
  | { kind: 'switch-to-default'; scene: UserScene }
  | { kind: 'restore-backup'; backup: LastSwitchBackup }
  | { kind: 'stay-put' }

/**
 * 删除当前生效场景时的回落链：默认场景 → 切换前自动备份 → 原地不动。
 * 绝不回落到系统默认布局（那会清空用户攒下的布局）。
 * 返回 'switch-to-default' 时调用方再走一次 applyScene 切过去。
 */
export function deleteActiveSceneFallback(
  doc: UserScenesDoc,
  deletedSceneId: string,
): DeleteFallback {
  const fallback = doc.scenes.find(
    (s) => s.id === doc.defaultSceneId && s.id !== deletedSceneId,
  )
  if (fallback) return { kind: 'switch-to-default', scene: fallback }
  if (doc.lastSwitchBackup) return { kind: 'restore-backup', backup: doc.lastSwitchBackup }
  return { kind: 'stay-put' }
}

/* ------------------------------------------------------------------ *
 * 站点索引注册表：navigation-content 把全站站点→分类索引登记到这里，
 * SceneSwitcher / ⌘K / DIY 工具栏共用同一份，不各自重算。
 * ------------------------------------------------------------------ */

let registeredSiteIndex: Map<string, SceneSiteEntry> = new Map()

export function registerSceneSiteIndex(index: Map<string, SceneSiteEntry>): void {
  registeredSiteIndex = index
}

export function getRegisteredSceneSiteIndex(): Map<string, SceneSiteEntry> {
  return registeredSiteIndex
}

/**
 * 用取数后的最新分类建场景站点索引：新索引优先，注册表里仅有的条目
 * （自建分类）保留。场景切换在 await ensureHomeCategoriesLoaded() 后
 * 用返回的列表调它，不要直接读注册表——await 续体执行时 React 尚未
 * 重渲染，注册表仍是取数前的旧版，置顶站点会被当成已删除剪掉
 * （与工作区折叠同根的时序竞态，2026-11-26 flight 分片回归）。
 */
export function buildFreshSceneSiteIndex(
  freshCategories: SceneSiteCategoryLike[],
): Map<string, SceneSiteEntry> {
  return new Map([...registeredSiteIndex, ...buildSceneSiteIndex(freshCategories)])
}

export interface SceneSiteCategoryLike {
  id: string
  items?: Array<{ id: string; title: string }>
  subCategories?: Array<{ items?: Array<{ id: string; title: string }> }>
}

/**
 * 从导航分类 + 自建分类建站点索引（id → 标题 + 所属分类）。
 * 用未经过滤的原始分类建：置顶站点所在分类即使被隐藏/折叠也要能解析。
 */
export function buildSceneSiteIndex(
  categories: SceneSiteCategoryLike[],
  customCategories: Array<{ id: string; items?: Array<{ id: string; title: string }> }> = [],
): Map<string, SceneSiteEntry> {
  const index = new Map<string, SceneSiteEntry>()
  const add = (categoryId: string, items?: Array<{ id: string; title: string }>) => {
    for (const item of items ?? []) {
      if (!item?.id || index.has(item.id)) continue
      index.set(item.id, { id: item.id, title: item.title ?? item.id, categoryId })
    }
  }
  for (const category of categories) {
    add(category.id, category.items)
    for (const sub of category.subCategories ?? []) add(category.id, sub.items)
  }
  for (const custom of customCategories) add(custom.id, custom.items)
  return index
}
