/**
 * AI 工坊「自动化体检」面板（第五批 A3.2）：死链探活 / 启发式预检 /
 * 自动修复 / 发布与下载入口。拆分说明同 sandbox 面板。
 */
'use client'

import { Activity, AlertCircle, CheckCircle2, Loader2, ShieldCheck, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/registry/new-york/ui/button'
import { cn } from '@/lib/utils'

import { AuditDimensionTile } from './audit-dimension-tile'
import type { HubPluginAuditReport, HubPluginItem } from '@/lib/navhub-api'

export interface UrlCheckResults {
  total: number
  okCount: number
  failedCount: number
  results: Array<{ url: string; ok: boolean; status: number; error?: string }>
}

export interface StudioHealthPanelProps {
  extractedUrls: string[]
  urlCheckResults: UrlCheckResults | null
  checkingUrls: boolean
  handleCheckUrls: () => void
  preAuditReport: HubPluginAuditReport | null
  autoFixing: boolean
  handleAutoFix: () => void
}

export function StudioHealthPanel(props: StudioHealthPanelProps) {
  const {
    extractedUrls,
    urlCheckResults,
    checkingUrls,
    handleCheckUrls,
    preAuditReport,
    autoFixing,
    handleAutoFix,
  } = props
  return (
    <>
              <div className="space-y-4">
                {/* AI 提交前预检报告雷达面板 */}
                {preAuditReport && (
                  <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                        <span className="text-xs font-bold text-foreground">AI 智能预检多维严审评分</span>
                        <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30 font-mono">
                          {preAuditReport.score}分 · {preAuditReport.level.toUpperCase()}级
                          {preAuditReport.decision === 'pending_review' && ' · 待复核'}
                        </Badge>
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {/* model=none 说明这次没有模型参与，不能写成「审查模型」 */}
                        {preAuditReport.llmReviewed
                          ? `审查模型: ${preAuditReport.model}`
                          : preAuditReport.model && preAuditReport.model !== 'none'
                            ? `尝试的模型: ${preAuditReport.model}（未产出结论）`
                            : '本次无模型参与：仅静态沙箱 + 外链探活'}
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-center text-xs">
                      <AuditDimensionTile label="静态安全 (30%)" value={preAuditReport.dimensionScores?.security} className="p-2 text-center bg-background/80 border-border/60" />
                      <AuditDimensionTile label="外链探活 (25%)" value={preAuditReport.dimensionScores?.availability} className="p-2 text-center bg-background/80 border-border/60" />
                      <AuditDimensionTile label="AI 合规 (25%)" value={preAuditReport.dimensionScores?.compliance} className="p-2 text-center bg-background/80 border-border/60" />
                      <AuditDimensionTile label="语义相关 (20%)" value={preAuditReport.dimensionScores?.relevance} className="p-2 text-center bg-background/80 border-border/60" />
                    </div>

                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {preAuditReport.aiRationale}
                    </p>

                    {preAuditReport.suggestions && preAuditReport.suggestions.length > 0 && (
                      <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] space-y-1">
                        <div className="font-semibold text-amber-700 dark:text-amber-300 flex items-center justify-between">
                          <span className="flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            <span>AI 优化整改建议 ({preAuditReport.suggestions.length}条)：</span>
                          </span>
                          <button
                            type="button"
                            onClick={handleAutoFix}
                            disabled={autoFixing}
                            className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-800 dark:text-amber-200 transition-colors font-medium flex items-center gap-1"
                          >
                            <Sparkles className="h-2.5 w-2.5" />
                            <span>点击一键自动修复</span>
                          </button>
                        </div>
                        <ul className="list-disc list-inside space-y-0.5 text-muted-foreground pl-1">
                          {preAuditReport.suggestions.map((s, idx) => (
                            <li key={idx}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                <div className="p-4 rounded-xl border border-border bg-card space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <ShieldCheck className="h-4 w-4 text-emerald-500" />
                        <span>全清单连通性与死链嗅探体检</span>
                      </h4>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        受限出网安全沙箱并发探活，防止提交失效死链到插件市场。
                      </p>
                    </div>
                    <Button
                      size="sm"
                      disabled={checkingUrls || extractedUrls.length === 0}
                      onClick={handleCheckUrls}
                      className="h-7 text-xs gap-1.5"
                    >
                      {checkingUrls ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span>正在并发检测...</span>
                        </>
                      ) : (
                        <>
                          <Activity className="h-3 w-3" />
                          <span>一键开始检测 ({extractedUrls.length}个链接)</span>
                        </>
                      )}
                    </Button>
                  </div>

                  {urlCheckResults && (
                    <div className="grid grid-cols-3 gap-2 pt-2 text-center text-xs">
                      <div className="p-2 rounded-lg bg-muted/50 border border-border">
                        <div className="text-lg font-bold">{urlCheckResults.total}</div>
                        <div className="text-[10px] text-muted-foreground">检测总数</div>
                      </div>
                      <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                        <div className="text-lg font-bold">{urlCheckResults.okCount}</div>
                        <div className="text-[10px]">健康正常</div>
                      </div>
                      <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400">
                        <div className="text-lg font-bold">{urlCheckResults.failedCount}</div>
                        <div className="text-[10px]">异常或超时</div>
                      </div>
                    </div>
                  )}
                </div>

                {urlCheckResults && (
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">详细探活日志：</span>
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                      {urlCheckResults.results.map((r, i) => (
                        <div
                          key={i}
                          className={cn(
                            'px-3 py-1.5 rounded-lg border text-xs flex items-center justify-between font-mono',
                            r.ok
                              ? 'bg-emerald-500/5 border-emerald-500/20 text-foreground'
                              : 'bg-rose-500/5 border-rose-500/20 text-rose-600 dark:text-rose-400'
                          )}
                        >
                          <span className="truncate max-w-[400px]">{r.url}</span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span>{r.ok ? `HTTP ${r.status || 200}` : (r.error || '失败')}</span>
                            {r.ok ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                            ) : (
                              <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
    </>
  )
}
