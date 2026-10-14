'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/registry/new-york/ui/button'
import { Scale, Check, Trophy, Sparkles, AlertCircle } from 'lucide-react'
import type { TechComparisonMatrix } from '@/lib/comparison'

interface TechComparisonCardProps {
  matrix: TechComparisonMatrix
}

export function TechComparisonCard({ matrix }: TechComparisonCardProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mx-2 mb-2 p-3.5 rounded-xl border border-violet-500/30 bg-gradient-to-br from-violet-500/5 via-primary/[0.02] to-transparent shadow-sm space-y-3">
      {/* 头部标题与标识 */}
      <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400">
            <Scale className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-foreground">{matrix.title}</span>
              <Badge variant="outline" className="text-xs text-violet-600 dark:text-violet-400 border-violet-400/30">
                Agentic 决策矩阵
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">多维参数原地对比 · 0 延迟决策</p>
          </div>
        </div>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => setExpanded(!expanded)}
          className="text-xs h-7 text-muted-foreground hover:text-foreground"
        >
          {expanded ? '收起详情' : '展开参数'}
        </Button>
      </div>

      {/* 并排核心摘要对比 */}
      <div className="grid grid-cols-2 gap-2.5 text-xs">
        {/* A 方案 */}
        <div className="p-2.5 rounded-lg border bg-background/80 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-bold text-foreground">{matrix.itemA.name}</span>
            <Badge variant="secondary" className="text-xs">{matrix.itemA.license}</Badge>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1">{matrix.itemA.category}</p>
          <div className="space-y-1 pt-1">
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold block">核心优势：</span>
            {matrix.itemA.primaryPros.slice(0, 2).map((pro, i) => (
              <div key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                <Check className="w-3 h-3 text-emerald-500 flex-shrink-0 mt-0.5" />
                <span className="line-clamp-1">{pro}</span>
              </div>
            ))}
          </div>
        </div>

        {/* B 方案 */}
        <div className="p-2.5 rounded-lg border bg-background/80 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-bold text-foreground">{matrix.itemB.name}</span>
            <Badge variant="secondary" className="text-xs">{matrix.itemB.license}</Badge>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1">{matrix.itemB.category}</p>
          <div className="space-y-1 pt-1">
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold block">核心优势：</span>
            {matrix.itemB.primaryPros.slice(0, 2).map((pro, i) => (
              <div key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                <Check className="w-3 h-3 text-emerald-500 flex-shrink-0 mt-0.5" />
                <span className="line-clamp-1">{pro}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 展开的维度对比表 */}
      {expanded && (
        <div className="border rounded-lg overflow-hidden text-xs bg-background">
          <div className="grid grid-cols-3 bg-muted/50 p-2 font-semibold text-xs text-muted-foreground border-b">
            <span>对比维度</span>
            <span>{matrix.itemA.name}</span>
            <span>{matrix.itemB.name}</span>
          </div>
          <div className="divide-y divide-border/60">
            {matrix.dimensions.map((dim, idx) => (
              <div key={idx} className="grid grid-cols-3 p-2 text-xs items-center gap-2">
                <span className="font-medium text-foreground">{dim.dimName}</span>
                <span className={dim.winner === 'A' ? 'font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1' : 'text-muted-foreground'}>
                  {dim.winner === 'A' && <Trophy className="w-3 h-3 text-amber-500 inline flex-shrink-0" />}
                  {dim.valueA}
                </span>
                <span className={dim.winner === 'B' ? 'font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1' : 'text-muted-foreground'}>
                  {dim.winner === 'B' && <Trophy className="w-3 h-3 text-amber-500 inline flex-shrink-0" />}
                  {dim.valueB}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 结论建议 */}
      <div className="p-2.5 rounded-lg bg-violet-500/10 border border-violet-500/20 text-xs flex items-start gap-2">
        <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-foreground leading-relaxed">
          <span className="font-bold text-violet-700 dark:text-violet-300 mr-1">选型建议：</span>
          {matrix.verdict}
        </div>
      </div>
    </div>
  )
}
