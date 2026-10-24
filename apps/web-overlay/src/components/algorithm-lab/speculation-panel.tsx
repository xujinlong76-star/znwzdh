'use client'

/**
 * 算法 10：自适应推测性预渲染（W3C Speculation Rules）。
 * 从 algorithm-lab.tsx 拆出（第五批 A1）：状态与逻辑原样搬运，行为由
 * algorithm-lab-structure.test.ts 与 e2e/algorithms.spec.ts 双守卫锁定。
 */
import { useState, useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/registry/new-york/ui/card'
import { Button } from '@/registry/new-york/ui/button'
import { Badge } from '@/components/ui/badge'
import { Zap, CheckCircle2 } from 'lucide-react'
import { type EncryptedVaultPayload, type VaultItem } from '@/lib/vault'
import { type JsonRpcResponse } from '@/lib/webmcp-bridge'
import { type CandidateItem } from '@/lib/federated-recommendation'
import {
  compileSpeculationRules,
  renderSpeculationRulesScript,
  generateFallbackLinkTags,
  type SpeculationCandidate
} from '@/lib/speculative-prerender'
import { type VectorClock } from '@/lib/crdt-sync'


export function SpeculationPanel() {
  /* --- 模块 10：自适应推测性预渲染与 W3C 规则状态 --- */
  const [specPrerenderThresh, setSpecPrerenderThresh] = useState<number>(0.82)
  const [specPrefetchThresh, setSpecPrefetchThresh] = useState<number>(0.45)
  const [specCandidates] = useState<SpeculationCandidate[]>([
    { url: 'https://navhub.dev/tech/react', confidence: 0.92, predictedArrivalMs: 110 },
    { url: 'https://navhub.dev/tech/vue', confidence: 0.78, predictedArrivalMs: 240 },
    { url: 'https://navhub.dev/tech/svelte', confidence: 0.52, predictedArrivalMs: 380 },
    { url: 'https://navhub.dev/api/tokens/revoke', confidence: 0.95, predictedArrivalMs: 90 },
    { url: 'https://navhub.dev/admin/dashboard', confidence: 0.88, predictedArrivalMs: 130 },
  ])

  const compiledSpecRules = useMemo(() => {
    return compileSpeculationRules(specCandidates, {
      prerenderConfidenceThreshold: specPrerenderThresh,
      prefetchConfidenceThreshold: specPrefetchThresh,
    })
  }, [specCandidates, specPrerenderThresh, specPrefetchThresh])

  const fallbackLinkTags = useMemo(() => {
    if (!compiledSpecRules) return []
    return generateFallbackLinkTags(compiledSpecRules)
  }, [compiledSpecRules])

  return (
    <div className="space-y-4">
          <Card className="nav-card-glow border-border/70 shadow-xs overflow-hidden">
            <CardHeader className="bg-muted/15 border-b border-border/50 pb-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
                      <Zap className="w-4 h-4" />
                    </div>
                    <span>W3C Speculation Rules 自适应推测预渲染编译器</span>
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs sm:text-sm">
                    依据 Kalman 鼠标轨迹加速度与焦点抵达预测，自动为高置信落点生成标准 Speculation Rules，并在内核中自动拦截敏感/高危路径。
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/5 text-xs font-mono">
                  Speculation Rules API
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5 sm:p-6 space-y-6">
              {/* 阈值调节 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Prerender 唤起置信度阈值</span>
                    <span className="font-mono text-amber-500 font-bold">≥ {specPrerenderThresh}</span>
                  </div>
                  <div className="flex gap-2">
                    {[0.75, 0.82, 0.9, 0.95].map((t) => (
                      <Button
                        key={t}
                        size="sm"
                        variant={specPrerenderThresh === t ? 'default' : 'outline'}
                        onClick={() => setSpecPrerenderThresh(t)}
                        className="text-xs h-7 flex-1"
                      >
                        {t}
                      </Button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    满足阈值时在后台静默预渲染整个 DOM 树与资源流，实现物理 0-RTT 秒开。
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Prefetch 降级预取阈值</span>
                    <span className="font-mono text-amber-500 font-bold">≥ {specPrefetchThresh}</span>
                  </div>
                  <div className="flex gap-2">
                    {[0.35, 0.45, 0.55, 0.65].map((t) => (
                      <Button
                        key={t}
                        size="sm"
                        variant={specPrefetchThresh === t ? 'default' : 'outline'}
                        onClick={() => setSpecPrefetchThresh(t)}
                        className="text-xs h-7 flex-1"
                      >
                        {t}
                      </Button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    中置信度仅预取静态 HTML 骨架与 CSS，节约用户端带宽与移动网络流量。
                  </p>
                </div>
              </div>

              {/* 实时推测候选卡片列表 */}
              <div className="space-y-3">
                <span className="text-xs font-semibold text-muted-foreground">传感器推测落点集与策略研判：</span>
                <div className="space-y-2">
                  {specCandidates.map((c) => {
                    const isUnsafe = /tokens|admin|logout|delete/i.test(c.url)
                    const isPrerender = !isUnsafe && c.confidence >= specPrerenderThresh
                    const isPrefetch = !isUnsafe && !isPrerender && c.confidence >= specPrefetchThresh

                    return (
                      <div key={c.url} className="p-3 rounded-lg border border-border/60 bg-muted/15 flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div className="space-y-1">
                          <div className="font-mono font-medium">{c.url}</div>
                          <div className="text-[11px] text-muted-foreground">
                            置信度: <span className="font-bold text-foreground">{c.confidence}</span> · 预估抵达: <span className="font-bold text-foreground">{c.predictedArrivalMs} ms</span>
                          </div>
                        </div>
                        <div>
                          {isUnsafe && (
                            <Badge variant="destructive" className="text-[10px]">
                              安全策略阻断 (Sensitive Path)
                            </Badge>
                          )}
                          {isPrerender && (
                            <Badge className="bg-amber-600 hover:bg-amber-600 text-[10px]">
                              唤起 Prerender (即时)
                            </Badge>
                          )}
                          {isPrefetch && (
                            <Badge variant="secondary" className="text-amber-500 border-amber-500/30 text-[10px]">
                              降级 Prefetch (适度)
                            </Badge>
                          )}
                          {!isUnsafe && !isPrerender && !isPrefetch && (
                            <Badge variant="outline" className="text-muted-foreground text-[10px]">
                              低于阈值 (无动作)
                            </Badge>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 编译产物：标准 Speculation Rules JSON 脚本 */}
              <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-amber-500 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    编译出的标准 W3C Speculation Rules 结构：
                  </span>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    script type=&quot;speculationrules&quot;
                  </span>
                </div>
                <pre className="p-3.5 rounded-lg bg-background border border-border/50 text-[11px] font-mono overflow-x-auto text-foreground/90 max-h-52">
                  {compiledSpecRules ? renderSpeculationRulesScript(compiledSpecRules) : '// 暂无满足置信度阈值的候选规则'}
                </pre>
                {fallbackLinkTags.length > 0 && (
                  <div className="pt-2 text-[11px] text-muted-foreground">
                    低版本降级回退标签: <code className="text-xs text-foreground font-mono">{fallbackLinkTags.join(' ')}</code>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
    </div>
  )
}
