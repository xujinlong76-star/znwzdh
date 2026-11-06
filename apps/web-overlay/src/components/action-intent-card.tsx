'use client'

import { useState } from 'react'
import Link from 'next/link'
import { safeHref } from '@/lib/safe-url'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/registry/new-york/ui/button'
import {
  Sparkles,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Workflow,
  Zap,
  Eye,
  Copy,
  Check,
  X,
} from 'lucide-react'
import { copyText } from '@/lib/clipboard'

export interface ActionIntentCardData {
  isActionable: boolean
  actionSummary: string
  primaryTool: {
    id: string
    title: string
    url: string
    whyBest: string
  }
  steps: string[]
  proTip: string
  alternativeTool?: {
    id?: string
    title: string
    url: string
    reason: string
  }
  model?: string
}

interface ActionIntentCardProps {
  data: ActionIntentCardData
}

export function ActionIntentCard({ data }: ActionIntentCardProps) {
  const [copyGuideState, setCopyGuideState] = useState<'idle' | 'copied' | 'failed'>('idle')

  if (!data.isActionable || !data.primaryTool) return null

  const handleCopyGuide = async () => {
    const text = [
      `🎯 ${data.actionSummary}`,
      `🛠️ 推荐工具: ${data.primaryTool.title} (${data.primaryTool.url})`,
      `💡 入选理由: ${data.primaryTool.whyBest}`,
      '',
      '📋 极简 3 步落地指南:',
      ...data.steps.map((s, idx) => `${idx + 1}. ${s.replace(/^(\d+[\.、\s]+|[一二三四五]+[、\.\s]+)/, '').trim()}`),
      '',
      `⚠️ 避坑提示: ${data.proTip}`,
    ].join('\n')

    const res = await copyText(text)
    setCopyGuideState(res.ok ? 'copied' : 'failed')
    setTimeout(() => setCopyGuideState('idle'), 2000)
  }

  return (
    <div className="mx-2 mb-2 p-3.5 rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-amber-500/[0.03] to-transparent shadow-sm space-y-3">
      {/* 头部摘要 */}
      <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-amber-500/20 text-amber-600 dark:text-amber-400">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-foreground">{data.actionSummary}</span>
              <Badge variant="outline" className="text-xs text-amber-600 dark:text-amber-400 border-amber-500/30 font-medium">
                AI 极速操作法
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              为您匹配站内最优工具与 3 步实操闭环
            </p>
          </div>
        </div>

        <Button
          size="sm"
          variant="ghost"
          onClick={handleCopyGuide}
          className="h-6.5 px-2 text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground flex-shrink-0"
        >
          {copyGuideState === 'copied' ? (
            <Check className="w-3 h-3 text-emerald-500" />
          ) : copyGuideState === 'failed' ? (
            <X className="w-3 h-3 text-destructive-text" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
          <span>{copyGuideState === 'copied' ? '已复制' : '复制指南'}</span>
        </Button>
      </div>

      {/* 首推王牌工具卡片 */}
      <div className="p-2.5 rounded-lg border border-primary/20 bg-background/90 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">
              王牌首选
            </span>
            <span className="font-bold text-sm text-foreground truncate">
              {data.primaryTool.title}
            </span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">
            💡 {data.primaryTool.whyBest}
          </p>
        </div>

        {/* 双行动入口：外链直达 + 站内深度透视 */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {data.primaryTool.id && (
            <Link
              href={`/site/${encodeURIComponent(data.primaryTool.id)}`}
              className="inline-flex items-center justify-center gap-1 h-7.5 px-2.5 rounded-md text-xs font-medium border border-border/80 bg-background hover:bg-muted text-muted-foreground hover:text-foreground shadow-2xs transition-colors"
            >
              <Eye className="w-3 h-3" />
              <span>深度透视</span>
            </Link>
          )}

          <a
            href={safeHref(data.primaryTool.url)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-1 h-7.5 px-3 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 shadow-2xs transition-colors"
          >
            <span>直达使用</span>
            <ExternalLink className="w-3.5 h-3.5 ml-0.5" />
          </a>
        </div>
      </div>

      {/* 3步极简操作法 */}
      <div className="space-y-1.5">
        <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
          <Workflow className="w-3.5 h-3.5 text-primary" />
          <span>极简 3 步落地指南：</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {data.steps.map((step, idx) => {
            const cleanStep = step.replace(/^(\d+[\.、\s]+|[一二三四五]+[、\.\s]+)/, '').trim()
            return (
              <div
                key={idx}
                className="p-2.5 rounded-lg bg-muted/60 border text-xs text-foreground flex flex-col justify-between gap-1 shadow-2xs"
              >
                <div className="flex items-center gap-1.5 text-primary font-semibold text-[11px]">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  <span>第 {idx + 1} 步</span>
                </div>
                <p className="leading-relaxed text-muted-foreground">{cleanStep}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* 避坑小贴士与备选平替 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-1 text-xs">
        <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="line-clamp-1">提示: {data.proTip}</span>
        </div>

        {data.alternativeTool && (
          <div className="flex items-center gap-1 text-muted-foreground flex-shrink-0">
            <span>备选:</span>
            {data.alternativeTool.id ? (
              <Link
                href={`/site/${encodeURIComponent(data.alternativeTool.id)}`}
                className="text-primary hover:underline font-medium flex items-center gap-0.5"
              >
                {data.alternativeTool.title}
              </Link>
            ) : (
              <a
                href={safeHref(data.alternativeTool.url)}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline font-medium flex items-center gap-0.5"
              >
                {data.alternativeTool.title}
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
            <span className="text-[11px]">({data.alternativeTool.reason})</span>
          </div>
        )}
      </div>
    </div>
  )
}
