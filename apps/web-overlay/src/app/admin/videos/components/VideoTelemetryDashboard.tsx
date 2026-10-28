'use client'

import { useState } from 'react'
import useSWR from 'swr'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Flame,
  Loader2,
  Play,
  RotateCw,
  Sparkles,
  TrendingUp,
  Zap
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { Badge } from '@/registry/new-york/ui/badge'
import { Progress } from '@/registry/new-york/ui/progress'
import { useToast } from '@/registry/new-york/hooks/use-toast'
import type { NavigationItem, NavigationSubItem } from '@/types/navigation'
import { formatDuration } from '@/lib/video-format'

interface VideoHarvestTaskState {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  dryRun: boolean
  progress: {
    percent: number
    stage: string
    harvestedCount: number
    replacedCount: number
  }
}

interface TaskResponse {
  activeTask: VideoHarvestTaskState | null
  recentTasks: VideoHarvestTaskState[]
  lock: { locked: boolean; owner?: string; remainingSec?: number }
}

async function fetcher(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

interface VideoTelemetryDashboardProps {
  categories: NavigationItem[]
  onTriggerHarvest: (categoryId?: string, dryRun?: boolean) => void
  onRefreshCategories: () => void
}

export function VideoTelemetryDashboard({
  categories,
  onTriggerHarvest,
  onRefreshCategories
}: VideoTelemetryDashboardProps) {
  const { toast } = useToast()
  const [isStartingAsync, setIsStartingAsync] = useState(false)

  // 轮询任务队列状态（每 2.5 秒刷新一次）
  const { data: taskData, mutate: mutateTask } = useSWR<TaskResponse>(
    '/api/videos/harvest/task',
    fetcher,
    { refreshInterval: 2500 }
  )

  const activeTask = taskData?.activeTask

  // 计算健康分箱
  const allVideos: Array<{ item: NavigationSubItem; category: NavigationItem }> = []
  categories.forEach(cat => {
    if (cat.enabled === false) return
    ;(cat.items || []).forEach(it => {
      if (it.enabled !== false && it.videoConfig) allVideos.push({ item: it, category: cat })
    })
    ;(cat.subCategories || []).forEach(sub => {
      if (sub.enabled === false) return
      ;(sub.items || []).forEach(it => {
        if (it.enabled !== false && it.videoConfig) allVideos.push({ item: it, category: cat })
      })
    })
  })

  const total = allVideos.length
  let excellent = 0 // 90-100
  let good = 0 // 70-89
  let warning = 0 // 50-69
  let urgent = 0 // <50

  const urgentList: Array<{ item: NavigationSubItem; category: NavigationItem; score: number }> = []

  allVideos.forEach(({ item, category }) => {
    const sc = item.videoConfig?.freshnessScore ?? 75
    if (sc >= 90) excellent++
    else if (sc >= 70) good++
    else if (sc >= 50) warning++
    else {
      urgent++
      urgentList.push({ item, category, score: sc })
    }
  })

  // 触发异步后台长任务
  const handleLaunchAsyncTask = async (dryRun: boolean = false) => {
    setIsStartingAsync(true)
    try {
      const res = await fetch('/api/videos/harvest/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, trigger: 'admin' })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.details || data.error || '启动失败')
      }

      mutateTask()
      toast({
        title: dryRun ? '已启动演练长任务' : '已启动后台采集与轮换',
        description: `任务 ID: ${data.taskId}，可在控制台实时查看处理进度。`
      })
    } catch (err) {
      toast({
        title: '启动任务失败',
        description: (err as Error).message,
        variant: 'destructive'
      })
    } finally {
      setIsStartingAsync(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 实时后台采集长任务进度卡片 */}
      {activeTask && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 shadow-xs space-y-3 animate-in fade-in">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <Loader2 className="w-4 h-4 text-primary animate-spin" />
              <span className="font-semibold text-sm">
                后台长任务执行中 ({activeTask.dryRun ? '试运行' : '真实生效'})
              </span>
              <Badge variant="outline" className="font-mono text-[11px] bg-background">
                {activeTask.id.slice(0, 16)}...
              </Badge>
            </div>
            <span className="text-xs font-mono font-medium text-primary">
              {activeTask.progress.percent}%
            </span>
          </div>

          <Progress value={activeTask.progress.percent} className="h-2" />

          <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-2">
            <span>{activeTask.progress.stage}</span>
            <div className="flex items-center gap-3">
              <span>已采集: <strong>{activeTask.progress.harvestedCount}</strong></span>
              <span>已轮换淘汰: <strong>{activeTask.progress.replacedCount}</strong></span>
            </div>
          </div>
        </div>
      )}

      {/* 核心看板区：时效分分布直方图 + 亟需轮换预警列表 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 左侧 2/3：时效衰减分布直方图 */}
        <div className="lg:col-span-2 rounded-xl border bg-card p-4 space-y-4 shadow-xs">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-violet-500" />
              <h3 className="text-sm font-semibold">视频时效分布直方图 (Freshness Histogram)</h3>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                disabled={Boolean(activeTask) || isStartingAsync}
                onClick={() => handleLaunchAsyncTask(true)}
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                试运行演练 (Dry Run)
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-7 text-xs gap-1.5"
                disabled={Boolean(activeTask) || isStartingAsync}
                onClick={() => handleLaunchAsyncTask(false)}
              >
                <Zap className="w-3.5 h-3.5" />
                立即全量异步采集
              </Button>
            </div>
          </div>

          <div className="space-y-3 pt-1">
            {/* 分箱 1: 卓越时效 */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  卓越新鲜 (90~100分) · 新收录 / 热门精选
                </span>
                <span className="font-mono text-muted-foreground">
                  {excellent} 部 ({total > 0 ? Math.round((excellent / total) * 100) : 0}%)
                </span>
              </div>
              <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${total > 0 ? (excellent / total) * 100 : 0}%` }}
                />
              </div>
            </div>

            {/* 分箱 2: 良好有效 */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-medium">
                  <TrendingUp className="w-3.5 h-3.5" />
                  良好有效 (70~89分) · 正常展示中
                </span>
                <span className="font-mono text-muted-foreground">
                  {good} 部 ({total > 0 ? Math.round((good / total) * 100) : 0}%)
                </span>
              </div>
              <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{ width: `${total > 0 ? (good / total) * 100 : 0}%` }}
                />
              </div>
            </div>

            {/* 分箱 3: 临界衰减 */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
                  <Clock className="w-3.5 h-3.5" />
                  临界衰减 (50~69分) · 接近半衰期阈值
                </span>
                <span className="font-mono text-muted-foreground">
                  {warning} 部 ({total > 0 ? Math.round((warning / total) * 100) : 0}%)
                </span>
              </div>
              <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all duration-500"
                  style={{ width: `${total > 0 ? (warning / total) * 100 : 0}%` }}
                />
              </div>
            </div>

            {/* 分箱 4: 亟需轮换 */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  亟需轮换 (&lt;50分) · 时效严重过期或热度过低
                </span>
                <span className="font-mono text-muted-foreground">
                  {urgent} 部 ({total > 0 ? Math.round((urgent / total) * 100) : 0}%)
                </span>
              </div>
              <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-500 rounded-full transition-all duration-500"
                  style={{ width: `${total > 0 ? (urgent / total) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* 右侧 1/3：过时预警与一键定向清洗 */}
        <div className="rounded-xl border bg-card p-4 space-y-3 shadow-xs flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-orange-500" />
              <h3 className="text-sm font-semibold">亟需轮换预警清单</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              评分低于 50 的视频将在下次触发采集时被优先轮换淘汰（已置顶锁定的内容除外）。
            </p>

            <div className="space-y-2 pt-1 max-h-48 overflow-y-auto pr-1">
              {urgentList.length === 0 ? (
                <div className="text-center py-6 space-y-1">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto opacity-70" />
                  <p className="text-xs text-muted-foreground">当前全库视频新鲜度极佳，无待淘汰项</p>
                </div>
              ) : (
                urgentList.map(({ item, category, score }) => (
                  <div
                    key={item.id}
                    className="p-2 rounded-lg border border-red-500/20 bg-red-500/5 text-xs flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium line-clamp-1">{item.title}</p>
                      <p className="text-[11px] text-muted-foreground line-clamp-1">
                        所属: {category.title} · 当前得分: <span className="font-mono font-bold text-red-500">{score}</span>
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px] px-2 text-primary hover:bg-primary/10 shrink-0"
                      onClick={() => onTriggerHarvest(category.id, false)}
                    >
                      轮换此分类
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="pt-2 border-t text-[11px] text-muted-foreground flex items-center justify-between">
            <span>总容量: {total} 部视频</span>
            <button
              onClick={onRefreshCategories}
              className="text-primary hover:underline flex items-center gap-1 cursor-pointer"
            >
              <RotateCw className="w-3 h-3" />
              刷新看板
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
