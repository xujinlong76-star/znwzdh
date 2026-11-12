'use client'

/**
 * 算法 1：LinUCB 上下文多臂老虎机。
 * 从 algorithm-lab.tsx 拆出（第五批 A1）：状态与逻辑原样搬运，行为由
 * algorithm-lab-structure.test.ts 与 e2e/algorithms.spec.ts 双守卫锁定。
 */
import { useState, useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/registry/new-york/ui/card'
import { Button } from '@/registry/new-york/ui/button'
import { Input } from '@/registry/new-york/ui/input'
import { Sparkles, RefreshCw, Layers } from 'lucide-react'
/* ------------------ 算法 1：LinUCB（真引擎，来自 @navhub/core） ------------------
 *
 * 2026-11-10 修正：此前这个面板是**手工线性加权**冒充 LinUCB ——
 * `weight + 0.3 * (1 - lenNorm)` 这种固定系数既没有上下文特征向量 x、
 * 也没有 A 矩阵求逆与置信上界探索项（sqrt(x^T A^{-1} x)）。
 * 而页面标题写的是「LinUCB 情境自适应多臂融合…动态求解最优置信上界权重」，
 * 描述与实现对不上；真正的引擎 packages/core/src/linucb.ts（含单位阵、求逆、
 * 逐臂 UCB 计算）一直存在但零调用。
 *
 * 现在改为直接调用引擎：模型只在本地 useState 里持有（已接 serializeLinUCB 持久化到 localStorage（navhub.linucb.model.v1）），
 * 每次预测与更新都走真算法，页面展示的权重就是引擎算出来的。
 */
import {
  CHANNELS,
  createLinUCBModel,
  deserializeLinUCB,
  predictArmWeights,
  serializeLinUCB,
  updateArmReward,
  extractContextFeatures,
  type LinUCBModel,
  type RetrievalChannel,
} from '@/lib/linucb'

const LINUCB_STORAGE_KEY = 'navhub.linucb.model.v1'

function loadStoredLinUCBModel(): LinUCBModel {
  try {
    const raw = window.localStorage.getItem(LINUCB_STORAGE_KEY)
    return raw ? deserializeLinUCB(raw) : createLinUCBModel(0.25)
  } catch {
    return createLinUCBModel(0.25)
  }
}


export function LinucbPanel() {
  /* --- 模块 1：LinUCB 状态 --- */
  const [banditQuery, setBanditQuery] = useState('vsc')
  /**
   * LinUCB 模型：只在本地持有，每次查询/反馈都走真引擎。
   *
   * 用 useState 持有对象引用（引擎是原地更新 A/b 与 theta 的），
   * 因此每次更新后用一个自增 tick 触发重算 —— 不能依赖对象引用变化。
   */
  const [model, setModel] = useState<LinUCBModel>(() => createLinUCBModel(0.25))
  const [tick, setTick] = useState(0)
  const restoredRef = useRef(false)
  useEffect(() => {
    if (!restoredRef.current) {
      restoredRef.current = true
      setModel(loadStoredLinUCBModel())
      return
    }
    try {
      window.localStorage.setItem(LINUCB_STORAGE_KEY, serializeLinUCB(model))
    } catch {
      // 本地存储不可用时静默跳过
    }
  }, [tick])

  /** 上下文特征向量（5 维原始值，供界面展示） */
  const contextFeatures = useMemo(() => {
    const x = extractContextFeatures(banditQuery)
    return {
      lenNorm: Number(x[0].toFixed(2)),
      cjkRatio: Number(x[1].toFixed(2)),
      alphaRatio: Number(x[2].toFixed(2)),
      pinyinProb: Number(x[3].toFixed(2)),
    }
  }, [banditQuery])

  /** 引擎算出的每臂 UCB 权重（含探索项，不是手工线性加权） */
  const predictedWeights = useMemo(() => {
    const w = predictArmWeights(model, banditQuery)
    const out: Record<string, number> = {}
    for (const ch of CHANNELS) out[ch] = Number((w[ch] ?? 0).toFixed(2))
    return out
    // tick 是刻意的重算触发器：引擎原地改模型，引用不变
  }, [model, banditQuery, tick])

  /** 臂的点击次数（纯展示统计，与引擎状态分开维护） */
  const [armClicks, setArmClicks] = useState<Record<string, number>>({})

  /** 给某通道一次正反馈：走引擎 updateArmReward（会更新 A 与 b） */
  const rewardArm = (channel: string) => {
    updateArmReward(model, channel as RetrievalChannel, banditQuery, 1)
    setArmClicks((prev) => ({ ...prev, [channel]: (prev[channel] ?? 0) + 1 }))
    setTick((t) => t + 1)
  }

  /** 重置：换一个全新模型（等价于清空收益矩阵） */
  const resetArms = () => {
    setModel(createLinUCBModel(0.25))
    setArmClicks({})
    setTick((t) => t + 1)
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
                    终结传统静态 RRF 的经验常数权重，根据当前输入的特征（中文/拼音/长度）动态求解最优置信上界权重。模型保存在本浏览器（localStorage），刷新与切换 Tab 后恢复，只影响本面板。
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetArms}
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
                    <span className="text-xs font-normal text-muted-foreground">(实时动态提取上下文特征向量 x)</span>
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
                          <span className="text-xs text-muted-foreground">历史点击: {armClicks[ch] ?? 0}</span>
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
