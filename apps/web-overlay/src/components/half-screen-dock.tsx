'use client'

/**
 * 半屏下沉栏 HalfScreenDock（Batch 3 第 12 项）。
 *
 * 定义（Ryan 2026-11-13 22:01 确认）：视口 640–1024px 时，顶部工具栏
 * 在半屏下丢失的操作（密度、视图等）下沉到底部一条常驻的拇指区操作栏。
 * 不是 DIY 模块半屏沉底。
 *
 * 显隐用纯 CSS，不用 JS 量宽度：默认 hidden，
 * min-[640px]:max-[1024px]:flex，与 MobileNav（<640）与完整工具栏
 * （≥1024）形成三段互斥，同一时刻最多出现一个；无 JS 状态 ⇒ 无水合闪烁。
 * 注意上界写 1024 而不是 1023：Tailwind v4 的 max-* 变体是左闭右开
 * （width < 1024px），写 max-[1023px] 会在 1023px 恰好漏掉——
 * 2026-11-14 真实视口实测：1022 显示、1023 不显示，改 1024 后
 * 639/640/1023/1024 四边界全部符合设计区间 [640, 1024)。
 *
 * 栏内 6 项封顶，每项 ≥44px；内容是顶部工具栏已有入口的复用，
 * 不新建任何状态：场景 / 密度复用同一份 useUserScenes / useDensity，
 * 工具箱与热度榜只是已有 onOpenTools / /hot 的第二个挂载点。
 * 明确不进栏：首页/分类/收藏/我的（MobileNav 的入口）、搜索、
 * 字号/长辈模式/皮肤/明暗（工具栏已全尺寸可见）。
 *
 * 让位：isEditingLayout 时不渲染（DIY HUD 优先）；多选模式且
 * selectedIds.length > 0 时不渲染（BatchOperationDock 优先）。
 * 挂载点选 navigation-content.tsx 而非 navigation-toolbar.tsx：
 * 工具栏没有 isEditingLayout 这个 prop，编辑态隐藏在该文件内无法直接
 * 实现；navigation-content 已同时持有 isEditingLayout、selectionMode、
 * selectedIds 与 setIsToolsOpen，少一次 prop 透传。
 *
 * 已知局限（v1 接受）：1024–1280px 区间工具箱/热度榜既不在下沉栏
 * 也不在工具栏（它们是 hidden xl），只剩探索矩阵下拉的两步入口；
 * 不要擅自把下沉栏延到 1280。
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Flame, Wrench, X } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { DensityToggle } from '@/components/density-toggle'
import { SceneSwitcher } from '@/components/scene-switcher'
import { ViewModeToggle } from '@/components/view-mode-toggle'
import { useToast } from '@/components/ui/use-toast'
import {
  HALF_SCREEN_DOCK_CHANGED_EVENT,
  loadHalfScreenDockOn,
  setHalfScreenDockOn,
} from '@/lib/half-screen-dock'
import type { UserSceneWorkspaceFilter } from '@/lib/modular/user-scenes'

export function HalfScreenDock({
  activeWorkspace,
  onOpenTools,
  isEditingLayout,
  selectionMode,
  selectedIds,
}: {
  activeWorkspace?: UserSceneWorkspaceFilter
  onOpenTools: () => void
  isEditingLayout: boolean
  selectionMode: boolean
  selectedIds: string[]
}) {
  const { toast } = useToast()
  // 开关默认开，本机存储（lib/half-screen-dock.ts）；读不到/损坏按开处理
  const [on, setOn] = useState(true)
  useEffect(() => {
    setOn(loadHalfScreenDockOn(window.localStorage))
    const refresh = () => setOn(loadHalfScreenDockOn(window.localStorage))
    window.addEventListener(HALF_SCREEN_DOCK_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(HALF_SCREEN_DOCK_CHANGED_EVENT, refresh)
  }, [])

  const handleClose = () => {
    setHalfScreenDockOn(false, window.localStorage)
    setOn(false)
    toast({ title: '已关闭半屏下沉栏，可在设置页重新打开' })
  }

  // 编辑态让位给 DIY HUD；多选态让位给 BatchOperationDock
  if (isEditingLayout) return null
  if (selectionMode && selectedIds.length > 0) return null
  if (!on) return null

  return (
    <nav
      role="toolbar"
      aria-label="半屏快捷操作"
      className="fixed bottom-0 left-0 right-0 z-40 hidden min-[640px]:max-[1024px]:flex h-14 items-center justify-around border-t border-border/40 bg-background/95 backdrop-blur px-2 pb-[env(safe-area-inset-bottom,0px)]"
    >
      {/* 场景：复用工具栏同款 SceneSwitcher，下拉菜单向上开 */}
      <SceneSwitcher activeWorkspace={activeWorkspace} menuSide="top" />
      {/* 密度：半屏下 hidden lg 完全丢失的首要恢复项，下拉菜单向上开 */}
      <DensityToggle menuSide="top" />
      {/* 视图：触发钮非方形（min-h-11 px-2，label 在 <xl 隐藏后宽约 32–36px），
          进栏须补 h-11 w-11 / min-w-11 满足 44×44；下拉菜单向上开 */}
      <ViewModeToggle menuSide="top" className="h-11 w-11 min-w-11 justify-center" />
      {/* 工具箱：半屏下 hidden xl，只藏在探索矩阵下拉里；复用 onOpenTools */}
      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-11 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        onClick={() => onOpenTools()}
        title="打开内置微工具箱 (快捷键: T)"
        aria-label="微工具箱"
      >
        <Wrench className="h-4 w-4" />
      </Button>
      {/* 热度榜：半屏下 hidden xl，只藏在探索矩阵下拉里 */}
      <Button
        asChild
        variant="ghost"
        size="icon"
        className="h-11 w-11 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
      >
        <Link href="/hot" title="热度趋势榜" aria-label="热度趋势榜">
          <Flame className="h-4 w-4" />
        </Link>
      </Button>
      {/* 关闭 ×：只写本机偏好 off，不碰云端设置 */}
      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-11 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        onClick={handleClose}
        title="关闭半屏下沉栏"
        aria-label="关闭半屏下沉栏"
      >
        <X className="h-4 w-4" />
      </Button>
    </nav>
  )
}
