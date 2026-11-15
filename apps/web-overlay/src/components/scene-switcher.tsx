'use client'

/**
 * 我的场景 — 首页工具栏下拉（SkinPicker 左侧）。
 *
 * 切换 = 预检 → 备份 → 一次 DIY 提交 → 皮肤 → 明暗 → 写 doc
 * （lib/modular/scene-apply 的 applyScene），失败全量回滚。
 * 切换成功 toast 必须点名三件套实际结果，禁止只报「已切换到工作」。
 *
 * 边界诚实标注：场景切换不改变沉浸工作台的看板（第二套布局系统
 * navhub_modular_multi_boards_v2 不在场景内）；场景只存在本机，不跨设备。
 */
import React from 'react'
import { Check, Layers, Plus, Settings2 } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/registry/new-york/ui/dropdown-menu'
import { useTheme } from 'next-themes'
import { useToast } from '@/components/ui/use-toast'
import { getHomeDiySnapshot } from '@/lib/modular/home-diy-storage'
import { getActiveTheme, isThemeSuspended } from '@/lib/plugins/theme-runtime'
import {
  applyScene,
  getRegisteredSceneSiteIndex,
  sceneSwitchSuccessText,
  type SceneSwitchResult,
} from '@/lib/modular/scene-apply'
import { buildLiveSceneDeps, buildLiveSceneDepsAsync } from '@/lib/modular/scene-apply-live'
import { SCENE_SWITCHED_EVENT } from '@/lib/route-prefetch'
import {
  broadcastUserScenesChanged,
  browserUserSceneStorage,
  clearSceneSwitchFlag,
  createUserScene,
  defaultSceneName,
  emptyUserScenesDoc,
  loadUserScenes,
  markSceneSwitchStarted,
  reconcileActiveSceneId,
  saveUserScenes,
  USER_SCENES_CHANGED_EVENT,
  type CurrentSceneState,
  type UserScene,
  type UserSceneWorkspaceFilter,
  type UserScenesDoc,
} from '@/lib/modular/user-scenes'
import { SceneManagerDialog } from '@/components/scene-manager-dialog'

/** 当前首页状态 → 场景捕获（三件套 = 当前置顶 + 当前皮肤 + 当前 DIY 配置） */
export function captureCurrentSceneState(
  workspaceFilter?: UserSceneWorkspaceFilter | null,
  mode?: string | null,
): CurrentSceneState {
  const config = getHomeDiySnapshot().config
  const activeTheme = getActiveTheme()
  const themeMode =
    mode === 'light' || mode === 'dark' || mode === 'system' ? mode : null
  return {
    pinnedSiteIds: [...(config.speedDialPinnedIds ?? [])],
    theme: {
      skinSlug: activeTheme?.slug ?? null,
      skinName: activeTheme?.name ?? null,
      mode: themeMode,
    },
    layout: config,
    workspaceFilter: workspaceFilter ?? null,
  }
}

export interface SceneSwitchToast {
  title: string
  description?: string
  variant?: 'destructive'
}

export interface PerformSceneSwitchOpts {
  theme: string | undefined
  setTheme: (mode: string) => void
  save: (doc: UserScenesDoc) => boolean
  toast: (t: SceneSwitchToast) => void
}

/**
 * 切换未完成旗标何时可清：成功、预检失败（什么都没改）、回滚成功
 * （已恢复切换前状态）都可以清；回滚失败时状态不确定，留旗标给下次
 * 加载标注「上次切换未完成」。
 */
export function shouldClearSwitchFlag(result: SceneSwitchResult): boolean {
  if (result.ok) return true
  if (
    result.failedStep === 'layout' ||
    result.failedStep === 'theme-install' ||
    result.failedStep === 'theme-fetch' ||
    result.failedStep === 'theme-payload'
  ) {
    return true
  }
  return result.rolledBack === true
}

/**
 * 切换场景的共用执行（含 toast）：工具栏下拉与 ⌘K 共用同一条路，
 * 保证两处成功/失败文案与回滚语义一致。返回 true = 已切换。
 */
export async function performSceneSwitch(
  scene: UserScene,
  doc: UserScenesDoc,
  opts: PerformSceneSwitchOpts,
): Promise<boolean> {
  if (scene.id === doc.activeSceneId) {
    opts.toast({ title: '已是当前场景', description: `「${scene.name}」已经是当前生效的场景。` })
    return false
  }
  // 切换开始前置旗标：页面在切换中途关闭时，下次加载凭它标注未完成
  const flagStorage = browserUserSceneStorage()
  if (flagStorage) markSceneSwitchStarted(flagStorage, scene.id)
  // 有皮肤的切换先拉一次已装列表：已装皮肤跳过 installPlugin 直接用，
  // 网络抖动不再让一次已装皮肤的切换失败；无皮肤的切换不额外发请求
  const deps = scene.theme.skinSlug
    ? await buildLiveSceneDepsAsync({
        getMode: () => opts.theme ?? null,
        setMode: (mode) => opts.setTheme(mode),
      })
    : buildLiveSceneDeps({
        getMode: () => opts.theme ?? null,
        setMode: (mode) => opts.setTheme(mode),
      })
  deps.siteIndex = getRegisteredSceneSiteIndex()
  const result = await applyScene(scene, doc, deps)
  if (flagStorage && shouldClearSwitchFlag(result)) clearSceneSwitchFlag(flagStorage)
  if (!result.ok) {
    opts.toast({
      title: '场景切换失败，已恢复到切换前状态',
      description: result.reason ?? '切换未完成，当前页面保持不变。',
      variant: 'destructive',
    })
    return false
  }
  if (result.doc) opts.save(result.doc)
  if (!result.backupSaved) {
    opts.toast({
      title: '本次切换没有自动备份',
      description: '本地存储已满，未能保存切换前自动备份；Ctrl+Z 仍可撤回布局部分。',
      variant: 'destructive',
    })
  }
  if (result.summary) {
    opts.toast({
      title: sceneSwitchSuccessText(scene.name, result.summary),
      description: '场景切换不改变沉浸工作台的看板；场景只存在本机，不跨设备。',
    })
  }
  if (result.removed && result.removed.length > 0) {
    const named = result.removed.filter((r) => r.title).map((r) => r.title as string)
    opts.toast({
      title: `其中 ${result.removed.length} 个站点已不存在，已从场景中移除`,
      description: named.length > 0 ? named.join('、') : undefined,
    })
  }
  // Batch 3 第 8 项 P2：切换成功后发事件，由 PredictivePrefetchProvider 接住，
  // 空闲预取目标场景首页 1 条最高优先站内路由（buildSceneLandingCandidate）。
  // 工具栏下拉与 ⌘K 共用 performSceneSwitch，两处都走这条路；失败 / 已是当前
  // 场景时不发（上面已提前 return）。
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(SCENE_SWITCHED_EVENT, { detail: { sceneId: scene.id } }),
    )
  }
  return true
}

export function useUserScenes(): {
  doc: UserScenesDoc
  refresh: () => void
  save: (next: UserScenesDoc) => boolean
} {
  const [doc, setDoc] = React.useState<UserScenesDoc>(() => emptyUserScenesDoc())
  const refresh = React.useCallback(() => {
    const storage = browserUserSceneStorage()
    if (!storage) return
    const loaded = loadUserScenes(storage)
    const reconciled = reconcileActiveSceneId(loaded.doc)
    if (reconciled.cleared || loaded.incompleteSwitch) {
      // 上次切换未完成：activeSceneId 指向不存在的场景，或切换中途关闭
      // 留下的旗标被本次加载消费——清 null 并落盘，标注由 SceneSwitcher
      // 的 incompleteSwitch 旗标展示
      saveUserScenes(storage, reconciled.doc)
      setDoc({ ...reconciled.doc, })
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('navhub:user-scenes-incomplete-switch'))
      }
    } else {
      setDoc(loaded.doc)
    }
  }, [])
  React.useEffect(() => {
    refresh()
    window.addEventListener(USER_SCENES_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(USER_SCENES_CHANGED_EVENT, refresh)
  }, [refresh])
  const save = React.useCallback(
    (next: UserScenesDoc) => {
      const storage = browserUserSceneStorage()
      if (!storage) return false
      const ok = saveUserScenes(storage, next)
      if (ok) {
        setDoc(next)
        broadcastUserScenesChanged()
      }
      return ok
    },
    [],
  )
  return { doc, refresh, save }
}

export function SceneSwitcher({
  activeWorkspace,
  className,
  menuSide = 'bottom',
}: {
  activeWorkspace?: UserSceneWorkspaceFilter
  className?: string
  menuSide?: 'top' | 'bottom'
}) {
  const { toast } = useToast()
  const { theme, setTheme } = useTheme()
  const { doc, save } = useUserScenes()
  const [open, setOpen] = React.useState(false)
  const [applyingId, setApplyingId] = React.useState<string | null>(null)
  const [managerOpen, setManagerOpen] = React.useState(false)
  const [incompleteSwitch, setIncompleteSwitch] = React.useState(false)

  React.useEffect(() => {
    const onIncomplete = () => setIncompleteSwitch(true)
    window.addEventListener('navhub:user-scenes-incomplete-switch', onIncomplete)
    return () => window.removeEventListener('navhub:user-scenes-incomplete-switch', onIncomplete)
  }, [])

  const activeScene: UserScene | null =
    doc.scenes.find((s) => s.id === doc.activeSceneId) ?? null
  const suspended = isThemeSuspended()

  const handleSwitch = async (scene: UserScene) => {
    if (applyingId !== null) return
    setApplyingId(scene.id)
    try {
      const switched = await performSceneSwitch(scene, doc, {
        theme,
        setTheme,
        save,
        toast,
      })
      if (switched) {
        setIncompleteSwitch(false)
        setOpen(false)
      }
    } finally {
      setApplyingId(null)
    }
  }

  const handleSaveCurrent = () => {
    const name = defaultSceneName(doc)
    const created = createUserScene(doc, {
      name,
      state: captureCurrentSceneState(activeWorkspace, theme),
    })
    if (!created.ok || !created.doc || !created.scene) {
      toast({ title: '存为场景失败', description: created.reason ?? '请稍后再试。', variant: 'destructive' })
      return
    }
    if (!save(created.doc)) {
      toast({ title: '存为场景失败', description: '本地存储写入失败，场景没有保存下来。', variant: 'destructive' })
      return
    }
    toast({
      title: `已存为场景「${created.scene.name}」`,
      description: `置顶 ${created.scene.pinnedSiteIds.length} 个站点 · 皮肤「${created.scene.theme.skinName ?? '系统默认'}」· 当前布局已存入场景。布局改了场景不跟变，用「用当前状态更新此场景」同步。`,
    })
    setOpen(false)
  }

  const sorted = React.useMemo(() => {
    const byLastUsed = (a: UserScene, b: UserScene) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
    return [...doc.scenes].sort(byLastUsed)
  }, [doc.scenes])

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={setOpen}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={applyingId !== null}
            className={`h-11 w-auto rounded-lg gap-1.5 px-2 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground ${className || ''}`}
            title={
              activeScene
                ? `我的场景：当前为「${activeScene.name}」${suspended ? '（皮肤在深色模式下暂停）' : ''}（点击切换）`
                : '我的场景：点击切换或保存当前状态为场景'
            }
            aria-label={activeScene ? `我的场景：当前为${activeScene.name}` : '我的场景'}
          >
            <Layers className="h-4 w-4" />
            <span className="hidden sm:inline text-sm">
              {applyingId !== null ? '切换中…' : activeScene ? activeScene.name : '场景'}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side={menuSide} className="w-80">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            我的场景（置顶 + 主题 + 布局一起换）
          </DropdownMenuLabel>
          {incompleteSwitch && (
            <DropdownMenuItem disabled className="text-xs text-destructive-text">
              上次切换未完成，已恢复切换前状态
            </DropdownMenuItem>
          )}
          {sorted.length === 0 ? (
            <DropdownMenuItem disabled className="flex-col items-start gap-1 py-3">
              <span className="text-sm font-medium">还没有场景</span>
              <span className="text-xs text-muted-foreground whitespace-normal">
                把现在的工作状态存成场景，下次一键回来。场景只存在本机，不跨设备。
              </span>
            </DropdownMenuItem>
          ) : (
            sorted.map((scene) => {
              const isActive = scene.id === doc.activeSceneId
              const isDefault = scene.id === doc.defaultSceneId
              return (
                <DropdownMenuItem
                  key={scene.id}
                  onSelect={(event) => {
                    event.preventDefault()
                    void handleSwitch(scene)
                  }}
                  disabled={applyingId !== null}
                  className="flex cursor-pointer items-center gap-2 py-2"
                  aria-selected={isActive}
                >
                  <span className="shrink-0 text-base leading-none" aria-hidden>
                    {scene.icon ?? scene.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {scene.name}
                      {isActive ? ' · 当前' : ''}
                      {isDefault ? ' · 默认' : ''}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {applyingId === scene.id
                        ? '正在切换…'
                        : `置顶 ${scene.pinnedSiteIds.length} 个站点 · ${scene.theme.skinName ?? '系统默认皮肤'}${scene.theme.mode === 'dark' ? ' · 深色' : scene.theme.mode === 'light' ? ' · 浅色' : ''}`}
                    </span>
                  </span>
                  {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </DropdownMenuItem>
              )
            })
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              handleSaveCurrent()
            }}
            disabled={applyingId !== null}
            className="cursor-pointer min-h-11 gap-2"
          >
            <Plus className="h-4 w-4" />
            一键存为场景（保存当前置顶 + 皮肤 + 布局）
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              setManagerOpen(true)
              setOpen(false)
            }}
            className="cursor-pointer min-h-11 gap-2"
          >
            <Settings2 className="h-4 w-4" />
            管理场景…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled className="text-xs text-muted-foreground whitespace-normal">
            场景切换不改变沉浸工作台的看板；场景只存在本机，不跨设备。
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SceneManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        activeWorkspace={activeWorkspace}
      />
    </>
  )
}
