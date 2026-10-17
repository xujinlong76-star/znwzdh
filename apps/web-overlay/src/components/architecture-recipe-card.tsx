'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/registry/new-york/ui/button'
import { Layers, ExternalLink, Copy, Check, ArrowRight, Terminal } from 'lucide-react'
import type { ArchitectureRecipe } from '@/lib/architecture-recipe'
import { copyText } from '@/lib/clipboard'

interface ArchitectureRecipeCardProps {
  recipe: ArchitectureRecipe
}

export function ArchitectureRecipeCard({ recipe }: ArchitectureRecipeCardProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!recipe.quickStartSnippet) return
    // 以真实结果为准：以前 void 掉 Promise，失败时静默 + 图标照样变成"已复制"
    const ok = await copyText(recipe.quickStartSnippet)
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mx-2 mb-2 p-3.5 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 via-primary/[0.02] to-transparent shadow-sm space-y-3">
      {/* 头部标题与描述 */}
      <div className="flex items-start justify-between gap-2 border-b border-border/50 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-primary/10 text-primary">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-foreground">{recipe.title}</span>
              <Badge variant="outline" className="text-xs text-primary border-primary/30">
                Graph-RAG 架构配方
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{recipe.targetGoal}</p>
          </div>
        </div>
      </div>

      {/* 分层技术链条 */}
      <div className="space-y-2">
        {recipe.layers.map((layer, idx) => (
          <div key={idx} className="p-2 rounded-lg border bg-background/80 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-muted-foreground">{layer.layerName}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{layer.category}</span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={layer.recommended.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-primary hover:underline flex items-center gap-1"
                >
                  {layer.recommended.title}
                  <ExternalLink className="w-3 h-3" />
                </a>
                <span className="text-xs text-muted-foreground line-clamp-1">
                  - {layer.recommended.description}
                </span>
              </div>
            </div>

            {/* 可替代项 */}
            {layer.alternatives.length > 0 && (
              <div className="flex items-center gap-1.5 flex-shrink-0 text-xs text-muted-foreground">
                <span>平替:</span>
                {layer.alternatives.map((alt) => (
                  <a
                    key={alt.id}
                    href={alt.url}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-foreground underline decoration-dotted"
                  >
                    {alt.title}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 快速初始化命令 */}
      {recipe.quickStartSnippet && (
        <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/60 border font-mono text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <Terminal className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span className="truncate text-muted-foreground select-all">{recipe.quickStartSnippet}</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCopy}
            className="h-6.5 px-2 text-xs flex items-center gap-1 flex-shrink-0"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? '已复制' : '复制命令'}</span>
          </Button>
        </div>
      )}
    </div>
  )
}
