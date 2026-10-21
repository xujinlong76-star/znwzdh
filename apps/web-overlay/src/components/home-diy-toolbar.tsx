'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { Palette, Eye, EyeOff, RotateCcw, Check, Sparkles, CreditCard, SlidersHorizontal, ChevronDown, FolderPlus, ArrowUp, ArrowDown, Pin, Download, Layers, Wand2, Trash2, Activity, Info, Undo2, Redo2, ChevronsUpDown, AlertTriangle, X } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/registry/new-york/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/registry/new-york/ui/dropdown-menu'
import { Input } from '@/registry/new-york/ui/input'
import { Textarea } from '@/registry/new-york/ui/textarea'
import { useHomeDIY, type CardDisplayMode, type CanvasBackground, type AccentColor } from '@/lib/modular/use-home-diy'
import { computeLayoutTidyPlan } from '@/lib/modular/layout-tidy'
import { HomeDIYBackupDialog } from '@/components/home-diy-backup-dialog'
import { useDensity } from '@/components/density-provider'
import { BUILTIN_DIY_PRESETS, evaluateLayoutErgonomics, type DIYPreset } from '@/lib/modular/diy-presets'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'

interface HomeDIYToolbarProps {
  allCategoryIds: string[]
  categoryTitleMap: Record<string, string>
  categories?: any[]
  /**
   * 底部被别的固定浮层占用时抬高自己。
   * 静息位（bottom-20）已为全局 AI 副驾胶囊（bottom-6 right-6）留出空间；
   * 批量操作坞（fixed bottom-6 居中、max-w-[95vw]）与本坞同钉在底部，
   * 窄屏下必然重叠；由使用方在多选模式打开时置 true。
   */
  raised?: boolean
}

const ACCENT_COLORS: { id: AccentColor; name: string; class: string }[] = [
  { id: 'default', name: '经典极客', class: 'bg-zinc-800 dark:bg-zinc-200' },
  { id: 'violet', name: '赛博紫', class: 'bg-violet-500' },
  { id: 'emerald', name: '翡翠绿', class: 'bg-emerald-500' },
  { id: 'amber', name: '琥珀金', class: 'bg-amber-500' },
  { id: 'rose', name: '玫瑰红', class: 'bg-rose-500' },
]

export function HomeDIYToolbar({ allCategoryIds, categoryTitleMap, categories = [], raised = false }: HomeDIYToolbarProps) {
  const {
    isEditingLayout,
    toggleEditingLayout,
    storageWarning,
    dismissStorageWarning,
    cardDisplayMode,
    setCardDisplayMode,
    canvasBackground,
    setCanvasBackground,
    accentColor,
    setAccentColor,
    categoryOrder,
    pinnedCategoryIds,
    hiddenCategoryIds,
    customCategories,
    isAdaptiveRankingEnabled,
    toggleAdaptiveRanking,
    togglePinCategory,
    toggleHideCategory,
    unhideCategory,
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
    canUndo,
    canRedo,
    undo,
    redo,
    collapsedCategoryIds,
    toggleCollapseCategory,
    collapseAllCategories,
    expandAllCategories,
    exportPresetToUrlHash,
    customWallpaperUrl,
    glassmorphismBlur,
    cardOpacity,
    setCustomWallpaper,
    setAestheticSliders,
  } = useHomeDIY()

  const { density, setDensity } = useDensity()
  const { toast } = useToast()

  // 核心人机工程学健康度与香农信息熵评估诊断
  const healthReport = useMemo(() => {
    const targetCats = categories && categories.length > 0
      ? categories
      : allCategoryIds.map((id) => ({ id, title: categoryTitleMap[id] || id, items: [] }))
    return evaluateLayoutErgonomics(targetCats, {
      pinnedCategoryIds,
      hiddenCategoryIds,
    })
  }, [categories, allCategoryIds, categoryTitleMap, pinnedCategoryIds, hiddenCategoryIds])

  // 弹窗状态
  const [isAddCatOpen, setIsAddCatOpen] = useState(false)
  const [newCatTitle, setNewCatTitle] = useState('')
  // 备份 / 漫游 / 云金库弹窗（含其全部 state 与 handler）已抽到
  // components/home-diy-backup-dialog.tsx —— 那个弹窗有 230 行，
  // 放在这里会让工具栏变成第二个难以维护的巨块。
  const [isBackupOpen, setIsBackupOpen] = useState(false)
  const [isManagerOpen, setIsManagerOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 处理新建专属分类
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

  // 重置分类排版
  const handleReset = () => {
    resetCategoryLayout()
    toast({
      title: '已重置分类排序',
      description: '分类排序与显隐状态已恢复系统默认。',
    })
  }

  // 应用情境预设
  const handleApplyPreset = (presetId: string) => {
    const ok = applyDIYPreset(presetId, (d) => setDensity(d as any))
    if (ok) {
      toast({
        title: '✨ 预设情境已应用',
        description: '视窗形态、卡片密度与画布背景已完成智能匹配。',
      })
    }
  }

  // 一键算法智能自愈整理（决策逻辑见 lib/modular/layout-tidy.ts，纯函数有单测）
  const handleAutoTidyLayout = () => {
    const targetCats = categories && categories.length > 0
      ? categories
      : allCategoryIds.map((id) => ({ id, title: categoryTitleMap[id] || id, items: [] }));

    const plan = computeLayoutTidyPlan(targetCats, {
      hiddenCategoryIds,
      collapsedCategoryIds,
      isAdaptiveRankingEnabled,
    });
    for (const id of plan.toHide) toggleHideCategory(id);
    for (const id of plan.toCollapse) toggleCollapseCategory(id);
    if (plan.enableAdaptiveRanking) toggleAdaptiveRanking();
    toast({
      title: '🎉 算法智能自愈整理已完成！',
      description: `已自动优化排版结构，隐藏闲置分类并开启时序半衰期推荐，健康度显著提升。`,
    });
  };

  return (
    <>
      {/* 悬浮微胶囊：首页 DIY 工坊坞 */}
      <div
        className={cn(
          'fixed right-6 z-40 flex flex-col items-end gap-2 pointer-events-none transition-[bottom] duration-200',
          // 静息位抬到全局 AI 副驾胶囊（bottom-6 right-6）上方，避免最低那颗
          // 「DIY 排版工坊」入口被胶囊拦截点击；多选批量坞在场时再进一步抬高
          raised ? 'bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))]' : 'bottom-[calc(5rem+env(safe-area-inset-bottom,0px))]',
          'right-[max(env(safe-area-inset-right,0px),1.5rem)]',
        )}
      >
        {/* 落盘失败必须说出来：改动还在屏幕上，但刷新就没了 ——
            不说清楚，用户会以为「已经保存好了」 */}
        {storageWarning && (
          <div
            role="alert"
            className="pointer-events-auto max-w-[19rem] flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-50/95 dark:bg-amber-950/90 backdrop-blur-md px-3 py-2 text-[11px] leading-snug text-amber-900 dark:text-amber-100 shadow-lg"
          >
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span className="flex-1">{storageWarning}</span>
            <button
              type="button"
              onClick={dismissStorageWarning}
              aria-label="关闭提示"
              className="shrink-0 rounded p-0.5 hover:bg-amber-500/20 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        <div className="pointer-events-auto flex items-center gap-1.5 p-1.5 rounded-full bg-background/90 dark:bg-card/90 backdrop-blur-md border border-border/80 shadow-lg hover:shadow-xl transition-all duration-200 max-w-[calc(100vw-3rem)] overflow-x-auto no-scrollbar touch-pan-x">
          <Button
            variant={isEditingLayout ? 'default' : 'ghost'}
            size="sm"
            onClick={toggleEditingLayout}
            className={cn(
              "h-8 px-3 rounded-full text-xs font-medium gap-1.5 transition-all",
              isEditingLayout
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
            title="开启/关闭首页排版与自定义分类工坊 (快捷键: E)"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>{isEditingLayout ? '完成编排' : 'DIY 排版工坊'}</span>
            <kbd className="hidden sm:inline-block text-[10px] px-1 py-0.2 bg-black/10 dark:bg-white/10 rounded font-mono">
              E
            </kbd>
          </Button>

          {isEditingLayout && (
            <>
              {/* 情境模版预设下拉 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 rounded-full text-xs gap-1 border-border/70"
                    title="开箱即用的预设排版方案"
                    aria-label="预设排版方案"
                  >
                    <Wand2 className="w-3.5 h-3.5 text-amber-500" />
                    <span className="hidden sm:inline">预设</span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 p-1.5">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">开箱即用情境模版</DropdownMenuLabel>
                  <DropdownMenuSeparator className="my-1" />
                  {BUILTIN_DIY_PRESETS.map((preset: DIYPreset) => (
                    <DropdownMenuItem
                      key={preset.id}
                      onClick={() => handleApplyPreset(preset.id)}
                      className="flex flex-col items-start gap-0.5 p-2 rounded-md cursor-pointer hover:bg-accent"
                    >
                      <div className="flex items-center gap-1.5 font-medium text-xs text-foreground">
                        <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span>{preset.name}</span>
                      </div>
                      <span className="text-[11px] text-muted-foreground leading-snug">
                        {preset.description}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* 卡片形态选择器 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 rounded-full text-xs gap-1 border-border/70"
                    aria-label="卡片形态选择"
                  >
                    <CreditCard className="w-3.5 h-3.5 text-blue-500" />
                    <span className="hidden sm:inline">卡片:</span>
                    <span className="font-semibold capitalize">
                      {cardDisplayMode === 'compact' ? '紧凑' : cardDisplayMode === 'rich' ? '深度' : '标准'}
                    </span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44 p-1.5">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">卡片视觉形态</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => setCardDisplayMode('compact')}
                    className={cn("text-xs flex items-center justify-between", cardDisplayMode === 'compact' && "font-bold text-primary")}
                  >
                    <span>紧凑条形 (超高密度)</span>
                    {cardDisplayMode === 'compact' && <Check className="w-3.5 h-3.5" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setCardDisplayMode('standard')}
                    className={cn("text-xs flex items-center justify-between", cardDisplayMode === 'standard' && "font-bold text-primary")}
                  >
                    <span>经典标准 (图文均衡)</span>
                    {cardDisplayMode === 'standard' && <Check className="w-3.5 h-3.5" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setCardDisplayMode('rich')}
                    className={cn("text-xs flex items-center justify-between", cardDisplayMode === 'rich' && "font-bold text-primary")}
                  >
                    <span>深度丰富 (指标光晕)</span>
                    {cardDisplayMode === 'rich' && <Check className="w-3.5 h-3.5" />}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* 画布与强调色工坊 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 rounded-full text-xs gap-1 border-border/70"
                    aria-label="画布美学背景"
                  >
                    <Palette className="w-3.5 h-3.5 text-pink-500" />
                    <span className="hidden sm:inline">美学</span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52 p-2">
                  <DropdownMenuLabel className="text-xs text-muted-foreground px-1">画布背景氛围</DropdownMenuLabel>
                  <div className="space-y-0.5 pt-1">
                    <DropdownMenuItem onClick={() => setCanvasBackground('mesh')} className="text-xs flex items-center justify-between">
                      <span>微网格微妙 (Mesh)</span>
                      {canvasBackground === 'mesh' && <Check className="w-3.5 h-3.5 text-primary" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setCanvasBackground('dots')} className="text-xs flex items-center justify-between">
                      <span>科技点阵 (Dots)</span>
                      {canvasBackground === 'dots' && <Check className="w-3.5 h-3.5 text-primary" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setCanvasBackground('grid')} className="text-xs flex items-center justify-between">
                      <span>极客工程网格 (Grid)</span>
                      {canvasBackground === 'grid' && <Check className="w-3.5 h-3.5 text-primary" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setCanvasBackground('aurora')} className="text-xs flex items-center justify-between">
                      <span>柔和极光流光 (Aurora)</span>
                      {canvasBackground === 'aurora' && <Check className="w-3.5 h-3.5 text-primary" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setCanvasBackground('clean')} className="text-xs flex items-center justify-between">
                      <span>纯净极简 (Clean)</span>
                      {canvasBackground === 'clean' && <Check className="w-3.5 h-3.5 text-primary" />}
                    </DropdownMenuItem>
                  </div>

                  <DropdownMenuSeparator className="my-1.5" />

                  <DropdownMenuLabel className="text-xs text-muted-foreground px-1">次世代强调色</DropdownMenuLabel>
                  <div className="flex items-center gap-2 p-1.5">
                    {ACCENT_COLORS.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setAccentColor(item.id)}
                        className={cn(
                          "w-5 h-5 rounded-full transition-transform hover:scale-110 flex items-center justify-center",
                          item.class,
                          accentColor === item.id ? "ring-2 ring-primary ring-offset-2 scale-105" : "opacity-80"
                        )}
                        title={item.name}
                      >
                        {accentColor === item.id && <Check className="w-3 h-3 text-white dark:text-black" />}
                      </button>
                    ))}
                  </div>
                  <DropdownMenuSeparator className="my-1.5" />

                  <DropdownMenuLabel className="text-xs text-muted-foreground px-1">沉浸式壁纸与毛玻璃</DropdownMenuLabel>
                  <div className="px-1.5 py-1 space-y-2" onClick={(e) => e.stopPropagation()}>
                    <input aria-label="粘贴自定义壁纸图片 URL"
                      type="text"
                      placeholder="粘贴自定义壁纸图片 URL..."
                      value={customWallpaperUrl || ''}
                      onChange={(e) => setCustomWallpaper(e.target.value)}
                      className="w-full text-[11px] px-2 py-1 rounded border border-border bg-background/90 outline-none focus:border-primary"
                    />
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>毛玻璃模糊: {glassmorphismBlur ?? 12}px</span>
                      {customWallpaperUrl && (
                        <button
                          type="button"
                          onClick={() => setCustomWallpaper('')}
                          className="text-rose-500 hover:underline"
                        >
                          清除壁纸
                        </button>
                      )}
                    </div>
                    <input aria-label="毛玻璃模糊强度"
                      type="range"
                      min={0}
                      max={30}
                      value={glassmorphismBlur ?? 12}
                      onChange={(e) => setAestheticSliders(Number(e.target.value), cardOpacity ?? 0.9)}
                      className="w-full h-1.5 accent-primary cursor-pointer"
                    />
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* 智能自适应热度半衰期推荐排序开关 */}
              <Button
                variant={isAdaptiveRankingEnabled ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  toggleAdaptiveRanking()
                  toast({
                    title: !isAdaptiveRankingEnabled ? '✨ 已开启智能自适应排序' : '已恢复默认站点排序',
                    description: !isAdaptiveRankingEnabled
                      ? '已应用物理时间半衰期自适应衰减与趋势加权算法。'
                      : '分类内站点将按基础收录次序展示。',
                  })
                }}
                className={cn(
                  "h-8 px-2.5 rounded-full text-xs gap-1 border-border/70 transition-all",
                  isAdaptiveRankingEnabled
                    ? "bg-violet-600 hover:bg-violet-700 text-white shadow-xs border-violet-500"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title="自适应排序引擎：基于物理半衰期衰减与热度加权推荐分类内站点"
              >
                <Sparkles className={cn("w-3.5 h-3.5", isAdaptiveRankingEnabled ? "text-amber-300" : "text-violet-500")} />
                <span className="hidden sm:inline">自适应:</span>
                <span>{isAdaptiveRankingEnabled ? '已开' : '关'}</span>
              </Button>

              {/* 分类全景大纲管理 */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsManagerOpen(true)}
                className="h-8 px-2.5 rounded-full text-xs gap-1 border-border/70"
                title="全景管理所有分类的排序与显隐"
              >
                <Layers className="w-3.5 h-3.5 text-indigo-500" />
                <span className="hidden sm:inline">大纲</span>
              </Button>

              {/* 专属分类创建 */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsAddCatOpen(true)}
                className="h-8 px-2.5 rounded-full text-xs gap-1 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20"
                title="新建专属分类"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">新建</span>
              </Button>

              {/* 撤销 (Undo) */}
              <Button
                variant="ghost"
                size="icon"
                disabled={!canUndo}
                onClick={undo}
                className={cn(
                  "h-8 w-8 rounded-full transition-all",
                  !canUndo ? "opacity-30 cursor-not-allowed text-muted-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                title="撤销编排变更 (快捷键: Ctrl+Z / Cmd+Z)"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </Button>

              {/* 重做 (Redo) */}
              <Button
                variant="ghost"
                size="icon"
                disabled={!canRedo}
                onClick={redo}
                className={cn(
                  "h-8 w-8 rounded-full transition-all",
                  !canRedo ? "opacity-30 cursor-not-allowed text-muted-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                title="重做编排变更 (快捷键: Ctrl+Shift+Z / Cmd+Shift+Z)"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </Button>

              {/* 分类折叠/展开控制 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 rounded-full text-xs gap-1 border-border/70"
                    title="分类手风琴展开与折叠"
                  >
                    <ChevronsUpDown className="w-3.5 h-3.5 text-sky-500" />
                    <span className="hidden sm:inline">折叠</span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40 p-1.5">
                  <DropdownMenuItem
                    onClick={() => {
                      collapseAllCategories(allCategoryIds)
                      toast({ title: '📦 已全部折叠', description: '所有分类视图已收起。' })
                    }}
                    className="text-xs cursor-pointer"
                  >
                    <span>全部折叠 ({allCategoryIds.length})</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      expandAllCategories()
                      toast({ title: '📖 已全部展开', description: '所有分类视图已还原展开。' })
                    }}
                    className="text-xs cursor-pointer"
                  >
                    <span>全部展开</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* 备份与分享生态 */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsBackupOpen(true)}
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                title="导出 / 导入配置 JSON"
              >
                <Download className="w-3.5 h-3.5" />
              </Button>

              {/* 重置排版 */}
              <Button
                variant="ghost"
                size="icon"
                onClick={handleReset}
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                title="重置分类排序与显隐"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 分类全景大纲管理抽屉/弹窗 */}
      <Dialog open={isManagerOpen} onOpenChange={setIsManagerOpen}>
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-xl max-h-[85dvh] flex flex-col p-4 sm:p-6">
          <DialogHeader className="pb-3 border-b border-border/50 pr-8 sm:pr-6">
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Layers className="w-5 h-5 text-indigo-500" />
              <span>分类全景管理大纲</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              集中调整所有系统分类与私人专属分类的先后次序、置顶与显隐状态。
            </DialogDescription>
          </DialogHeader>

          {/* 排版人机工程学健康度与香农信息熵诊断卡片 */}
          <div className="my-2.5 p-3 rounded-xl border border-indigo-500/20 bg-indigo-500/5 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-500" />
                <span className="text-xs font-bold text-foreground">排版架构人机工程学评估</span>
                <span className={cn(
                  "text-[10px] font-mono px-2 py-0.5 rounded-full font-bold uppercase",
                  healthReport.level === 'excellent'
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                    : healthReport.level === 'good'
                    ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                )}>
                  {healthReport.score} 分 · {healthReport.level === 'excellent' ? '极佳' : healthReport.level === 'good' ? '良好' : '需优化'}
                </span>
              </div>

              {/* 快速开关自适应智能排序 */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  toggleAdaptiveRanking()
                  toast({
                    title: !isAdaptiveRankingEnabled ? '✨ 已开启智能自适应排序' : '已恢复默认站点排序',
                    description: !isAdaptiveRankingEnabled
                      ? '已应用物理时间半衰期自适应衰减与趋势加权算法。'
                      : '分类内站点将按基础收录次序展示。',
                  })
                }}
                className={cn(
                  "h-6 px-2 text-[10px] rounded-full gap-1 border-border/80 transition-all",
                  isAdaptiveRankingEnabled && "bg-violet-600 text-white hover:bg-violet-700 border-violet-500"
                )}
              >
                <Sparkles className="w-2.5 h-2.5" />
                <span>自适应热度: {isAdaptiveRankingEnabled ? '已开启' : '关闭'}</span>
              </Button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
              <div className="p-2 rounded-lg bg-background/60 border border-border/40">
                <div className="text-muted-foreground text-[10px]">信息熵 H / 均衡度</div>
                <div className="font-semibold text-foreground mt-0.5">{healthReport.shannonEntropy} ({Math.round(healthReport.normalizedEntropy * 100)}%)</div>
              </div>
              <div className="p-2 rounded-lg bg-background/60 border border-border/40">
                <div className="text-muted-foreground text-[10px]">可见 / 隐藏</div>
                <div className="font-semibold text-foreground mt-0.5">{healthReport.visibleCategories} / {healthReport.hiddenCategories} 类</div>
              </div>
              <div className="p-2 rounded-lg bg-background/60 border border-border/40">
                <div className="text-muted-foreground text-[10px]">总收录站点</div>
                <div className="font-semibold text-foreground mt-0.5">{healthReport.totalSites} 个</div>
              </div>
              <div className="p-2 rounded-lg bg-background/60 border border-border/40">
                <div className="text-muted-foreground text-[10px]">置顶关注分类</div>
                <div className="font-semibold text-foreground mt-0.5">{healthReport.pinnedCategories} 类</div>
              </div>
            </div>

            {healthReport.suggestions.length > 0 && (
              <div className="pt-0.5 space-y-1">
                {healthReport.suggestions.slice(0, 2).map((sug, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground leading-relaxed">
                    <Info className="w-3 h-3 text-indigo-400 shrink-0 mt-0.5" />
                    <span>{sug}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="py-2 flex-1 overflow-y-auto space-y-1.5 pr-1">
            {allCategoryIds.map((id, index) => {
              const title = categoryTitleMap[id] || id
              const isPinned = pinnedCategoryIds.includes(id)
              const isHidden = hiddenCategoryIds.includes(id)
              const isCollapsed = collapsedCategoryIds.includes(id)
              const customCat = customCategories.find((c) => c.id === id)

              return (
                <div
                  key={id}
                  className={cn(
                    "flex items-center justify-between p-2.5 rounded-xl border transition-all text-xs",
                    isHidden
                      ? "bg-muted/30 border-dashed border-border/40 opacity-60"
                      : isPinned
                      ? "bg-amber-500/5 border-amber-500/30 font-medium"
                      : "bg-card/80 border-border/60"
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="font-mono text-muted-foreground/60 text-[10px] w-5 text-center">
                      {index + 1}
                    </span>
                    <span className="truncate text-foreground font-semibold">
                      {title}
                    </span>
                    {customCat && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                        专属
                      </span>
                    )}
                    {isPinned && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0 flex items-center gap-0.5">
                        <Pin className="w-2.5 h-2.5 fill-amber-500" />
                        <span>置顶</span>
                      </span>
                    )}
                    {isCollapsed && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 shrink-0">
                        已收起
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => togglePinCategory(id)}
                      className={cn("h-7 w-7 rounded-md", isPinned && "text-amber-500 bg-amber-500/10")}
                      title={isPinned ? "取消置顶" : "置顶分类"}
                      aria-label={isPinned ? "取消置顶" : "置顶分类"}
                    >
                      <Pin className={cn("w-3.5 h-3.5", isPinned && "fill-amber-500")} />
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={index === 0}
                      onClick={() => moveCategory(id, 'up', allCategoryIds)}
                      className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30"
                      title="上移"
                      aria-label="上移分类"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={index === allCategoryIds.length - 1}
                      onClick={() => moveCategory(id, 'down', allCategoryIds)}
                      className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30"
                      title="下移"
                      aria-label="下移分类"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleCollapseCategory(id)}
                      className={cn("h-7 w-7 rounded-md", isCollapsed ? "text-sky-500 bg-sky-500/10" : "text-muted-foreground hover:text-foreground")}
                      title={isCollapsed ? "展开分类" : "收起/折叠分类"}
                      aria-label={isCollapsed ? "展开分类" : "收起分类"}
                    >
                      <ChevronsUpDown className="w-3.5 h-3.5" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleHideCategory(id)}
                      className={cn("h-7 w-7 rounded-md", isHidden ? "text-amber-500 bg-amber-500/10" : "text-muted-foreground hover:text-foreground")}
                      title={isHidden ? "显示分类" : "隐藏分类"}
                      aria-label={isHidden ? "显示分类" : "隐藏分类"}
                    >
                      {isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </Button>

                    {customCat && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteCustomCategory(id)}
                        className="h-7 w-7 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title="删除该专属分类"
                        aria-label="删除该专属分类"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <DialogFooter className="border-t border-border/40 pt-3 flex items-center justify-between sm:justify-between">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => collapseAllCategories(allCategoryIds)}
                className="text-xs text-muted-foreground hover:text-foreground h-7 px-2"
              >
                全部收起
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={expandAllCategories}
                className="text-xs text-muted-foreground hover:text-foreground h-7 px-2"
              >
                全部展开
              </Button>
              {hiddenCategoryIds.length > 0 && (
                <Button variant="ghost" size="sm" onClick={unhideAllCategories} className="text-xs text-primary h-7 px-2">
                  恢复所有隐藏 ({hiddenCategoryIds.length})
                </Button>
              )}
            </div>
            <Button size="sm" onClick={() => setIsManagerOpen(false)}>
              完成管理
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 备份与分享模态框 */}
      {/* 备份 / 漫游 / 云金库：独立组件（见 home-diy-backup-dialog.tsx），
          这里只做开合与依赖注入 */}
      <HomeDIYBackupDialog
        open={isBackupOpen}
        onOpenChange={setIsBackupOpen}
        exportPresetToUrlHash={exportPresetToUrlHash}
        exportDIYConfig={exportDIYConfig}
        importDIYConfig={importDIYConfig}
        exportEncryptedDIYConfig={exportEncryptedDIYConfig}
        importEncryptedDIYConfig={importEncryptedDIYConfig}
        syncToCloudVault={syncToCloudVault}
        syncFromCloudVault={syncFromCloudVault}
        checkCloudVaultStatus={checkCloudVaultStatus}
      />

      {/* 新建专属分类对话框 */}
      <Dialog open={isAddCatOpen} onOpenChange={setIsAddCatOpen}>
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md p-4 sm:p-6">
          <DialogHeader className="pr-8 sm:pr-6">
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="w-5 h-5 text-emerald-500" />
              <span>创建首页专属私人分类</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              为您的日常工作或高频需求创建专属分类板块。创建后呈现在首页，支持自由置顶与添加站点。
            </DialogDescription>
          </DialogHeader>

          <div className="py-3 space-y-3">
            <div>
              <label htmlFor="diy-new-category-title" className="text-xs font-medium text-foreground block mb-1.5">分类名称</label>
              <Input id="diy-new-category-title"
                placeholder="例如：极客日常 / 深度学习速查 / 监控大盘"
                value={newCatTitle}
                onChange={(e) => setNewCatTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateCategory()}
                autoFocus
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setIsAddCatOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={handleCreateCategory} disabled={!newCatTitle.trim()}>
              确认创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
