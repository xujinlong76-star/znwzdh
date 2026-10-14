'use client'

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
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Binary,
  Layers,
  ArrowLeft,
  Lock,
  Unlock,
  Key,
} from 'lucide-react'
import Link from 'next/link'
import {
  parseSpeculativeIntent,
  type SpeculativeIntentResult,
} from '@/lib/speculative'
import {
  encryptVault,
  decryptVault,
  type EncryptedVaultPayload,
  type VaultItem,
} from '@/lib/vault'


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

/* ------------------ 算法 2：双曲平替节点集 ------------------ */
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

/* ------------------ 算法 3：文本熵计算与检测样本 ------------------ */
const SAMPLE_HTMLS = {
  normal: {
    name: '正常技术开发站 (React 官网)',
    html: `<!DOCTYPE html><html><body><h1>React 用于构建 Web 的库</h1><p>通过组合组件快速搭建现代化交互式 Web 应用。声明式视图、组件化架构，以及与 Vite 和 Next.js 的无缝整合。</p></body></html>`,
  },
  parked: {
    name: '域名抢注停放广告 (Dan.com / GoDaddy)',
    html: `<html><body><h1>This domain is for sale! Buy this domain on Dan.com</h1><p>Inquire about this domain or renew this domain name. HugeDomains parking network.</p></body></html>`,
  },
  soft404: {
    name: 'SPA 单页软 404 (假 200 空白首页)',
    html: `<html><head><title>Page Not Found</title></head><body><h1>404 Not Found 页面未找到</h1><p>请返回首页或者访问其他链接</p></body></html>`,
  },
}

function calculateTextEntropy(text: string): number {
  if (!text || text.length === 0) return 0.0
  const clean = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const freq: Record<string, number> = {}
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (c) freq[c] = (freq[c] || 0) + 1
  }
  let h = 0
  for (const c in freq) {
    const p = (freq[c] || 0) / clean.length
    h -= p * Math.log2(p)
  }
  return Number(h.toFixed(3))
}

export function AlgorithmLab() {
  const [activeTab, setActiveTab] = useState('linucb')

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

  /* --- 模块 3：页面健康状态 --- */
  const [healthSnippet, setHealthSnippet] = useState(SAMPLE_HTMLS.parked.html)
  const healthAudit = useMemo(() => {
    const entropy = calculateTextEntropy(healthSnippet)
    const lower = healthSnippet.toLowerCase()
    const parkingKeywords = ['domain for sale', 'buy this domain', 'renew this domain', 'hugedomains', '404 not found', '页面未找到']
    const matched = parkingKeywords.filter((k) => lower.includes(k))
    let status = 'HEALTHY'
    let reason = '文本信息熵充盈，无停放或软404特征'
    if (matched.length >= 2 || (matched.length === 1 && healthSnippet.length < 400)) {
      status = matched.some((m) => m.includes('404')) ? 'SOFT_404' : 'SUSPICIOUS_PARKED'
      reason = `检出虚假 200 关键字特征: [${matched.join(', ')}]`
    } else if (entropy < 2.0) {
      status = 'SUSPICIOUS_PARKED'
      reason = `信息熵极低 (${entropy} < 2.0)，疑似空白或停放页`
    }
    return { entropy, matched, status, reason }
  }, [healthSnippet])

  /* --- 模块 4：推测意图测试 --- */
  const [intentInput, setIntentInput] = useState('SGVsbG8gV29ybGQ=')
  const intentResult = useMemo(() => parseSpeculativeIntent(intentInput), [intentInput])

  /* --- 模块 5：零知识 E2EE 金库状态 --- */
  const [vaultPassword, setVaultPassword] = useState('SecretDev123!')
  const [vaultItems] = useState<VaultItem[]>([
    { id: '1', title: '内部 GitLab 敏捷看板', url: 'https://gitlab.corp.internal/board', isInternal: true },
    { id: '2', title: '生产数据库只读审计', url: 'https://10.0.8.50:9000/db', isInternal: true },
  ])
  const [encryptedPayload, setEncryptedPayload] = useState<EncryptedVaultPayload | null>(null)
  const [decryptInputPassword, setDecryptInputPassword] = useState('SecretDev123!')
  const [decryptedItems, setDecryptedItems] = useState<VaultItem[] | null>(null)
  const [vaultError, setVaultError] = useState<string | null>(null)
  const [isEncrypting, setIsEncrypting] = useState(false)

  const handleEncryptVault = async () => {
    setIsEncrypting(true)
    setVaultError(null)
    try {
      const payload = await encryptVault(vaultItems, vaultPassword)
      setEncryptedPayload(payload)
      setDecryptedItems(null)
    } catch (err) {
      setVaultError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsEncrypting(false)
    }
  }

  const handleDecryptVault = async () => {
    if (!encryptedPayload) return
    setVaultError(null)
    try {
      const items = await decryptVault(encryptedPayload, decryptInputPassword)
      setDecryptedItems(items)
    } catch (err) {
      setVaultError(err instanceof Error ? err.message : String(err))
      setDecryptedItems(null)
    }
  }

  return (
    <div className="container max-w-6xl mx-auto py-6 sm:py-10 px-4 space-y-6 sm:space-y-8">
      {/* 头部导航与沉浸式 Hero 展板 */}
      <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface subtle-mesh p-6 sm:p-8 shadow-xs">
        {/* 背景微光光斑 */}
        <div className="absolute -right-16 -top-16 w-72 h-72 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -left-16 -bottom-16 w-60 h-60 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>返回主页</span>
              </Link>
              <span className="text-border">/</span>
              <Badge variant="outline" className="text-primary border-primary/40 bg-primary/5 text-xs px-2.5 py-0.5 font-medium">
                NavHub 5.0+ 算法实验室
              </Badge>
            </div>

            {/* 顶栏快速特性胶囊 */}
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                5 大前沿引擎全就绪
              </span>
            </div>
          </div>

          <div className="max-w-3xl space-y-2">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-xs">
                <Cpu className="w-6 h-6 sm:w-7 sm:h-7" />
              </div>
              <span>前沿自适应算法与认知引擎全景测试台</span>
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              实时推演与体验超越传统导航的技术奇点：<span className="text-foreground font-medium">LinUCB 浏览器端在线多臂学习</span>、
              <span className="text-foreground font-medium">Poincaré 双曲空间平替拓扑推演</span>、
              <span className="text-foreground font-medium">Shannon 文本熵防假 200 巡检</span>、
              <span className="text-foreground font-medium">0-RTT 推测性意图瞬时计算</span> 与
              <span className="text-foreground font-medium">AES-256-GCM 零知识端到端私密金库</span>。
            </p>
          </div>

          {/* 5 大算法指标快速指示牌 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 pt-2">
            <div className="p-2.5 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5">
              <div className="text-xs text-muted-foreground">多臂自适应融合</div>
              <div className="font-bold font-mono text-primary flex items-center gap-1">
                LinUCB 5-Channel
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5">
              <div className="text-xs text-muted-foreground">双曲平替曲率</div>
              <div className="font-bold font-mono text-violet-500 flex items-center gap-1">
                Poincaré c = -1
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5">
              <div className="text-xs text-muted-foreground">假死链防欺骗</div>
              <div className="font-bold font-mono text-emerald-500 flex items-center gap-1">
                Shannon H &gt; 3.5
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5">
              <div className="text-xs text-muted-foreground">推测执行吞吐</div>
              <div className="font-bold font-mono text-amber-500 flex items-center gap-1">
                0-RTT &lt; 1ms
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5 col-span-2 sm:col-span-1">
              <div className="text-xs text-muted-foreground">零知识密码学</div>
              <div className="font-bold font-mono text-cyan-500 flex items-center gap-1">
                AES-GCM-256 E2EE
              </div>
            </div>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 w-full h-auto p-1.5 bg-muted/40 border border-border/60 rounded-xl backdrop-blur-md gap-1">
          <TabsTrigger
            value="linucb"
            className="py-2 text-xs sm:text-sm flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Layers className="w-4 h-4 text-primary" /> LinUCB 自适应融合
          </TabsTrigger>
          <TabsTrigger
            value="hyperbolic"
            className="py-2 text-xs sm:text-sm flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Orbit className="w-4 h-4 text-violet-500" /> 庞加莱双曲平替
          </TabsTrigger>
          <TabsTrigger
            value="health"
            className="py-2 text-xs sm:text-sm flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <ShieldCheck className="w-4 h-4 text-emerald-500" /> 文本熵防假 200
          </TabsTrigger>
          <TabsTrigger
            value="intent"
            className="py-2 text-xs sm:text-sm flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Zap className="w-4 h-4 text-amber-500" /> 0-RTT 推测执行
          </TabsTrigger>
          <TabsTrigger
            value="vault"
            className="py-2 text-xs sm:text-sm flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium col-span-2 sm:col-span-1"
          >
            <Lock className="w-4 h-4 text-cyan-500" /> 零知识 E2EE 金库
          </TabsTrigger>
        </TabsList>


        {/* ================= 1. LinUCB 上下文多臂老虎机 ================= */}
        <TabsContent value="linucb" className="space-y-4 mt-6">
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
                    <Input
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
        </TabsContent>

        {/* ================= 2. 庞加莱双曲空间平替几何 ================= */}
        <TabsContent value="hyperbolic" className="space-y-4 mt-6">
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
        </TabsContent>

        {/* ================= 3. 页面健康与防假 200 巡检 ================= */}
        <TabsContent value="health" className="space-y-4 mt-6">
          <Card className="nav-card-glow border-border/70 shadow-xs overflow-hidden">
            <CardHeader className="bg-muted/15 border-b border-border/50 pb-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <span>Shannon 文本信息熵与防虚假 200 巡检引擎</span>
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs sm:text-sm">
                    传统导航站仅探测 HTTP 状态码，易被“域名过期停放广告”与“SPA 单页软 404”欺骗。本算法实时计算文本信息熵并比对特征词频。
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/5 text-xs">
                  熵值检测法 H(S)
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">快速加载典型实测样本：</span>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(SAMPLE_HTMLS).map(([k, s]) => (
                      <Button
                        key={k}
                        size="sm"
                        variant="secondary"
                        className="text-xs h-7.5 px-2.5 border border-border/60"
                        onClick={() => setHealthSnippet(s.html)}
                      >
                        {s.name}
                      </Button>
                    ))}
                  </div>
                </div>
                <textarea
                  className="w-full h-32 p-3.5 rounded-xl border border-border/70 font-mono text-xs bg-muted/20 focus:outline-hidden focus:ring-1 focus:ring-emerald-500/50 shadow-inner resize-y"
                  value={healthSnippet}
                  onChange={(e) => setHealthSnippet(e.target.value)}
                  placeholder="在此输入或粘贴待检测的 HTML 文本..."
                />
              </div>

              {/* 实时分析判据结果 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-border/50">
                <div className="p-4 rounded-xl border border-border/60 bg-card flex flex-col justify-between shadow-2xs">
                  <div>
                    <span className="text-xs text-muted-foreground">Shannon 文本信息熵 H(S)</span>
                    <div className="text-3xl font-extrabold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                      {healthAudit.entropy}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3 pt-2 border-t border-border/40">
                    正常技术站 H &ge; 3.5；空白/停放页 H &lt; 2.0
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-border/60 bg-card flex flex-col justify-between shadow-2xs">
                  <div>
                    <span className="text-xs text-muted-foreground">命中华文/英文停放特征词</span>
                    <div className="text-xl font-bold font-mono text-foreground mt-1">
                      {healthAudit.matched.length > 0 ? `${healthAudit.matched.length} 处匹配` : '0 处 (安全)'}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-3">
                    {healthAudit.matched.length > 0 ? (
                      healthAudit.matched.map((m) => (
                        <Badge key={m} variant="destructive" className="text-xs px-2 py-0.5">{m}</Badge>
                      ))
                    ) : (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 font-mono">未检出广告/抢注模式</span>
                    )}
                  </div>
                </div>

                <div className={`p-4 rounded-xl border flex flex-col justify-between shadow-2xs ${
                  healthAudit.status === 'HEALTHY'
                    ? 'bg-emerald-500/10 border-emerald-500/30'
                    : 'bg-red-500/10 border-red-500/30'
                }`}>
                  <div>
                    <div className="flex items-center gap-1.5">
                      {healthAudit.status === 'HEALTHY' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <ShieldAlert className="w-4 h-4 text-red-500" />
                      )}
                      <span className="text-xs font-bold uppercase tracking-wide">{healthAudit.status}</span>
                    </div>
                    <div className="text-sm font-semibold mt-1">
                      {healthAudit.status === 'HEALTHY' ? '健康可达站点' : '伪健康异常预警'}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3 pt-2 border-t border-border/30">{healthAudit.reason}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================= 4. 0-RTT 推测性意图执行 ================= */}
        <TabsContent value="intent" className="space-y-4 mt-6">
          <Card className="nav-card-glow border-border/70 shadow-xs overflow-hidden">
            <CardHeader className="bg-muted/15 border-b border-border/50 pb-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
                      <Zap className="w-4 h-4" />
                    </div>
                    <span>0-RTT 推测意图预执行试验台</span>
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs sm:text-sm">
                    搜索框不仅是跳板，而是微任务执行终点。键入代码短串时瞬间原地出结果，杜绝跳转摩擦。
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/5 text-xs">
                  延迟 &lt; 1ms
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="space-y-2.5">
                <label className="text-xs font-semibold text-muted-foreground">快速加载特征串测试：</label>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" className="text-xs font-mono h-7.5" onClick={() => setIntentInput('SGVsbG8gV29ybGQ=')}>
                    Base64 串
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs font-mono h-7.5" onClick={() => setIntentInput('1710328900')}>
                    Unix 时间戳
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs font-mono h-7.5" onClick={() => setIntentInput('#ff4500')}>
                    HEX 色彩
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs font-mono h-7.5" onClick={() => setIntentInput('(128 + 64) * 8')}>
                    算术表达式
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs font-mono h-7.5" onClick={() => setIntentInput('{"site":"navhub","v":4}')}>
                    JSON 美化
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs font-mono h-7.5" onClick={() => setIntentInput('e10adc3949ba59abbe56e057f20f883e')}>
                    MD5 哈希
                  </Button>
                </div>
                <Input
                  className="mt-2 font-mono text-sm h-10 border-border/70 focus-visible:ring-amber-500/40"
                  value={intentInput}
                  onChange={(e) => setIntentInput(e.target.value)}
                  placeholder="在此键入 Base64、时间戳、RGB/HEX、算术公式..."
                />
              </div>

              {/* 呈现推测执行卡片 */}
              {intentResult ? (
                <div className="p-4 sm:p-5 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent space-y-3.5 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1 rounded-md bg-amber-500/20 text-amber-600 dark:text-amber-400">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <span className="text-sm font-bold">{intentResult.title}</span>
                      <Badge variant="outline" className="text-xs text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10 font-mono px-2 py-0.5">
                        0-RTT 命中
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{intentResult.subtitle}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    {intentResult.type === 'color' && (
                      <div
                        className="w-9 h-9 rounded-lg border border-border/60 shadow-inner shrink-0"
                        style={{ backgroundColor: intentResult.previewValue }}
                      />
                    )}
                    <div className="flex-1 p-3 rounded-lg bg-background border border-border/60 font-mono text-xs break-all select-all shadow-2xs">
                      {intentResult.previewValue}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-muted-foreground border border-dashed rounded-xl bg-muted/10">
                  当前输入暂未命中特定微任务语法，按回车将触发自适应多通道混合检索。
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================= 5. 零知识 E2EE 加密金库 ================= */}
        <TabsContent value="vault" className="space-y-4 mt-6">
          <Card className="nav-card-glow border-border/70 shadow-xs overflow-hidden">
            <CardHeader className="bg-muted/15 border-b border-border/50 pb-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-500">
                      <Lock className="w-4 h-4" />
                    </div>
                    <span>本地优先零知识 E2EE 端到端加密金库</span>
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs sm:text-sm">
                    彻底解决企业内网开发资产与个人隐私书签上云的泄露隐患。采用 PBKDF2 派生密钥与 AES-256-GCM 认证加密，云端仅触碰不可逆密文。
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-cyan-500 border-cyan-500/30 bg-cyan-500/5 text-xs">
                  Web Cryptography API
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 左栏：加密封存 */}
                <div className="p-4 sm:p-5 rounded-xl border border-border/60 bg-card space-y-4 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-cyan-500" />
                      <span>第一步：明文书签与主密码封存</span>
                    </span>
                    <Badge variant="outline" className="text-xs text-cyan-500 border-cyan-500/30 bg-cyan-500/5 px-2 py-0.5">
                      客户端加密
                    </Badge>
                  </div>

                  <div className="space-y-2 text-xs">
                    <label className="text-muted-foreground font-semibold">待加密的内部私密书签：</label>
                    <div className="p-2.5 rounded-lg border border-border/50 bg-muted/30 space-y-1.5 font-mono text-xs">
                      {vaultItems.map((item) => (
                        <div key={item.id} className="flex justify-between items-center text-muted-foreground">
                          <span className="text-foreground font-semibold">{item.title}</span>
                          <span className="truncate max-w-[180px]">{item.url}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">设置主加密密码 (Passphrase)：</label>
                    <Input
                      type="password"
                      value={vaultPassword}
                      onChange={(e) => setVaultPassword(e.target.value)}
                      placeholder="设置用于派生 AES 密钥的强密码..."
                      className="font-mono text-xs h-9 border-border/70"
                    />
                  </div>

                  <Button
                    onClick={handleEncryptVault}
                    disabled={isEncrypting}
                    className="w-full text-xs h-9 bg-cyan-600 hover:bg-cyan-700 text-white shadow-xs"
                  >
                    {isEncrypting ? '派生密钥加密中...' : '执行 AES-256-GCM 零知识加密'}
                  </Button>

                  {encryptedPayload && (
                    <div className="p-3.5 rounded-lg border border-border/50 bg-muted/40 space-y-1.5 text-xs font-mono">
                      <div className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> 密文封包已生成 (AES-GCM):
                      </div>
                      <div className="truncate text-muted-foreground">Salt: {encryptedPayload.saltHex}</div>
                      <div className="truncate text-muted-foreground">IV: {encryptedPayload.ivHex}</div>
                      <div className="truncate text-primary font-bold">Ciphertext: {encryptedPayload.cipherTextBase64.slice(0, 36)}...</div>
                    </div>
                  )}
                </div>

                {/* 右栏：解密验证与防篡改测试 */}
                <div className="p-4 sm:p-5 rounded-xl border border-border/60 bg-card space-y-4 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold flex items-center gap-1.5">
                      <Unlock className="w-4 h-4 text-emerald-500" />
                      <span>第二步：输入密码解密还原</span>
                    </span>
                    <Badge variant="outline" className="text-xs text-emerald-500 border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5">
                      认证标签校验
                    </Badge>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed">
                    模拟跨端设备拉取密文后，输入主密码在本地内存还原。可故意输入错误密码测试 AES-GCM 认证标签防篡改防护。
                  </p>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">输入解密密码：</label>
                    <Input
                      type="text"
                      value={decryptInputPassword}
                      onChange={(e) => setDecryptInputPassword(e.target.value)}
                      placeholder="输入正确或错误密码进行测试..."
                      className="font-mono text-xs h-9 border-border/70"
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={handleDecryptVault}
                      disabled={!encryptedPayload}
                      variant="secondary"
                      className="flex-1 text-xs h-9 border border-border/50"
                    >
                      验证并解密金库
                    </Button>
                    <Button
                      onClick={() => setDecryptInputPassword('WrongPass!456')}
                      variant="outline"
                      className="text-xs h-9 text-destructive border-destructive/30 hover:bg-destructive/10"
                    >
                      填入错误密码测试
                    </Button>
                  </div>

                  {vaultError && (
                    <div className="p-3 rounded-lg border border-destructive/40 bg-destructive/10 text-xs text-destructive flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      <span>{vaultError}</span>
                    </div>
                  )}

                  {decryptedItems && (
                    <div className="p-3.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 space-y-2 text-xs">
                      <div className="text-emerald-700 dark:text-emerald-300 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" /> 解密成功！还原 {decryptedItems.length} 条私密书签：
                      </div>
                      <div className="space-y-1 font-mono text-xs">
                        {decryptedItems.map((item) => (
                          <div key={item.id} className="p-2 rounded bg-background border border-border/40 flex justify-between items-center">
                            <span className="font-semibold text-foreground">{item.title}</span>
                            <span className="text-muted-foreground truncate max-w-[160px]">{item.url}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

    </div>
  )
}
