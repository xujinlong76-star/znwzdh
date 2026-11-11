'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
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
  { id: 'appflowy', title: 'AppFlowy', url: 'https://appflowy.io', category: 'efficiency', description: '开源私有化 Notion 替代品', openSource: true },
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
  const [activeCategory, setActiveCategory] = useState<'all' | 'dev' | 'design' | 'ai' | 'efficiency'>('all')
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })

  const [edges, setEdges] = useState<GraphEdge[]>(DEFAULT_EDGES)
  const [liveCount, setLiveCount] = useState(0)
  /** 图谱数据来源：'live' = 真实站点库；'sample' = 内置示例集（必须在界面上如实标注） */
  const [dataSource, setDataSource] = useState<'live' | 'sample' | 'loading'>('loading')

  // 键盘漫游：只有「当前节点」在 Tab 序列里，方向键按几何方向移动（见 lib/graph-nav.ts）
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const nodeRefs = useRef(new Map<string, SVGGElement>())

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
          setDataSource('sample')
          return
        }

        // 展平 19 个一级类目（含直属站点与子分类站点）为统一站点列表
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

        if (flat.length === 0) {
          setDataSource('sample')
          return
        }

        // 入口参数 ?category={中枢分类 id}：分类页/首页分类区的图谱按钮带着它跳来，
        // 旧实现从不读这个参数、永远展示全部分类（假跳转）。按分类标题关键词
        // 映射到图谱内部分类（dev/design/ai/efficiency）并预先选中；映射不上
        // 就保持全部，不假装过滤成功。
        try {
          const wanted = new URLSearchParams(window.location.search).get('category')
          if (wanted) {
            const titleById = new Map<string, string>()
            for (const cat of cats) {
              titleById.set(String(cat.id), String(cat.title ?? ''))
              for (const sub of cat.subCategories || []) titleById.set(String(sub.id), String(sub.title ?? ''))
            }
            const raw = (titleById.get(wanted) ?? wanted).toLowerCase()
            const bucket = raw.includes('ai') || raw.includes('智能') || raw.includes('模型')
              ? 'ai'
              : raw.includes('design') || raw.includes('设计') || raw.includes('创意')
                ? 'design'
                : raw.includes('效率') || raw.includes('办公') || raw.includes('文档')
                  ? 'efficiency'
                  : raw.includes('dev') || raw.includes('开发') || raw.includes('前端') || raw.includes('后端') || raw.includes('编程')
                    ? 'dev'
                    : null
            if (bucket) setActiveCategory(bucket)
          }
        } catch { /* 参数解析失败不影响图谱主体 */ }

        // live 口径：只按真实站点自身去重，不再拿预设集顶替同 URL 的真实站
        const seenUrls = new Set<string>()
        const dynamicNodes: GraphNode[] = []
        const rawTagMap = new Map<string, string[]>()

        // 采样策略：均匀抽样而非「取前 N 条」，否则图谱永远只反映第一个类目。
        const MAX_NODES = 24
        const stride = Math.max(1, Math.floor(flat.length / MAX_NODES))
        const sampled = flat.filter((_, i) => i % stride === 0).slice(0, MAX_NODES)

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
        setDataSource('live')
      })
      .catch(() => {
        // 拉不到数据：保留内置静态图谱保证可视化不空白，但把「示例数据」如实标注出来
        if (!cancelled) setDataSource('sample')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 简易力导引松弛算法（使得连接更舒展）
  useEffect(() => {
    let frameId: number
    let iter = 0

    const step = () => {
      if (iter > 45) return
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
  }, [])

  // 过滤后的节点与连线
  const filteredNodes = useMemo(() => {
    return nodes.filter((n) => {
      const catMatch = activeCategory === 'all' || n.category === activeCategory
      const queryMatch =
        !searchQuery ||
        n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.description.toLowerCase().includes(searchQuery.toLowerCase())
      return catMatch && queryMatch
    })
  }, [nodes, activeCategory, searchQuery])

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
                    className="text-xs font-mono text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                    title={`图中节点 = ${liveCount} 个站内真实站点（均匀抽样，非全量 298 站）；连线为按共享标签推导的关系，不是人工录入的生态关系`}
                  >
                    实时抽样 {liveCount} 站（真实站点，非全量）
                  </Badge>
                )}
                {dataSource === 'sample' && (
                  <Badge
                    variant="outline"
                    className="text-xs font-mono text-amber-600 dark:text-amber-400 border-amber-500/40"
                    title="未能读取站点库，当前展示的是内置示例节点集，不代表真实收录情况"
                  >
                    示例数据（未接入站点库）
                  </Badge>
                )}
              </h1>
            </div>
          </div>
        </div>

        {/* 场景分类过滤 */}
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
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="放大" title="放大" onClick={() => setZoom((z) => Math.min(z + 0.15, 2))}>
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="缩小" title="缩小" onClick={() => setZoom((z) => Math.max(z - 0.15, 0.5))}>
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="重置视图" title="重置视图" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* SVG 画布 */}
      <div
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
            <pattern id="graph-pattern-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1" className="fill-border/40" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#graph-pattern-grid)" />

          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* 连线层 */}
            {visibleEdges.map((e, idx) => {
              const src = nodeMap.get(e.source)
              const tgt = nodeMap.get(e.target)
              if (!src || !tgt) return null

              const isConnectedToSelected =
                selectedNode && (e.source === selectedNode.id || e.target === selectedNode.id)
              const strokeColor =
                e.type === 'alternative' ? 'rgba(236, 72, 153, 0.55)' : 'rgba(99, 102, 241, 0.55)'

              return (
                <g key={idx}>
                  <line
                    x1={src.x}
                    y1={src.y}
                    x2={tgt.x}
                    y2={tgt.y}
                    stroke={isConnectedToSelected ? '#f43f5e' : strokeColor}
                    strokeWidth={isConnectedToSelected ? 2.5 : 1.4}
                    strokeDasharray={e.type === 'alternative' ? '4 3' : undefined}
                    opacity={selectedNode && !isConnectedToSelected ? 0.2 : 0.85}
                  />
                  {e.label && (
                    <text
                      x={((src.x || 0) + (tgt.x || 0)) / 2}
                      y={((src.y || 0) + (tgt.y || 0)) / 2 - 3}
                      fontSize="9"
                      fill="#94a3b8"
                      textAnchor="middle"
                      className="pointer-events-none font-mono"
                    >
                      {e.label}
                    </text>
                  )}
                </g>
              )
            })}

            {/* 节点层 */}
            {filteredNodes.map((n) => {
              const isSelected = selectedNode?.id === n.id
              const catColor = CATEGORY_COLORS[n.category]

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
                >
                  {/* 键盘焦点环：只有真正聚焦（Tab / 方向键）时才出现 */}
                  <circle
                    r={26}
                    fill="none"
                    stroke="#60a5fa"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    className="pointer-events-none opacity-0 group-focus:opacity-100 transition-opacity"
                  />
                  <circle
                    r={isSelected ? 23 : 16}
                    fill={catColor.fill}
                    stroke={isSelected ? '#ffffff' : 'rgba(255,255,255,0.4)'}
                    strokeWidth={isSelected ? 3.5 : 1.8}
                    className="hover:scale-115 transition-transform drop-shadow-md"
                  />
                  <text
                    y={28}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight={isSelected ? 'bold' : '500'}
                    fill={isSelected ? '#ffffff' : '#cbd5e1'}
                    className="pointer-events-none select-none drop-shadow-sm font-mono"
                  >
                    {n.title}
                  </text>
                  {n.openSource && (
                    <circle
                      cx={12}
                      cy={-12}
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
