'use client'

/**
 * 算法 2：庞加莱双曲空间平替几何。
 * 从 algorithm-lab.tsx 拆出（第五批 A1）：状态与逻辑原样搬运，行为由
 * algorithm-lab-structure.test.ts 与 e2e/algorithms.spec.ts 双守卫锁定。
 */
import { useState, useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/registry/new-york/ui/card'
import { Button } from '@/registry/new-york/ui/button'
import { Badge } from '@/components/ui/badge'
import { Orbit } from 'lucide-react'
interface TechNode {
  id: string
  name: string
  category: string
  emb: [number, number] // 庞加莱圆盘 2D 坐标
}

const TECH_NODES: TechNode[] = [
  { id: 'react', name: 'React', category: '前端框架', emb: [0.65, 0.2] },
  { id: 'vue', name: 'Vue.js', category: '前端框架', emb: [0.63, 0.25] },
  { id: 'svelte', name: 'Svelte', category: '前端框架', emb: [0.62, 0.28] },
  { id: 'angular', name: 'Angular', category: '前端框架', emb: [0.67, 0.15] },
  { id: 'fe_root', name: '前端工程体系', category: '根抽象分类', emb: [0.15, 0.05] },
  { id: 'vscode', name: 'VS Code', category: '编辑器', emb: [-0.6, 0.3] },
  { id: 'cursor', name: 'Cursor', category: '编辑器', emb: [-0.62, 0.32] },
  { id: 'zed', name: 'Zed', category: '编辑器', emb: [-0.58, 0.35] },
]

function poincareDist2D(u: [number, number], v: [number, number]): number {
  const diffSq = (u[0] - v[0]) ** 2 + (u[1] - v[1]) ** 2
  const uNormSq = u[0] ** 2 + u[1] ** 2
  const vNormSq = v[0] ** 2 + v[1] ** 2
  const denom = (1 - uNormSq) * (1 - vNormSq)
  if (denom <= 0) return 25.0
  const delta = 1 + (2 * diffSq) / denom
  const safeDelta = Math.max(1.0, delta)
  return Math.log(safeDelta + Math.sqrt(Math.max(0, safeDelta * safeDelta - 1)))
}


export function HyperbolicPanel() {
  /* --- 模块 2：双曲平替状态 --- */
  const [selectedTech, setSelectedTech] = useState<string>('react')
  const activeTech = useMemo(() => TECH_NODES.find((t) => t.id === selectedTech) || TECH_NODES[0]!, [selectedTech])

  const hyperbolicAlts = useMemo(() => {
    const list = TECH_NODES.filter((n) => n.id !== activeTech.id).map((cand) => {
      const dist = poincareDist2D(activeTech.emb, cand.emb)
      const uNorm = Math.sqrt(activeTech.emb[0] ** 2 + activeTech.emb[1] ** 2)
      const vNorm = Math.sqrt(cand.emb[0] ** 2 + cand.emb[1] ** 2)
      const depthParity = Math.max(0, 1 - Math.abs(uNorm - vNorm))
      const score = Math.exp(-dist / 2.5) * depthParity
      return {
        ...cand,
        dist: Number(dist.toFixed(3)),
        depthParity: Number(depthParity.toFixed(2)),
        score: Number((score * 100).toFixed(1)),
      }
    })
    return list.sort((a, b) => b.score - a.score)
  }, [activeTech])

  return (
    <div className="space-y-4">
          <Card className="nav-card-glow border-border/70 shadow-xs overflow-hidden">
            <CardHeader className="bg-muted/15 border-b border-border/50 pb-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-violet-500/10 text-violet-500">
                      <Orbit className="w-4 h-4" />
                    </div>
                    <span>庞加莱双曲圆盘（Poincaré Disk）平替拓扑推导</span>
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs sm:text-sm">
                    双曲空间容积按指数级膨胀，越靠近边界代表技术越细分。结合双曲测地线与抽象层级模长一致性（Norm Equivalence）自动发现竞品。
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-violet-500 border-violet-500/30 bg-violet-500/5 text-xs">
                  常负曲率 K = -1
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs font-semibold text-muted-foreground mr-1">选择基准技术锚点：</span>
                {TECH_NODES.map((node) => (
                  <Button
                    key={node.id}
                    size="sm"
                    variant={selectedTech === node.id ? 'default' : 'outline'}
                    onClick={() => setSelectedTech(node.id)}
                    className={`text-xs h-7.5 px-3 rounded-lg transition-all ${
                      selectedTech === node.id ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-xs' : 'border-border/60 hover:border-violet-500/40'
                    }`}
                  >
                    {node.name}
                  </Button>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                {/* 左侧：2D 庞加莱投影圆盘示意 */}
                <div className="relative w-full aspect-square max-w-sm mx-auto rounded-full border-2 border-violet-500/30 bg-radial from-violet-500/10 via-background to-background flex items-center justify-center p-4 shadow-inner">
                  {/* 同心圆辅助线 */}
                  <div className="absolute inset-4 rounded-full border border-dashed border-violet-400/20 pointer-events-none" />
                  <div className="absolute inset-16 rounded-full border border-dashed border-violet-400/20 pointer-events-none" />
                  <div className="absolute inset-28 rounded-full border border-dotted border-violet-400/15 pointer-events-none" />
                  <div className="text-xs text-muted-foreground/70 absolute top-2 font-mono">||x|| = 1.0 (流形边界)</div>
                  <div className="text-xs text-muted-foreground/60 absolute bottom-3 font-mono">Poincaré Ball Model</div>

                  {/* 节点在圆盘上的投影点 */}
                  {TECH_NODES.map((n) => {
                    const isTarget = n.id === activeTech.id
                    const left = `${50 + n.emb[0] * 42}%`
                    const top = `${50 + n.emb[1] * 42}%`
                    return (
                      <div
                        key={n.id}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 flex items-center gap-1.5 cursor-pointer transition-all hover:scale-125 z-10`}
                        style={{ left, top }}
                        onClick={() => setSelectedTech(n.id)}
                      >
                        <div
                          className={`w-3.5 h-3.5 rounded-full border transition-all ${
                            isTarget
                              ? 'bg-violet-600 border-white ring-4 ring-violet-500/30 shadow-md scale-110'
                              : 'bg-muted-foreground/50 border-background hover:bg-violet-400'
                          }`}
                        />
                        <span
                          className={`text-xs font-mono px-1.5 py-0.5 rounded shadow-2xs transition-colors ${
                            isTarget
                              ? 'bg-violet-600 text-white font-bold'
                              : 'bg-background/90 text-foreground border border-border/60 hover:border-violet-500/40'
                          }`}
                        >
                          {n.name}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {/* 右侧：测地线距离推导排行榜 */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
                    <span>基于测地距离 d_B(u, v) 求解候选：</span>
                    <Badge variant="outline" className="text-xs font-mono px-2 py-0.5">当前锚点: {activeTech.name}</Badge>
                  </div>
                  <div className="space-y-2">
                    {hyperbolicAlts.slice(0, 4).map((alt, idx) => (
                      <div
                        key={alt.id}
                        className="p-3 rounded-xl border border-border/60 bg-card hover:border-violet-500/50 transition-all flex items-center justify-between shadow-2xs group"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-bold flex items-center justify-center font-mono">
                              #{idx + 1}
                            </span>
                            <span className="text-sm font-semibold group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                              {alt.name}
                            </span>
                            <Badge variant="secondary" className="text-xs px-2 py-0.5">{alt.category}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground font-mono flex gap-3">
                            <span>双曲测地距: <strong className="text-foreground">{alt.dist}</strong></span>
                            <span>层级对等: <strong className="text-foreground">{alt.depthParity}</strong></span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-base font-extrabold font-mono text-violet-600 dark:text-violet-400">
                            {alt.score}%
                          </div>
                          <span className="text-xs text-muted-foreground">平替置信度</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
    </div>
  )
}
