'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  HeartPulse,
  RefreshCw,
  AlertTriangle,
  History,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  ShieldAlert,
  Loader2,
  X,
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  fetchSiteHealthAuditReport,
  runSiteHealthScan,
  applySiteHealingAction,
  recommendSiteAlternatives,
  type HubSiteHealthSummary,
  type HubSiteHealthIssue,
} from '@/lib/navhub-api'

interface SiteHealthAuditModalProps {
  open: boolean
  onClose: () => void
}

export function SiteHealthAuditModal({ open, onClose }: SiteHealthAuditModalProps) {
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [healingId, setHealingId] = useState<string | null>(null)
  const [recommendingId, setRecommendingId] = useState<string | null>(null)
  const [aiAlternatives, setAiAlternatives] = useState<Record<string, Array<{ title: string; url: string; reason: string }>>>({})
  const [summary, setSummary] = useState<HubSiteHealthSummary | null>(null)

  const loadReport = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchSiteHealthAuditReport()
      if (res.ok) {
        setSummary(res.summary)
      }
    } catch {
      toast.error('拉取站点健康自愈报告失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      loadReport()
    }
  }, [open, loadReport])

  const handleScan = async () => {
    setScanning(true)
    try {
      const res = await runSiteHealthScan()
      if (res.ok) {
        setSummary(res.summary)
        toast.success(`巡检完成，已扫描 ${res.scanned} 个站点`)
      }
    } catch {
      toast.error('触发站点巡检失败')
    } finally {
      setScanning(false)
    }
  }

  const handleApplyWayback = async (issue: HubSiteHealthIssue) => {
    if (!issue.waybackRecoveryUrl) return
    setHealingId(issue.siteId)
    try {
      const res = await applySiteHealingAction({
        siteId: issue.siteId,
        action: 'wayback',
        targetUrl: issue.waybackRecoveryUrl,
      })
      if (res.ok) {
        toast.success(`已成功采纳 Wayback 历史快照自愈站点：${issue.title}`)
        loadReport()
      }
    } catch {
      toast.error('自愈采纳失败')
    } finally {
      setHealingId(null)
    }
  }

  const handleApplyAlternative = async (issue: HubSiteHealthIssue, alt: { title: string; url: string }) => {
    setHealingId(issue.siteId)
    try {
      const res = await applySiteHealingAction({
        siteId: issue.siteId,
        action: 'replacement',
        targetUrl: alt.url,
        targetTitle: alt.title,
      })
      if (res.ok) {
        toast.success(`已成功替换为平替站点：${alt.title}`)
        loadReport()
      }
    } catch {
      toast.error('平替替换失败')
    } finally {
      setHealingId(null)
    }
  }

  const handleFetchAiAlternatives = async (issue: HubSiteHealthIssue) => {
    setRecommendingId(issue.siteId)
    try {
      const res = await recommendSiteAlternatives(issue.siteId)
      if (res.ok && res.recommendations?.length > 0) {
        setAiAlternatives((prev) => ({
          ...prev,
          [issue.siteId]: res.recommendations,
        }))
        toast.success(`Agnes 3.0 Flash 已生成 ${res.recommendations.length} 个智能平替建议`)
      } else {
        toast.info('暂无更高匹配度的替代站点')
      }
    } catch {
      toast.error('获取 AI 替代站点失败')
    } finally {
      setRecommendingId(null)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in-0 duration-200">
      <div className="relative w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-border/80 bg-card/95 shadow-2xl overflow-hidden backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/60 bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
              <HeartPulse className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-foreground">站点健康自治巡检与无感自愈中枢</span>
                <Badge variant="outline" className="text-[10px] font-normal text-rose-600 border-rose-500/30">
                  Autonomous Health
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                实时探活死链、域名失效与 301 重定向，联动 Wayback 时间机器与 Agnes 3.0 Flash 智能推荐平替
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={scanning}
              onClick={handleScan}
              className="h-8 text-xs gap-1.5"
            >
              {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span>{scanning ? '巡检中...' : '即刻全面巡检'}</span>
            </Button>
            <Button size="icon" variant="ghost" aria-label="关闭健康自愈中枢" className="h-8 w-8 rounded-full" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* KPI 概览 */}
        {summary && (
          <div className="grid grid-cols-4 gap-2 px-5 py-3 border-b border-border/40 bg-muted/10 text-xs">
            <div className="p-2.5 rounded-lg border border-border/50 bg-background/50">
              <div className="text-[10px] text-muted-foreground">全站健康度评分</div>
              <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                {summary.healthScore}%
              </div>
            </div>
            <div className="p-2.5 rounded-lg border border-border/50 bg-background/50">
              <div className="text-[10px] text-muted-foreground">巡检覆盖总数</div>
              <div className="text-base font-semibold text-foreground mt-0.5">{summary.totalSites} 个</div>
            </div>
            <div className="p-2.5 rounded-lg border border-border/50 bg-background/50">
              <div className="text-[10px] text-muted-foreground">在线正常站点</div>
              <div className="text-base font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                {summary.activeCount} 个
              </div>
            </div>
            <div className="p-2.5 rounded-lg border border-border/50 bg-background/50">
              <div className="text-[10px] text-muted-foreground">异常/死链待治愈</div>
              <div className="text-base font-semibold text-rose-600 dark:text-rose-400 mt-0.5">
                {summary.brokenCount} 个
              </div>
            </div>
          </div>
        )}

        {/* 异常列表与自愈决策 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-xs text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <span>正在拉取最新自治巡检报告...</span>
            </div>
          ) : !summary || summary.issues.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <div className="inline-flex p-3 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="text-sm font-medium text-foreground">全站网络连接健康度极佳！</div>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                未检测到无法访问的失效站点或死链。系统后台将持续自动守护。
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
                <span>检测到的待自愈站点列表 ({summary.issues.length})</span>
                <span className="text-[10px] font-normal font-mono">
                  上次巡检：{new Date(summary.scannedAt).toLocaleTimeString()}
                </span>
              </div>

              {summary.issues.map((issue) => {
                const currentAlts = aiAlternatives[issue.siteId] || issue.suggestedReplacements || []
                return (
                  <div
                    key={issue.siteId}
                    className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/5 dark:bg-rose-950/10 space-y-3 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-foreground truncate">{issue.title}</span>
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0 font-mono">
                            {issue.cause}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                            {issue.severity}
                          </Badge>
                        </div>
                        <div className="text-[11px] font-mono text-muted-foreground truncate">{issue.url}</div>
                        <div className="text-[11px] text-muted-foreground">{issue.description}</div>
                      </div>

                      {/* 修复动作 */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {issue.waybackRecoveryUrl && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={healingId === issue.siteId}
                            className="h-7 text-xs gap-1 bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-200 border border-amber-500/30"
                            onClick={() => handleApplyWayback(issue)}
                          >
                            <History className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                            <span>采纳 Wayback 快照</span>
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={recommendingId === issue.siteId}
                          className="h-7 text-xs gap-1 border-purple-500/30 text-purple-700 dark:text-purple-300 hover:bg-purple-500/10"
                          onClick={() => handleFetchAiAlternatives(issue)}
                        >
                          {recommendingId === issue.siteId ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Sparkles className="w-3 h-3 text-purple-500" />
                          )}
                          <span>AI 平替推荐</span>
                        </Button>
                      </div>
                    </div>

                    {/* 推荐平替列表 */}
                    {currentAlts.length > 0 && (
                      <div className="pt-2 border-t border-border/40 space-y-1.5">
                        <div className="text-[11px] font-medium text-foreground flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-purple-500" />
                          <span>候选平替方案：</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {currentAlts.map((alt, i) => (
                            <div
                              key={i}
                              className="p-2 rounded-lg border border-border/50 bg-background/80 flex items-center justify-between text-xs gap-2"
                            >
                              <div className="min-w-0">
                                <div className="font-medium text-xs text-foreground truncate">{alt.title}</div>
                                <div className="text-[10px] text-muted-foreground truncate">{alt.reason}</div>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={healingId === issue.siteId}
                                className="h-6 px-2 text-[10px] gap-1 text-primary hover:text-primary shrink-0"
                                onClick={() => handleApplyAlternative(issue, alt)}
                              >
                                <span>一键平替</span>
                                <ArrowRight className="w-2.5 h-2.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border/60 bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span>自愈动作已连接审计流水 (Audit Log)，每次替换均具备回滚与快照保障</span>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onClose}>
            完成
          </Button>
        </div>
      </div>
    </div>
  )
}
