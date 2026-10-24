'use client'

/**
 * 算法 6：知识拓扑星图与多跳寻路。
 * 从 algorithm-lab.tsx 拆出（第五批 A1）：状态与逻辑原样搬运，行为由
 * algorithm-lab-structure.test.ts 与 e2e/algorithms.spec.ts 双守卫锁定。
 */
import { useState, useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/registry/new-york/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/registry/new-york/ui/tabs'
import { Button } from '@/registry/new-york/ui/button'
import { Input } from '@/registry/new-york/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Cpu,
  Orbit,
  ShieldCheck,
  ShieldAlert,
  Zap,
  ArrowRight,
  Sparkles,
  RefreshCw,
  Check,
  CheckCircle2,
  Layers,
  ArrowLeft,
  Lock,
  Unlock,
  Network,
  Palette,
  Bot,
  Send,
  Radio,
  Share2,
  Wrench,
  Sliders,
  Activity,
} from 'lucide-react'
import Link from 'next/link'
import {
  parseSpeculativeIntent,
} from '@/lib/speculative'
import {
  encryptVault,
  decryptVault,
  type EncryptedVaultPayload,
  type VaultItem,
} from '@/lib/vault'
import {
  findShortestTechPath,
  analyzeStackCompatibility,
  PRESET_TECH_GRAPH,
} from '@/lib/knowledge-graph'
import {
  analyzeVisualFingerprint,
} from '@/lib/visual-fingerprint'
import {
  getWebMcpBridge,
  type JsonRpcResponse,
} from '@/lib/webmcp-bridge'
import {
  privatizeVector,
  rankItemsWithPrivacy,
  type CandidateItem,
} from '@/lib/federated-recommendation'
import {
  compileSpeculationRules,
  renderSpeculationRulesScript,
  generateFallbackLinkTags,
  type SpeculationCandidate,
} from '@/lib/speculative-prerender'
import {
  isSafeUrl,
  synthesizeRestTool,
  synthesizeSiteSearchTool,
  parseOpenApiToSpecs,
} from '@/lib/dynamic-tool-synthesizer'
import {
  CrdtStore,
  compareVectorClocks,
  type VectorClock,
} from '@/lib/crdt-sync'


export function GraphPanel() {
  /* --- 模块 6：知识拓扑星图与多跳寻路状态 --- */
  const [graphStart, setGraphStart] = useState('react')
  const [graphTarget, setGraphTarget] = useState('postgres')
  const techPathResult = useMemo(
    () => findShortestTechPath(graphStart, graphTarget),
    [graphStart, graphTarget]
  )
  const [selectedStackTechs, setSelectedStackTechs] = useState<string[]>([
    'react',
    'nextjs',
    'drizzle',
  ])
  const stackReport = useMemo(
    () => analyzeStackCompatibility(selectedStackTechs),
    [selectedStackTechs]
  )

  return (
    <div className="space-y-4">
          <Card className="nav-card-glow border-border/70 shadow-xs overflow-hidden">
            <CardHeader className="bg-muted/15 border-b border-border/50 pb-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500">
                      <Network className="w-4 h-4" />
                    </div>
                    <span>技术栈知识拓扑图谱与双向 Dijkstra 寻路</span>
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs sm:text-sm">
                    终结孤立陈列。基于有向加权图谱构建全栈协同拓扑，秒级解算任意两项技术之间的协同演进路径与补齐缺失基础设施。
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-indigo-500 border-indigo-500/30 bg-indigo-500/5 text-xs">
                  Bi-directional Dijkstra
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              {/* 寻路选择器 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                    <span>起始技术 (From)：</span>
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_TECH_GRAPH.nodes.slice(0, 9).map((n) => (
                      <Button
                        key={n.id}
                        size="sm"
                        variant={graphStart === n.id ? 'default' : 'outline'}
                        onClick={() => setGraphStart(n.id)}
                        className={`text-xs h-7 px-2.5 rounded-lg transition-all ${
                          graphStart === n.id ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'border-border/60'
                        }`}
                      >
                        {n.name}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                    <span>目标技术 (To)：</span>
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_TECH_GRAPH.nodes.slice(9).map((n) => (
                      <Button
                        key={n.id}
                        size="sm"
                        variant={graphTarget === n.id ? 'default' : 'outline'}
                        onClick={() => setGraphTarget(n.id)}
                        className={`text-xs h-7 px-2.5 rounded-lg transition-all ${
                          graphTarget === n.id ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'border-border/60'
                        }`}
                      >
                        {n.name}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 寻路解算结果看板 */}
              <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="flex items-center gap-1.5 text-indigo-500">
                    <Sparkles className="w-3.5 h-3.5" />
                    协同演进链路推演结果：
                  </span>
                  <span className="font-mono text-muted-foreground">
                    拓扑代价距离：<span className="text-foreground font-bold">{techPathResult.distance}</span> | 跃点数：{techPathResult.steps.length}
                  </span>
                </div>

                {techPathResult.found ? (
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    {techPathResult.nodeChain.map((node, idx) => (
                      <div key={node.id} className="flex items-center gap-2">
                        <div className="px-3 py-1.5 rounded-lg bg-background border border-indigo-500/40 shadow-xs flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-indigo-500" />
                          <span className="text-xs font-bold text-foreground">{node.name}</span>
                          <span className="text-[10px] text-muted-foreground font-mono">({node.layer})</span>
                        </div>
                        {idx < techPathResult.nodeChain.length - 1 && (
                          <div className="flex items-center text-xs font-mono text-indigo-500 px-1">
                            <span className="text-[11px] bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 mr-1">
                              {techPathResult.steps[idx]?.relation}
                            </span>
                            <ArrowRight className="w-3.5 h-3.5 text-indigo-400" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground py-2 font-mono">未找到连通链路</div>
                )}
              </div>

              {/* 技术栈兼容性自测 */}
              <div className="p-4 rounded-xl border border-border/60 bg-card space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span>技术栈方案兼容度与补齐诊断：</span>
                  <Badge variant="outline" className="text-xs font-mono text-indigo-500">
                    契合度: {stackReport.coherenceScore} / 100
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {PRESET_TECH_GRAPH.nodes.map((node) => {
                    const isSelected = selectedStackTechs.includes(node.id)
                    return (
                      <Button
                        key={node.id}
                        size="sm"
                        variant={isSelected ? 'default' : 'outline'}
                        onClick={() => {
                          if (isSelected) {
                            if (selectedStackTechs.length > 1) {
                              setSelectedStackTechs(selectedStackTechs.filter((id) => id !== node.id))
                            }
                          } else {
                            setSelectedStackTechs([...selectedStackTechs, node.id])
                          }
                        }}
                        className={`text-xs h-6.5 px-2.5 rounded-md ${
                          isSelected ? 'bg-primary text-primary-foreground' : 'border-border/50'
                        }`}
                      >
                        {isSelected ? '✓ ' : '+ '}
                        {node.name}
                      </Button>
                    )
                  })}
                </div>

                {stackReport.synergies.length > 0 && (
                  <div className="space-y-1 text-xs pt-1">
                    <span className="text-muted-foreground font-medium">协同优势：</span>
                    <div className="flex flex-wrap gap-1.5">
                      {stackReport.synergies.map((syn, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[11px]">
                          ✓ {syn}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {stackReport.missingLayers.length > 0 && (
                  <div className="space-y-1 text-xs pt-1">
                    <span className="text-amber-500 font-medium">缺失分层建议补齐：</span>
                    <div className="flex flex-wrap gap-1.5">
                      {stackReport.suggestedAdditions.map((item) => (
                        <span key={item.id} className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[11px]">
                          + 推荐引入 {item.name} ({item.reason})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
    </div>
  )
}
