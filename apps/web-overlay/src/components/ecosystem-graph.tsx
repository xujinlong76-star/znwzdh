'use client'

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
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
  sampleUniform,
  type GraphCategoryFocus,
} from '@/lib/graph-category'
import {
  capsuleTextWidth,
  computeGraphFit,
  computeNodeDegrees,
  edgeCapsuleText,
  graphContentBox,
  nodeRadiusForDegree,
  truncateGraphLabel,
} from '@/lib/graph-polish'
import { extractFaviconMonogram, resolveSiteIcon } from '@/components/site-favicon'

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
  ai: { fill: '#10b981', text: '#a7f3d0', bg: 'rgba(16, 185, 129, 0.15)', name: 'AI 实验室' },
  efficiency: { fill: '#f59e0b', text: '#fde68a', bg: 'rgba(245, 158, 11, 0.15)', name: '效率创作' },
}

export function EcosystemGraph() {
  // ?category= 入口（首页/分类页的「查看该领域技术生态图谱」按钮带过来）：
  // 用 useSearchParams 读，参数变化时重拉重算；不用 window.location 一次性读
  // （客户端导航换参数时不刷新页面，一次性读会读到旧值，等于假跳转）。
  const searchParams = useSearchParams()
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

        // 分类域只抽样该分类自己的站点（顶级 + 其全部二级）；全局域抽样全部。
        // 分类命中了、但 live 数据里 0 站点时不假装过滤成功：清掉焦点、退回示例态，
        // 不然横幅会写着「正在查看某分类 · 展示 0 站」，图里却是示例节点。
        const scopeFlat = activeFocus
          ? flat.filter((s) => activeFocus.memberIds.includes(s.categoryId ?? ''))
          : flat
        if (scopeFlat.length === 0) {
          setLiveTotal(0)
          setFocusedCategory(null)
          setDataSource('sample')
          return
        }

        // live 口径：只按真实站点自身去重，不再拿预设集顶替同 URL 的真实站
        const seenUrls = new Set<string>()
        const dynamicNodes: GraphNode[] = []
        const rawTagMap = new Map<string, string[]>()

        // 采样策略：均匀抽样而非「取前 N 条」，否则图谱永远只反映第一个类目。
        // 分类域与全局域共用同一均匀抽样规则（lib/graph-category.ts 的 sampleUniform）。
        const MAX_NODES = 24
        const sampled = sampleUniform(scopeFlat, MAX_NODES)

        for (const s of sampled) {
          const normUrl = s.href.replace(/\/$/, '').toLowerCase()
          if (seenUrls.has(normUrl)) continue
          seenUrls.add(normUrl)

          const catStr = `${s.categoryId || ''} ${(s.tags || []).join(' ')}`.toLowerCase()
          const cat: GraphNode['category'] = catStr.includes('ai') || catStr.includes('模型')
            ? 'ai'
            : catStr.includes('design') || catStr.includes('设计') || catStr.includes('ui')
              ? 'design'
              : catStr.includes('效率') || catStr.includes('文档') || catStr.includes('笔记')
                ? 'efficiency'
                : 'dev'

          const nodeId = `db_${s.id}`
          dynamicNodes.push({
            id: nodeId,
            title: s.title.slice(0, 24),
            url: s.href,
            category: cat,
            description: String(s.description || s.href),
          })
          if (s.tags && s.tags.length > 0) {
            rawTagMap.set(nodeId, s.tags.map((x) => String(x).toLowerCase()))
          }
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

        const positioned = dynamicNodes.map((n, i) => {
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

        // 只在真实节点之间按共享标签推导关联边，不再连向预设节点
        const extraEdges: GraphEdge[] = []
        for (let i = 0; i < dynamicNodes.length; i++) {
          const a = dynamicNodes[i]!
          const tagsA = rawTagMap.get(a.id) || []
          for (let j = i + 1; j < dynamicNodes.length; j++) {
            const b = dynamicNodes[j]!
            const tagsB = rawTagMap.get(b.id) || []
            const shared = tagsA.find((x) => tagsB.includes(x))
            if (shared) {
              extraEdges.push({ source: a.id, target: b.id, type: 'alternative', label: `共享:${shared}` })
            }
          }
        }

        setNodes(positioned)
        setEdges(extraEdges)
        setLiveCount(dynamicNodes.length)
        setLiveTotal(scopeFlat.length)
        setDataSource('live')
        // 新节点已按圆周摆好：重跑一次力导向松弛再 fitView（否则只按圆周摆，不舒展）
        setLayoutNonce((v) => v + 1)
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
      const catMatch = focusedCategory ? true : activeCategory === 'all' || n.category === activeCategory
      const queryMatch =
        !searchQuery ||
        n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.description.toLowerCase().includes(searchQuery.toLowerCase())
      return catMatch && queryMatch
    })
  }, [nodes, activeCategory, searchQuery, focusedCategory])

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes])

  // 键盘导航用的几何点集；以及「漫游 tabindex」当前的落点（被筛掉的节点会自动回落）
  const navPoints = useMemo(
    () => filteredNodes.map((n) => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0 })),
    [filteredNodes],
  )
  const rovingId = useMemo(() => rovingNodeId(filteredNodes, focusedNodeId), [filteredNodes, focusedNodeId])

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
    return edges.filter((e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target))
  }, [edges, filteredNodeIds])

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
   * 自动 fitView：算出全部可见节点（含文字包围盒）的并集，按画布实际宽高比
   * 缩放并居中，强制预留 56px 四周安全边距，彻底杜绝裁切。
   * animate=true 时用 350ms 缓动从当前视图平滑过渡过去。
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
      const target = computeGraphFit(box, rect.width, rect.height)
      if (viewTweenRef.current !== null) {
        cancelAnimationFrame(viewTweenRef.current)
        viewTweenRef.current = null
      }
      if (!animate) {
        setZoom(target.zoom)
        setPan(target.pan)
        return
      }
      const startZoom = zoomRef.current
      const startPan = panRef.current
      const start = performance.now()
      const duration = 350
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration)
        const eased = 1 - Math.pow(1 - t, 3)
        setZoom(startZoom + (target.zoom - startZoom) * eased)
        setPan({
          x: startPan.x + (target.pan.x - startPan.x) * eased,
          y: startPan.y + (target.pan.y - startPan.y) * eased,
        })
        if (t < 1) {
          viewTweenRef.current = requestAnimationFrame(tick)
        } else {
          viewTweenRef.current = null
        }
      }
      viewTweenRef.current = requestAnimationFrame(tick)
    },
    [filteredNodes, degreeMap],
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

  // 画布鼠标拖拽平移
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target instanceof SVGElement && e.target.tagName !== 'circle') {
      isDraggingRef.current = true
      dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return
    // 真正拖动才算手动移动：光点下不算，避免一次点击就关掉自动 fit
    setUserMoved(true)
    setPan({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    })
  }

  const handleMouseUp = () => {
    isDraggingRef.current = false
  }

  return (
    <main
      id="main-content"
      className="relative w-full h-[calc(100vh-64px)] overflow-hidden bg-background select-none flex flex-col"
    >
      {/* 顶部控制栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 sm:px-6 border-b border-border/60 glass-surface subtle-mesh z-20 shadow-xs">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="gap-1.5 text-xs h-8 border border-border/50 hover:bg-background/80">
            <Link href="/">
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回导航</span>
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-bold flex items-center gap-2 flex-wrap">
                <span>工具链关系图谱与平替雷达</span>
                <Badge variant="outline" className="hidden sm:inline-flex text-xs text-indigo-500 border-indigo-500/30 font-mono">
                  Poincaré Graph v5.0
                </Badge>
                {/*
                  数据来源必须如实标注（2026-11-08 深度扫描 P0-4）：
                  「真实站点库」与「内置示例集」是两种性质完全不同的结果，
                  不标注就等于让访客把演示数据当成全网图谱。
                */}
                {dataSource === 'live' && liveCount > 0 && (
                  <Badge
                    variant="outline"
                    className="text-xs font-mono text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                    title={
                      liveCount < liveTotal
                        ? `图中节点 = ${liveCount} 个站内真实站点（均匀抽样，非全量 ${liveTotal} 站）；连线为按共享标签推导的关系，不是人工录入的生态关系`
                        : `图中节点 = ${liveCount} 个站内真实站点（已全部展示，共 ${liveTotal} 站）；连线为按共享标签推导的关系，不是人工录入的生态关系`
                    }
                  >
                    {liveCount < liveTotal
                      ? `实时抽样 ${liveCount} 站（真实站点，非全量）`
                      : `实时 ${liveCount} 站（真实站点，全部展示）`}
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

        {/* 场景分类过滤：分类域不展示（范围已由 ?category= 圈定，再按桶筛会筛空） */}
        {!focusedCategory && (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar touch-pan-x p-1 rounded-xl bg-muted/40 border border-border/50">
          {(['all', 'dev', 'design', 'ai', 'efficiency'] as const).map((cat) => (
            <Button
              key={cat}
              size="sm"
              variant={activeCategory === cat ? 'default' : 'ghost'}
              className="h-7 text-xs px-2.5 rounded-lg transition-all"
              onClick={() => { setActiveCategory(cat); setSelectedNode(null); }}
            >
              {cat === 'all' ? '全部' : CATEGORY_COLORS[cat].name}
            </Button>
          ))}
        </div>
        )}

        {/* 搜索与缩放控制 */}
        <div className="flex items-center gap-2">
          {/* 图例简要提示 */}
          <div className="hidden lg:flex items-center gap-3 text-xs text-muted-foreground mr-2 font-mono">
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 border-b-2 border-dashed border-pink-500" /> 平替候选
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-indigo-500" /> 生态链路
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> 开源
            </span>
          </div>

          <div className="relative w-36 sm:w-48">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-muted-foreground" />
            <Input aria-label="搜索图谱节点"
              placeholder="搜索图谱节点..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs border-border/60 bg-background/80"
            />
          </div>
          <div className="flex items-center gap-1 bg-muted/30 p-0.5 rounded-lg border border-border/50">
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="放大" title="放大" onClick={() => { setUserMoved(true); setZoom((z) => Math.min(z + 0.15, 2)) }}>
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

      {/* 分类域横幅：?category= 命中时只展示该分类自己的站点，点「查看全部」回到全局 */}
      {focusedCategory && (
        <div className="flex flex-wrap items-center gap-2 px-3 sm:px-6 py-2 text-xs border-b border-border/60 bg-indigo-500/5 z-20">
          <span>正在查看「{focusedCategory.title}」分类 · 展示 {liveCount} 站</span>
          <Link href="/graph" className="font-medium text-indigo-500 hover:underline">
            查看全部
          </Link>
        </div>
      )}

      {/* SVG 画布 */}
      <div
        ref={containerRef}
        className="flex-1 w-full h-full cursor-grab active:cursor-grabbing relative overflow-hidden bg-dot-grid"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
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
            {filteredNodes.map((n) => {
              const isSelected = selectedNode?.id === n.id
              const catColor = CATEGORY_COLORS[n.category]
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
                  onClick={() => setSelectedNode(n)}
                  onFocus={() => setFocusedNodeId(n.id)}
                  onKeyDown={(event) => handleNodeKeyDown(event, n)}
                  onMouseEnter={() => setHoveredNodeId(n.id)}
                  onMouseLeave={() => setHoveredNodeId((id) => (id === n.id ? null : id))}
                  opacity={isDimmed ? 0.18 : 1}
                  style={{ transition: 'opacity 200ms ease' }}
                >
                  {/* 完整名称：hover 原生 tooltip 与详情抽屉展示，标签只显示截断版 */}
                  <title>{n.title}</title>
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
