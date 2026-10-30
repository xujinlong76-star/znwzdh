'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Badge } from '@/registry/new-york/ui/badge'
import { Input } from '@/registry/new-york/ui/input'
import { useToast } from '@/registry/new-york/hooks/use-toast'
import type { VideoHarvestReport } from '@/lib/video-harvester'
import { Sparkles, Play, CheckCircle2, ArrowRight, Layers, Search, Filter } from 'lucide-react'

const CATEGORIES_OPTIONS = [
  { id: 'all', title: '🌐 全部 12 个技术领域巡航 (默认全量)' },
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

interface HarvestModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCompleted?: () => void
}

export function HarvestModal({
  open,
  onOpenChange,
  onCompleted,
}: HarvestModalProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [customKeywords, setCustomKeywords] = useState<string>('')
  const [report, setReport] = useState<VideoHarvestReport | null>(null)
  const [mode, setMode] = useState<'idle' | 'previewed' | 'applied'>('idle')

  const handleHarvest = async (dryRun: boolean) => {
    setLoading(true)
    try {
      const res = await fetch('/api/videos/harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryRun,
          categoryId: selectedCategory === 'all' ? undefined : selectedCategory,
          forceKeywords: customKeywords.trim()
            ? customKeywords.split(/[,，\s]+/).filter(Boolean)
            : undefined,
        }),
      })

      if (!res.ok) throw new Error('执行采集任务失败')
      const data = await res.json()

      setReport(data.report)
      setMode(dryRun ? 'previewed' : 'applied')

      if (!dryRun) {
        toast({
          title: '自动化采集与轮换完成',
          description: `成功新增 ${data.report?.totalAddedCount || 0} 个优质视频，淘汰替换 ${data.report?.totalReplacedCount || 0} 个过时内容`,
        })
        onCompleted?.()
      }
    } catch (err) {
      toast({
        title: '错误',
        description: (err as Error).message || '任务失败',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setReport(null)
    setMode('idle')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleReset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            <span>智能热点采集与过时内容淘汰轮换</span>
          </DialogTitle>
          <DialogDescription>
            自动联动分类关键词与站内热点，发现高质量视频；通过智能语义路由器自动分流至 36 个最佳子方向。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-2 space-y-4 text-sm">
          {mode === 'idle' && (
            <div className="space-y-3.5">
              {/* 定向配置项 */}
              <div className="p-3.5 rounded-xl border bg-muted/20 space-y-3">
                <div className="font-medium text-xs text-foreground flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-primary" />
                  <span>定向采集范围与技术栈参数</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label htmlFor="harvest-target-category" className="text-[11px] text-muted-foreground font-medium">目标技术分类</label>
                    <select
                      id="harvest-target-category"
                      aria-label="目标技术分类"
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      disabled={loading}
                      className="w-full h-8 px-2.5 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {CATEGORIES_OPTIONS.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="harvest-custom-keywords" className="text-[11px] text-muted-foreground font-medium">自定义强制检索词 (选填)</label>
                    <Input
                      id="harvest-custom-keywords"
                      aria-label="自定义强制检索词"
                      value={customKeywords}
                      onChange={(e) => setCustomKeywords(e.target.value)}
                      placeholder="逗号或空格分隔，如: DeepSeek-V3, ArkTS"
                      disabled={loading}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-1 border-t border-border/40">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span>启用智能语义分流: 采集入库时自动映射至该分类下最相关的子方向（如 ArkUI -&gt; HarmonyOS NEXT）</span>
                </div>
              </div>

              {/* 机制说明 */}
              <div className="space-y-3 p-4 rounded-xl border bg-muted/30">
                <div className="font-medium text-foreground text-xs">采集与替换机制说明：</div>
                <ul className="list-disc list-inside space-y-1.5 text-xs text-muted-foreground leading-relaxed">
                  <li>
                    <strong className="text-foreground">热点源与关键词：</strong>
                    自动扫描各分类启用的采集关键词与站内高频热门技术栈。
                  </li>
                  <li>
                    <strong className="text-foreground">质量评分过滤：</strong>
                    按播放量、高收藏率（干货教程关键指标）、投币比与时长要求筛选。
                  </li>
                  <li>
                    <strong className="text-foreground">锁定防替换保护：</strong>
                    凡是标记为「📌 锁定」的经典视频，绝不会被自动轮换替换。
                  </li>
                  <li>
                    <strong className="text-foreground">温水替换防抖：</strong>
                    仅当候选新视频评分显著超越旧视频（门槛差值 ≥ 12 分）或旧视频时效严重老化（有效分 &lt; 45）时才触发替换，并完整记录审计轨迹支持一键回滚。
                  </li>
                </ul>
              </div>
            </div>
          )}

          {report && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2.5 p-3 rounded-lg bg-muted/40 border text-center">
                <div>
                  <div className="text-xs text-muted-foreground">检索候选</div>
                  <div className="text-lg font-bold text-foreground mt-0.5">
                    {report.totalHarvestedCount}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">符合新增</div>
                  <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    +{report.totalAddedCount}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">淘汰替换</div>
                  <div className="text-lg font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                    ~{report.totalReplacedCount}
                  </div>
                </div>
              </div>

              {mode === 'previewed' && (
                <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">
                  ⚠️ 当前为<strong>预览模式 (Dry Run)</strong>，尚未修改实际视频库。确认方案后点击下方「立即执行更新」即可落盘生效。
                </div>
              )}

              {mode === 'applied' && (
                <div className="p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>已成功应用采集与轮换结果至视频库！可在历史记录中随时查看并回滚。</span>
                </div>
              )}

              {report.additions.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground">新增候选视频 ({report.additions.length}):</div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {report.additions.map((item, idx) => (
                      <div key={idx} className="p-2.5 rounded-lg border bg-card text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-2xs">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-foreground truncate">
                              {item.item.title}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                            <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                              {item.subCategoryTitle ? `${item.categoryTitle} · ${item.subCategoryTitle}` : item.categoryTitle}
                            </span>
                            {item.item.videoConfig?.difficulty && (
                              <span className="px-1.5 py-0.5 rounded bg-muted font-medium text-foreground">
                                {item.item.videoConfig.difficulty === 'beginner' ? '入门' : item.item.videoConfig.difficulty === 'intermediate' ? '进阶' : '高阶'}
                              </span>
                            )}
                            {item.item.videoConfig?.tags && item.item.videoConfig.tags.length > 0 && (
                              <span className="text-muted-foreground/80">
                                [{item.item.videoConfig.tags.slice(0, 3).join(', ')}]
                              </span>
                            )}
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[11px] shrink-0 text-emerald-600 dark:text-emerald-400 font-mono">
                          评分: {item.item.videoConfig?.freshnessScore || 80}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {report.replacements.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground">替换过时视频 ({report.replacements.length}):</div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {report.replacements.map((rec, idx) => (
                      <div key={idx} className="p-2.5 rounded-lg border bg-card text-xs space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-medium text-muted-foreground">[{rec.categoryTitle}]</span>
                          <span className="text-amber-600 dark:text-amber-400 font-mono">分差提升: +{rec.scoreDiff}</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <span className="line-through truncate flex-1">{rec.oldItem.title}</span>
                          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="font-medium text-foreground truncate flex-1">{rec.newItem.title}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t">
          {mode === 'idle' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => handleHarvest(true)}
              >
                {loading ? '正在分析...' : '先演练预览 (Dry Run)'}
              </Button>
              <Button
                size="sm"
                disabled={loading}
                onClick={() => handleHarvest(false)}
                className="gap-1.5 font-semibold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
              >
                <Play className="h-3.5 w-3.5 fill-white" />
                <span>{loading ? '正在采集与轮换...' : '立即执行全量更新'}</span>
              </Button>
            </>
          ) : mode === 'previewed' ? (
            <>
              <Button variant="outline" size="sm" onClick={handleReset}>
                重新配置
              </Button>
              <Button
                size="sm"
                disabled={loading}
                onClick={() => handleHarvest(false)}
                className="gap-1.5 font-semibold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
              >
                <Play className="h-3.5 w-3.5 fill-white" />
                <span>{loading ? '正在落盘执行...' : '确认并立即应用方案'}</span>
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => onOpenChange(false)}>
              完成
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
