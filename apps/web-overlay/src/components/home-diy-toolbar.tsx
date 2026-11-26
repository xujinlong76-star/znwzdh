'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  AlertTriangle,
  Palette,
  RotateCcw,
  Check,
  Sparkles,
  CreditCard,
  ChevronDown,
  FolderPlus,
  Pin,
  Download,
  LayoutGrid,
  Layers,
  Wand2,
  Undo2,
  Redo2,
  Trash2,
  MoreHorizontal,
  X,
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { HomeDIYCreateCategoryDialog } from '@/components/home-diy-create-category-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/registry/new-york/ui/dropdown-menu'
import { Input } from '@/registry/new-york/ui/input'
import { useHomeDIY, setHomeDiyPreview, type AccentColor } from '@/lib/modular/use-home-diy'
import {
  CARD_DISPLAY_MODE_OPTIONS,
  getCardDisplayModeMeta,
  normalizeCardDisplayMode,
} from '@/lib/modular/card-display-modes'
import { resetAllModuleWindowSizes } from '@/lib/modular/module-resize-store'
import { HomeDIYBackupDialog } from '@/components/home-diy-backup-dialog'
import { HomeDiyShareConfirmDialog } from '@/components/diy/home-diy-share-confirm-dialog'
import { HomeDIYOutlineDialog, type OutlineDialogTab } from '@/components/home-diy-outline-dialog'
import { useFeatureMask } from '@/lib/modular/feature-mask-store'
import { useDensity } from '@/components/density-provider'
import { isAppleDevice } from '@/lib/platform'
import { BUILTIN_DIY_PRESETS, clampCardOpacity, evaluateLayoutErgonomics, parseDiyShortcut, type DIYPreset } from '@/lib/modular/diy-presets'
import { useTheme } from 'next-themes'
import { useToast } from '@/components/ui/use-toast'
import { describeCorruptFavorites } from '@/lib/favorites-storage'
import { cn } from '@/lib/utils'
import { captureCurrentSceneState } from '@/components/scene-switcher'
import {
  broadcastUserScenesChanged,
  browserUserSceneStorage,
  createUserScene,
  defaultSceneName,
  loadUserScenes,
  saveUserScenes,
  type UserSceneWorkspaceFilter,
} from '@/lib/modular/user-scenes'

interface HomeDIYToolbarProps {
  allCategoryIds: string[]
  categoryTitleMap: Record<string, string>
  categories?: any[]
  raised?: boolean
  /** 当前首页工作区筛选（navigation-content 的 activeWorkspace 原样透传） */
  activeWorkspace?: UserSceneWorkspaceFilter
}

const ACCENT_COLORS: { id: AccentColor; name: string; class: string }[] = [
  { id: 'default', name: '经典极客', class: 'bg-zinc-800 dark:bg-zinc-200' },
  { id: 'violet', name: '赛博紫', class: 'bg-violet-500' },
  { id: 'emerald', name: '翡翠绿', class: 'bg-emerald-500' },
  { id: 'amber', name: '琥珀金', class: 'bg-amber-500' },
  { id: 'rose', name: '玫瑰红', class: 'bg-rose-500' },
]

export function HomeDIYToolbar({
  allCategoryIds,
  categoryTitleMap,
  categories = [],
  activeWorkspace,
}: HomeDIYToolbarProps) {
  const {
    isEditingLayout,
    toggleEditingLayout,
    cardDisplayMode,
    setCardDisplayMode,
    canvasBackground,
    setCanvasBackground,
    accentColor,
    setAccentColor,
    pinnedCategoryIds,
    hiddenCategoryIds,
    setHiddenCategories,
    customCategories,
    isAdaptiveRankingEnabled,
    toggleAdaptiveRanking,
    togglePinCategory,
    toggleHideCategory,
    unhideAllCategories,
    moveCategory,
    resetCategoryLayout,
    addCustomCategory,
    deleteCustomCategory,
    applyDIYPreset,
    exportDIYConfig,
    importDIYConfig,
    exportEncryptedDIYConfig,
    importEncryptedDIYConfig,
    syncToCloudVault,
    syncFromCloudVault,
    checkCloudVaultStatus,
    clearCloudVault,
    canUndo,
    canRedo,
    undo,
    redo,
    collapsedCategoryIds,
    toggleCollapseCategory,
    collapseAllCategories,
    expandAllCategories,
    exportPresetToUrlHash,
    stageImportForConfirm,
    glassmorphismBlur,
    cardOpacity,
    setAestheticSliders,
    speedDialEnabled,
    toggleSpeedDial,
    applySmartAutoTune,
    storageWarning,
    dismissStorageWarning,
    workspaceLayoutV2,
    outlineMode,
    toggleOutlineMode,
    setWorkspaceCompactType,
  } = useHomeDIY()
  const compactType = workspaceLayoutV2?.gridConfig.compactType ?? 'vertical'

  const { density, setDensity } = useDensity()
  const { toast } = useToast()

  // 平台感知的撤销/重做标题：Mac 上重做是 Cmd+Shift+Z，Ctrl+Y 不可用；
  // navigator 只在客户端可读，挂载后再判，避免 SSR 与水合文案不一致。
  const [isMac, setIsMac] = useState(false)
  useEffect(() => {
    setIsMac(isAppleDevice())
  }, [])

  const healthReport = useMemo(() => {
    const targetCats =
      categories && categories.length > 0
        ? categories
        : allCategoryIds.map((id) => ({ id, title: categoryTitleMap[id] || id, items: [] }))
    return evaluateLayoutErgonomics(targetCats, {
      pinnedCategoryIds,
      hiddenCategoryIds,
    })
  }, [categories, allCategoryIds, categoryTitleMap, pinnedCategoryIds, hiddenCategoryIds])

  const [isAddCatOpen, setIsAddCatOpen] = useState(false)
  const [newCatTitle, setNewCatTitle] = useState('')
  const [isBackupOpen, setIsBackupOpen] = useState(false)
  const [isManagerOpen, setIsManagerOpen] = useState(false)
  const [managerTab, setManagerTab] = useState<OutlineDialogTab>('outline')
  const [aiPrompt, setAiPrompt] = useState('')

  const { trashBin, totalPrunedCount, restoreAll } = useFeatureMask()

  useEffect(() => {
    const onOpenRecovery = (e: Event) => {
      const detail = (e as CustomEvent<{ tab?: OutlineDialogTab }>).detail
      setManagerTab(detail?.tab || 'trash')
      setIsManagerOpen(true)
    }
    window.addEventListener('navhub:open-recovery-center', onOpenRecovery)
    return () => window.removeEventListener('navhub:open-recovery-center', onOpenRecovery)
  }, [])

  const handleCreateCategory = () => {
    if (!newCatTitle.trim()) return
    addCustomCategory(newCatTitle.trim())
    toast({
      title: '🎉 专属分类已创建',
      description: `分类「${newCatTitle.trim()}」已置于首页顶层，可在编排模式下自由管理。`,
    })
    setNewCatTitle('')
    setIsAddCatOpen(false)
  }

  const { theme: currentMode } = useTheme()

  /** 一键存为场景：把当前置顶 + 皮肤 + DIY 布局存成新场景，带上当前工作区筛选（与下拉入口、管理对话框同一路） */
  const handleSaveAsScene = () => {
    const storage = browserUserSceneStorage()
    if (!storage) {
      toast({ title: '存为场景失败', description: '浏览器不允许读写本地存储。', variant: 'destructive' })
      return
    }
    const doc = loadUserScenes(storage).doc
    const created = createUserScene(doc, {
      name: defaultSceneName(doc),
      state: captureCurrentSceneState(activeWorkspace ?? null, currentMode),
    })
    if (!created.ok || !created.doc || !created.scene) {
      toast({ title: '存为场景失败', description: created.reason ?? '请稍后再试。', variant: 'destructive' })
      return
    }
    if (!saveUserScenes(storage, created.doc)) {
      toast({ title: '存为场景失败', description: '本地存储写入失败，场景没有保存下来。', variant: 'destructive' })
      return
    }
    broadcastUserScenesChanged()
    toast({
      title: `已存为场景「${created.scene.name}」`,
      description: `置顶 ${created.scene.pinnedSiteIds.length} 个站点 · 皮肤「${created.scene.theme.skinName ?? '系统默认'}」· 当前布局已存入场景。布局改了场景不跟变，用「用当前状态更新此场景」同步。`,
    })
  }

  const handleReset = () => {
    resetCategoryLayout()
    resetAllModuleWindowSizes()
    restoreAll()
    toast({
      title: '已重置全站排版与所有已删减功能',
      description: '分类排序、模块显隐、卡片微元素与所有模块窗口尺寸已无损恢复系统默认。',
    })
  }

  const handleFinishEditing = () => {
    toggleEditingLayout()
    toast({
      title: '已退出排版编辑模式',
      description: '配置已自动持久化至本地',
    })
  }

  // 焦点管理：工具栏只在编排态挂载。进编排时记下当时聚焦的元素、把焦点
  // 移进工具栏首个控件；退出（卸载）时把焦点还回去。触发按钮在编排态
  // 不渲染（home-diy-trigger 在 isEditingLayout 时 return null），所以
  // 原元素可能已卸载——卸载后等一拍再还，找不到原元素就回退到重新出现
  // 的触发按钮（按 title 找，触发按钮无 aria-label/data 属性）。
  const toolbarRootRef = useRef<HTMLDivElement | null>(null)
  const previouslyFocusedRef = useRef<Element | null>(null)
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement
    toolbarRootRef.current
      ?.querySelector<HTMLElement>('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])')
      ?.focus()
    return () => {
      const prev = previouslyFocusedRef.current
      window.setTimeout(() => {
        if (prev && prev.isConnected && prev instanceof HTMLElement) {
          prev.focus()
          return
        }
        document.querySelector<HTMLElement>('button[title^="开启 DIY 排版"]')?.focus()
      }, 0)
    }
  }, [])

  const finishEditingRef = useRef(handleFinishEditing)
  finishEditingRef.current = handleFinishEditing

  const handleApplyPreset = (presetId: string) => {
    const ok = applyDIYPreset(presetId, (d) => setDensity(d as any))
    if (ok) {
      // 长辈模式开着时 globals.css 的 [data-elder-mode="on"] 会把密度变量
      // 覆盖成宽松档：预设写了 data-density，间距仍是宽松，必须明说，
      // 否则用户会以为预设的密度生效了。
      const elderOn =
        typeof document !== 'undefined' &&
        document.documentElement.getAttribute('data-elder-mode') === 'on'
      toast({
        title: '✨ 预设情境已应用',
        description: elderOn
          ? '视窗形态与画布背景已应用；长辈模式开启中，密度仍保持宽松间距，关闭长辈模式后恢复。'
          : '视窗形态、卡片密度与画布背景已完成智能匹配。',
      })
    }
  }

  // Esc 退出编排。Ctrl/Cmd+E 不在这里处理：唯一入口是
  // keyboard-shortcuts-dialog.tsx:140（单源），工具栏再挂一份
  // 会和它抢 toggle（两处同时 preventDefault + toggle 会互相抵消）。
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      const isInput =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT' ||
          (activeEl as HTMLElement).isContentEditable)
      if (isInput) return

      // 对话框 / 菜单打开时 Esc 归它们：Radix 对话框的 Esc 是「关闭对话框」，
      // 下拉菜单的 Esc 是「收起菜单」；这里不拦，工具栏会顺手退出编排。
      // 判定抄 keyboard-shortcuts-dialog.tsx（role=dialog / alertdialog，
      // 排除 aria-hidden 的关闭态常驻节点），再加 role=menu（下拉菜单）。
      const overlayOpen = typeof document !== 'undefined' && Boolean(
        document.querySelector(
          '[role="dialog"]:not([aria-hidden="true"]), [role="alertdialog"]:not([aria-hidden="true"]), [role="menu"]:not([aria-hidden="true"])',
        ),
      )
      if (overlayOpen) return

      if (e.key === 'Escape' && isEditingLayout) {
        e.preventDefault()
        finishEditingRef.current()
      }
    }
    window.addEventListener('keydown', handleGlobalKey)
    return () => window.removeEventListener('keydown', handleGlobalKey)
  }, [isEditingLayout])

  // 预设悬停/聚焦预览：只覆盖快照与 data-density 属性，不提交、不落盘、不进撤销栈。
  // 悬停结束 / 菜单关闭 / 点击应用 / 组件卸载时都要清掉，否则预览值会一直盖着真实配置。
  // 覆盖面 = setHomeDiyPreview 的 DiyPreviewPatch（home-diy-storage.ts）：
  // cardDisplayMode / canvasBackground / viewMode / heroDeckCollapsed /
  // heroDeckWidgets——渲染层读的是快照 config（真实配置 + 预览覆盖），所以悬停
  // zen-focus 时就能看到 classic 视图 + 折叠展板，不必等点击。密度走 data-density。
  // 键盘聚焦也要预览：只挂 onMouseEnter 是鼠标专属，键盘用户收不到任何预览。
  const handlePresetHover = (preset: DIYPreset | null) => {
    if (preset) {
      setHomeDiyPreview({
        cardDisplayMode: preset.config.cardDisplayMode,
        canvasBackground: preset.config.canvasBackground,
        viewMode: preset.config.viewMode,
        heroDeckCollapsed: preset.config.heroDeckCollapsed,
        heroDeckWidgets: preset.config.heroDeckWidgets,
      })
      document.documentElement.setAttribute('data-density', preset.config.density)
    } else {
      setHomeDiyPreview(null)
      document.documentElement.setAttribute('data-density', density)
    }
  }

  const handleApplyPresetAndClearPreview = (presetId: string) => {
    setHomeDiyPreview(null)
    // 点击即提交：密度由 applyDIYPreset 经 setDensity 写回偏好，
    // 偏好 effect 会把 data-density 设回新档位；这里先恢复，避免中途闪一下旧值。
    document.documentElement.setAttribute('data-density', density)
    handleApplyPreset(presetId)
  }

  // 卸载时清掉可能残留的预览（例如菜单开着就切走了页面）
  useEffect(() => {
    return () => setHomeDiyPreview(null)
  }, [])

  // 快捷指令：只是关键词匹配（见 diy-presets.parseDiyShortcut），不是 AI。
  // 占位符与提示只列真正能识别的词；一个意图都没识别出来时必须如实说没听懂，
  // 不许再 toast 假成功（旧实现兜底文案「已根据意图优化排版布局」是编造）。
  const handleRunAiPrompt = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!aiPrompt.trim()) return
    const match = parseDiyShortcut(aiPrompt, { allCategoryIds, categoryTitleMap })
    if (match.density) setDensity(match.density)
    if (match.cardDisplayMode) setCardDisplayMode(match.cardDisplayMode)
    if (match.canvasBackground) setCanvasBackground(match.canvasBackground)
    if (match.hiddenCategoryIds && setHiddenCategories) {
      setHiddenCategories(match.hiddenCategoryIds)
    }
    if (match.feedback.length > 0) {
      toast({
        title: '🪄 快捷指令已生效',
        description: `已为您匹配：${match.feedback.join('、')}`,
      })
    } else {
      toast({
        title: '这句我没匹配到可执行的排版意图',
        description: '试试这样说：「5列紧凑」「只看AI与前端」「极光背景」「胶囊模式」。',
      })
    }
    setAiPrompt('')
  }

  // 卡片不透明度滑杆：拖动时只改本地草稿（数字即时显示），松开 / 失焦 /
  // 按键抬起 / 菜单关闭时才提交一次。以前 onChange 每 tick 就 commit，
  // 一次拖动能刷出几十条撤销记录和几十次落盘。
  const [opacityDraft, setOpacityDraft] = useState<number | null>(null)
  const committedOpacity = clampCardOpacity(cardOpacity)
  const shownOpacity = opacityDraft ?? committedOpacity
  const commitOpacityDraft = () => {
    if (opacityDraft === null) return
    const target = opacityDraft
    setOpacityDraft(null)
    if (target !== committedOpacity) {
      setAestheticSliders(glassmorphismBlur ?? 12, target)
    }
  }

  const handleRunSmartAutoTune = () => {
    const allSites = categories.flatMap((c) => [
      ...(c.items || []),
      ...(c.subCategories || []).flatMap((sub: any) => sub.items || []),
    ])
    // applySmartAutoTune 返回真实落盘的结果：速览坞取的是按访问频次 + 星标
    // 排前 10 的站点（站点不足 10 就只取现有的），不改任何密度/网格设置，
    // 分类按访问热度全量重排（不限于技术类目）。toast 必须按这个结果说，
    // 不许编数字、密度功效或类目定向。
    const result = applySmartAutoTune(allSites, categories)
    if (result === null) {
      // 收藏数据读不出来：调优未执行、未落盘。不能弹「调优已生效」，
      // 那会是假成功；如实告知用户原数据还在、可先备份再重置。
      toast({
        title: '收藏数据读不出来，调优未执行',
        description: describeCorruptFavorites(),
      })
      return
    }
    const counts = result.appliedCounts
    toast({
      title: '✨ 智能调优已生效',
      description: `已按访问频次与星标把 ${counts.speedDialCount} 个高频站点置入速览坞，按访问热度重排分类${counts.collapsedCount > 0 ? `并折叠 ${counts.collapsedCount} 个无访问的长尾分类` : '、折叠无访问的长尾分类'}，同时开启自适应排序（可按 ↩ 撤销）`,
    })
  }

  return (
    <>
        {storageWarning && (
          <div
            role="alert"
            className={cn(
              'fixed left-1/2 -translate-x-1/2 z-50 pointer-events-auto max-w-[92vw] w-max flex items-start gap-2 rounded-xl',
              'border border-amber-500/40 bg-amber-50/95 dark:bg-amber-950/90 backdrop-blur-md',
              'px-3 py-2 text-[11px] leading-snug text-amber-900 dark:text-amber-100 shadow-lg',
              'bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+4.25rem)] sm:bottom-[4.75rem]',
            )}
          >
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span className="flex-1">{storageWarning}</span>
            <button
              type="button"
              onClick={() => setIsBackupOpen(true)}
              className="shrink-0 min-h-11 rounded-lg px-3 py-1 font-semibold text-amber-900 dark:text-amber-100 bg-amber-500/20 hover:bg-amber-500/30 transition-colors cursor-pointer"
            >
              导出备份
            </button>
            {/* 16px 的 × 视觉不变，::after 把点击区无形扩到 44px（提示条不增高） */}
            <button
              type="button"
              onClick={dismissStorageWarning}
              aria-label="关闭提示"
              className="relative shrink-0 rounded p-0.5 hover:bg-amber-500/20 transition-colors cursor-pointer after:absolute after:-inset-3.5 after:content-['']"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        <div
          ref={toolbarRootRef}
          data-diy-hud="true"
          data-testid="diy-toolbar"
          className={cn(
            'fixed left-1/2 lg:left-[calc(50%+110px)] -translate-x-1/2 z-50 pointer-events-auto',
            'bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+0.5rem)] sm:bottom-4',
            // Phase 1 A2：375px–1440px 全视口零溢出零裁切——取消 w-max，保证右侧主操作簇（撤销/重做/完成）始终 shrink-0 完整可见
            'w-[calc(100vw-1rem)] sm:w-auto sm:max-w-[94vw] rounded-2xl',
            'bg-white/92 dark:bg-slate-900/92 backdrop-blur-md shadow-2xl border border-slate-200/80 dark:border-slate-800/80 px-2 sm:px-3 py-1.5 sm:py-2',
            'flex items-center justify-between gap-1.5 sm:gap-2',
            'animate-in fade-in slide-in-from-bottom-3 duration-200'
          )}
        >
          {/* 左侧控制簇：桌面端直出全部工具，窄视口（<lg）自动将低频工具收拢进「更多」弹出菜单，彻底杜绝溢出裁切 */}
          <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 flex-1 overflow-hidden">
            {/* 快捷预设 */}
            <DropdownMenu onOpenChange={(open) => { if (!open) handlePresetHover(null) }}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 px-2.5 rounded-xl text-xs gap-1.5 border-border/70 hover:border-primary/50"
                  title="快捷指令或悬停预览预设（悬停只预览，不改配置、不留撤销记录）"
                >
                  <Wand2 className="w-3.5 h-3.5 text-amber-500" />
                  <span className="font-semibold">快捷预设</span>
                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-80 p-1.5">
                <div className="p-2 border-b border-border/40">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-xs font-semibold text-foreground">快捷指令（关键词匹配）</span>
                  </div>
                  <form onSubmit={handleRunAiPrompt} className="flex items-center gap-1">
                    <Input
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder="如：5列紧凑胶囊、极光背景、只看AI与前端"
                      aria-label="快捷指令输入"
                      className="h-11 text-xs rounded-lg"
                    />
                    <Button type="submit" size="sm" className="min-h-11 px-2 text-xs shrink-0 rounded-lg">
                      执行
                    </Button>
                  </form>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-1.5">
                    只认这些关键词：3列/4列/5列/6列 · 宽松/标准/紧凑 · 胶囊/丰富/深度 · 极简/网格/极光 · 只看AI/前端
                  </p>
                </div>
                <DropdownMenuLabel className="text-xs text-muted-foreground px-2 py-1">
                  经典场景预设方案 (悬停或聚焦即时预览：卡片形态、背景、密度、视图与首屏展板)
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="my-1" />
                {BUILTIN_DIY_PRESETS.map((preset: DIYPreset) => (
                  <DropdownMenuItem
                    key={preset.id}
                    onMouseEnter={() => handlePresetHover(preset)}
                    onMouseLeave={() => handlePresetHover(null)}
                    onFocus={() => handlePresetHover(preset)}
                    onBlur={() => handlePresetHover(null)}
                    onClick={() => handleApplyPresetAndClearPreview(preset.id)}
                    className="flex flex-col items-start gap-0.5 p-2 rounded-xl cursor-pointer hover:bg-accent/80 transition-colors"
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span>{preset.name}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground leading-snug">{preset.description}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 智能自适应调优（lg+ 直出，窄视口收进「更多」菜单） */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRunSmartAutoTune}
              className="hidden lg:inline-flex min-h-11 px-2.5 rounded-xl text-xs gap-1.5 shrink-0 border-violet-500/30 text-violet-700 dark:text-violet-200 bg-violet-500/10 dark:bg-violet-500/20 hover:bg-violet-500/20 font-medium"
              title="根据本地访问频次与星标收藏，提取高频 Top 站点至速览坞，优化分类次序并折叠长尾分类"
            >
              <Sparkles className="w-3.5 h-3.5 text-violet-500 animate-pulse" />
              <span>智能调优</span>
            </Button>

            {/* 全局卡片形态切换 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="min-h-11 px-2.5 rounded-xl text-xs gap-1 border-border/70">
                  <CreditCard className="w-3.5 h-3.5 text-blue-500" />
                  <span className="hidden sm:inline">形态:</span>
                  <span className="font-semibold">
                    {getCardDisplayModeMeta(cardDisplayMode).shortLabel}
                  </span>
                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 p-1.5">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  全局网址展示风格（{CARD_DISPLAY_MODE_OPTIONS.length} 种）
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="my-1" />
                {CARD_DISPLAY_MODE_OPTIONS.map((opt) => {
                  const active = normalizeCardDisplayMode(cardDisplayMode) === opt.id
                  return (
                    <DropdownMenuItem
                      key={opt.id}
                      onClick={() => setCardDisplayMode(opt.id)}
                      className={cn(
                        'min-h-10 text-xs flex items-center justify-between cursor-pointer gap-2',
                        active && 'font-bold text-primary',
                      )}
                    >
                      <span className="truncate">{opt.label} ({opt.badge})</span>
                      {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 首屏常驻速览星标坞开关（xl+ 直出，窄视口收进「更多」） */}
            <Button
              variant={speedDialEnabled ? 'default' : 'outline'}
              size="sm"
              onClick={toggleSpeedDial}
              className={cn('hidden xl:inline-flex min-h-11 px-2.5 rounded-xl text-xs gap-1 shrink-0 border-border/70 transition-all', speedDialEnabled ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600 shadow-xs' : 'text-muted-foreground hover:text-foreground')}
              title="开启或关闭首屏常驻速览星标坞"
            >
              <Pin className={cn('w-3.5 h-3.5', speedDialEnabled ? 'fill-white' : 'text-amber-500')} />
              <span>速览坞:</span>
              <span>{speedDialEnabled ? '已开' : '关'}</span>
            </Button>

            {/* 美学背景、列数与强调色（md+ 直出） */}
            <DropdownMenu onOpenChange={(open) => { if (!open) commitOpacityDraft() }}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="hidden md:inline-flex min-h-11 px-2 rounded-xl text-xs gap-1 shrink-0 border-border/70"
                  title="美学背景、网格列数与强调色"
                >
                  <Palette className="w-3.5 h-3.5 text-pink-500" />
                  <span className="hidden lg:inline">美学</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60 p-2">
                <DropdownMenuLabel className="text-xs text-muted-foreground px-1">网格密度与间距</DropdownMenuLabel>
                <div className="grid grid-cols-3 gap-1 p-1">
                  <Button
                    type="button"
                    variant={density === 'spacious' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setDensity('spacious')}
                    className="min-h-11 text-xs px-1"
                  >
                    宽松 (Spacious)
                  </Button>
                  <Button
                    type="button"
                    variant={density === 'comfortable' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setDensity('comfortable')}
                    className="min-h-11 text-xs px-1"
                  >
                    标准 (Default)
                  </Button>
                  <Button
                    type="button"
                    variant={density === 'dense' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setDensity('dense')}
                    className="min-h-11 text-xs px-1"
                  >
                    紧凑 (Dense)
                  </Button>
                </div>
                <DropdownMenuSeparator className="my-1.5" />
                <DropdownMenuLabel className="text-xs text-muted-foreground px-1">画布背景</DropdownMenuLabel>
                <div className="space-y-0.5 pt-1">
                  <DropdownMenuItem onClick={() => setCanvasBackground('mesh')} className="min-h-11 text-xs flex items-center justify-between">
                    <span>微网格微妙 (Mesh)</span>
                    {canvasBackground === 'mesh' && <Check className="w-3.5 h-3.5 text-primary" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setCanvasBackground('dots')} className="min-h-11 text-xs flex items-center justify-between">
                    <span>科技点阵 (Dots)</span>
                    {canvasBackground === 'dots' && <Check className="w-3.5 h-3.5 text-primary" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setCanvasBackground('grid')} className="min-h-11 text-xs flex items-center justify-between">
                    <span>极客工程网格 (Grid)</span>
                    {canvasBackground === 'grid' && <Check className="w-3.5 h-3.5 text-primary" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setCanvasBackground('aurora')} className="min-h-11 text-xs flex items-center justify-between">
                    <span>柔和极光流光 (Aurora)</span>
                    {canvasBackground === 'aurora' && <Check className="w-3.5 h-3.5 text-primary" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setCanvasBackground('clean')} className="min-h-11 text-xs flex items-center justify-between">
                    <span>纯净极简 (Clean)</span>
                    {canvasBackground === 'clean' && <Check className="w-3.5 h-3.5 text-primary" />}
                  </DropdownMenuItem>
                </div>
                <DropdownMenuSeparator className="my-1.5" />
                {/* P1 可读性下限：滑杆最小 0.88（88%）——按壁纸实测曲线，0.85 时描述文字外推 ≈4.4:1（跌破 AA），0.88 实测最坏 4.60:1；下限与配置 clamp / CSS 兜底同口径 */}
                <div className="px-1 py-1 space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>卡片不透明度: {Math.round(shownOpacity * 100)}%（可读性下限 88%）</span>
                  </div>
                  <input
                    type="range"
                    aria-label="卡片不透明度（可读性下限 0.88）"
                    min={0.88}
                    max={1}
                    step={0.01}
                    value={shownOpacity}
                    onChange={(e) => setOpacityDraft(Number(e.target.value))}
                    onPointerUp={commitOpacityDraft}
                    onTouchEnd={commitOpacityDraft}
                    onBlur={commitOpacityDraft}
                    onKeyUp={commitOpacityDraft}
                    className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer"
                  />
                </div>
                <DropdownMenuSeparator className="my-1.5" />
                <DropdownMenuLabel className="text-xs text-muted-foreground px-1">强调色</DropdownMenuLabel>
                <div className="flex items-center gap-2 p-1.5">
                  {ACCENT_COLORS.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setAccentColor(item.id)}
                      aria-label={`强调色：${item.name}`}
                      aria-pressed={accentColor === item.id}
                      className={cn(
                        // 色点视觉 36px，::after 再向外扩 4px 凑满 44px 点击区：
                        // 相邻色点间距 8px，扩 4px 刚好接壤不重叠，点错色的风险为零。
                        "relative h-9 w-9 rounded-full transition-transform hover:scale-110 flex items-center justify-center after:absolute after:-inset-1 after:content-['']",
                        item.class,
                        accentColor === item.id ? 'ring-2 ring-primary ring-offset-2 scale-105' : 'opacity-80'
                      )}
                      title={item.name}
                    >
                      {accentColor === item.id && <Check className="w-3 h-3 text-white dark:text-black" />}
                    </button>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Phase 2：大纲全景切换（md+ 直出，窄屏同步收进「更多」菜单） */}
            <Button
              variant={outlineMode ? 'default' : 'outline'}
              size="sm"
              data-testid="diy-btn-outline"
              aria-pressed={outlineMode}
              onClick={toggleOutlineMode}
              className={cn(
                'hidden md:inline-flex min-h-11 px-2 rounded-xl text-xs gap-1 shrink-0',
                outlineMode
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'border-border/70',
              )}
              title="切换紧凑大纲全景态：所有区块折叠为紧凑胶囊，像拼积木一样俯瞰并排与调序"
              aria-label={outlineMode ? '退出大纲全景模式' : '开启大纲全景模式'}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">{outlineMode ? '退出大纲' : '大纲全景'}</span>
            </Button>

            {/* Phase 2：吸附策略切换（2xl+ 直出，中窄视口自动收拢进「更多」菜单，保证 375px–1440px 工具栏零裁切） */}
            <Button
              variant="outline"
              size="sm"
              data-testid="diy-compact-type-toggle"
              onClick={() => setWorkspaceCompactType(compactType === 'vertical' ? null : 'vertical')}
              className={cn(
                'hidden 2xl:inline-flex min-h-11 px-2 rounded-xl text-xs gap-1 shrink-0',
                compactType === null
                  ? 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300'
                  : 'border-border/70',
              )}
              title={
                compactType === 'vertical'
                  ? '当前：自动紧凑吸附（区块自动上吸对齐），点击切换为自由留白'
                  : '当前：自由留白模式（允许任意空隙摆放），点击切换为自动紧凑吸附'
              }
            >
              <span>{compactType === 'vertical' ? '自动吸附' : '自由留白'}</span>
            </Button>

            {/* 大纲与功能矩阵管理（2xl+ 直出，中窄视口收拢进「更多」菜单，保证 375px–1440px 底部栏零裁切） */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setManagerTab('outline')
                setIsManagerOpen(true)
              }}
              className="hidden 2xl:inline-flex min-h-11 px-2 rounded-xl text-xs gap-1 shrink-0 border-border/70"
              title="主分类全景大纲与功能矩阵管理器"
              aria-label="大纲与功能矩阵管理器"
            >
              <Layers className="w-3.5 h-3.5 text-indigo-500" />
              <span>大纲/矩阵</span>
            </Button>

            {/* 时间轴回收站入口（md+ 直出，窄屏收进「更多」菜单） */}
            <Button
              variant="outline"
              size="sm"
              data-testid="diy-btn-trash"
              onClick={() => {
                setManagerTab('trash')
                setIsManagerOpen(true)
              }}
              className={cn(
                'hidden md:inline-flex min-h-11 px-2 rounded-xl text-xs gap-1 shrink-0',
                trashBin.length > 0 || totalPrunedCount > 0
                  ? 'border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10 dark:bg-amber-500/20 hover:bg-amber-500/20'
                  : 'border-border/70'
              )}
              title="打开时间轴回收站，一键恢复任意已删减模块或站点"
              aria-label="回收站：恢复已删减模块或站点"
            >
              <Trash2 className="w-3.5 h-3.5 text-amber-500" />
              <span className="hidden lg:inline">回收站</span>
              {(trashBin.length > 0 || totalPrunedCount > 0) && (
                <span className="text-[10px] font-mono px-1 rounded-full bg-amber-500/20">
                  {Math.max(trashBin.length, totalPrunedCount)}
                </span>
              )}
            </Button>

            {/* 新建分类（md+ 直出，窄屏收进「更多」菜单） */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAddCatOpen(true)}
              className="hidden md:inline-flex min-h-11 px-2 rounded-xl text-xs gap-1 shrink-0 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 dark:bg-emerald-500/20 hover:bg-emerald-500/20"
              title="新建专属分类"
              aria-label="新建专属分类"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">新建</span>
            </Button>

            {/* 窄视口低频工具收纳菜单（< 2xl 可见）：保证 375px–1440px 所有工具零遗漏、零裁切 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="diy-toolbar-more"
                  className="2xl:hidden min-h-11 px-2 rounded-xl text-xs gap-1 shrink-0 border-border/70"
                  title="更多排版工具（回收站 / 新建 / 智能调优 / 蓝图 / 重置）"
                  aria-label="更多排版工具"
                >
                  <MoreHorizontal className="w-4 h-4" />
                  <span className="hidden sm:inline">更多</span>
                  {(trashBin.length > 0 || totalPrunedCount > 0) && (
                    <span className="md:hidden text-[10px] font-mono px-1 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300">
                      {Math.max(trashBin.length, totalPrunedCount)}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 p-1.5">
                <DropdownMenuLabel className="text-xs text-muted-foreground">排版工具箱</DropdownMenuLabel>
                <DropdownMenuSeparator className="my-1" />
                <DropdownMenuItem onClick={toggleOutlineMode} className="min-h-10 text-xs gap-2 cursor-pointer">
                  <LayoutGrid className="w-3.5 h-3.5 text-primary" />
                  <span>{outlineMode ? '退出大纲全景态' : '开启大纲全景态'}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setWorkspaceCompactType(compactType === 'vertical' ? null : 'vertical')}
                  className="min-h-10 text-xs gap-2 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                  <span>吸附模式：{compactType === 'vertical' ? '自动吸附 → 自由留白' : '自由留白 → 自动吸附'}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsAddCatOpen(true)} className="min-h-10 text-xs gap-2 cursor-pointer">
                  <FolderPlus className="w-3.5 h-3.5 text-emerald-500" />
                  <span>新建专属分类</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setManagerTab('trash')
                    setIsManagerOpen(true)
                  }}
                  className="min-h-10 text-xs gap-2 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-amber-500" />
                  <span>时间轴回收站 ({Math.max(trashBin.length, totalPrunedCount)})</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setManagerTab('outline')
                    setIsManagerOpen(true)
                  }}
                  className="min-h-10 text-xs gap-2 cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5 text-indigo-500" />
                  <span>分类大纲与功能矩阵</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleRunSmartAutoTune} className="min-h-10 text-xs gap-2 cursor-pointer">
                  <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                  <span>智能自适应调优</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={toggleSpeedDial} className="min-h-10 text-xs gap-2 cursor-pointer">
                  <Pin className="w-3.5 h-3.5 text-amber-500" />
                  <span>首屏速览坞：{speedDialEnabled ? '已开启' : '已关闭'}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="my-1" />
                <DropdownMenuItem onClick={handleSaveAsScene} className="min-h-10 text-xs gap-2 cursor-pointer">
                  <Layers className="w-3.5 h-3.5 text-primary" />
                  <span>一键存为我的场景</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsBackupOpen(true)} className="min-h-10 text-xs gap-2 cursor-pointer">
                  <Download className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>蓝图 JSON 导入与导出</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleReset} className="min-h-10 text-xs gap-2 cursor-pointer text-destructive-text">
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>恢复系统默认排版</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* 右侧主操作控制簇（shrink-0）：撤销、重做、完成编排在 375px–1440px 永远固定可见零裁切 */}
          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0 ml-auto">
            {/* 撤销 / 重做 */}
            <Button
              variant="ghost"
              size="icon"
              disabled={!canUndo}
              onClick={undo}
              className={cn(
                'h-9 w-9 sm:h-8 sm:w-8 rounded-full shrink-0',
                !canUndo ? 'opacity-30 cursor-not-allowed' : 'hover:bg-muted text-muted-foreground hover:text-foreground'
              )}
              title={isMac ? '撤销 (↩ ⌘Z)' : '撤销 (↩ Ctrl+Z)'}
              aria-label="撤销"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!canRedo}
              onClick={redo}
              className={cn(
                'h-9 w-9 sm:h-8 sm:w-8 rounded-full shrink-0',
                !canRedo ? 'opacity-30 cursor-not-allowed' : 'hover:bg-muted text-muted-foreground hover:text-foreground'
              )}
              title={isMac ? '重做 (↪ ⌘⇧Z)' : '重做 (↪ Ctrl+Y)'}
              aria-label="重做"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </Button>

            {/* 一键存为场景 / 蓝图 JSON / 重置（xl+ 直出，窄视口已收进「更多」菜单） */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSaveAsScene}
              className="hidden xl:inline-flex h-8 w-8 rounded-full shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
              title="一键存为场景：把当前置顶、皮肤与布局存成我的场景"
              aria-label="一键存为场景"
            >
              <Layers className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsBackupOpen(true)}
              className="hidden xl:inline-flex h-8 w-8 rounded-full shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
              title="排版蓝图 JSON 导入与导出"
              aria-label="排版蓝图 JSON 导入与导出"
            >
              <Download className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleReset}
              className="hidden xl:inline-flex h-8 w-8 rounded-full shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
              title="🔄 恢复系统默认排版，同时恢复所有已删减功能"
              aria-label="恢复系统默认排版，同时恢复所有已删减功能"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>

            <div className="h-4 w-px bg-border/60 mx-0.5 sm:mx-1 shrink-0" />

            {/* 完成编排 */}
            <Button
              variant="default"
              size="sm"
              data-testid="diy-btn-done"
              onClick={handleFinishEditing}
              className="min-h-10 sm:min-h-11 px-3 sm:px-3.5 rounded-xl text-xs font-bold gap-1 shrink-0 bg-primary text-primary-foreground shadow-sm hover:opacity-90"
              title="保存并退出编排模式 (快捷键: Esc)"
            >
              <Check className="w-3.5 h-3.5 shrink-0" />
              <span className="whitespace-nowrap">完成</span>
              <kbd className="hidden md:inline-block sm:pointer-coarse:hidden text-[10px] px-1 py-0.2 bg-primary-foreground/20 rounded font-mono ml-0.5">
                Esc
              </kbd>
            </Button>
          </div>
        </div>

      {/* 分类全景大纲与时间轴恢复中心抽屉/弹窗 */}
      <HomeDIYOutlineDialog
        open={isManagerOpen}
        onOpenChange={setIsManagerOpen}
        initialTab={managerTab}
        allCategoryIds={allCategoryIds}
        categoryTitleMap={categoryTitleMap}
        categories={categories}
        pinnedCategoryIds={pinnedCategoryIds}
        hiddenCategoryIds={hiddenCategoryIds}
        collapsedCategoryIds={collapsedCategoryIds}
        customCategories={customCategories}
        isAdaptiveRankingEnabled={isAdaptiveRankingEnabled}
        healthReport={healthReport}
        togglePinCategory={togglePinCategory}
        moveCategory={moveCategory}
        toggleCollapseCategory={toggleCollapseCategory}
        toggleHideCategory={toggleHideCategory}
        unhideAllCategories={unhideAllCategories}
        deleteCustomCategory={deleteCustomCategory}
        toggleAdaptiveRanking={toggleAdaptiveRanking}
        collapseAllCategories={collapseAllCategories}
        expandAllCategories={expandAllCategories}
        setHiddenCategories={setHiddenCategories}
      />

      {/* #diy= 分享确认对话框：挂起的分享在此确认/忽略（组件自读 useHomeDIY 的 pendingShare） */}
      <HomeDiyShareConfirmDialog />

      {/* 备份与分享模态框 */}
      <HomeDIYBackupDialog
        open={isBackupOpen}
        onOpenChange={setIsBackupOpen}
        exportPresetToUrlHash={exportPresetToUrlHash}
        exportDIYConfig={exportDIYConfig}
        importDIYConfig={importDIYConfig}
        stageImportForConfirm={stageImportForConfirm}
        exportEncryptedDIYConfig={exportEncryptedDIYConfig}
        importEncryptedDIYConfig={importEncryptedDIYConfig}
        syncToCloudVault={syncToCloudVault}
        syncFromCloudVault={syncFromCloudVault}
        checkCloudVaultStatus={checkCloudVaultStatus}
        clearCloudVault={clearCloudVault}
      />
      {/* 旧版 HomeDIYShareDialog 已下线：它与上面的 HomeDiyShareConfirmDialog
          在同一个 pendingShare 上双开（两层 Radix 焦点陷阱、两份不同的差异列表，
          旧那份还是水合前的 stale 快照）。确认对话框只剩上面这一个挂载点；
          静息态的另一个挂载点在 HomeDIYTrigger。 */}

      {/* 新建专属分类对话框 */}
      <HomeDIYCreateCategoryDialog
        open={isAddCatOpen}
        onOpenChange={setIsAddCatOpen}
        title={newCatTitle}
        onTitleChange={setNewCatTitle}
        onCreate={handleCreateCategory}
      />
    </>
  )
}
