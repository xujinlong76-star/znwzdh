'use client'

import React, { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import {
  Bot,
  BrainCircuit,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  PlayCircle,
  Terminal,
  Layers,
  Cpu,
  RefreshCw,
  Search,
  Filter,
} from 'lucide-react'
import { formatDuration } from '@/lib/video-format'
import { cn } from '@/lib/utils'
import type {
  AutonomousHarvestLogEntry,
  AutonomousHarvestCycleReport,
} from '@/lib/video-autonomous-ai-harvester'

interface VideoAutonomousHarvestConsoleProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCycleFinished?: () => void
}

export function VideoAutonomousHarvestConsole({
  open,
  onOpenChange,
  onCycleFinished,
}: VideoAutonomousHarvestConsoleProps) {
  const [isRunning, setIsRunning] = useState<boolean>(false)
  const [dryRun, setDryRun] = useState<boolean>(false)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [logs, setLogs] = useState<AutonomousHarvestLogEntry[]>([])
  const [report, setReport] = useState<AutonomousHarvestCycleReport | null>(null)
  const [stats, setStats] = useState<{
    totalVideos: number
    categoriesCount: number
    aiScoredCount: number
    avgAiScore: number
    candidatePoolSize: number
  } | null>(null)
  const [isLoadingStats, setIsLoadingStats] = useState<boolean>(false)

  // Fetch initial stats when modal opens
  useEffect(() => {
    if (!open) return
    setIsLoadingStats(true)
    fetch('/api/videos/ai-autonomous-harvest')
      .then(res => res.json())
      .then(json => {
        if (json.code === 0 && json.data) {
          setStats({
            totalVideos: json.data.totalVideos,
            categoriesCount: json.data.categoriesCount,
            aiScoredCount: json.data.aiScoredCount,
            avgAiScore: json.data.avgAiScore,
            candidatePoolSize: json.data.candidatePoolSize,
          })
        }
      })
      .catch(err => console.error('Failed to load harvest stats:', err))
      .finally(() => setIsLoadingStats(false))
  }, [open])

  const handleStartAutonomousCycle = async () => {
    setIsRunning(true)
    setLogs([
      {
        timestamp: Date.now(),
        level: 'info',
        message: '⚡ 启动全天候 AI 自主巡航引擎...',
      },
      {
        timestamp: Date.now() + 100,
        level: 'ai_thought',
        message: '🧠 AI 大模型知识图谱正在分析前沿技术演进缺口与课程时效性...',
      },
    ])

    try {
      const response = await fetch('/api/videos/ai-autonomous-harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryRun,
          forceCategory: selectedCategory === 'all' ? undefined : selectedCategory,
        }),
      })

      const result = await response.json()
      if (result.code === 0 && result.data?.report) {
        const cycleReport: AutonomousHarvestCycleReport = result.data.report
        setReport(cycleReport)
        setLogs(cycleReport.logs || [])
        if (onCycleFinished) onCycleFinished()
      } else {
        setLogs(prev => [
          ...prev,
          {
            timestamp: Date.now(),
            level: 'rejected',
            message: `❌ 采集巡航遇到异常: ${result.message || '未知错误'}`,
          },
        ])
      }
    } catch (err: any) {
      setLogs(prev => [
        ...prev,
        {
          timestamp: Date.now(),
          level: 'rejected',
          message: `❌ 网络或服务通信失败: ${err?.message || err}`,
        },
      ])
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="shrink-0 pb-3 border-b border-border/50">
          <DialogTitle className="flex items-center justify-between text-base font-bold">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <BrainCircuit className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <span>AI 全自主视频采集与知识重构控制台</span>
                <p className="text-[11px] font-normal text-muted-foreground mt-0.5">
                  全流程无人值守巡航 · AI 大模型深度审核 · 自动提取章节字幕测验
                </p>
              </div>
            </div>
            {stats && (
              <div className="flex items-center gap-3 text-xs font-mono">
                <div className="text-right">
                  <div className="text-foreground font-semibold">{stats.totalVideos} 部视频</div>
                  <div className="text-muted-foreground text-[10px]">AI均分 {stats.avgAiScore}</div>
                </div>
              </div>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pt-3 pr-1 text-xs">
          {/* Controls Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3 rounded-lg border border-border/60 bg-muted/20">
            <div className="space-y-1">
              <label htmlFor="harvest-category-filter" className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5" />
                <span>目标技术领域</span>
              </label>
              <select id="harvest-category-filter"
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="w-full h-8 px-2 rounded-md bg-background border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="all">全领域自动拓展</option>
                <option value="cat_ai_engineering">AI 与大模型工程</option>
                <option value="cat_fullstack_architecture">现代全栈与架构演进</option>
                <option value="cat_devops_cloud">云原生与 DevOps 实战</option>
                <option value="cat_systems_perf">系统底层与高性能计算</option>
                <option value="cat_tools_indie">开源神器与独立开发</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>运行模式</span>
              </label>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setDryRun(false)}
                  className={cn(
                    'px-2.5 py-1 rounded text-[11px] font-medium border transition-colors',
                    !dryRun
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  真实自动入库
                </button>
                <button
                  type="button"
                  onClick={() => setDryRun(true)}
                  className={cn(
                    'px-2.5 py-1 rounded text-[11px] font-medium border transition-colors',
                    dryRun
                      ? 'bg-amber-500/20 text-amber-500 border-amber-500/40'
                      : 'bg-background border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  沙盒试运行 (Dry-Run)
                </button>
              </div>
            </div>

            <div className="flex items-end">
              <Button
                onClick={handleStartAutonomousCycle}
                disabled={isRunning}
                className="w-full h-8 text-xs font-semibold gap-2 shadow-sm"
              >
                {isRunning ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>AI 巡航中...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>启动全自主巡航</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* AI Log / Thought Stream */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5 font-mono">
                <Terminal className="w-3.5 h-3.5 text-primary" />
                <span>AI 大模型推理与决策链日志</span>
              </span>
              <span className="text-[10px] font-mono">
                {logs.length > 0 ? `${logs.length} 条推理记录` : '待巡航'}
              </span>
            </div>

            <div className="h-44 p-3 rounded-lg border border-border/70 bg-zinc-950 font-mono text-[11px] space-y-1.5 overflow-y-auto leading-relaxed shadow-inner">
              {logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-zinc-500 space-y-1.5">
                  <Bot className="w-6 h-6 opacity-40" />
                  <p>AI 采集流水线就绪。点击“启动全自主巡航”让大模型自主发现与审核高质量视频。</p>
                </div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-zinc-600 shrink-0 select-none">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    {log.level === 'ai_thought' && (
                      <span className="text-indigo-400 font-semibold">[AI Thought]</span>
                    )}
                    {log.level === 'approved' && (
                      <span className="text-emerald-400 font-semibold">[APPROVED]</span>
                    )}
                    {log.level === 'rejected' && (
                      <span className="text-rose-400 font-semibold">[REJECTED]</span>
                    )}
                    {log.level === 'success' && (
                      <span className="text-amber-400 font-semibold">[SUCCESS]</span>
                    )}
                    {log.level === 'info' && (
                      <span className="text-zinc-400">[INFO]</span>
                    )}
                    <span
                      className={cn(
                        'break-all',
                        log.level === 'ai_thought' && 'text-indigo-200/90',
                        log.level === 'approved' && 'text-emerald-300',
                        log.level === 'rejected' && 'text-rose-300/80',
                        log.level === 'success' && 'text-amber-300 font-medium',
                        log.level === 'info' && 'text-zinc-300'
                      )}
                    >
                      {log.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Harvest Report / Summary Result */}
          {report && (
            <div className="space-y-3 p-3.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
              <div className="flex items-center justify-between font-semibold text-emerald-400">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>巡航结果: 成功采集 {report.newCourses.length} 部优质课程</span>
                </span>
                <span className="text-[11px] font-mono text-emerald-500/80">
                  耗时 {((report.completedAt - report.startedAt) / 1000).toFixed(1)}s
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 py-1 text-center font-mono">
                <div className="p-2 rounded bg-background/50 border border-border/50">
                  <div className="text-muted-foreground text-[10px]">扫描候选池</div>
                  <div className="text-foreground font-bold text-sm">{report.scannedCandidatesCount}</div>
                </div>
                <div className="p-2 rounded bg-background/50 border border-border/50">
                  <div className="text-emerald-400 text-[10px]">AI 审核通过</div>
                  <div className="text-emerald-400 font-bold text-sm">{report.aiApprovedCount}</div>
                </div>
                <div className="p-2 rounded bg-background/50 border border-border/50">
                  <div className="text-rose-400 text-[10px]">AI 拒绝过滤</div>
                  <div className="text-rose-400 font-bold text-sm">{report.aiRejectedCount}</div>
                </div>
              </div>

              {report.newCourses.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="text-[11px] font-medium text-foreground flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-primary" />
                    <span>最新入库课程明细</span>
                  </div>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1 font-sans">
                    {report.newCourses.map((c, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded-md bg-background/80 border border-border/60 hover:border-primary/40 transition-colors"
                      >
                        <div className="min-w-0 pr-2">
                          <p className="font-medium text-foreground truncate">{c.title}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {c.categoryTitle} · UP主: {c.author} · 时长: {formatDuration(c.durationSec)}
                          </p>
                        </div>
                        <div className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-primary/10 text-primary border border-primary/20">
                          <Sparkles className="w-3 h-3" />
                          <span>AI {c.aiScore}分</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 pt-3 border-t border-border/50 flex items-center justify-between text-muted-foreground text-[11px]">
          <div className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5" />
            <span>自适应知识图谱 + 深度学习大模型自动流水线</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-7 text-xs">
            关闭控制台
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
