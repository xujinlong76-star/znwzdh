'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/registry/new-york/ui/button'
import { Scale, Check, Trophy, Sparkles, ShieldCheck } from 'lucide-react'
import type { ComparisonProvenance, TechComparisonMatrix } from '@/lib/comparison'

interface TechComparisonCardProps {
  matrix: TechComparisonMatrix
}

/**
 * P2-5 三态标注 UI：来源徽标 + 文案双通道区分，绝不只靠颜色。
 *   measured        「已核实」（绿框 + 对勾）
 *   model_generated 「模型生成」+「仅供参考」（琥珀框 + 星标 + 文案）
 *   unverified      「未验证」（虚线框）
 * 缺标注按模型生成处理：来源不明的格子绝不标成“已核实”。
 */
function ProvenanceTag({ provenance, withNote = false }: { provenance?: ComparisonProvenance; withNote?: boolean }) {
  const p = provenance ?? 'model_generated'
  if (p === 'measured') {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-emerald-400/40 bg-emerald-500/10 px-1.5 py-px text-[11px] leading-4 text-emerald-700 dark:text-emerald-400">
        <ShieldCheck className="w-3 h-3" />
        已核实
      </span>
    )
  }
  if (p === 'unverified') {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-dashed px-1.5 py-px text-[11px] leading-4 text-muted-foreground">
        未验证
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex items-center gap-0.5 rounded border border-amber-400/40 bg-amber-500/10 px-1.5 py-px text-[11px] leading-4 text-amber-700 dark:text-amber-400">
        <Sparkles className="w-3 h-3" />
        模型生成
      </span>
      {withNote && <span className="text-[11px] text-amber-700 dark:text-amber-400">仅供参考</span>}
    </span>
  )
}

/** 维度格：值 + 来源徽标；未验证的格只显“未验证”，不渲染原值。 */
function DimensionValue({ value, provenance, winner }: { value: string; provenance?: ComparisonProvenance; winner: boolean }) {
  const p = provenance ?? 'model_generated'
  if (p === 'unverified' || !value.trim() || value === '未验证') {
    return (
      <span className="flex flex-col items-start gap-1">
        <ProvenanceTag provenance="unverified" />
      </span>
    )
  }
  return (
    <span className={winner ? 'font-semibold text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}>
      <span className="flex items-center gap-1 flex-wrap">
        {winner && <Trophy className="w-3 h-3 text-amber-500 inline flex-shrink-0" />}
        <span>{value}</span>
      </span>
      <span className="mt-1 block">
        <ProvenanceTag provenance={p} withNote />
      </span>
    </span>
  )
}

export function TechComparisonCard({ matrix }: TechComparisonCardProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mx-2 mb-2 p-3.5 rounded-xl border border-violet-500/30 bg-gradient-to-br from-violet-500/5 via-primary/[0.02] to-transparent shadow-sm space-y-3">
      {/* 头部标题与标识 */}
      <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-violet-500/10 text-violet-700 dark:text-violet-400">
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
            <span className="flex items-center gap-1">
              <Badge variant="secondary" className="text-xs">{matrix.itemA.license}</Badge>
              <ProvenanceTag provenance={matrix.itemA.provenance?.license} />
            </span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1">
            <span className="flex items-center gap-1">
              <span>{matrix.itemA.category}</span>
              <ProvenanceTag provenance={matrix.itemA.provenance?.category} />
            </span>
          </p>
          <div className="space-y-1 pt-1">
            <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
              核心优势：
              <ProvenanceTag provenance={matrix.itemA.provenance?.primaryPros} withNote />
            </span>
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
            <span className="flex items-center gap-1">
              <Badge variant="secondary" className="text-xs">{matrix.itemB.license}</Badge>
              <ProvenanceTag provenance={matrix.itemB.provenance?.license} />
            </span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1">
            <span className="flex items-center gap-1">
              <span>{matrix.itemB.category}</span>
              <ProvenanceTag provenance={matrix.itemB.provenance?.category} />
            </span>
          </p>
          <div className="space-y-1 pt-1">
            <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
              核心优势：
              <ProvenanceTag provenance={matrix.itemB.provenance?.primaryPros} withNote />
            </span>
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
              <div key={idx} className="grid grid-cols-3 p-2 text-xs items-start gap-2">
                <span className="font-medium text-foreground">{dim.dimName}</span>
                <DimensionValue value={dim.valueA} provenance={dim.provenanceA} winner={dim.winner === 'A'} />
                <DimensionValue value={dim.valueB} provenance={dim.provenanceB} winner={dim.winner === 'B'} />
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
          <ProvenanceTag provenance={matrix.verdictProvenance} withNote />
          <span className="ml-1">{matrix.verdict}</span>
        </div>
      </div>
    </div>
  )
}
