'use client'

/**
 * 算法 1：LinUCB 上下文多臂老虎机。
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
/* ------------------ 算法 1：LinUCB 浏览器侧纯计算 ------------------ */
interface ArmState {
  weight: number
  clicks: number
}

const DEFAULT_ARMS: Record<string, ArmState> = {
  exact: { weight: 1.2, clicks: 0 },
  fts: { weight: 1.0, clicks: 0 },
  pinyin: { weight: 1.1, clicks: 0 },
  semantic: { weight: 0.95, clicks: 0 },
  personal: { weight: 0.9, clicks: 0 },
}


export function LinucbPanel() {
  /* --- 模块 1：LinUCB 状态 --- */
  const [banditQuery, setBanditQuery] = useState('vsc')
  const [arms, setArms] = useState(DEFAULT_ARMS)

  const contextFeatures = useMemo(() => {
    const q = banditQuery.trim()
    const len = q.length
    if (len === 0) return { lenNorm: 0, cjkRatio: 0, alphaRatio: 0, pinyinProb: 0 }
    let cjk = 0
    let alpha = 0
    for (let i = 0; i < len; i++) {
      const code = q.charCodeAt(i)
      if (code >= 0x4e00 && code <= 0x9fa5) cjk++
      else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) alpha++
    }
    const isPinyin = /^[a-zA-Z]+$/.test(q) && len >= 2 && len <= 12
    return {
      lenNorm: Number(Math.min(1.0, len / 30).toFixed(2)),
      cjkRatio: Number((cjk / len).toFixed(2)),
      alphaRatio: Number((alpha / len).toFixed(2)),
      pinyinProb: isPinyin ? 1.0 : 0.0,
    }
  }, [banditQuery])

  // 动态预测权重
  const predictedWeights = useMemo(() => {
    const { cjkRatio, pinyinProb, lenNorm } = contextFeatures
    return {
      exact: Number((arms.exact.weight + 0.3 * (1 - lenNorm)).toFixed(2)),
      fts: Number((arms.fts.weight + 0.2 * lenNorm).toFixed(2)),
      pinyin: Number((arms.pinyin.weight + 0.8 * pinyinProb).toFixed(2)),
      semantic: Number((arms.semantic.weight + 0.9 * cjkRatio + 0.4 * lenNorm).toFixed(2)),
      personal: Number(arms.personal.weight.toFixed(2)),
    }
  }, [arms, contextFeatures])

  const rewardArm = (channel: string) => {
    setArms((prev) => {
      const cur = prev[channel] || { weight: 1.0, clicks: 0 }
      return {
        ...prev,
        [channel]: {
          weight: Number((cur.weight + 0.15).toFixed(2)),
          clicks: cur.clicks + 1,
        },
      }
    })
  }

  return (
    <div className="space-y-4">
          <Card className="nav-card-glow border-border/70 shadow-xs overflow-hidden">
            <CardHeader className="bg-muted/15 border-b border-border/50 pb-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                      <Layers className="w-4 h-4" />
                    </div>
                    <span>LinUCB 情境自适应多臂融合实时推演</span>
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs sm:text-sm">
                    终结传统静态 RRF 的经验常数权重，根据当前输入的特征（中文/拼音/长度）动态求解最优置信上界权重。
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setArms(DEFAULT_ARMS)}
                  className="text-xs h-8 border-border/70 hover:bg-accent gap-1.5 shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>重置收益矩阵</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 space-y-2.5">
                  <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                    <span>测试搜索输入：</span>
                    <span className="text-xs font-normal text-muted-foreground/75">(实时动态提取上下文特征向量 x)</span>
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input aria-label="搜索关键词（拼音 / 中文 / 长句）"
                      value={banditQuery}
                      onChange={(e) => setBanditQuery(e.target.value)}
                      placeholder="试着输入拼音 (vsc)、长句 (构建高可用架构) 或纯中文..."
                      className="text-xs sm:text-sm h-9 border-border/70 focus-visible:ring-primary/40"
                    />
                    <div className="flex gap-1.5 shrink-0">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="text-xs h-9 px-3 border border-border/50"
                        onClick={() => setBanditQuery('自然语言处理模型')}
                      >
                        中文长句
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="text-xs h-9 px-3 border border-border/50"
                        onClick={() => setBanditQuery('cursor')}
                      >
                        纯英文/拼音
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border border-border/60 bg-muted/30 space-y-2 text-xs font-mono shadow-2xs">
                  <div className="font-semibold text-foreground flex items-center justify-between pb-1 border-b border-border/40">
                    <span>提取特征向量 x:</span>
                    <span className="text-xs text-muted-foreground font-normal">在线实时解算</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">长度归一 (lenNorm):</span>
                    <span className="font-bold text-primary font-mono">{contextFeatures.lenNorm}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">中文占比 (cjkRatio):</span>
                    <span className="font-bold text-primary font-mono">{contextFeatures.cjkRatio}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">英文占比 (alphaRatio):</span>
                    <span className="font-bold text-primary font-mono">{contextFeatures.alphaRatio}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">拼音似然 (pinyinProb):</span>
                    <span className="font-bold text-primary font-mono">{contextFeatures.pinyinProb}</span>
                  </div>
                </div>
              </div>

              {/* 5 个通道的动态置信上界打分 */}
              <div className="space-y-3 pt-4 border-t border-border/50">
                <div className="text-xs sm:text-sm font-semibold flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                    <span>通道置信上界权重 w_a(q) 与在线反馈强化：</span>
                  </span>
                  <span className="text-xs text-muted-foreground font-normal">点击下方强化按钮模拟真实用户采纳反馈闭环</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                  {(Object.keys(predictedWeights) as (keyof typeof predictedWeights)[]).map((ch) => (
                    <div
                      key={ch}
                      className="p-3.5 rounded-xl border border-border/60 bg-card hover:border-primary/40 transition-all flex flex-col justify-between space-y-3 shadow-2xs group"
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold uppercase">{ch} 通道</span>
                          <span className="text-xs text-muted-foreground">历史点击: {arms[ch]?.clicks || 0}</span>
                        </div>
                        <div className="text-2xl font-bold font-mono text-primary mt-1">
                          {predictedWeights[ch]}
                        </div>
                        <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden mt-1.5">
                          <div
                            className="bg-primary h-full transition-all duration-300"
                            style={{ width: `${Math.min(100, (predictedWeights[ch] / 2.5) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full text-xs h-7 mt-1 hover:bg-primary hover:text-primary-foreground"
                        onClick={() => rewardArm(ch)}
                      >
                        + 点击强化
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
    </div>
  )
}
