'use client'

import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/registry/new-york/ui/tabs'
import { Badge } from '@/components/ui/badge'
import {
  Cpu,
  Orbit,
  ShieldCheck,
  Zap,
  Layers,
  ArrowLeft,
  Lock,
  Network,
  Palette,
  Bot,
  Radio,
  Share2,
  Wrench
} from 'lucide-react'
import Link from 'next/link'
import { LinucbPanel } from './algorithm-lab/linucb-panel'
import { HyperbolicPanel } from './algorithm-lab/hyperbolic-panel'
import { HealthPanel } from './algorithm-lab/health-panel'
import { IntentPanel } from './algorithm-lab/intent-panel'
import { VaultPanel } from './algorithm-lab/vault-panel'
import { GraphPanel } from './algorithm-lab/graph-panel'
import { VisualPanel } from './algorithm-lab/visual-panel'
import { WebMcpPanel } from './algorithm-lab/webmcp-panel'
import { FederatedPanel } from './algorithm-lab/federated-panel'
import { SpeculationPanel } from './algorithm-lab/speculation-panel'
import { SynthesizerPanel } from './algorithm-lab/synthesizer-panel'
import { MeshPanel } from './algorithm-lab/mesh-panel'

/**
 * 算法实验室壳：Hero 展板 + 12 实验区 tab 导航。各实验区的状态与逻辑
 * 已拆到 ./algorithm-lab/*-panel.tsx（第五批 A1），这里只保留 activeTab
 * 一个业务状态位。
 */
export function AlgorithmLab() {
  const [activeTab, setActiveTab] = useState('linucb')

  return (
    <div className="container max-w-6xl mx-auto py-4 sm:py-8 px-3 sm:px-4 space-y-5 sm:space-y-8">
      {/* 头部导航与沉浸式 Hero 展板 */}
      <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero subtle-mesh p-4 sm:p-8 shadow-xs">
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
                山羊胡 5.0+ 算法实验室
              </Badge>
            </div>

            {/* 顶栏快速特性胶囊 */}
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                12 大前沿认知与自治计算引擎全就绪
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
              <span className="text-foreground font-medium">技术拓扑星图与多跳 Dijkstra 寻路</span>、
              <span className="text-foreground font-medium">视觉指纹与 WCAG 2.1 色彩和谐度</span>、
              <span className="text-foreground font-medium">端侧 WebMCP JSON-RPC 2.0 网桥</span>、
              <span className="text-foreground font-medium">本地差分隐私协同推荐 (LDP Laplace)</span>、
              <span className="text-foreground font-medium">W3C Speculation Rules 推测预渲染</span>、
              <span className="text-foreground font-medium">动态 WebMCP 工具合成器沙箱</span>、
              <span className="text-foreground font-medium">P2P Mesh 去中心化状态向量共识</span>、
              <span className="text-foreground font-medium">Shannon 文本熵防假 200 巡检</span>、
              <span className="text-foreground font-medium">0-RTT 推测性意图瞬时计算</span> 与
              <span className="text-foreground font-medium">AES-256-GCM 零知识端到端私密金库</span>。
            </p>
          </div>

          {/* 12 大算法指标快速指示牌 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-2 pt-2">
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5">
              <div className="text-[11px] text-muted-foreground">多臂自适应</div>
              <div className="font-bold font-mono text-primary text-xs">LinUCB</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5">
              <div className="text-[11px] text-muted-foreground">双曲平替</div>
              <div className="font-bold font-mono text-violet-500 text-xs">Poincaré</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5">
              <div className="text-[11px] text-muted-foreground">知识星图</div>
              <div className="font-bold font-mono text-indigo-500 text-xs">Dijkstra</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5">
              <div className="text-[11px] text-muted-foreground">视觉指纹</div>
              <div className="font-bold font-mono text-pink-500 text-xs">WCAG 2.1</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5">
              <div className="text-[11px] text-muted-foreground">端侧网桥</div>
              <div className="font-bold font-mono text-emerald-500 text-xs">WebMCP</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5">
              <div className="text-[11px] text-muted-foreground">差分隐私</div>
              <div className="font-bold font-mono text-blue-500 text-xs">LDP Lap</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5">
              <div className="text-[11px] text-muted-foreground">推测渲染</div>
              <div className="font-bold font-mono text-amber-500 text-xs">SpecRules</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5">
              <div className="text-[11px] text-muted-foreground">工具合成</div>
              <div className="font-bold font-mono text-orange-500 text-xs">Synthesizer</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5">
              <div className="text-[11px] text-muted-foreground">网格共识</div>
              <div className="font-bold font-mono text-teal-500 text-xs">P2P Mesh</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5">
              <div className="text-[11px] text-muted-foreground">防假死链</div>
              <div className="font-bold font-mono text-emerald-600 text-xs">Entropy</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5">
              <div className="text-[11px] text-muted-foreground">推测执行</div>
              <div className="font-bold font-mono text-amber-500 text-xs">0-RTT</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5">
              <div className="text-[11px] text-muted-foreground">密码金库</div>
              <div className="font-bold font-mono text-cyan-500 text-xs">AES-256</div>
            </div>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex items-center gap-1 overflow-x-auto no-scrollbar touch-pan-x sm:grid sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-12 w-full h-auto p-1.5 bg-muted/40 border border-border/60 rounded-xl backdrop-blur-md">
          <TabsTrigger
            value="linucb"
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Layers className="w-3.5 h-3.5 text-primary" /> LinUCB
          </TabsTrigger>
          <TabsTrigger
            value="hyperbolic"
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Orbit className="w-3.5 h-3.5 text-violet-500" /> 庞加莱平替
          </TabsTrigger>
          <TabsTrigger
            value="graph"
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Network className="w-3.5 h-3.5 text-indigo-500" /> 知识星图
          </TabsTrigger>
          <TabsTrigger
            value="visual"
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Palette className="w-3.5 h-3.5 text-pink-500" /> 视觉指纹
          </TabsTrigger>
          <TabsTrigger
            value="webmcp"
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Bot className="w-3.5 h-3.5 text-emerald-500" /> WebMCP
          </TabsTrigger>
          <TabsTrigger
            value="federated"
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Radio className="w-3.5 h-3.5 text-blue-500" /> 差分隐私
          </TabsTrigger>
          <TabsTrigger
            value="speculation"
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" /> 推测预渲染
          </TabsTrigger>
          <TabsTrigger
            value="synthesizer"
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Wrench className="w-3.5 h-3.5 text-orange-500" /> 工具合成
          </TabsTrigger>
          <TabsTrigger
            value="mesh"
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Share2 className="w-3.5 h-3.5 text-teal-500" /> P2P共识
          </TabsTrigger>
          <TabsTrigger
            value="health"
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> 文本熵巡检
          </TabsTrigger>
          <TabsTrigger
            value="intent"
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" /> 0-RTT 推测
          </TabsTrigger>
          <TabsTrigger
            value="vault"
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Lock className="w-3.5 h-3.5 text-cyan-500" /> E2EE 金库
          </TabsTrigger>
        </TabsList>



        {/* ================= 1. LinUCB 上下文多臂老虎机 ================= */}
        <TabsContent value="linucb" className="mt-6">
          <LinucbPanel />
        </TabsContent>

        {/* ================= 2. 庞加莱双曲空间平替几何 ================= */}
        <TabsContent value="hyperbolic" className="mt-6">
          <HyperbolicPanel />
        </TabsContent>

        {/* ================= 3. 页面健康与防假 200 巡检 ================= */}
        <TabsContent value="health" className="mt-6">
          <HealthPanel />
        </TabsContent>

        {/* ================= 4. 0-RTT 推测性意图执行 ================= */}
        <TabsContent value="intent" className="mt-6">
          <IntentPanel />
        </TabsContent>

        {/* ================= 5. 零知识 E2EE 加密金库 ================= */}
        <TabsContent value="vault" className="mt-6">
          <VaultPanel />
        </TabsContent>

        {/* ================= 6. 知识拓扑星图与多跳寻路 ================= */}
        <TabsContent value="graph" className="mt-6">
          <GraphPanel />
        </TabsContent>

        {/* ================= 7. 视觉指纹分析与色彩和谐度 ================= */}
        <TabsContent value="visual" className="mt-6">
          <VisualPanel />
        </TabsContent>

        {/* ================= 8. 端侧 WebMCP 运行态网桥 ================= */}
        <TabsContent value="webmcp" className="mt-6">
          <WebMcpPanel />
        </TabsContent>

        {/* ================= 9. 客户端联邦协同与差分隐私推荐 ================= */}
        <TabsContent value="federated" className="mt-6">
          <FederatedPanel />
        </TabsContent>

        {/* ================= 10. 自适应推测性预渲染（W3C Speculation Rules） ================= */}
        <TabsContent value="speculation" className="mt-6">
          <SpeculationPanel />
        </TabsContent>

        {/* ================= 11. 动态 WebMCP 工具合成器与 SSRF 沙箱 ================= */}
        <TabsContent value="synthesizer" className="mt-6">
          <SynthesizerPanel />
        </TabsContent>

        {/* ================= 12. P2P Mesh 去中心化状态向量共识 ================= */}
        <TabsContent value="mesh" className="mt-6">
          <MeshPanel />
        </TabsContent>
      </Tabs>

    </div>
  )
}
