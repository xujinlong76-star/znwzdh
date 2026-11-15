'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { useAlgorithmHud } from '../lib/algorithm-hud'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/registry/new-york/ui/tabs'

const LAB_TABS = ['linucb', 'hyperbolic', 'graph', 'visual', 'webmcp', 'federated', 'speculation', 'synthesizer', 'mesh', 'health', 'intent', 'vault'] as const

function tabFromHash(): string {
  if (typeof window === 'undefined') return 'linucb'
  const h = window.location.hash.replace(/^#/, "")
  return (LAB_TABS as readonly string[]).includes(h) ? h : 'linucb'
}
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

/**
 * Tab 级动态加载：12 个实验区面板以前是静态 import、首屏一次性全打包全挂载，
 * /algorithms 首屏 JS 因此超预算约 35KB。这里改成 next/dynamic 懒加载 ——
 * 首屏只下载当前激活 Tab 的 chunk，其余 Tab 切换时再加载；
 * 保持服务端渲染开启（与 /drama 的 drama-content-lazy 同一口径）：
 * 服务端仍渲染激活 Tab 的真实内容，索引与首屏不受影响。
 * 每个面板都保留一个裸 import() 加载器：hover/focus 时调用它只预取 chunk
 * （不挂载面板），切换时 chunk 已在缓存里、立刻渲染，体验不卡顿。
 */
function PanelLoading({ label }: { label: string }) {
  return (
    <div className="mt-6" aria-busy="true" aria-label={`正在加载${label}`}>
      <div className="h-8 w-56 animate-pulse rounded-lg bg-muted" />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="h-40 animate-pulse rounded-xl bg-muted/60" />
        <div className="h-40 animate-pulse rounded-xl bg-muted/60" />
      </div>
    </div>
  )
}

const loadLinucbPanel = () => import('./algorithm-lab/linucb-panel')
const LinucbPanel = dynamic(() => loadLinucbPanel().then((m) => ({ default: m.LinucbPanel })), {
  loading: () => <PanelLoading label="LinUCB 沙箱" />,
})
const loadHyperbolicPanel = () => import('./algorithm-lab/hyperbolic-panel')
const HyperbolicPanel = dynamic(
  () => loadHyperbolicPanel().then((m) => ({ default: m.HyperbolicPanel })),
  { loading: () => <PanelLoading label="庞加莱平替沙箱" /> },
)
const loadHealthPanel = () => import('./algorithm-lab/health-panel')
const HealthPanel = dynamic(() => loadHealthPanel().then((m) => ({ default: m.HealthPanel })), {
  loading: () => <PanelLoading label="文本熵巡检沙箱" />,
})
const loadIntentPanel = () => import('./algorithm-lab/intent-panel')
const IntentPanel = dynamic(() => loadIntentPanel().then((m) => ({ default: m.IntentPanel })), {
  loading: () => <PanelLoading label="0-RTT 推测沙箱" />,
})
const loadVaultPanel = () => import('./algorithm-lab/vault-panel')
const VaultPanel = dynamic(() => loadVaultPanel().then((m) => ({ default: m.VaultPanel })), {
  loading: () => <PanelLoading label="E2EE 金库沙箱" />,
})
const loadGraphPanel = () => import('./algorithm-lab/graph-panel')
const GraphPanel = dynamic(() => loadGraphPanel().then((m) => ({ default: m.GraphPanel })), {
  loading: () => <PanelLoading label="知识星图沙箱" />,
})
const loadVisualPanel = () => import('./algorithm-lab/visual-panel')
const VisualPanel = dynamic(() => loadVisualPanel().then((m) => ({ default: m.VisualPanel })), {
  loading: () => <PanelLoading label="视觉指纹沙箱" />,
})
const loadWebMcpPanel = () => import('./algorithm-lab/webmcp-panel')
const WebMcpPanel = dynamic(() => loadWebMcpPanel().then((m) => ({ default: m.WebMcpPanel })), {
  loading: () => <PanelLoading label="WebMCP 沙箱" />,
})
const loadFederatedPanel = () => import('./algorithm-lab/federated-panel')
const FederatedPanel = dynamic(
  () => loadFederatedPanel().then((m) => ({ default: m.FederatedPanel })),
  { loading: () => <PanelLoading label="差分隐私沙箱" /> },
)
const loadSpeculationPanel = () => import('./algorithm-lab/speculation-panel')
const SpeculationPanel = dynamic(
  () => loadSpeculationPanel().then((m) => ({ default: m.SpeculationPanel })),
  { loading: () => <PanelLoading label="推测预渲染沙箱" /> },
)
const loadTrajectoryLab = () => import('./algorithm-lab/trajectory-lab')
const TrajectoryLab = dynamic(loadTrajectoryLab, { loading: () => null })
const loadSynthesizerPanel = () => import('./algorithm-lab/synthesizer-panel')
const SynthesizerPanel = dynamic(
  () => loadSynthesizerPanel().then((m) => ({ default: m.SynthesizerPanel })),
  { loading: () => <PanelLoading label="工具合成沙箱" /> },
)
const loadMeshPanel = () => import('./algorithm-lab/mesh-panel')
const MeshPanel = dynamic(() => loadMeshPanel().then((m) => ({ default: m.MeshPanel })), {
  loading: () => <PanelLoading label="P2P 共识沙箱" />,
})

/** hover/focus 预取用：tab 值 → 裸 import() 加载器（只下载 chunk，不挂载）。 */
const PANEL_PRELOADERS: Record<string, () => Promise<unknown>> = {
  linucb: loadLinucbPanel,
  hyperbolic: loadHyperbolicPanel,
  health: loadHealthPanel,
  intent: loadIntentPanel,
  vault: loadVaultPanel,
  graph: loadGraphPanel,
  visual: loadVisualPanel,
  webmcp: loadWebMcpPanel,
  federated: loadFederatedPanel,
  speculation: loadSpeculationPanel,
  synthesizer: loadSynthesizerPanel,
  mesh: loadMeshPanel,
}

/**
 * 算法实验室壳：Hero 展板 + 12 实验区 tab 导航。各实验区的状态与逻辑
 * 已拆到 ./algorithm-lab/*-panel.tsx（第五批 A1），这里只保留 activeTab
 * 一个业务状态位。
 */
export function AlgorithmLab() {
  const [activeTab, setActiveTab] = useState('linucb')
  // 已访问过的实验区：首屏只挂载当前激活 Tab；某 Tab 首次被激活时才渲染其面板
  // （同时触发 chunk 下载），访问过一次后常驻挂载（TabsContent 全是 forceMount），
  // 来回切换不丢本地状态、不重复下载。用 ref 存集合：每次变更都紧跟一次 setActiveTab
  // 触发重渲染，渲染时读到的集合一定是最新的。
  const loadedTabsRef = useRef<Set<string>>(new Set(['linucb']))
  const isLoaded = (tab: string) => loadedTabsRef.current.has(tab)
  const activateTab = (tab: string) => {
    loadedTabsRef.current.add(tab)
    setActiveTab(tab)
  }
  // hover/focus 只预取 chunk，不挂载面板也不改状态；切过去时直接读缓存。
  const preloadTab = (tab: string) => {
    if (loadedTabsRef.current.has(tab)) return
    void PANEL_PRELOADERS[tab]?.()
    if (tab === 'speculation') void loadTrajectoryLab()
  }
const hud = useAlgorithmHud()
  useEffect(() => { const t = tabFromHash(); if (t !== 'linucb') { loadedTabsRef.current.add(t); setActiveTab(t) } }, [])
  useEffect(() => { const next = "#" + activeTab; if (window.location.hash !== next) window.history.replaceState(null, "", next) }, [activeTab])
  useEffect(() => { const sync = () => { const t = tabFromHash(); loadedTabsRef.current.add(t); setActiveTab(t) }; window.addEventListener("hashchange", sync); return () => window.removeEventListener("hashchange", sync) }, [])
  const scrollToSandbox = (tab: string) => { activateTab(tab); document.getElementById('algorithm-sandbox')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

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
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                12 大前沿认知与自治计算引擎 · 实验室演示
              </span>
            </div>
      <button type="button" role="switch" aria-checked={hud.enabled} aria-label="算法 HUD：显示主导通道角标" data-testid="algorithm-hud-toggle" onClick={hud.toggle} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-zinc-50 px-2.5 py-1 font-mono text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        <span aria-hidden="true">{hud.enabled ? "●" : "○"}</span>
        <span>算法 HUD {hud.enabled ? "开" : "关"}</span>
      </button>
      <span className="text-xs text-muted-foreground">仅本地展示，不上报；personal 角标出现即代表用了登录画像</span>
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
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-2 pt-2" onClick={(e) => { const t = (e.target as HTMLElement).closest("[data-tab]"); if (t) scrollToSandbox(t.getAttribute("data-tab") || "linucb") }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { const t = (e.target as HTMLElement).closest("[data-tab]"); if (t) { e.preventDefault(); scrollToSandbox(t.getAttribute("data-tab") || "linucb") } } }} onMouseOver={(e) => { const t = (e.target as HTMLElement).closest("[data-tab]"); if (t) preloadTab(t.getAttribute("data-tab") || "linucb") }} onFocus={(e) => { const t = (e.target as HTMLElement).closest("[data-tab]"); if (t) preloadTab(t.getAttribute("data-tab") || "linucb") }}>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5 cursor-pointer hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary" role="button" tabIndex={0} data-tab="linucb" aria-label="打开多臂自适应沙箱">
              <div className="text-[11px] text-muted-foreground">多臂自适应</div>
              <div className="font-bold font-mono text-primary text-xs">LinUCB</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5 cursor-pointer hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary" role="button" tabIndex={0} data-tab="hyperbolic" aria-label="打开双曲平替沙箱">
              <div className="text-[11px] text-muted-foreground">双曲平替</div>
              <div className="font-bold font-mono text-violet-500 text-xs">Poincaré</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5 cursor-pointer hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary" role="button" tabIndex={0} data-tab="graph" aria-label="打开知识星图沙箱">
              <div className="text-[11px] text-muted-foreground">知识星图</div>
              <div className="font-bold font-mono text-indigo-500 text-xs">Dijkstra</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5 cursor-pointer hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary" role="button" tabIndex={0} data-tab="visual" aria-label="打开视觉指纹沙箱">
              <div className="text-[11px] text-muted-foreground">视觉指纹</div>
              <div className="font-bold font-mono text-pink-500 text-xs">WCAG 2.1</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5 cursor-pointer hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary" role="button" tabIndex={0} data-tab="webmcp" aria-label="打开端侧网格沙箱">
              <div className="text-[11px] text-muted-foreground">端侧网桥</div>
              <div className="font-bold font-mono text-emerald-500 text-xs">WebMCP</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5 cursor-pointer hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary" role="button" tabIndex={0} data-tab="federated" aria-label="打开差分隐私沙箱">
              <div className="text-[11px] text-muted-foreground">差分隐私</div>
              <div className="font-bold font-mono text-blue-500 text-xs">LDP Lap</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5 cursor-pointer hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary" role="button" tabIndex={0} data-tab="speculation" aria-label="打开推测渲染沙箱">
              <div className="text-[11px] text-muted-foreground">推测渲染</div>
              <div className="font-bold font-mono text-amber-500 text-xs">SpecRules</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5 cursor-pointer hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary" role="button" tabIndex={0} data-tab="synthesizer" aria-label="打开工具合成沙箱">
              <div className="text-[11px] text-muted-foreground">工具合成</div>
              <div className="font-bold font-mono text-orange-500 text-xs">Synthesizer</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5 cursor-pointer hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary" role="button" tabIndex={0} data-tab="mesh" aria-label="打开网格共识沙箱">
              <div className="text-[11px] text-muted-foreground">网格共识</div>
              <div className="font-bold font-mono text-teal-500 text-xs">P2P Mesh</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5 cursor-pointer hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary" role="button" tabIndex={0} data-tab="health" aria-label="打开防假死链沙箱">
              <div className="text-[11px] text-muted-foreground">防假死链</div>
              <div className="font-bold font-mono text-emerald-700 dark:text-emerald-400 text-xs">Entropy</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5 cursor-pointer hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary" role="button" tabIndex={0} data-tab="intent" aria-label="打开推测执行沙箱">
              <div className="text-[11px] text-muted-foreground">推测执行</div>
              <div className="font-bold font-mono text-amber-500 text-xs">0-RTT</div>
            </div>
            <div className="p-2 rounded-xl bg-background/70 border border-border/50 text-xs space-y-0.5 cursor-pointer hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary" role="button" tabIndex={0} data-tab="vault" aria-label="打开密码金库沙箱">
              <div className="text-[11px] text-muted-foreground">密码金库</div>
              <div className="font-bold font-mono text-cyan-500 text-xs">AES-256</div>
            </div>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={activateTab} className="w-full scroll-mt-20" id="algorithm-sandbox">
        <p className="sm:hidden text-center text-[11px] text-muted-foreground pb-1">左右滑动查看全部 12 个沙箱</p>
      <TabsList className="sticky top-0 z-30 flex items-center gap-1 overflow-x-auto no-scrollbar touch-pan-x sm:grid sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-12 w-full h-auto p-1.5 bg-muted/40 border border-border/60 rounded-xl backdrop-blur-md">
          <TabsTrigger
            value="linucb"
            onMouseEnter={() => preloadTab('linucb')}
            onFocus={() => preloadTab('linucb')}
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Layers className="w-3.5 h-3.5 text-primary" /> LinUCB
          </TabsTrigger>
          <TabsTrigger
            value="hyperbolic"
            onMouseEnter={() => preloadTab('hyperbolic')}
            onFocus={() => preloadTab('hyperbolic')}
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Orbit className="w-3.5 h-3.5 text-violet-500" /> 庞加莱平替
          </TabsTrigger>
          <TabsTrigger
            value="graph"
            onMouseEnter={() => preloadTab('graph')}
            onFocus={() => preloadTab('graph')}
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Network className="w-3.5 h-3.5 text-indigo-500" /> 知识星图
          </TabsTrigger>
          <TabsTrigger
            value="visual"
            onMouseEnter={() => preloadTab('visual')}
            onFocus={() => preloadTab('visual')}
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Palette className="w-3.5 h-3.5 text-pink-500" /> 视觉指纹
          </TabsTrigger>
          <TabsTrigger
            value="webmcp"
            onMouseEnter={() => preloadTab('webmcp')}
            onFocus={() => preloadTab('webmcp')}
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Bot className="w-3.5 h-3.5 text-emerald-500" /> WebMCP
          </TabsTrigger>
          <TabsTrigger
            value="federated"
            onMouseEnter={() => preloadTab('federated')}
            onFocus={() => preloadTab('federated')}
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Radio className="w-3.5 h-3.5 text-blue-500" /> 差分隐私
          </TabsTrigger>
          <TabsTrigger
            value="speculation"
            onMouseEnter={() => preloadTab('speculation')}
            onFocus={() => preloadTab('speculation')}
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" /> 推测预渲染
          </TabsTrigger>
          <TabsTrigger
            value="synthesizer"
            onMouseEnter={() => preloadTab('synthesizer')}
            onFocus={() => preloadTab('synthesizer')}
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Wrench className="w-3.5 h-3.5 text-orange-500" /> 工具合成
          </TabsTrigger>
          <TabsTrigger
            value="mesh"
            onMouseEnter={() => preloadTab('mesh')}
            onFocus={() => preloadTab('mesh')}
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Share2 className="w-3.5 h-3.5 text-teal-500" /> P2P共识
          </TabsTrigger>
          <TabsTrigger
            value="health"
            onMouseEnter={() => preloadTab('health')}
            onFocus={() => preloadTab('health')}
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> 文本熵巡检
          </TabsTrigger>
          <TabsTrigger
            value="intent"
            onMouseEnter={() => preloadTab('intent')}
            onFocus={() => preloadTab('intent')}
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" /> 0-RTT 推测
          </TabsTrigger>
          <TabsTrigger
            value="vault"
            onMouseEnter={() => preloadTab('vault')}
            onFocus={() => preloadTab('vault')}
            className="py-2 px-3 sm:px-1.5 whitespace-nowrap shrink-0 sm:shrink text-xs flex items-center justify-center gap-1.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/60 transition-all font-medium"
          >
            <Lock className="w-3.5 h-3.5 text-cyan-500" /> E2EE 金库
          </TabsTrigger>
        </TabsList>



        {/* ================= 1. LinUCB 上下文多臂老虎机 ================= */}
        <TabsContent value="linucb" forceMount className="mt-6">
          {isLoaded('linucb') ? <LinucbPanel /> : null}
        </TabsContent>

        {/* ================= 2. 庞加莱双曲空间平替几何 ================= */}
        <TabsContent value="hyperbolic" forceMount className="mt-6">
          {isLoaded('hyperbolic') ? <HyperbolicPanel /> : null}
        </TabsContent>

        {/* ================= 3. 页面健康与防假 200 巡检 ================= */}
        <TabsContent value="health" forceMount className="mt-6">
          {isLoaded('health') ? <HealthPanel /> : null}
        </TabsContent>

        {/* ================= 4. 0-RTT 推测性意图执行 ================= */}
        <TabsContent value="intent" forceMount className="mt-6">
          {isLoaded('intent') ? <IntentPanel /> : null}
        </TabsContent>

        {/* ================= 5. 零知识 E2EE 加密金库 ================= */}
        <TabsContent value="vault" forceMount className="mt-6">
          {isLoaded('vault') ? <VaultPanel /> : null}
        </TabsContent>

        {/* ================= 6. 知识拓扑星图与多跳寻路 ================= */}
        <TabsContent value="graph" forceMount className="mt-6">
          {isLoaded('graph') ? <GraphPanel /> : null}
        </TabsContent>

        {/* ================= 7. 视觉指纹分析与色彩和谐度 ================= */}
        <TabsContent value="visual" forceMount className="mt-6">
          {isLoaded('visual') ? <VisualPanel /> : null}
        </TabsContent>

        {/* ================= 8. 端侧 WebMCP 运行态网桥 ================= */}
        <TabsContent value="webmcp" forceMount className="mt-6">
          {isLoaded('webmcp') ? <WebMcpPanel /> : null}
        </TabsContent>

        {/* ================= 9. 客户端联邦协同与差分隐私推荐 ================= */}
        <TabsContent value="federated" forceMount className="mt-6">
          {isLoaded('federated') ? <FederatedPanel /> : null}
        </TabsContent>

        {/* ================= 10. 自适应推测性预渲染（W3C Speculation Rules） ================= */}
        <TabsContent value="speculation" forceMount className="mt-6">
          {isLoaded('speculation') ? (
            <>
              <SpeculationPanel />
              <TrajectoryLab />
            </>
          ) : null}
        </TabsContent>

        {/* ================= 11. 动态 WebMCP 工具合成器与 SSRF 沙箱 ================= */}
        <TabsContent value="synthesizer" forceMount className="mt-6">
          {isLoaded('synthesizer') ? <SynthesizerPanel /> : null}
        </TabsContent>

        {/* ================= 12. P2P Mesh 去中心化状态向量共识 ================= */}
        <TabsContent value="mesh" forceMount className="mt-6">
          {isLoaded('mesh') ? <MeshPanel /> : null}
        </TabsContent>
      </Tabs>

    </div>
  )
}
