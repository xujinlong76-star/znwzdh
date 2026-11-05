'use client'

import React, { useState, useMemo } from 'react'
import {
  CURATED_TRENDING_TOPICS,
  type TrendingHarvestResult,
} from '@/lib/video-trending-harvester'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Input } from '@/registry/new-york/ui/input'
import {
  Flame,
  Sparkles,
  CheckCircle2,
  RefreshCw,
  Terminal,
  Layers,
  ArrowRight,
  Eye,
  Play,
  Radar,
  Filter,
  Check,
  Compass,
  Tag,
  Clock,
  Award
} from 'lucide-react'
import { formatDuration } from '@/lib/video-format'
import { cn } from '@/lib/utils'
import { ensureAdminSession } from '@/lib/client-auto-auth'
import { VIDEO_PLATFORM_REGISTRY } from '@/lib/video-platform-registry'
import type { VideoPlatformType } from '@/types/navigation'

const HARVEST_PLATFORMS: Array<{ id: VideoPlatformType; label: string; color: string }> = [
  { id: 'bilibili', label: '哔哩哔哩 (B站)', color: '#00A1D6' },
  { id: 'youtube', label: 'YouTube', color: '#FF0000' },
  { id: 'dailymotion', label: 'Dailymotion', color: '#0066DC' },
  { id: 'ted', label: 'TED Talks', color: '#E62B1E' },
  { id: 'peertube', label: 'PeerTube', color: '#F1680D' },
]

const CATEGORIES_OPTIONS = [
  { id: 'all', title: '🌐 全网全领域智能巡航 (自动按 12 个方向扫描)' },
  { id: 'cat_ai_models', title: '🤖 AI 与大模型工程' },
  { id: 'cat_fullstack_micro', title: '🚀 现代全栈与微服务架构' },
  { id: 'cat_cloudnative_devops', title: '☁️ 云原生与 DevOps 实战' },
  { id: 'cat_systems_perf', title: '⚡ 系统底层与高性能计算' },
  { id: 'cat_storage_data', title: '🗄️ 现代存储引擎与海量数据架构' },
  { id: 'cat_open_source_indie', title: '🚢 开源神器与独立开发出海' },
  { id: 'cat_mobile_multiplatform', title: '📱 移动端与跨平台全栈开发' },
  { id: 'cat_cyber_security', title: '🛡️ 网络安全与攻防工程' },
  { id: 'cat_algorithm_design', title: '🧠 算法精粹与系统设计' },
  { id: 'cat_game_graphics', title: '🎮 游戏开发与 3D 图形渲染' },
  { id: 'cat_embedded_iot', title: '🔌 嵌入式系统与物联网硬件' },
  { id: 'cat_qa_testing', title: '🎯 软件测试与自动化效能工程' },
]

interface VideoAutoHarvestDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onHarvestCompleted?: () => void
  defaultCategoryId?: string
}

export function VideoAutoHarvestDialog({
  open,
  onOpenChange,
  onHarvestCompleted,
  defaultCategoryId = 'all',
}: VideoAutoHarvestDialogProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>(defaultCategoryId)
  const [customKeyword, setCustomKeyword] = useState<string>('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<VideoPlatformType[]>([
    'bilibili',
    'youtube',
    'dailymotion',
    'ted',
    'peertube',
  ])
  const [dryRun, setDryRun] = useState<boolean>(false)
  const [isHarvesting, setIsHarvesting] = useState<boolean>(false)
  const [currentStep, setCurrentStep] = useState<number>(0) // 0: 就绪, 1: 全网雷达, 2: 质量筛除, 3: 语义分流, 4: HD标签入库
  const [logs, setLogs] = useState<string[]>([])
  const [result, setResult] = useState<TrendingHarvestResult | null>(null)
  const [reportDetails, setReportDetails] = useState<any>(null)
  const [activeFilter, setActiveFilter] = useState<'all' | 'high_quality' | 'beginner' | 'advanced'>('all')

  const togglePlatform = (p: VideoPlatformType) => {
    if (isHarvesting) return
    setSelectedPlatforms((prev) => {
      if (prev.includes(p)) {
        if (prev.length <= 1) return prev
        return prev.filter((x) => x !== p)
      }
      return [...prev, p]
    })
  }

  const handleStartHarvest = async (previewOnly: boolean = false) => {
    setIsHarvesting(true)
    const runMode = previewOnly || dryRun
    const targetCatTitle = CATEGORIES_OPTIONS.find(c => c.id === selectedCategory)?.title || '全领域'
    
    setCurrentStep(1)
    setLogs([
      `[Harvester] 启动多源技术热点雷达 (${runMode ? '演练预览 Dry Run' : '真实落盘入库'})...`,
      `[Target] 目标领域: ${targetCatTitle}${customKeyword.trim() ? ` · 自定义检索: ${customKeyword.trim()}` : ' · 自动按分类热词'}`,
      '[Auth] 正在验证管理员调度会话安全通行凭证...',
    ])

    // 自动激活管理员会话（本地开发与免密模式下无缝签发）
    await ensureAdminSession()

    const platformNames = selectedPlatforms.map(p => HARVEST_PLATFORMS.find(hp => hp.id === p)?.label || p).join(' + ')
    setCurrentStep(2)
    setLogs(prev => [
      ...prev,
      '[Quality Guard] 启用前沿视频质量门禁与播放收藏比评分算法...',
      '[Semantic Router] 激活 36 个技术细分子方向语义路由器与高维向量特征表...',
      `[Crawler] 正在多源并发检索 ${platformNames} 高质量开发者实战课程与前沿讲座...`,
    ])

    try {
      setCurrentStep(3)
      const response = await fetch('/api/videos/harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryRun: runMode,
          categoryId: selectedCategory === 'all' ? undefined : selectedCategory,
          forceKeywords: customKeyword.trim() ? [customKeyword.trim()] : undefined,
          platforms: selectedPlatforms,
        }),
      })

      if (!response.ok) {
        throw new Error(`服务端采集调度返回 HTTP ${response.status}`)
      }

      const json = await response.json()
      const report = json.report
      setReportDetails(report)

      setCurrentStep(4)
      setLogs(prev => [
        ...prev,
        `[Analysis] 扫描完成：检索候选 ${report?.totalHarvestedCount || 0} 部。`,
        `[Smart Router] 智能匹配子分类并去重：通过 ${report?.totalAddedCount || 0} 部，替换过时 ${report?.totalReplacedCount || 0} 部。`,
      ])

      const res: TrendingHarvestResult = {
        timestamp: report?.timestamp || Date.now(),
        harvestedCount: (report?.totalAddedCount || 0) + (report?.totalReplacedCount || 0),
        categoriesEnriched: (report?.categorySummaries || [])
          .filter((c: any) => c.addedCount > 0 || c.replacedCount > 0)
          .map((c: any) => c.categoryTitle),
        topDiscoveredVideos: (report?.additions || []).slice(0, 16).map((a: any) => ({
          title: a.item?.title || '新采集视频',
          category: a.subCategoryTitle ? `${a.categoryTitle} · ${a.subCategoryTitle}` : a.categoryTitle,
          subCategory: a.subCategoryTitle,
          mainCategory: a.categoryTitle,
          author: a.item?.videoConfig?.author || '开发者讲师',
          hotIndex: a.item?.videoConfig?.qualityScore || a.item?.videoConfig?.freshnessScore || 85,
          durationSec: a.item?.videoConfig?.durationSec || 600,
          tags: a.item?.videoConfig?.tags || [],
          difficulty: a.item?.videoConfig?.difficulty,
          platform: a.item?.videoConfig?.type || 'bilibili',
        })),
      }

      if (runMode) {
        setLogs(prev => [
          ...prev,
          `🔍 [Dry Run 演练完成] 发现 ${res.harvestedCount} 门符合标准的精品课程，尚未写入数据库。`,
        ])
      } else {
        setLogs(prev => [
          ...prev,
          `✅ [Completed] 入库完成！新视频已置顶追加至对应子方向，视频库已同步！`,
        ])
        if (onHarvestCompleted) onHarvestCompleted()
      }

      setResult(res)
    } catch (err: any) {
      setLogs(prev => [
        ...prev,
        `❌ [Error] 采集流水线异常: ${err?.message || err}`,
      ])
    } finally {
      setIsHarvesting(false)
    }
  }

  // 结果集根据筛选过滤
  const filteredDiscoveredVideos = useMemo(() => {
    if (!result?.topDiscoveredVideos) return []
    return result.topDiscoveredVideos.filter((v: any) => {
      if (activeFilter === 'high_quality') return v.hotIndex >= 90
      if (activeFilter === 'beginner') return v.difficulty === 'beginner'
      if (activeFilter === 'advanced') return v.difficulty === 'advanced' || v.difficulty === 'intermediate'
      return true
    })
  }, [result, activeFilter])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col p-5">
        <DialogHeader className="space-y-1.5 pb-2 border-b">
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Flame className="w-5 h-5 text-amber-500 fill-amber-500" />
            <span>智能技术视频采集与语义分流引擎</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            自动探测 B站/YouTube 前沿技术视频，通过 36 个技术细分方向语义路由器精准归类，杜绝目录混杂。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3.5 py-2 text-xs">
          {/* 流水线阶段状态指示器 */}
          <div className="grid grid-cols-4 gap-1.5 p-2 rounded-xl border bg-muted/30">
            {[
              { step: 1, label: '全网热点扫描', icon: Radar },
              { step: 2, label: '质量门禁过滤', icon: Filter },
              { step: 3, label: '36方向语义分流', icon: Compass },
              { step: 4, label: 'HD标签库内落盘', icon: Tag },
            ].map((st) => {
              const Icon = st.icon
              const isPast = (currentStep > st.step) || (result !== null && !isHarvesting)
              const isCurrent = isHarvesting && currentStep === st.step
              return (
                <div
                  key={st.step}
                  className={cn(
                    'flex flex-col items-center justify-center p-2 rounded-lg text-center transition-all',
                    isCurrent && 'bg-primary/10 border border-primary/30 text-primary animate-pulse',
                    isPast && !isCurrent && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                    !isCurrent && !isPast && 'opacity-50 text-muted-foreground'
                  )}
                >
                  <div className="flex items-center gap-1 text-[11px] font-semibold mb-0.5">
                    {isPast && !isCurrent ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Icon className={cn('w-3.5 h-3.5', isCurrent && 'animate-spin')} />
                    )}
                    <span>{st.label}</span>
                  </div>
                  <span className="text-[10px] font-mono">
                    {isCurrent ? '执行中...' : isPast ? '已完成' : '待激活'}
                  </span>
                </div>
              )
            })}
          </div>

          {/* 配置面板 */}
          <div className="p-3 rounded-xl border bg-muted/20 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label htmlFor="harvest-dialog-category" className="text-[11px] font-semibold text-foreground flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-primary" />
                  <span>目标技术领域</span>
                </label>
                <select
                  id="harvest-dialog-category"
                  aria-label="目标技术领域"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  disabled={isHarvesting}
                  className="w-full h-8 px-2.5 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {CATEGORIES_OPTIONS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="harvest-dialog-keywords" className="text-[11px] font-semibold text-foreground flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>自定义检索词 (选填)</span>
                </label>
                <Input
                  id="harvest-dialog-keywords"
                  aria-label="自定义检索词"
                  value={customKeyword}
                  onChange={(e) => setCustomKeyword(e.target.value)}
                  placeholder="如: DeepSeek, ArkTS, Go并发 (留空按分类内置)"
                  disabled={isHarvesting}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            {/* 多源采集通道选择 */}
            <div className="space-y-1.5 pt-1">
              <div className="text-[11px] font-semibold text-foreground flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Radar className="w-3.5 h-3.5 text-primary" />
                  <span>采集平台通道 ({selectedPlatforms.length} / {HARVEST_PLATFORMS.length} 已选)</span>
                </span>
                <span className="text-[10px] text-muted-foreground font-normal">点击切换 · 多源并发解析与入库</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {HARVEST_PLATFORMS.map((p) => {
                  const active = selectedPlatforms.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={isHarvesting}
                      onClick={() => togglePlatform(p.id)}
                      className={cn(
                        'px-2.5 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 border cursor-pointer',
                        active
                          ? 'bg-background border-border text-foreground shadow-2xs'
                          : 'opacity-40 bg-muted/30 border-transparent text-muted-foreground hover:opacity-75'
                      )}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: p.color }}
                      />
                      <span>{p.label}</span>
                      {active && <Check className="w-3 h-3 text-emerald-500" />}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 text-[11px] text-muted-foreground border-t border-border/40">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>语义路由: 自动归入 36 个子方向 (如鸿蒙归入 HarmonyOS，Go 归入高并发)</span>
              </div>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                  disabled={isHarvesting}
                  className="rounded border-border text-primary focus:ring-0"
                />
                <span className="text-foreground">演练预览模式 (Dry Run)</span>
              </label>
            </div>
          </div>

          {/* 实时日志终端 */}
          <div className="p-3 rounded-xl border border-border/60 bg-muted/40 font-mono text-[11px] space-y-1 max-h-32 overflow-y-auto shadow-inner">
            {logs.length === 0 ? (
              <p className="text-muted-foreground flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5" />
                <span>就绪。选择领域或直接点击下方按钮开始采集。</span>
              </p>
            ) : (
              logs.map((l, i) => (
                <p key={i} className="text-foreground leading-snug">
                  {l}
                </p>
              ))
            )}
          </div>

          {/* 采集成果卡片展示 */}
          {result && (
            <div className="space-y-2.5 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
              <div className="flex items-center justify-between font-semibold text-emerald-600 dark:text-emerald-400">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {dryRun ? '预览符合标准的候选课程' : '最新入库优质技术课程'} ({result.harvestedCount} 部)
                  </span>
                </span>
                <span className="text-[11px] font-mono">
                  涉及 {result.categoriesEnriched.length} 个分类
                </span>
              </div>

              {/* 关键指标数据看板 */}
              <div className="grid grid-cols-4 gap-2 text-center p-2 rounded-lg bg-background/80 border border-border/40 text-[11px]">
                <div>
                  <div className="text-muted-foreground text-[10px]">捕获候选</div>
                  <div className="font-bold text-foreground mt-0.5">{reportDetails?.totalHarvestedCount || result.harvestedCount} 部</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px]">{dryRun ? '预计新增' : '通过入库'}</div>
                  <div className="font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">+{result.harvestedCount} 门</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px]">技术方向</div>
                  <div className="font-bold text-primary mt-0.5">{result.categoriesEnriched.length} 个领域</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px]">平均质量分</div>
                  <div className="font-bold text-amber-500 mt-0.5">
                    {Math.round(result.topDiscoveredVideos.reduce((a, b) => a + (b.hotIndex || 85), 0) / Math.max(1, result.topDiscoveredVideos.length))} 分
                  </div>
                </div>
              </div>

              {/* 结果集快捷筛选 Tab 栏 */}
              {result.topDiscoveredVideos.length > 0 && (
                <div className="flex items-center gap-1.5 pt-1 overflow-x-auto">
                  <span className="text-[11px] text-muted-foreground shrink-0">快速查看:</span>
                  {[
                    { id: 'all', label: `全部 (${result.topDiscoveredVideos.length})` },
                    { id: 'high_quality', label: `高分精品 ≥90分 (${result.topDiscoveredVideos.filter((v: any) => v.hotIndex >= 90).length})` },
                    { id: 'beginner', label: `入门教程 (${result.topDiscoveredVideos.filter((v: any) => v.difficulty === 'beginner').length})` },
                    { id: 'advanced', label: `进阶高阶 (${result.topDiscoveredVideos.filter((v: any) => v.difficulty === 'advanced' || v.difficulty === 'intermediate').length})` },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveFilter(tab.id as any)}
                      className={cn(
                        'px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors shrink-0',
                        activeFilter === tab.id
                          ? 'bg-primary text-primary-foreground font-semibold shadow-2xs'
                          : 'bg-muted/70 text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}

              {filteredDiscoveredVideos.length === 0 ? (
                <p className="text-muted-foreground text-[11px] py-2 text-center">当前筛选标签下无条目。</p>
              ) : (
                <div className="space-y-1.5 pt-1 max-h-48 overflow-y-auto pr-1">
                  {filteredDiscoveredVideos.map((v: any, i: number) => (
                    <div
                      key={i}
                      className="p-2.5 rounded-lg bg-card border border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-2xs hover:border-primary/30 transition-colors"
                    >
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {v.platform && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white shrink-0 shadow-2xs"
                              style={{
                                backgroundColor:
                                  (VIDEO_PLATFORM_REGISTRY[v.platform as VideoPlatformType] || VIDEO_PLATFORM_REGISTRY.bilibili).badgeColor,
                              }}
                            >
                              {(VIDEO_PLATFORM_REGISTRY[v.platform as VideoPlatformType] || VIDEO_PLATFORM_REGISTRY.bilibili).shortName}
                            </span>
                          )}
                          <span className="text-xs font-semibold text-foreground truncate">
                            {v.title}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                            {v.category}
                          </span>
                          <span>讲师: {v.author}</span>
                          {v.difficulty && (
                            <span className="px-1.5 py-0.5 rounded bg-muted font-medium text-foreground">
                              {v.difficulty === 'beginner' ? '入门' : v.difficulty === 'intermediate' ? '进阶' : '高阶'}
                            </span>
                          )}
                          {v.tags && v.tags.length > 0 && (
                            <span className="text-muted-foreground/80">
                              [{v.tags.slice(0, 3).join(', ')}]
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex sm:flex-col items-center sm:items-end justify-between shrink-0 font-mono text-[11px]">
                        <span className="text-amber-500 font-bold">综合 {v.hotIndex}分</span>
                        <span className="text-[10px] text-muted-foreground">{formatDuration(v.durationSec)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t">
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            关闭
          </Button>

          <div className="flex items-center gap-2">
            {dryRun && result && result.harvestedCount > 0 ? (
              <Button
                size="sm"
                className="gap-1.5 font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                onClick={() => handleStartHarvest(false)}
                disabled={isHarvesting}
              >
                <Check className="w-3.5 h-3.5" />
                <span>确认并将此方案落盘入库</span>
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isHarvesting}
                  onClick={() => handleStartHarvest(true)}
                  className="gap-1.5 text-xs"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>演练预览 (Dry Run)</span>
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 font-semibold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-xs"
                  onClick={() => handleStartHarvest(false)}
                  disabled={isHarvesting}
                >
                  <RefreshCw className={cn('w-3.5 h-3.5', isHarvesting && 'animate-spin')} />
                  <span>{isHarvesting ? '正在采集与分流...' : '立即采集并入库'}</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
