'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { useAlgorithmHud } from '../lib/algorithm-hud'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/registry/new-york/ui/tabs'

const LAB_TABS = ['linucb', 'hyperbolic', 'graph', 'visual', 'webmcp', 'federated', 'speculation', 'synthesizer', 'mesh', 'health', 'intent', 'vault'] as const

/**
 * 12 个引擎的 3 大技术域分组（2026-11-21）。
 *
 * 原先 12 个 Tab 按 2×6 平铺，排序算法、知识图谱、端侧基建、隐私安全混在
 * 一起——用户看不出「这一组是干什么的」。现按技术域分组，组标题即心智锚点。
 * 成员严格覆盖 LAB_TABS 全集（有单测守卫，见 algorithm-lab-groups.test.ts）。
 */
export const LAB_GROUPS = [
  {
    id: 'retrieval',
    label: '检索与排序',
    items: [
      { value: 'linucb', label: 'LinUCB', icon: Layers, tone: 'text-primary' },
      { value: 'intent', label: '0-RTT 推测', icon: Zap, tone: 'text-amber-500' },
      { value: 'health', label: '文本熵巡检', icon: Activity, tone: 'text-emerald-700 dark:text-emerald-400' },
    ],
  },
  {
    id: 'graph',
    label: '图谱与视觉',
    items: [
      { value: 'hyperbolic', label: '庞加莱平替', icon: Orbit, tone: 'text-violet-500' },
      { value: 'graph', label: '知识星图', icon: Network, tone: 'text-indigo-500' },
      { value: 'visual', label: '视觉指纹', icon: Palette, tone: 'text-pink-500' },
    ],
  },
  {
    id: 'infra',
    label: '端侧基建与隐私',
    items: [
      { value: 'webmcp', label: 'WebMCP', icon: Bot, tone: 'text-emerald-500' },
      { value: 'synthesizer', label: '工具合成', icon: Wrench, tone: 'text-orange-500' },
      { value: 'federated', label: '差分隐私', icon: Radio, tone: 'text-blue-500' },
      { value: 'mesh', label: 'P2P 共识', icon: Share2, tone: 'text-teal-500' },
      { value: 'speculation', label: '推测预渲染', icon: Rocket, tone: 'text-amber-500' },
      { value: 'vault', label: 'E2EE 金库', icon: Lock, tone: 'text-cyan-500' },
    ],
  },
] as const

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
  Wrench,
  Activity,
  Rocket,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
  /* scrollToSandbox 已随「12 个静态指标块」一并退役（2026-11-21）：
     那个块是唯一调用方（点指示牌滚动到沙箱）。删块之后它成了死代码，
     留着会被 lint 判未使用。分组切换栏直接切 Tab，不需要额外滚动。 */

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

            {/* 2026-11-21：原先这里另有一枚「12 大前沿认知与自治计算引擎」胶囊，
                与下方副标题、以及 12 个 Tab 三重重述同一件事，已删除。
                HUD 开关保留；「仅本地展示」收成带 Tooltip 的轻量徽标。 */}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" role="switch" aria-checked={hud.enabled} aria-label="算法 HUD：显示主导通道角标" data-testid="algorithm-hud-toggle" onClick={hud.toggle} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-zinc-50 px-2.5 py-1 font-mono text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                <span aria-hidden="true">{hud.enabled ? "●" : "○"}</span>
                <span>算法 HUD {hud.enabled ? "开" : "关"}</span>
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    aria-label="数据说明：全部计算在本机浏览器完成，不上报任何参数"
                    className="inline-flex cursor-help items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-emerald-400"
                  >
                    <ShieldCheck className="h-3 w-3" aria-hidden />
                    仅本地展示，不上报
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  全部计算在本机浏览器完成，不上报任何参数；personal 角标出现即代表用了登录画像
                </TooltipContent>
              </Tooltip>
            </div>

          </div>

          {/* 2026-11-21 首屏重构：原先这里是「三连复读」的第一环——
              一段把 12 个引擎名逐个念一遍的长段落（实测把 Hero 撑到 328–372px）。
              现在压成 2 行：主标题 + 一句克制的副标题。
              12 个引擎的名字交给下方按技术域分组的切换栏去表达，
              同一个信息不在首屏出现三次。 */}
          <div className="min-w-0">
            <h1 className="flex items-center gap-2.5 text-xl font-extrabold tracking-tight sm:text-2xl">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-xs">
                <Cpu className="h-5 w-5" />
              </span>
              <span>山羊胡 5.0+ 算法实验室</span>
            </h1>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">
              12 个端侧认知、排序与零知识计算引擎的本地交互验证台
            </p>
          </div>

          {/* 2026-11-21：删除 12 个纯装饰静态指标块（三连复读第二环）。
              它们不可切换、不可点击进沙箱，只是在重复引擎名；
              真正承担导航职责的是下方按技术域分组的切换栏。 */}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={activateTab} className="w-full scroll-mt-20" id="algorithm-sandbox">
        <p className="sm:hidden text-center text-[11px] text-muted-foreground pb-1">左右滑动查看全部 12 个沙箱</p>
      {/* 2026-11-21 分组导航（替代原 2×6 平铺）：
          12 个引擎原本一字排开，排序、图谱、端侧基建、隐私安全混在一起，
          缺少系统架构层次。现按技术域分 3 组，桌面端横向排列、窄屏横向滚动：
            检索与排序  → LinUCB / 0-RTT 推测 / 文本熵巡检
            图谱与视觉  → 庞加莱平替 / 知识星图 / 视觉指纹
            端侧基建与隐私 → WebMCP / 工具合成 / 差分隐私 / P2P 共识 / 推测预渲染 / E2EE 金库
          仍是同一套 Tabs 原语，故 #hash 深链与前进后退行为完全不变。 */}
      {/* 布局：1280px 实测「12 个 Tab + 3 个组标签」一行放不下，
          右侧「推测预渲染」被截断。改为按组换行（每组建自己的 flex 行），
          ≥xl 才尝试单行；任何宽度下都不隐藏引擎，也不出现截断。
          overflow-x-auto 仍保留作最后兜底（极窄屏），但通常不会触发。 */}
      <TabsList className="sticky top-0 z-30 flex h-auto w-full flex-wrap items-center gap-x-2 gap-y-1.5 overflow-x-auto no-scrollbar rounded-xl border border-border/60 bg-muted/40 p-2 backdrop-blur-md touch-pan-x">
        {LAB_GROUPS.map((group, gi) => (
          /* 组间用竖线分隔 + 明确左右留白：首版只靠 gap 区分，实测
             1280px 下「检索与排序」的组标签与相邻 Tab 文字视觉粘连。
             组标签改为独立小色块（bg-muted 底 + 圆角），边界一眼可辨。 */
          <div key={group.id} className="flex min-w-0 shrink-0 items-center gap-1 lg:shrink">
            {gi > 0 ? (
              <span aria-hidden="true" className="mx-1.5 hidden h-4 w-px shrink-0 bg-border lg:block" />
            ) : null}
            <span className="mr-0.5 shrink-0 whitespace-nowrap rounded-md bg-background/70 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
              {group.label}
            </span>
            {group.items.map((item) => (
              <TabsTrigger
                key={item.value}
                value={item.value}
                onMouseEnter={() => preloadTab(item.value)}
                onFocus={() => preloadTab(item.value)}
                className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-medium transition-all data-[state=active]:border data-[state=active]:border-border/60 data-[state=active]:bg-background data-[state=active]:shadow-xs"
              >
                <item.icon className={`h-3.5 w-3.5 ${item.tone}`} aria-hidden /> {item.label}
              </TabsTrigger>
            ))}
          </div>
        ))}
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
