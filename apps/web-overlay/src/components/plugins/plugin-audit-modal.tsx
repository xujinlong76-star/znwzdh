'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, CircleAlert, ExternalLink, MinusCircle, ShieldCheck } from 'lucide-react'
import { fetchPluginAudit, type HubPluginAuditReport, type HubPluginItem } from '@/lib/navhub-api'
import {
  auditReviewSkippedLabel,
  buildAuditView,
  buildAuditViewFromSummary,
  type AuditLevelTone,
  type AuditReportView,
} from '@/lib/plugins/audit-report-view'
import { pluginDetailHref } from '@/lib/plugins/detail-href'

export interface PluginAuditModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  plugin: HubPluginItem
}

const TONE_BADGE_CLASS: Record<AuditLevelTone, string> = {
  good: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  ok: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
  warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  bad: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30',
}

const TONE_TEXT_CLASS: Record<AuditLevelTone, string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  ok: 'text-sky-600 dark:text-sky-400',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-red-600 dark:text-red-400',
}

const TONE_ICON_CLASS: Record<AuditLevelTone, string> = {
  good: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  ok: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  bad: 'bg-red-500/10 text-red-700 dark:text-red-400',
}

export function PluginAuditModal({ open, onOpenChange, plugin }: PluginAuditModalProps) {
  const [report, setReport] = useState<HubPluginAuditReport | null>(null)
  const [reportState, setReportState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  // 打开时拉取完整审计报告（checks / dimensionScores / level 都在里面）；
  // 报告是异步增强信息，拉不到也不阻断弹窗，只降级到摘要视图。
  useEffect(() => {
    if (!open || !plugin.aiAudit) return
    let cancelled = false
    setReport(null)
    setReportState('loading')
    fetchPluginAudit(plugin.slug)
      .then((res) => {
        if (cancelled) return
        if (res?.ok && res.report) {
          setReport(res.report)
          setReportState('ready')
        } else {
          setReportState('error')
        }
      })
      .catch(() => {
        if (!cancelled) setReportState('error')
      })
    return () => {
      cancelled = true
    }
  }, [open, plugin.slug, plugin.aiAudit])

  // 注意：hooks 之后再判断——卡片只在有 aiAudit 时才开弹窗，无摘要则无报告可看。
  if (!plugin.aiAudit) return null

  // 完整报告优先；拉不到就用摘要分数 + 等级，维度一律“未测量”，
  // 绝不拿写死的四项全绿结论补位（F-3）。
  const view: AuditReportView = report
    ? buildAuditView(report)
    : buildAuditViewFromSummary(plugin.aiAudit.score, plugin.aiAudit.level, plugin.aiAudit.auditedAt)
  const risky = view.levelTone === 'warn' || view.levelTone === 'bad'
  const skippedNote = auditReviewSkippedLabel(view.reviewSkipped)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md p-4 sm:p-5 glass-surface border-border/80 shadow-2xl rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader className="space-y-1 pb-2 border-b border-border/50">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-xl ${TONE_ICON_CLASS[view.levelTone]}`}>
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">AI 智能严审认证报告</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {risky
                  ? `插件「${plugin.name}」的审计报告存在风险项，安装前请仔细甄别`
                  : `插件「${plugin.name}」已通过山羊胡全自动代码沙盒与合规性审查`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-2 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl bg-muted/40 border border-border/60">
            <div>
              <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <span>综合质量与安全评分</span>
                <Badge
                  variant="outline"
                  className={`text-[10px] font-bold ${TONE_BADGE_CLASS[view.levelTone]}`}
                >
                  {view.level.toUpperCase()} 级准入
                </Badge>
              </div>
              <div className={`text-2xl font-black mt-0.5 font-mono ${TONE_TEXT_CLASS[view.levelTone]}`}>
                {view.score} <span className="text-xs font-normal text-muted-foreground">/ 100 分</span>
              </div>
            </div>
            <Badge
              variant="outline"
              className={`text-xs font-semibold px-2.5 py-1 self-start sm:self-auto ${TONE_BADGE_CLASS[view.levelTone]}`}
            >
              安全等级：{view.levelLabel}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            {view.dimensions.map((dim) => (
              <div key={dim.key} className="p-2 rounded-lg bg-card border border-border/50">
                <div className="text-[10px] text-muted-foreground">{dim.label}</div>
                <div className="font-bold font-mono mt-0.5">
                  {reportState === 'loading'
                    ? '读取中…'
                    : dim.score === null
                      ? '未测量'
                      : `${dim.score} 分`}
                </div>
              </div>
            ))}
          </div>

          {!view.hasFullReport && reportState === 'error' && (
            <p className="text-[11px] text-muted-foreground">
              分维报告暂时取不到：以上维度按“未测量”显示，分数与等级取自审计摘要。
            </p>
          )}

          {view.aiRationale && (
            <p className="text-[11px] leading-relaxed text-muted-foreground rounded-lg bg-muted/40 border border-border/50 p-2">
              {view.aiRationale}
            </p>
          )}
          {!view.aiRationale && skippedNote && (
            <p className="text-[11px] leading-relaxed text-muted-foreground rounded-lg bg-muted/40 border border-border/50 p-2">
              {skippedNote}
            </p>
          )}

          {reportState === 'ready' && view.checks.length > 0 && (
            <ul className="space-y-1.5">
              {view.checks.map((check) => (
                <li
                  key={check.name}
                  className="flex items-start gap-2 rounded-lg bg-card border border-border/50 p-2 text-xs"
                >
                  {check.skipped ? (
                    <MinusCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                  ) : check.passed ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <CircleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
                  )}
                  <div className="min-w-0">
                    <div className="font-medium flex flex-wrap items-center gap-1.5">
                      <span>{check.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {check.skipped ? '未运行' : check.passed ? '通过' : '未通过'}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{check.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {reportState === 'loading' && (
            <p className="text-[11px] text-muted-foreground">正在读取检查项…</p>
          )}
          {reportState === 'error' && (
            <p className="text-[11px] text-muted-foreground">检查项暂时取不到。</p>
          )}

          <div className="text-[11px] text-muted-foreground flex flex-wrap gap-1 items-center justify-between pt-1 font-mono">
            <span>认证时间：{new Date(view.auditedAt).toLocaleString()}</span>
            <span>契约版本：v1.0</span>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row justify-end gap-2">
            <Link
              href={pluginDetailHref(plugin.slug, plugin.status)}
              className="w-full sm:w-auto justify-center inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition-all"
              onClick={() => onOpenChange(false)}
            >
              <span>查看插件详情</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
