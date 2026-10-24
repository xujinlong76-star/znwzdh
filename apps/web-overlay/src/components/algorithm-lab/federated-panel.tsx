'use client'

/**
 * 算法 9：客户端联邦协同与差分隐私推荐。
 * 从 algorithm-lab.tsx 拆出（第五批 A1）：状态与逻辑原样搬运，行为由
 * algorithm-lab-structure.test.ts 与 e2e/algorithms.spec.ts 双守卫锁定。
 */
import { useState, useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/registry/new-york/ui/card'
import { Button } from '@/registry/new-york/ui/button'
import { Badge } from '@/components/ui/badge'
import { Radio, Sliders, Activity } from 'lucide-react'
import { type EncryptedVaultPayload, type VaultItem } from '@/lib/vault'
import { type JsonRpcResponse } from '@/lib/webmcp-bridge'
import { privatizeVector, rankItemsWithPrivacy, type CandidateItem } from '@/lib/federated-recommendation'
import { type SpeculationCandidate } from '@/lib/speculative-prerender'
import { type VectorClock } from '@/lib/crdt-sync'


export function FederatedPanel() {
  /* --- 模块 9：客户端联邦协同与本地差分隐私 (LDP) 状态 --- */
  const [fedEpsilon, setFedEpsilon] = useState<number>(1.0)
  const [fedPersonalWeight, setFedPersonalWeight] = useState<number>(0.6)
  const [localFeatureVector, setLocalFeatureVector] = useState<number[]>([0.9, 0.8, 0.3, 0.2, 0.7])
  const [noisyVector, setNoisyVector] = useState<number[]>([])
  const [globalFedVector] = useState<number[]>([0.7, 0.95, 0.6, 0.4, 0.8])

  const fedCandidates: CandidateItem[] = useMemo(() => [
    { id: 'nextjs', name: 'Next.js 15 (前端全栈)', featureVector: [0.95, 0.4, 0.3, 0.2, 0.8] },
    { id: 'ollama', name: 'Ollama / DeepSeek (本地 AI)', featureVector: [0.2, 0.98, 0.4, 0.1, 0.7] },
    { id: 'k8s', name: 'Kubernetes (云原生编排)', featureVector: [0.1, 0.2, 0.95, 0.4, 0.6] },
    { id: 'pgvector', name: 'PostgreSQL + pgvector (向量库)', featureVector: [0.2, 0.85, 0.5, 0.95, 0.5] },
    { id: 'turborepo', name: 'Turborepo (现代化Monorepo工具)', featureVector: [0.8, 0.3, 0.3, 0.1, 0.95] },
  ], [])

  const handlePrivatize = () => {
    const noisy = privatizeVector(localFeatureVector, fedEpsilon)
    setNoisyVector(noisy)
  }

  const fedRecommendations = useMemo(() => {
    return rankItemsWithPrivacy(localFeatureVector, globalFedVector, fedCandidates, fedPersonalWeight)
  }, [localFeatureVector, globalFedVector, fedCandidates, fedPersonalWeight])

  return (
    <div className="space-y-4">
          <Card className="nav-card-glow border-border/70 shadow-xs overflow-hidden">
            <CardHeader className="bg-muted/15 border-b border-border/50 pb-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500">
                      <Radio className="w-4 h-4" />
                    </div>
                    <span>本地差分隐私 (LDP Laplace) 协同推荐引擎</span>
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs sm:text-sm">
                    通过数学拉普拉斯扰动机制在客户端注入受控噪声，保证个体特征绝对不可重构，同时与脱敏群体共识向量结合计算最佳混合排序。
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-blue-500 border-blue-500/30 bg-blue-500/5 text-xs font-mono">
                  Laplace(0, 1/ε)
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5 sm:p-6 space-y-6">
              {/* 控制面板：隐私预算与个人权重 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-blue-500" />
                      隐私预算 ε (Epsilon): <span className="font-mono text-primary font-bold">{fedEpsilon}</span>
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {fedEpsilon <= 0.5 ? '极高隐私 (强混淆)' : fedEpsilon <= 1.0 ? '均衡隐私' : '效用优先 (弱扰动)'}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    {[0.2, 0.5, 1.0, 2.0, 5.0].map((eps) => (
                      <Button
                        key={eps}
                        size="sm"
                        variant={fedEpsilon === eps ? 'default' : 'outline'}
                        onClick={() => setFedEpsilon(eps)}
                        className="text-xs h-8 flex-1"
                      >
                        {eps}
                      </Button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    拉普拉斯分布标度参数 b = sensitivity / ε。ε 越小，采样方差越大，个体身份越难被反推。
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-blue-500" />
                      排序权重：本地偏好占比 <span className="font-mono text-primary font-bold">{Math.round(fedPersonalWeight * 100)}%</span>
                    </span>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      群体趋势: {Math.round((1 - fedPersonalWeight) * 100)}%
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {[0.2, 0.4, 0.6, 0.8, 1.0].map((w) => (
                      <Button
                        key={w}
                        size="sm"
                        variant={fedPersonalWeight === w ? 'default' : 'outline'}
                        onClick={() => setFedPersonalWeight(w)}
                        className="text-xs h-8 flex-1"
                      >
                        {Math.round(w * 100)}%
                      </Button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    混合打分公式：Score = personalMatch × {fedPersonalWeight} + globalTrendMatch × {(1 - fedPersonalWeight).toFixed(1)}。
                  </p>
                </div>
              </div>

              {/* 特征向量加噪模拟 */}
              <div className="p-4 rounded-xl border border-border/60 bg-muted/10 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold">
                    本地未脱敏偏好向量 <span className="text-muted-foreground font-normal">[前端, AI模型, 云原生, 数据库, 工具链]</span>
                  </div>
                  <Button
                    size="sm"
                    onClick={handlePrivatize}
                    className="text-xs h-8 bg-blue-600 hover:bg-blue-700 text-white gap-1"
                  >
                    <Radio className="w-3.5 h-3.5" /> 注入 Laplace 差分隐私扰动
                  </Button>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {['前端', 'AI模型', '云原生', '数据库', '工具链'].map((label, idx) => (
                    <div key={label} className="p-2.5 rounded-lg bg-background border border-border/50 text-center space-y-1">
                      <div className="text-[10px] text-muted-foreground">{label}</div>
                      <div className="font-mono font-bold text-xs">{localFeatureVector[idx]}</div>
                      {noisyVector.length > 0 && (
                        <div className="text-[10px] font-mono text-blue-500 pt-0.5 border-t border-border/40">
                          加噪: {noisyVector[idx]}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 实时协同推荐排序结果 */}
              <div className="space-y-3">
                <span className="text-xs font-semibold text-muted-foreground">实时隐私协同推荐排序清单：</span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {fedRecommendations.map((item, idx) => (
                    <div key={item.itemId} className="p-3.5 rounded-xl border border-border/60 bg-muted/20 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-full bg-blue-500/10 text-blue-500 font-mono text-[10px] flex items-center justify-center">
                            {idx + 1}
                          </span>
                          {item.name}
                        </span>
                        <Badge variant="outline" className="text-blue-500 border-blue-500/30 text-xs font-mono font-bold">
                          {item.score}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                        <span>个人匹配度: {item.personalMatch}</span>
                        <span>群体趋势度: {item.globalTrendMatch}</span>
                      </div>
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${Math.min(100, Math.round(item.score * 100))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
    </div>
  )
}
