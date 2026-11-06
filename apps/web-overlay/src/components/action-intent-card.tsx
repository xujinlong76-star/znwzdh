'use client'

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
} from 'lucide-react'

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
  if (!data.isActionable || !data.primaryTool) return null

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

        {/* 嵌套可交互守卫：外层 <a> 已是链接，里面不能再套 <Button>（button 内嵌于 a 非法）。
            改为纯展示的 <span>，外观一致、语义正确；视觉仍由外层 a 的样式承担。 */}
        <a
          href={safeHref(data.primaryTool.url)}
          target="_blank"
          rel="noreferrer"
          className="flex-shrink-0 inline-flex items-center justify-center gap-1 h-7.5 px-3 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 shadow-2xs transition-colors"
        >
          <span>直达使用</span>
          <ExternalLink className="w-3.5 h-3.5 ml-0.5" />
        </a>
      </div>

      {/* 3步极简操作法 */}
      <div className="space-y-1.5">
        <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
          <Workflow className="w-3.5 h-3.5 text-primary" />
          <span>极简 3 步落地指南：</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {data.steps.map((step, idx) => (
            <div
              key={idx}
              className="p-2 rounded-lg bg-muted/60 border text-xs text-foreground flex items-start gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
              <span className="leading-snug">{step}</span>
            </div>
          ))}
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
            <a
              href={safeHref(data.alternativeTool.url)}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline font-medium flex items-center gap-0.5"
            >
              {data.alternativeTool.title}
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
            <span className="text-[11px]">({data.alternativeTool.reason})</span>
          </div>
        )}
      </div>
    </div>
  )
}
