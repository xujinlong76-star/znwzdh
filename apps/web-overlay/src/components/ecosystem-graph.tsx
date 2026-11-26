'use client'

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { safeWindowOpen } from '@/lib/safe-url'
import { Button } from '@/registry/new-york/ui/button'
import { Badge } from '@/components/ui/badge'
import { ExternalLink, Sparkles, Zap, ArrowLeft, Search, ZoomIn, ZoomOut, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import {
  directionFromKey,
  isActivationKey,
  nextNodeInDirection,
  nodeAccessibleName,
  rovingNodeId,
  type GraphDirection,
} from '@/lib/graph-nav'
import {
  resolveGraphCategory,
  type GraphCategoryFocus,
} from '@/lib/graph-category'
import {
  capsuleTextWidth,
  computeGraphFit,
  computeGraphReadableFloor,
  computeNodeDegrees,
  edgeCapsuleText,
  graphContentBox,
  nodeRadiusForDegree,
  pinchGraphView,
  toGraphViewBoxPoint,
  truncateGraphLabel,
  resolveIsOpenSource,
  GRAPH_MIN_NODE_RADIUS,
  GRAPH_NARROW_CONTAINER_PX,
} from '@/lib/graph-polish'
import { extractFaviconMonogram, resolveSiteIcon } from '@/components/site-favicon'
import {
  buildGraphEdges,
  sampleClusterFirst,
  searchGraphSites,
  egoSubgraph,
  type ClusterEdge,
  type GraphCluster,
} from '@/lib/graph-cluster'

export interface GraphNode {
  id: string
  title: string
  url: string
  category: 'dev' | 'design' | 'ai' | 'efficiency'
  description: string
  openSource?: boolean
  x?: number
  y?: number
  vx?: number
  vy?: number
}

export interface GraphEdge {
  source: string
  target: string
  type: 'alternative' | 'ecosystem'
  label?: string
}

const DEFAULT_NODES: GraphNode[] = [
  // AI
  { id: 'cursor', title: 'Cursor', url: 'https://cursor.com', category: 'ai', description: '新一代 AI 原生 IDE' },
  { id: 'copilot', title: 'GitHub Copilot', url: 'https://github.com/features/copilot', category: 'ai', description: '微软官方 AI 编程助手' },
  { id: 'continue', title: 'Continue.dev', url: 'https://continue.dev', category: 'ai', description: '开源本地大模型代码助手', openSource: true },
  { id: 'claude', title: 'Claude', url: 'https://claude.ai', category: 'ai', description: 'Anthropic 旗舰推理与长文本模型' },
  { id: 'deepseek', title: 'DeepSeek', url: 'https://chat.deepseek.com', category: 'ai', description: '高性价比国产推理大模型', openSource: true },
  { id: 'ollama', title: 'Ollama', url: 'https://ollama.com', category: 'ai', description: '本地轻量离线大模型运行框架', openSource: true },
  { id: 'vllm', title: 'vLLM', url: 'https://github.com/vllm-project/vllm', category: 'ai', description: '高吞吐量大模型推理引擎', openSource: true },

  // Dev
  { id: 'github', title: 'GitHub', url: 'https://github.com', category: 'dev', description: '全球开源代码协作中心' },
  { id: 'gitlab', title: 'GitLab', url: 'https://gitlab.com', category: 'dev', description: '支持自托管的 DevOps 平台', openSource: true },
  { id: 'vercel', title: 'Vercel', url: 'https://vercel.com', category: 'dev', description: '前端与全栈极速部署云平台' },
  { id: 'coolify', title: 'Coolify', url: 'https://coolify.io', category: 'dev', description: '开源自托管 Vercel/Heroku 替代方案', openSource: true },
  { id: 'zeabur', title: 'Zeabur', url: 'https://zeabur.com', category: 'dev', description: '多语言极速容器托管' },
  { id: 'docker', title: 'Docker Hub', url: 'https://hub.docker.com', category: 'dev', description: '容器镜像官方仓库' },
  { id: 'npm', title: 'npm', url: 'https://npmjs.com', category: 'dev', description: 'Node.js 官方包管理器' },
  { id: 'nextjs', title: 'Next.js', url: 'https://nextjs.org', category: 'dev', description: '企业级 React 全栈框架', openSource: true },

  // Design
  { id: 'figma', title: 'Figma', url: 'https://figma.com', category: 'design', description: '主流云端 UI/UX 设计与原型工具' },
  { id: 'penpot', title: 'Penpot', url: 'https://penpot.app', category: 'design', description: '首款开源 Web 矢量协同设计工具', openSource: true },
  { id: 'pixso', title: 'Pixso', url: 'https://pixso.cn', category: 'design', description: '国产专业级协同原型设计' },
  { id: 'tinypng', title: 'TinyPNG', url: 'https://tinypng.com', category: 'design', description: '智能无损图片压缩' },
  { id: 'squoosh', title: 'Squoosh', url: 'https://squoosh.app', category: 'design', description: 'Google 开源端侧图片压缩', openSource: true },
  { id: 'unsplash', title: 'Unsplash', url: 'https://unsplash.com', category: 'design', description: '高质量免版权摄影图库' },
  { id: 'pexels', title: 'Pexels', url: 'https://pexels.com', category: 'design', description: '免费商用摄影与 4K 视频' },
  { id: 'excalidraw', title: 'Excalidraw', url: 'https://excalidraw.com', category: 'design', description: '精美手绘风格虚拟白板', openSource: true },
  { id: 'tldraw', title: 'tldraw', url: 'https://tldraw.com', category: 'design', description: '轻量易扩展开源画板', openSource: true },

  // Efficiency
  { id: 'notion', title: 'Notion', url: 'https://notion.so', category: 'efficiency', description: '全能一体化模块化笔记与工作区' },
  { id: 'obsidian', title: 'Obsidian', url: 'https://obsidian.md', category: 'efficiency', description: '本地优先离线双链 Markdown 知识库', openSource: false },
  { id: 'appflowy', title: 'AppFlowy', url: 'https://appflowy.com', category: 'efficiency', description: '开源私有化 Notion 替代品', openSource: true },
]

const DEFAULT_EDGES: GraphEdge[] = [
  // 平替关系
  { source: 'cursor', target: 'continue', type: 'alternative', label: '开源平替' },
  { source: 'cursor', target: 'copilot', type: 'alternative', label: '竞品' },
  { source: 'claude', target: 'deepseek', type: 'alternative', label: '高性价比平替' },
  { source: 'github', target: 'gitlab', type: 'alternative', label: '私有化平替' },
  { source: 'vercel', target: 'coolify', type: 'alternative', label: '自托管平替' },
  { source: 'vercel', target: 'zeabur', type: 'alternative', label: '多语言平替' },
  { source: 'figma', target: 'penpot', type: 'alternative', label: '开源平替' },
  { source: 'figma', target: 'pixso', type: 'alternative', label: '国产平替' },
  { source: 'tinypng', target: 'squoosh', type: 'alternative', label: '离线开源平替' },
  { source: 'unsplash', target: 'pexels', type: 'alternative', label: '同类图库' },
  { source: 'excalidraw', target: 'tldraw', type: 'alternative', label: '平替白板' },
  { source: 'notion', target: 'appflowy', type: 'alternative', label: '开源平替' },
  { source: 'notion', target: 'obsidian', type: 'alternative', label: '本地双链平替' },

  // 生态链协同关系
  { source: 'nextjs', target: 'vercel', type: 'ecosystem', label: '原生部署' },
  { source: 'nextjs', target: 'npm', type: 'ecosystem', label: '包管理' },
  { source: 'ollama', target: 'vllm', type: 'ecosystem', label: '生态协同' },
  { source: 'deepseek', target: 'ollama', type: 'ecosystem', label: '本地运行' },
  { source: 'cursor', target: 'github', type: 'ecosystem', label: '代码协作' },
]

const CATEGORY_COLORS = {
  dev: { fill: '#3b82f6', text: '#bfdbfe', bg: 'rgba(59, 130, 246, 0.15)', name: '研发全栈' },
  design: { fill: '#ec4899', text: '#fbcfe8', bg: 'rgba(236, 72, 153, 0.15)', name: 'UI & 设计' },
  // 2026-11-22：AI 分类改用紫色，翠绿让位给「开源」形状通道（外环 + OS 徽标）
  ai: { fill: '#8b5cf6', text: '#ddd6fe', bg: 'rgba(139, 92, 246, 0.15)', name: 'AI 实验室' },
  efficiency: { fill: '#f59e0b', text: '#fde68a', bg: 'rgba(245, 158, 11, 0.15)', name: '效率创作' },
}

/** 从 /api/home/navigation 展平后的站点：抽样母体 + 全站检索池，取到后常驻 */
interface FlatSite {
  id: string
  title: string
  href: string
  description?: string
  tags?: string[]
  categoryId?: string
}

/**
 * AI 桶的分类 id 集合（reg-ai-tools 顶级 + 全部 10 个二级分类）。
 * 注意：绝不能用 catStr.includes('ai')——'containers'（容器编排）与
 * 'affairs'（政务）里都含 'ai'，会把 Docker Hub / Kubernetes / 政务类
 * 共 17 站误判进 AI 桶（2026-11-21 Playwright 实测：AI 场景混入 6–8 个
 * 容器工具）。'模型' 标签在 AI 分类外出现 0 次，故也不再作标签回退。
 */
const AI_CATEGORY_IDS = new Set([
  'reg-ai-tools',
  'reg-chat-assistants',
  'reg-ai-search-knowledge',
  'reg-ai-coding-assistant',
  'reg-ai-image-generation',
  'reg-ai-audio-voice',
  'reg-ai-writing-office',
  'reg-agents-and-automation',
  'reg-models-and-datasets',
  'reg-ai-video-generation',
  'reg-ai-drama-creation',
])

/**
 * 场景桶推断：AI 只按分类 id 归属（上表），其余桶仍走关键词规则。
 * 全局场景切换靠它圈抽样范围。
 */
function inferGraphBucket(site: FlatSite): GraphNode['category'] {
  if (site.categoryId && AI_CATEGORY_IDS.has(site.categoryId)) return 'ai'
  const catStr = `${site.categoryId || ''} ${(site.tags || []).join(' ')}`.toLowerCase()
  if (catStr.includes('design') || catStr.includes('设计') || catStr.includes('ui')) return 'design'
  if (catStr.includes('效率') || catStr.includes('文档') || catStr.includes('笔记')) return 'efficiency'
  return 'dev'
}

export function EcosystemGraph() {
  // ?category= 入口（首页/分类页的「查看该领域技术生态图谱」按钮带过来）：
  // 用 useSearchParams 读，参数变化时重拉重算；不用 window.location 一次性读
  // （客户端导航换参数时不刷新页面，一次性读会读到旧值，等于假跳转）。
  const searchParams = useSearchParams()
  const router = useRouter()
  const categoryParam = searchParams.get('category')
  /** 分类域焦点：命中时只展示该分类自己的站点；null = 全局视图 */
  const [focusedCategory, setFocusedCategory] = useState<GraphCategoryFocus | null>(null)
  const [activeCategory, setActiveCategory] = useState<'all' | 'dev' | 'design' | 'ai' | 'efficiency'>('all')
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  /** 拖拽平移用 rAF 合帧：mousemove 每帧最多触发一次 setPan，避免大 SVG 每事件全量重渲染 */
  const dragRafRef = useRef<number | null>(null)
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null)

  const [edges, setEdges] = useState<GraphEdge[]>(DEFAULT_EDGES)
  const [liveCount, setLiveCount] = useState(0)
  /**
   * 本次 live 视图的抽样母体大小（全局 = 全库站点数 / 分类域 = 该分类站点数）。
   * 角标「非全量 N 站」的 N 必须取它：写死总数一改库就失真
   * （2026-11-11 实测：库已 334 站，角标 title 仍写 314）。
   * liveCount === liveTotal 时是全量展示，角标与 title 都不许再写「非全量」。
   */
  const [liveTotal, setLiveTotal] = useState(0)
  /** 图谱数据来源：'live' = 真实站点库；'sample' = 内置示例集（必须在界面上如实标注） */
  const [dataSource, setDataSource] = useState<'live' | 'sample' | 'loading'>('loading')
  /** 全站展平数据（navigation.json 392 站）：抽样母体 + 全站检索池，取到后常驻 */
  const [allSites, setAllSites] = useState<FlatSite[]>([])
  /** 换一批生态簇的轮次：同一 round 输出完全确定 */
  const [sampleRound, setSampleRound] = useState(0)
  /** 平替雷达中心：非 null 时画布只展示该站的一跳子图 */
  const [radarCenter, setRadarCenter] = useState<FlatSite | null>(null)
  /** 图例过滤器：单选 toggle，再点一次取消 */
  const [legendFilter, setLegendFilter] = useState<'all' | 'opensource' | 'alternative' | 'ecosystem'>('all')
  /** 本次抽中的子簇（工具栏 chips 展示用） */
  const [clusters, setClusters] = useState<GraphCluster[]>([])
  /** 全站检索下拉 */
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchActiveIdx, setSearchActiveIdx] = useState(0)
  const searchBlurTimer = useRef<number | null>(null)

  // 键盘漫游：只有「当前节点」在 Tab 序列里，方向键按几何方向移动（见 lib/graph-nav.ts）
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const nodeRefs = useRef(new Map<string, SVGGElement>())

  // 图谱打磨轮（2026-11-21）：自动 fitView 与一跳聚焦
  /** 画布容器：ResizeObserver 量实际尺寸，fitView 据此换算安全边距 */
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  /** 用户一旦手动缩放/拖拽，就不再自动 fit（点「重置视图」恢复自动居中） */
  const [userMoved, setUserMoved] = useState(false)
  /** live 数据回填后重跑一次力导向松弛（否则新节点只按圆周摆，不舒展） */
  const [layoutNonce, setLayoutNonce] = useState(0)
  /** 力导向 45 帧跑完 = 布局收敛，可触发 fitView */
  const [layoutDone, setLayoutDone] = useState(false)
  /** hover 的节点（一跳聚焦优先于选中）与 hover 的边（浮现边胶囊） */
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null)
  /** 加载失败过的 favicon 地址：回落品牌首字母，不再反复请求 */
  const [failedIcons, setFailedIcons] = useState<ReadonlySet<string>>(new Set())
  /** zoom/pan 的 ref 镜像：补间动画读当前值，避免回调闭包过期 */
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  const viewTweenRef = useRef<number | null>(null)
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])
  useEffect(() => {
    panRef.current = pan
  }, [pan])
  useEffect(() => {
    return () => {
      if (viewTweenRef.current !== null) cancelAnimationFrame(viewTweenRef.current)
      if (dragRafRef.current !== null) cancelAnimationFrame(dragRafRef.current)
    }
  }, [])

  /** favicon 加载失败：记入失败集，节点回落品牌首字母 */
  const handleFaviconError = (src: string) => {
    setFailedIcons((prev) => {
      if (prev.has(src)) return prev
      const next = new Set(prev)
      next.add(src)
      return next
    })
  }

  // SSR/CSR 水合：节点坐标由浮点运算得出，服务端与客户端的 Number 字符串化尾差
  // 会让 React 抛出「hydrated but some attributes didn't match」告警（/graph 控制台实测）。
  // 图谱本就是纯客户端交互可视化，首屏服务端只渲染外壳与说明文案（SEO 内容），
  // 坐标相关的 SVG 推迟到挂载后再渲染——既消除水合告警，也不损失任何可索引内容。
  const [graphMounted, setGraphMounted] = useState(false)
  useEffect(() => {
    setGraphMounted(true)
  }, [])

  // 初始化带有圆周布局的节点坐标
  const [nodes, setNodes] = useState<GraphNode[]>(() => {
    const width = 900
    const height = 600
    const cx = width / 2
    const cy = height / 2

    return DEFAULT_NODES.map((n, i) => {
      const angle = (i / DEFAULT_NODES.length) * 2 * Math.PI
      const r = 180 + ((i % 3) * 70)
      return {
        ...n,
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        vx: 0,
        vy: 0,
      }
    })
  })


  /**
   * 动态对接中枢真实站点库并基于标签共现推导拓扑连线。
   *
   * 数据源修正（2026-11-08 深度扫描 P0-4）：
   * 原实现打 `/api/hub/sites?limit=60`，该路由在鉴权模式下对匿名访客返回 401，
   * 且失败分支静默 `return` —— 于是公开页 /graph 对访客展示的一直是硬编码
   * DEFAULT_NODES，页面文案却宣称是「真实生态图谱」。这是对外承诺与事实不符。
   *
   * 现改用公开只读的 `/api/home/navigation`（`s-maxage=60`，无需鉴权），
   * 它返回完整 19 个一级类目 + 全部子分类站点。若仍然拿不到数据，
   * 用 `dataSource='sample'` 在页面上打出显式「示例数据」角标，
   * 不再让访客把内置演示集误认成真实图谱。
   *
   * 口径再修正（2026-11-11，DEV_BACKLOG A5）：此前 live 分支把抽样到的真实
   * 站点与 DEFAULT_NODES/DEFAULT_EDGES 恒定混排（真实站里与预设同 URL 的
   * 还会被预设顶替），标着 live 却分不清哪些是真数据。现改为：拿到真实
   * 数据时图中只有真实节点与真实推导边，预设集仅在拿不到数据时作示例
   * 兜底（dataSource='sample'，角标明示）。
   */
  useEffect(() => {
    let cancelled = false
    fetch('/api/home/navigation')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return
        if (!data) {
          setLiveTotal(0)
          setDataSource('sample')
          return
        }

        // 展平 20 个一级类目（含直属站点与子分类站点）为统一站点列表
        const flat: Array<{ id: string; title: string; href: string; description?: string; tags?: string[]; categoryId?: string }> = []
        const cats = Array.isArray(data.navigationItems) ? data.navigationItems : []
        for (const cat of cats) {
          if (cat?.enabled === false) continue
          const pushItems = (items: any[] | undefined, catId: string) => {
            for (const it of items || []) {
              if (!it || it.enabled === false || !it.href || !it.title) continue
              flat.push({
                id: String(it.id),
                title: String(it.title),
                href: String(it.href),
                description: it.description,
                tags: Array.isArray(it.tags) ? it.tags : [],
                categoryId: catId,
              })
            }
          }
          pushItems(cat.items, String(cat.id))
          for (const sub of cat.subCategories || []) {
            if (sub?.enabled === false) continue
            pushItems(sub.items, String(sub.id))
          }
        }

        // 入口参数 ?category={中枢分类 id}：按 id 精确匹配一级/二级分类
        // （lib/graph-category.ts 的 resolveGraphCategory，不猜标题关键词——
        // 旧实现按标题猜桶：14 个一级分类里 7 个没有任何关键词能命中，点进来
        // 仍是「全部」，等于假跳转）。匹配不上、被禁用时返回 null，保持全局视图。
        const activeFocus = resolveGraphCategory(categoryParam, cats)
        setFocusedCategory(activeFocus)

        if (flat.length === 0) {
          setLiveTotal(0)
          setFocusedCategory(null)
          setDataSource('sample')
          return
        }

        // 取到数据后只存全量展平表：抽样（Cluster-First，见下面的采样 effect）
        // 按当前 scope（分类域 / 场景桶 / 换一批轮次）统一做，场景切换与换簇
        // 不用重新拉网。dataSource 先回到 loading，等采样 effect 落盘后再置 live。
        setDataSource('loading')
        setAllSites(flat)
      })
      .catch(() => {
        // 拉不到数据：保留内置静态图谱保证可视化不空白，但把「示例数据」如实标注出来
        if (!cancelled) {
          setLiveTotal(0)
          setDataSource('sample')
        }
      })
    return () => {
      cancelled = true
    }
  }, [categoryParam])

  /**
   * 抽样 effect（Cluster-First，算法见 lib/graph-cluster.ts）：
   * 取数只拉一次，之后 scope（分类域 / 场景桶）、换一批轮次、雷达中心任一
   * 变化都只重抽样。母体 = allSites（navigation.json 全量展平）。
   * 标识说明：graph-live-purity.test.ts 钉死 `dynamicNodes / positioned /
   * extraEdges / setLiveTotal(scopeFlat.length)` 这几个名字，本 effect 保持原样。
   */
  const MAX_NODES = 24
  useEffect(() => {
    if (dataSource === 'sample') return
    if (allSites.length === 0) return

    // scope：分类域（?category=）圈成员 id；否则按场景桶圈范围。
    const scopeFlat = focusedCategory
      ? allSites.filter((s) => focusedCategory.memberIds.includes(s.categoryId ?? ''))
      : activeCategory === 'all'
        ? allSites
        : allSites.filter((s) => inferGraphBucket(s) === activeCategory)
    if (scopeFlat.length === 0) {
      // 分类命中了、但 live 数据里 0 站点时不假装过滤成功：清掉焦点、退回
      // 全局重抽（全局母体非空，一定能抽出来，不再退回示例态）。
      setFocusedCategory(null)
      return
    }

    // 雷达：中心 + 全图一跳邻居；否则 Cluster-First 抽样。
    let sampledSites: FlatSite[]
    let derivedEdges: ClusterEdge[]
    let clusterList: GraphCluster[] = []
    if (radarCenter) {
      const ego = egoSubgraph(allSites, radarCenter.id)
      if (!ego) {
        setRadarCenter(null)
        return
      }
      sampledSites = ego.sites
      derivedEdges = ego.edges
    } else {
      const sample = sampleClusterFirst(scopeFlat, { target: MAX_NODES, round: sampleRound })
      sampledSites = sample.sites
      derivedEdges = sample.edges
      clusterList = sample.clusters
    }

    /*
     * 2026-11-22 图谱视觉解耦：边由同一份站点输入经 buildGraphEdges 生成，
     * 与节点数据同源，避免「抽样返回的边」与「当前节点集合」漂移。
     * topologyInputs 只含边计算需要的字段（id / href / description / tags / categoryId）。
     */
    const topologyInputs = sampledSites.map((s) => ({
      id: s.id,
      href: s.href,
      title: s.title,
      description: s.description,
      tags: s.tags,
      categoryId: s.categoryId,
    }))
    derivedEdges = buildGraphEdges(topologyInputs)

    // live 口径：只按真实站点自身去重，不再拿预设集顶替同 URL 的真实站；
    // 开源标记从标签推导（标签含「开源」即开源，图例「只看开源」才有得筛）。
    const seenUrls = new Set<string>()
    const dynamicNodes: GraphNode[] = []

    for (const s of sampledSites) {
      const normUrl = s.href.replace(/\/$/, '').toLowerCase()
      if (seenUrls.has(normUrl)) continue
      seenUrls.add(normUrl)

      const nodeId = `db_${s.id}`
      dynamicNodes.push({
        id: nodeId,
        title: s.title.slice(0, 24),
        url: s.href,
        category: inferGraphBucket(s),
        description: String(s.description || s.href),
        openSource: (s.tags || []).some((t) => String(t).toLowerCase() === '开源'),
      })
    }

    if (dynamicNodes.length === 0) {
      setLiveTotal(0)
      setDataSource('sample')
      return
    }

    const width = 900
    const height = 600
    const cx = width / 2
    const cy = height / 2

    // 雷达：中心居中、邻居环绕；抽样：圆周布局（同簇在 sampledSites 里相邻）。
    const positioned = dynamicNodes.map((n, i) => {
      if (radarCenter && n.id === `db_${radarCenter.id}`) {
        return { ...n, x: cx, y: cy, vx: 0, vy: 0 }
      }
      if (radarCenter) {
        const others = dynamicNodes.filter((d) => d.id !== `db_${radarCenter.id}`)
        const idx = others.findIndex((d) => d.id === n.id)
        const angle = (idx / Math.max(1, others.length)) * 2 * Math.PI
        const r = 200
        return {
          ...n,
          x: cx + r * Math.cos(angle),
          y: cy + r * Math.sin(angle),
          vx: 0,
          vy: 0,
        }
      }
      const angle = (i / dynamicNodes.length) * 2 * Math.PI
      const r = 170 + ((i % 4) * 65)
      return {
        ...n,
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        vx: 0,
        vy: 0,
      }
    })

    // 只在真实节点之间取诱导边（平替边 + 生态边均由 lib/graph-cluster.ts
    // 在母体上算好），不再连向预设节点。
    const extraEdges: GraphEdge[] = derivedEdges
      .map((e) => ({
        source: `db_${e.source}`,
        target: `db_${e.target}`,
        type: e.type,
        label: e.label,
      }))
      .filter(
        (e) =>
          dynamicNodes.some((n) => n.id === e.source) &&
          dynamicNodes.some((n) => n.id === e.target),
      )

    setNodes(positioned)
    setEdges(extraEdges)
    setLiveCount(dynamicNodes.length)
    setLiveTotal(scopeFlat.length)
    setDataSource('live')
    setClusters(clusterList)
    // 新节点已按圆周摆好：重跑一次力导向松弛再 fitView（否则只按圆周摆，不舒展）。
    // 采样 effect 取代了旧的 fetch 内联抽样，原先 fetch 尾的 setLayoutNonce 随之迁到此处。
    setLayoutNonce((v) => v + 1)
    // 雷达：选中中心节点打开抽屉；抽样切换：清掉已不在图里的选中。
    if (radarCenter) {
      const centerNode = positioned.find((n) => n.id === `db_${radarCenter.id}`)
      if (centerNode) setSelectedNode(centerNode)
    } else {
      setSelectedNode((prev) => (prev && positioned.some((n) => n.id === prev.id) ? prev : null))
    }
  }, [allSites, focusedCategory, activeCategory, sampleRound, radarCenter, dataSource])

  // 简易力导引松弛算法（使得连接更舒展）
  // layoutNonce 变化时重跑：live 数据回填替换了节点集，旧坐标只按圆周摆，
  // 不重跑就永远是初始圆环。45 帧跑完标记 layoutDone，触发 fitView。
  useEffect(() => {
    let frameId: number
    let iter = 0
    setLayoutDone(false)

    const step = () => {
      if (iter > 45) {
        setLayoutDone(true)
        return
      }
      iter++

      setNodes((prevNodes) => {
        const next = prevNodes.map((n) => ({ ...n }))
        const width = 900
        const height = 600
        const cx = width / 2
        const cy = height / 2

        // 斥力
        for (let i = 0; i < next.length; i++) {
          for (let j = i + 1; j < next.length; j++) {
            const dx = (next[i]!.x || 0) - (next[j]!.x || 0)
            const dy = (next[i]!.y || 0) - (next[j]!.y || 0)
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            if (dist < 150) {
              const force = (150 - dist) * 0.05
              const fx = (dx / dist) * force
              const fy = (dy / dist) * force
              next[i]!.x! += fx
              next[i]!.y! += fy
              next[j]!.x! -= fx
              next[j]!.y! -= fy
            }
          }
          // 向心引力
          next[i]!.x! += (cx - next[i]!.x!) * 0.01
          next[i]!.y! += (cy - next[i]!.y!) * 0.01
        }
        return next
      })

      frameId = requestAnimationFrame(step)
    }

    step()
    return () => cancelAnimationFrame(frameId)
  }, [layoutNonce])

  // 容器尺寸监听：窗口缩放时重算 fitView（用户手动移动过视图时不自动抢回）
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setContainerSize({ w: r.width, h: r.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 过滤后的节点与连线
  const filteredNodes = useMemo(() => {
    return nodes.filter((n) => {
      // 分类域不按桶过滤：非技术类站点按关键词全落 dev 桶，筛一下就空了。
      // 分类域的范围已由抽样（scopeFlat）保证，这里只放行。
      // 雷达模式也不按桶过滤：一跳子图天然跨桶。
      // 注意：搜索框不再筛画布（它现在是全站检索，选中后进雷达），画布只按场景/图例过滤。
      const catMatch = radarCenter ? true : focusedCategory ? true : activeCategory === 'all' || n.category === activeCategory
      // 图例过滤器「只看开源」：只要开源节点（边类过滤在 visibleEdges 里做）。
      const legendMatch = legendFilter === 'opensource' ? !!n.openSource : true
      return catMatch && legendMatch
    })
  }, [nodes, activeCategory, legendFilter, focusedCategory, radarCenter])

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes])

  /** 方向键：把焦点搬到该方向上最接近的可见节点 */
  const moveNodeFocus = (fromId: string, direction: GraphDirection) => {
    const next = nextNodeInDirection(navPoints, fromId, direction)
    if (!next) return
    setFocusedNodeId(next.id)
    nodeRefs.current.get(next.id)?.focus()
  }

  const handleNodeKeyDown = (event: React.KeyboardEvent<SVGGElement>, node: GraphNode) => {
    if (isActivationKey(event.key)) {
      event.preventDefault()
      setSelectedNode(node)
      return
    }
    const direction = directionFromKey(event.key)
    if (!direction) return
    event.preventDefault()
    moveNodeFocus(node.id, direction)
  }

  const visibleEdges = useMemo(() => {
    return edges.filter((e) => {
      if (!filteredNodeIds.has(e.source) || !filteredNodeIds.has(e.target)) return false
      // 图例过滤器「仅看平替关系 / 仅看生态链路」：只留该类边。
      if (legendFilter === 'alternative' && e.type !== 'alternative') return false
      if (legendFilter === 'ecosystem' && e.type !== 'ecosystem') return false
      return true
    })
  }, [edges, filteredNodeIds, legendFilter])

  /** 边类过滤激活时，没有该类连线的节点也一并隐藏（否则满屏孤岛）；
   * 选中节点与雷达中心节点保留（抽屉正指着它们）。 */
  const displayNodes = useMemo(() => {
    if (legendFilter !== 'alternative' && legendFilter !== 'ecosystem') return filteredNodes
    const hasEdge = new Set<string>()
    for (const e of visibleEdges) {
      hasEdge.add(e.source)
      hasEdge.add(e.target)
    }
    return filteredNodes.filter(
      (n) =>
        hasEdge.has(n.id) ||
        selectedNode?.id === n.id ||
        (radarCenter !== null && n.id === `db_${radarCenter.id}`),
    )
  }, [filteredNodes, visibleEdges, legendFilter, selectedNode, radarCenter])

  // 键盘导航用的几何点集；以及「漫游 tabindex」当前的落点（被筛掉的节点会自动回落）。
  // 注意：必须放在 displayNodes 之后——它依赖 displayNodes，写在前面会触发
  // TS2448/TS2454（use before declaration），上轮只跑 vitest 未做类型检查故未发现。
  const navPoints = useMemo(
    () => displayNodes.map((n) => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0 })),
    [displayNodes],
  )
  const rovingId = useMemo(() => rovingNodeId(displayNodes, focusedNodeId), [displayNodes, focusedNodeId])

  /** 全站检索：搜全部收录站点（allSites），不是当前抽样的 24 站 */
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    return searchGraphSites(allSites, searchQuery, 8)
  }, [allSites, searchQuery])

  /** 选中检索结果 → 平替雷达：以该站为中心拉一跳子图并打开抽屉 */
  const enterRadar = useCallback((site: FlatSite) => {
    if (searchBlurTimer.current !== null) {
      window.clearTimeout(searchBlurTimer.current)
      searchBlurTimer.current = null
    }
    setSearchQuery('')
    setSearchOpen(false)
    setLegendFilter('all')
    setRadarCenter(site)
  }, [])

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!searchOpen) {
        setSearchOpen(true)
        return
      }
      const dir = event.key === 'ArrowDown' ? 1 : -1
      setSearchActiveIdx((i) => {
        if (searchResults.length === 0) return 0
        const next = i + dir
        if (next < 0) return searchResults.length - 1
        if (next >= searchResults.length) return 0
        return next
      })
      return
    }
    if (event.key === 'Enter') {
      const hit = searchResults[searchActiveIdx]
      if (hit) {
        event.preventDefault()
        enterRadar(hit)
      }
      return
    }
    if (event.key === 'Escape') {
      setSearchOpen(false)
    }
  }

  /** 场景切换：分类域里点场景 = 切回全局场景（与「查看全部」同一语义） */
  const handleSceneClick = (cat: 'all' | 'dev' | 'design' | 'ai' | 'efficiency') => {
    setSelectedNode(null)
    setRadarCenter(null)
    if (focusedCategory) {
      // 先本地清掉焦点即刻重抽，再把 URL 写回 /graph（刷新后不再跳回分类）。
      setFocusedCategory(null)
      router.replace('/graph')
    }
    setActiveCategory(cat)
  }

  /** 节点连接度（可见边）：半径分档与 fitView 包围盒共用 */
  const degreeMap = useMemo(
    () => computeNodeDegrees(visibleEdges, filteredNodeIds),
    [visibleEdges, filteredNodeIds],
  )

  /**
   * 一跳聚焦（Ego-Network Highlight）：hover 优先于选中。
   * focusId 为 null 时全图正常显示；有焦点时只留它与一跳邻居，其余淡化。
   */
  const focusId = hoveredNodeId ?? selectedNode?.id ?? null
  const neighborIds = useMemo(() => {
    if (!focusId) return null
    const s = new Set<string>([focusId])
    for (const e of visibleEdges) {
      if (e.source === focusId) s.add(e.target)
      else if (e.target === focusId) s.add(e.source)
    }
    return s
  }, [focusId, visibleEdges])

  /**
   * 视图补间：350ms 缓动从当前 zoom/pan 平滑过渡到目标值。
   * applyFit 与窄屏「点节点放大到可读」共用同一段动画。
   */
  const tweenView = useCallback((targetZoom: number, targetPan: { x: number; y: number }) => {
    if (viewTweenRef.current !== null) {
      cancelAnimationFrame(viewTweenRef.current)
      viewTweenRef.current = null
    }
    const startZoom = zoomRef.current
    const startPan = panRef.current
    const start = performance.now()
    const duration = 350
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setZoom(startZoom + (targetZoom - startZoom) * eased)
      setPan({
        x: startPan.x + (targetPan.x - startPan.x) * eased,
        y: startPan.y + (targetPan.y - startPan.y) * eased,
      })
      if (t < 1) {
        viewTweenRef.current = requestAnimationFrame(tick)
      } else {
        viewTweenRef.current = null
      }
    }
    viewTweenRef.current = requestAnimationFrame(tick)
  }, [])

  /**
   * 自动 fitView：算出全部可见节点（含文字包围盒）的并集，按画布实际宽高比
   * 缩放并居中，强制预留 56px 四周安全边距，彻底杜绝裁切。
   * animate=true 时用 350ms 缓动从当前视图平滑过渡过去。
   *
   * U-399 窄屏（<768px）：fit-all 在 390px 上会把节点压到约 5.4px、标签约 2.1px，
   * 既读不了也点不中。窄屏改走「可读缩放」：zoom 下限按最小节点直径 ≥24px
   * 反推（约 1.98），视图中心对准连接度最高的可见节点（环形布局的包围盒
   * 中心是空心，定在节点上首屏中央才有可点的东西）。桌面（≥768px）不传
   * 任何新参数，fit 数学与旧版逐字节一致。
   */
  const applyFit = useCallback(
    (animate: boolean) => {
      const el = containerRef.current
      if (!el || filteredNodes.length === 0) return
      const rect = el.getBoundingClientRect()
      if (rect.width < 10 || rect.height < 10) return
      const box = graphContentBox(
        filteredNodes,
        (i) => nodeRadiusForDegree(degreeMap.get(filteredNodes[i]!.id) ?? 0),
        (i) => truncateGraphLabel(filteredNodes[i]!.title),
      )
      if (!box) return
      const isNarrow = rect.width < GRAPH_NARROW_CONTAINER_PX
      let target: { zoom: number; pan: { x: number; y: number } }
      if (isNarrow) {
        // 焦点 = 连接度最高的可见节点（并列取先者，结果稳定）；没有边时取首个节点。
        let focusNode = filteredNodes[0]!
        let focusDegree = -1
        for (const n of filteredNodes) {
          const d = degreeMap.get(n.id) ?? 0
          if (d > focusDegree) {
            focusDegree = d
            focusNode = n
          }
        }
        target = computeGraphFit(box, rect.width, rect.height, {
          minReadableZoom: computeGraphReadableFloor(
            rect.width,
            rect.height,
            GRAPH_MIN_NODE_RADIUS,
          ),
          focusPoint: { x: focusNode.x ?? 450, y: focusNode.y ?? 300 },
        })
      } else {
        target = computeGraphFit(box, rect.width, rect.height)
      }
      if (!animate) {
        setZoom(target.zoom)
        setPan(target.pan)
        return
      }
      tweenView(target.zoom, target.pan)
    },
    [filteredNodes, degreeMap, tweenView],
  )

  // 自动 fitView 触发点：布局收敛后、可见集变化（筛选/搜索/分类域）后、
  // 容器尺寸变化（窗口缩放）后——只要用户没手动移动过视图。
  useEffect(() => {
    if (userMoved || !graphMounted || !layoutDone) return
    const t = window.setTimeout(() => applyFit(true), 150)
    return () => window.clearTimeout(t)
  }, [filteredNodes, containerSize, layoutDone, userMoved, graphMounted, applyFit])

  // 当前选中节点的所有关联
  const relatedEdges = useMemo(() => {
    if (!selectedNode) return []
    return edges.filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
  }, [edges, selectedNode])

  /** 窄屏标志（容器实测宽 <768）：缩放按钮上限 2→3、底部手势提示只在窄屏出现 */
  const isNarrowView =
    containerSize.w !== 0 && containerSize.w < GRAPH_NARROW_CONTAINER_PX

  // U-399：画布手势统一走 Pointer Events（鼠标/触摸/触控笔同一套）。
  // 旧版只有 onMouseDown/Move/Up，手机上手指拖动收不到任何事件，画布拖不动、
  // 捏合也没有。单指 = 平移（沿用旧版 1:1 client px 口径，桌面拖拽手感不变），
  // 双指 = 捏合缩放 + 跟手平移（纯函数 pinchGraphView，见 lib/graph-polish.ts）。
  // 刻意不用 setPointerCapture：capture 会把 click 重定向到容器，节点点选会被吞；
  // 手指滑出画布时 onPointerLeave 收尾，isDragging 不会卡住。
  const pointersRef = useRef(
    new Map<number, { x: number; y: number; downX: number; downY: number }>(),
  )
  const pinchRef = useRef<null | {
    startDist: number
    startZoom: number
    startPan: { x: number; y: number }
    startMidVb: { x: number; y: number }
  }>(null)
  /** 本次手势是否真的移动过（>4px）：节点 onClick 靠它区分「点按」与「拖完松手」 */
  const dragMovedRef = useRef(false)

  const endPointerGesture = useCallback(() => {
    isDraggingRef.current = false
    pinchRef.current = null
    pointersRef.current.clear()
  }, [])

  const handlePointerDown = (e: React.PointerEvent) => {
    pointersRef.current.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      downX: e.clientX,
      downY: e.clientY,
    })
    dragMovedRef.current = false
    if (pointersRef.current.size === 2) {
      // 第二指落下：由单指拖拽切到双指捏合（落点是否在节点上不影响捏合）
      isDraggingRef.current = false
      const pts = [...pointersRef.current.values()]
      const rect = containerRef.current?.getBoundingClientRect()
      const midClient = { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 }
      pinchRef.current = {
        startDist: Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y),
        startZoom: zoomRef.current,
        startPan: panRef.current,
        startMidVb: rect
          ? toGraphViewBoxPoint(midClient.x, midClient.y, rect)
          : { x: 450, y: 300 },
      }
      return
    }
    // 与旧版鼠标守卫同口径：只在非节点圆点处起拖（点节点圆点走 onClick 选节点）；
    // 触摸/触控笔落在节点上时先不拖，移动超 8px 再升级为拖拽（见 handlePointerMove），
    // 否则手指从节点上起拖永远拖不动。
    if (e.target instanceof SVGElement && e.target.tagName === 'circle') return
    isDraggingRef.current = true
    dragStartRef.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    const tracked = pointersRef.current.get(e.pointerId)
    if (!tracked) return
    tracked.x = e.clientX
    tracked.y = e.clientY
    if (pointersRef.current.size === 2 && pinchRef.current) {
      const pts = [...pointersRef.current.values()]
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const midClient = { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 }
      const next = pinchGraphView({
        startZoom: pinchRef.current.startZoom,
        startPan: pinchRef.current.startPan,
        startMidVb: pinchRef.current.startMidVb,
        startDist: pinchRef.current.startDist,
        currentMidVb: toGraphViewBoxPoint(midClient.x, midClient.y, rect),
        currentDist: Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y),
        minZoom: 0.5,
        maxZoom: isNarrowView ? 3 : 2,
      })
      if (Math.hypot(e.clientX - tracked.downX, e.clientY - tracked.downY) > 4) {
        dragMovedRef.current = true
      }
      // 真正移动才算手动移动：光点下不算，避免一次点击就关掉自动 fit
      setUserMoved(true)
      setZoom(next.zoom)
      setPan(next.pan)
      return
    }
    if (!isDraggingRef.current) {
      // 触摸/触控笔从节点圆点上起拖：移动超 8px 升级为拖拽（落点锚定，不跳变）；
      // 鼠标沿用旧版行为（圆点上起拖恒不拖），桌面行为不变。
      if (e.pointerType === 'mouse') return
      if (Math.hypot(e.clientX - tracked.downX, e.clientY - tracked.downY) <= 8) return
      isDraggingRef.current = true
      dragStartRef.current = { x: tracked.downX - panRef.current.x, y: tracked.downY - panRef.current.y }
    }
    if (Math.hypot(e.clientX - tracked.downX, e.clientY - tracked.downY) > 4) {
      dragMovedRef.current = true
    }
    // 真正拖动才算手动移动：光点下不算，避免一次点击就关掉自动 fit
    setUserMoved(true)
    const next = {
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    }
    pendingPanRef.current = next
    // 一帧内多次 mousemove 只提交最后一次；队列里已有帧就攒着不重复排。
    if (dragRafRef.current !== null) return
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = null
      if (pendingPanRef.current) setPan(pendingPanRef.current)
      pendingPanRef.current = null
    })
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId)
    // main eeca6c14 的 rAF 收尾（原 handleMouseUp）：松手时冲刷最后一帧，否则指针停在
    // 两帧之间、画面落后一个位置；放在分支前，全松开与捏合剩一指接管两条出路都经过它。
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current)
      dragRafRef.current = null
    }
    if (pendingPanRef.current) {
      setPan(pendingPanRef.current)
      pendingPanRef.current = null
    }
    if (pointersRef.current.size === 0) {
      isDraggingRef.current = false
      pinchRef.current = null
      return
    }
    // 捏合剩一指：该指无缝接管为单指拖拽（落点锚定，不跳变）
    pinchRef.current = null
    const remaining = [...pointersRef.current.values()][0]!
    isDraggingRef.current = true
    dragStartRef.current = { x: remaining.x - panRef.current.x, y: remaining.y - panRef.current.y }
  }

  /**
   * 节点点选：选中 + 窄屏下若缩放低于可读下限，单点一次把该节点居中放大
   * 到可读缩放（直径 ≥24px、标签 ≥9px）。拖完松手触发的 click 只选中、
   * 不缩放；桌面（≥768px）只选中，行为与旧版一致。
   */
  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      setSelectedNode(node)
      const wasDrag = dragMovedRef.current
      dragMovedRef.current = false
      if (wasDrag) return
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.width >= GRAPH_NARROW_CONTAINER_PX) return
      const floor = computeGraphReadableFloor(rect.width, rect.height, GRAPH_MIN_NODE_RADIUS)
      if (zoomRef.current >= floor) return
      tweenView(floor, {
        x: 900 / 2 - (node.x ?? 450) * floor,
        y: 600 / 2 - (node.y ?? 300) * floor,
      })
    },
    [tweenView],
  )

  return (
    <main
      id="main-content"
      className="relative w-full h-[calc(100vh-64px)] overflow-hidden bg-background select-none flex flex-col"
    >
      {/* 顶部控制栏：固定 2 行（第 1 行标题 + 场景胶囊，第 2 行图例过滤 + 换簇 + 搜索 + 缩放），
          行内超宽时组内横向滚动、不换行，画布始终占满剩余视口高度 */}
      <div className="border-b border-border/60 glass-surface subtle-mesh z-20 shadow-xs">
        {/* 第 1 行：返回 + 标题/徽章 + 场景胶囊（分类域里也展示，点场景即切回全局场景） */}
        <div className="flex items-center gap-3 px-3 sm:px-6 pt-2 pb-1.5">
          <div className="flex items-center gap-3 min-w-0 shrink-0">
            <Button asChild variant="ghost" size="sm" className="gap-1.5 text-xs h-8 border border-border/50 hover:bg-background/80 shrink-0">
              <Link href="/">
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>返回导航</span>
              </Link>
            </Button>
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm sm:text-base font-bold flex items-center gap-2 flex-wrap">
                  <span className="whitespace-nowrap">工具链关系图谱与平替雷达</span>
                  <Badge variant="outline" className="hidden sm:inline-flex text-xs text-indigo-500 border-indigo-500/30 font-mono">
                    Poincaré Graph v5.0
                  </Badge>
                  {/*
                    数据来源必须如实标注（2026-11-08 深度扫描 P0-4）：
                    「真实站点库」与「内置示例集」是两种性质完全不同的结果，
                    不标注就等于让访客把演示数据当成全网图谱。
                  */}
                  {dataSource === 'live' && liveCount > 0 && !radarCenter && (
                    <Badge
                      variant="outline"
                      className="text-xs font-mono text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                      title={
                        liveCount < liveTotal
                          ? `图中节点 = ${liveCount} 个站内真实站点（子簇优先抽样，非全量 ${liveTotal} 站）；连线为按共享标签推导的平替关系与同子分类的生态关联，不是人工录入的关系${clusters.length > 0 ? `；本次生态簇：${clusters.map((c) => c.label).join('、')}` : ''}`
                          : `图中节点 = ${liveCount} 个站内真实站点（已全部展示，共 ${liveTotal} 站）；连线为按共享标签推导的平替关系与同子分类的生态关联，不是人工录入的关系`
                      }
                    >
                      {liveCount < liveTotal
                        ? `实时抽样 ${liveCount} 站（真实站点，非全量）`
                        : `实时 ${liveCount} 站（真实站点，全部展示）`}
                    </Badge>
                  )}
                  {radarCenter && (
                    <Badge
                      variant="outline"
                      className="text-xs font-mono text-indigo-700 dark:text-indigo-300 border-indigo-500/30"
                    >
                      平替雷达 · 以「{radarCenter.title}」为中心
                    </Badge>
                  )}
                  {dataSource === 'sample' && (
                    <Badge
                      variant="outline"
                      className="text-xs font-mono text-amber-700 dark:text-amber-400 border-amber-500/40"
                      title="未能读取站点库，当前展示的是内置示例节点集，不代表真实收录情况"
                    >
                      示例数据（未接入站点库）
                    </Badge>
                  )}
                </h1>
              </div>
            </div>
          </div>

          {/* 场景胶囊：全部 / 研发全栈 / UI & 设计 / AI 实验室 / 效率创作。
              分类域里也展示（旧实现只在全局展示，?category= 进来就看不到，等于功能缺失）；
              点场景即重新抽样该场景子集，分类域里点场景先切回全局。 */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar touch-pan-x p-1 rounded-xl bg-muted/40 border border-border/50 min-w-0 flex-1" role="group" aria-label="场景切换">
            {(['all', 'dev', 'design', 'ai', 'efficiency'] as const).map((cat) => (
              <Button
                key={cat}
                size="sm"
                variant={activeCategory === cat ? 'default' : 'ghost'}
                aria-pressed={activeCategory === cat}
                className="h-7 text-xs px-2.5 rounded-lg transition-all shrink-0"
                onClick={() => handleSceneClick(cat)}
              >
                {cat === 'all' ? '全部' : CATEGORY_COLORS[cat].name}
              </Button>
            ))}
          </div>
        </div>

        {/* 第 2 行：图例过滤器 + 本次生态簇 + 换一批 + 搜索 + 缩放 */}
        <div className="flex items-center gap-2 px-3 sm:px-6 pb-2 pt-0.5">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar min-w-0 flex-1">
            {/* 图例升级为可点击过滤器：再点一次取消 */}
            <div className="flex items-center gap-1 shrink-0" role="group" aria-label="图例过滤">
              {([
                { key: 'alternative' as const, label: '平替候选', swatch: <span className="w-3 h-0.5 border-b-2 border-dashed border-pink-500" /> },
                { key: 'ecosystem' as const, label: '生态链路', swatch: <span className="w-3 h-0.5 bg-indigo-500" /> },
                { key: 'opensource' as const, label: '开源', swatch: <span className="w-2 h-2 rounded-full bg-emerald-500" /> },
              ]).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={legendFilter === item.key}
                  title={legendFilter === item.key ? `取消「只看${item.label}」过滤` : `只看${item.label}`}
                  onClick={() => setLegendFilter((f) => (f === item.key ? 'all' : item.key))}
                  className={`flex items-center gap-1 h-7 px-2 rounded-lg text-xs font-mono whitespace-nowrap border transition-all ${legendFilter === item.key ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-transparent hover:bg-muted/60'}`}
                >
                  {item.swatch}
                  {legendFilter === item.key ? `只看${item.label}` : item.label}
                </button>
              ))}
            </div>

            {/* 本次抽中的生态簇（悬停看成员） */}
            {clusters.length > 0 && !radarCenter && (
              <div className="flex items-center gap-1 shrink-0" aria-label="本次生态簇">
                {clusters.map((c) => (
                  <span
                    key={c.key}
                    title={`「${c.label}」成员：${c.siteIds.map((id) => nodeMap.get(`db_${id}`)?.title || id).join('、')}`}
                    className="inline-flex items-center h-6 px-2 rounded-full text-[11px] font-medium bg-violet-500/10 text-violet-700 dark:text-violet-300 border border-violet-500/25 whitespace-nowrap"
                  >
                    {c.label}·{c.siteIds.length}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/*
            M-03：换一批按钮必须放在横向滚动条带之外（shrink-0 直属第 2 行）。
            原先它在 overflow-x-auto 条带内，chips 异步落定后被推到 x≈551，
            768 视口下条带可视宽不足、按钮被裁出可视区，中心还被搜索框覆盖，
            真实点击 5 次图都不变；390 视口同样被裁到视口外。移出条带后按钮
            位置不再随 chips 落定而移位（O-B04 的异步移位只影响条带内部），
            各视口始终完整可见、可点。抽样逻辑本身未动。
          */}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-2.5 rounded-lg shrink-0 gap-1.5"
            title="重新抽取另一批高连通生态簇（同类簇结构，不退回随机抽样）"
            disabled={radarCenter !== null || dataSource !== 'live'}
            onClick={() => { setSampleRound((r) => r + 1); setSelectedNode(null); }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            换一批生态簇
          </Button>

          {/* 全站检索：搜全部收录站点，选中后进入平替雷达 */}
          <div className="relative w-28 sm:w-40 md:w-48 shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-muted-foreground" />
            <Input aria-label="搜索图谱节点"
              placeholder="搜索图谱节点..."
              value={searchQuery}
              role="combobox"
              aria-expanded={searchOpen && searchResults.length > 0}
              aria-controls="graph-search-listbox"
              aria-activedescendant={searchOpen && searchResults.length > 0 ? `graph-search-opt-${searchActiveIdx}` : undefined}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); setSearchActiveIdx(0) }}
              onKeyDown={handleSearchKeyDown}
              onFocus={() => { if (searchQuery.trim()) setSearchOpen(true) }}
              onBlur={() => {
                searchBlurTimer.current = window.setTimeout(() => setSearchOpen(false), 150)
              }}
              className="h-8 pl-8 text-xs border-border/60 bg-background/80"
            />
            {searchOpen && searchQuery.trim() !== '' && (
              <div id="graph-search-listbox" role="listbox" aria-label="全站检索结果" className="absolute left-0 top-full mt-1 w-72 max-w-[80vw] rounded-xl border border-border/70 bg-background shadow-2xl z-50 overflow-hidden">
                {searchResults.length === 0 ? (
                  <p className="px-3 py-2.5 text-xs text-muted-foreground">
                    在 {allSites.length} 个收录站点中没有找到「{searchQuery.trim()}」
                  </p>
                ) : (
                  <>
                    {searchResults.map((site, idx) => (
                      <button
                        key={site.id}
                        type="button"
                        id={`graph-search-opt-${idx}`}
                        role="option"
                        aria-selected={idx === searchActiveIdx}
                        onMouseDown={(e) => { e.preventDefault(); enterRadar(site) }}
                        onMouseEnter={() => setSearchActiveIdx(idx)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs ${idx === searchActiveIdx ? 'bg-primary/10' : ''}`}
                      >
                        <span className="font-medium truncate">{site.title}</span>
                        <span className="text-muted-foreground shrink-0">{CATEGORY_COLORS[inferGraphBucket(site)].name}</span>
                      </button>
                    ))}
                    <p className="px-3 py-1.5 text-[11px] text-muted-foreground border-t border-border/50">
                      站内检索 · 共 {allSites.length} 个收录站点 · 选中后进入平替雷达
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 bg-muted/30 p-0.5 rounded-lg border border-border/50 shrink-0">
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="放大" title="放大" onClick={() => { setUserMoved(true); setZoom((z) => Math.min(z + 0.15, isNarrowView ? 3 : 2)) }}>
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="缩小" title="缩小" onClick={() => { setUserMoved(true); setZoom((z) => Math.max(z - 0.15, 0.5)) }}>
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="重置视图" title="重置视图" onClick={() => { setUserMoved(false); applyFit(true) }}>
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* 分类域 / 雷达横幅：?category= 命中时只展示该分类自己的站点，点「查看全部」回到全局；
          雷达模式时展示中心站点与一跳关联数，点「退出雷达」回到抽样视图 */}
      {(focusedCategory || radarCenter) && (
        <div className="flex flex-wrap items-center gap-2 px-3 sm:px-6 py-1.5 text-xs border-b border-border/60 bg-indigo-500/5 z-20">
          {radarCenter ? (
            <>
              <span>
                平替雷达：以「{radarCenter.title}」为中心 · 一跳关联 {Math.max(0, liveCount - 1)} 站
                {liveCount <= 1 ? '（该站在全站中暂无共享标签关联）' : ''}
              </span>
              <button
                type="button"
                onClick={() => { setRadarCenter(null); setSelectedNode(null); }}
                className="font-medium text-indigo-500 hover:underline"
              >
                退出雷达
              </button>
            </>
          ) : focusedCategory ? (
            <>
              <span>正在查看「{focusedCategory.title}」分类 · 展示 {liveCount} 站</span>
              <Link href="/graph" className="font-medium text-indigo-500 hover:underline">
                查看全部
              </Link>
            </>
          ) : null}
        </div>
      )}

      {/* SVG 画布 */}
      <div
        ref={containerRef}
        /* 2026-11-21 移动端手势隔离：画布上要拖拽节点/平移视图，
           浏览器默认会把它当成页面竖滚（手势冲突，拖一下节点页面就跑了）。
           touch-none 让画布独占触摸手势。<768px 生效，桌面端不设——
           桌面端若也设 none，触控板双指滚动会失效。
           注意：图例条（下方 overflow-x-auto）仍保留 touch-pan-x，两者不冲突。 */
        className="flex-1 w-full h-full cursor-grab active:cursor-grabbing relative overflow-hidden bg-dot-grid max-md:touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={endPointerGesture}
        onPointerLeave={endPointerGesture}
      >
        {graphMounted ? (
        <svg
          className="w-full h-full"
          viewBox="0 0 900 600"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <pattern id="graph-pattern-grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="1.2" className="fill-border/50" />
            </pattern>
            {/* 节点 favicon 圆裁剪：每节点一个 clipPath（id 按节点 id 区分） */}
            {filteredNodes.map((node) => (
              <clipPath key={node.id} id={`graph-clip-${node.id}`}>
                <circle
                  r={
                    nodeRadiusForDegree(
                      degreeMap.get(node.id) ?? 0,
                      selectedNode?.id === node.id,
                    ) * 0.72
                  }
                />
              </clipPath>
            ))}
          </defs>
          <rect width="100%" height="100%" fill="url(#graph-pattern-grid)" />

          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* 连线层：常态只留线条（粉色虚线=平替，靛蓝实线=生态），
                边文字默认隐藏——hover 某条边、或 hover/选中某节点时，
                才在关联连线中点浮现高对比胶囊，避免画布文字互相打架 */}
            {visibleEdges.map((e, idx) => {
              const src = nodeMap.get(e.source)
              const tgt = nodeMap.get(e.target)
              if (!src || !tgt) return null

              const edgeKey = `${e.source}→${e.target}`
              const isConnectedToSelected =
                selectedNode && (e.source === selectedNode.id || e.target === selectedNode.id)
              const isConnectedToFocus =
                focusId !== null && (e.source === focusId || e.target === focusId)
              const isEdgeActive = hoveredEdgeKey === edgeKey || isConnectedToFocus
              const strokeColor =
                e.type === 'alternative' ? 'rgba(236, 72, 153, 0.55)' : 'rgba(99, 102, 241, 0.55)'
              const mx = ((src.x || 0) + (tgt.x || 0)) / 2
              const my = ((src.y || 0) + (tgt.y || 0)) / 2
              const capsule = edgeCapsuleText(e)
              const capsuleW = capsuleTextWidth(capsule)

              return (
                <g
                  key={idx}
                  onMouseEnter={() => setHoveredEdgeKey(edgeKey)}
                  onMouseLeave={() => setHoveredEdgeKey((k) => (k === edgeKey ? null : k))}
                >
                  {/* 加粗透明命中线：1.4px 的细线很难 hover 到，命中区扩到 14px */}
                  <line
                    x1={src.x}
                    y1={src.y}
                    x2={tgt.x}
                    y2={tgt.y}
                    stroke="transparent"
                    strokeWidth={14}
                    style={{ pointerEvents: 'stroke' }}
                  />
                  <line
                    x1={src.x}
                    y1={src.y}
                    x2={tgt.x}
                    y2={tgt.y}
                    stroke={isConnectedToSelected ? '#f43f5e' : strokeColor}
                    strokeWidth={isConnectedToSelected ? 2.5 : isConnectedToFocus ? 2.2 : 1.4}
                    strokeDasharray={e.type === 'alternative' ? '4 3' : undefined}
                    opacity={focusId ? (isConnectedToFocus ? 0.95 : 0.12) : 0.85}
                  />
                  {isEdgeActive && (
                    <g className="pointer-events-none">
                      <rect
                        x={mx - capsuleW / 2}
                        y={my - 9}
                        width={capsuleW}
                        height={18}
                        rx={9}
                        strokeWidth={1}
                        className={
                          e.type === 'alternative'
                            ? 'fill-white stroke-pink-500/70 dark:fill-slate-900'
                            : 'fill-white stroke-indigo-500/70 dark:fill-slate-900'
                        }
                      />
                      <text
                        x={mx}
                        y={my + 3.5}
                        fontSize={10}
                        textAnchor="middle"
                        className="fill-slate-800 dark:fill-slate-100 font-medium pointer-events-none"
                      >
                        {capsule}
                      </text>
                    </g>
                  )}
                </g>
              )
            })}

            {/* 节点层：favicon 优先（失败回落品牌首字母），半径按连接度分档，
                hover/选中一跳聚焦时其余节点淡化至 0.18 */}
            {displayNodes.map((n) => {
              const isSelected = selectedNode?.id === n.id
              const catColor = CATEGORY_COLORS[n.category]
              // 2026-11-22 开源改用形状通道：翠绿外环 + OS 徽标，
              // 与分类色（含新的 AI 紫）完全解耦。
              const isOpen = resolveIsOpenSource(n)
              const nodeR = nodeRadiusForDegree(degreeMap.get(n.id) ?? 0, isSelected)
              const iconSrc = resolveSiteIcon(n.url, n.title)
              const hasIcon = Boolean(iconSrc) && !failedIcons.has(iconSrc)
              const label = truncateGraphLabel(n.title)
              const isDimmed =
                focusId !== null && neighborIds !== null && !neighborIds.has(n.id)

              return (
                <g
                  key={n.id}
                  ref={(el) => {
                    if (el) nodeRefs.current.set(n.id, el)
                    else nodeRefs.current.delete(n.id)
                  }}
                  transform={`translate(${n.x}, ${n.y})`}
                  className="group cursor-pointer transition-transform focus:outline-none"
                  role="button"
                  tabIndex={rovingId === n.id ? 0 : -1}
                  aria-label={nodeAccessibleName(n.title, CATEGORY_COLORS[n.category].name)}
                  aria-pressed={isSelected}
                  onClick={() => handleNodeClick(n)}
                  onFocus={() => setFocusedNodeId(n.id)}
                  onKeyDown={(event) => handleNodeKeyDown(event, n)}
                  onMouseEnter={() => setHoveredNodeId(n.id)}
                  onMouseLeave={() => setHoveredNodeId((id) => (id === n.id ? null : id))}
                  opacity={isDimmed ? 0.18 : 1}
                  style={{ transition: 'opacity 200ms ease' }}
                >
                  {/* 完整名称：hover 原生 tooltip 与详情抽屉展示，标签只显示截断版 */}
                  <title>{n.title}</title>
                  {/* 开源外环：翠绿细环套在节点外圈，与分类填充色无关（色盲友好） */}
                  {isOpen && (
                    <circle
                      r={nodeR + 3}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth={1.6}
                      className="pointer-events-none"
                      aria-label="开源外环"
                    />
                  )}
                  {/* 键盘焦点环：只有真正聚焦（Tab / 方向键）时才出现 */}
                  <circle
                    r={nodeR + 8}
                    fill="none"
                    stroke="#60a5fa"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    className="pointer-events-none opacity-0 group-focus:opacity-100 transition-opacity"
                  />
                  <circle
                    r={nodeR}
                    fill={catColor.fill}
                    stroke={isSelected ? '#ffffff' : 'rgba(255,255,255,0.4)'}
                    strokeWidth={isSelected ? 3.5 : 1.8}
                    className="drop-shadow-md"
                  />
                  {hasIcon ? (
                    <>
                      <circle r={nodeR * 0.72} fill="#ffffff" />
                      <image
                        href={iconSrc}
                        x={-nodeR * 0.72}
                        y={-nodeR * 0.72}
                        width={nodeR * 1.44}
                        height={nodeR * 1.44}
                        preserveAspectRatio="xMidYMid slice"
                        clipPath={`url(#graph-clip-${n.id})`}
                        onError={() => handleFaviconError(iconSrc)}
                      />
                    </>
                  ) : (
                    <text
                      y={1}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={Math.round(nodeR * 0.85)}
                      fontWeight="700"
                      fill="#ffffff"
                      className="pointer-events-none select-none"
                    >
                      {extractFaviconMonogram(n.title)}
                    </text>
                  )}
                  {/* OS 徽标：开源节点右下角小标记，形状通道再加固一层 */}
                  {isOpen && (
                    <text
                      x={nodeR * 0.85}
                      y={-nodeR * 0.85}
                      textAnchor="middle"
                      fontSize="8"
                      fontWeight="700"
                      fill="#10b981"
                      className="pointer-events-none select-none"
                    >OS</text>
                  )}
                  <text
                    y={nodeR + 12}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight={isSelected ? 'bold' : '500'}
                    strokeWidth={3}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                    className="pointer-events-none select-none drop-shadow-sm font-mono fill-slate-800 stroke-white dark:fill-slate-100 dark:stroke-slate-950"
                  >
                    {label}
                  </text>
                  {n.openSource && (
                    <circle
                      cx={nodeR * 0.7}
                      cy={-nodeR * 0.7}
                      r={4.5}
                      fill="#10b981"
                      stroke="#0f172a"
                      strokeWidth="1.5"
                    />
                  )}
                </g>
              )
            })}
          </g>
        </svg>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground">
            图谱加载中…
          </div>
        )}

        {/* U-399 窄屏手势提示：首屏已是可读缩放，告诉用户单指拖动、双指捏合；不拦截点按 */}
        {graphMounted && isNarrowView && !selectedNode && (
          <div className="absolute left-2 bottom-2 z-10 pointer-events-none rounded-full bg-background/85 border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm">
            单指拖动平移 · 双指捏合缩放 · 点节点看详情
          </div>
        )}

        {/* 图例过滤空态：当前过滤下没有符合条件的节点（诚实提示，不假装有数据） */}
        {graphMounted && dataSource === 'live' && displayNodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground z-10">
            <p>当前过滤下没有符合条件的节点</p>
            <Button size="sm" variant="outline" onClick={() => setLegendFilter('all')}>
              清除过滤
            </Button>
          </div>
        )}

        {/* 右侧节点详情抽屉 */}
        {selectedNode && (
          <div className="absolute right-2 sm:right-4 top-2 sm:top-4 bottom-2 sm:bottom-4 w-full sm:w-88 max-w-[calc(100%-1rem)] sm:max-w-[calc(100%-2rem)] glass-surface subtle-mesh rounded-2xl border border-border/70 p-3.5 sm:p-5 shadow-2xl flex flex-col space-y-4 animate-in fade-in slide-in-from-right-4 z-30 overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold">{selectedNode.title}</h3>
                  <Badge variant="outline" className="text-xs border-border/70">
                    {CATEGORY_COLORS[selectedNode.category].name}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  {selectedNode.description}
                </p>
                {radarCenter && selectedNode.id === `db_${radarCenter.id}` && (
                  <p className="text-xs text-indigo-500 mt-1.5 font-medium">
                    平替雷达中心 · 一跳关联 {relatedEdges.length} 站（平替 {relatedEdges.filter((e) => e.type === 'alternative').length} · 生态 {relatedEdges.filter((e) => e.type === 'ecosystem').length}）
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 rounded-lg hover:bg-muted"
                aria-label="关闭节点详情"
                title="关闭节点详情"
                onClick={() => setSelectedNode(null)}
              >
                ✕
              </Button>
            </div>

            {selectedNode.openSource && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs border border-emerald-500/20 font-medium">
                <span>🌱 开源生态项目</span>
              </div>
            )}

            <Button
              className="w-full text-xs h-9 gap-1.5 shadow-xs font-medium"
              onClick={() => safeWindowOpen(selectedNode.url)}
            >
              <span>立即直达官方主站</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Button>

            {/* 关联网络 */}
            <div className="space-y-2.5 pt-3 border-t border-border/50 flex-1">
              <h4 className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  <span>图谱关联拓扑 ({relatedEdges.length})</span>
                </span>
                <span className="text-xs text-muted-foreground font-mono">点选或回车切换</span>
              </h4>

              <div className="space-y-2">
                {relatedEdges.map((e, idx) => {
                  const otherId = e.source === selectedNode.id ? e.target : e.source
                  const otherNode = nodeMap.get(otherId)
                  if (!otherNode) return null

                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedNode(otherNode)}
                      className="w-full text-left p-2.5 rounded-xl border border-border/60 bg-background/70 hover:bg-background/95 hover:border-primary/40 cursor-pointer transition-all flex items-center justify-between text-xs shadow-2xs group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex items-center">
                        <span className="font-semibold group-hover:text-primary transition-colors">{otherNode.title}</span>
                        <span className="text-xs text-muted-foreground ml-1.5 font-mono">
                          ({e.label || (e.type === 'alternative' ? '平替' : '生态')})
                        </span>
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        {CATEGORY_COLORS[otherNode.category].name}
                      </Badge>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
