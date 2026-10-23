'use client'

/**
 * 全景交互式 2D 知识星图与拓扑演进中枢
 *
 * 核心特性：
 * 1. 2D SVG 动态力学拓扑星图：以分类为核心星系、站点为行星、标签为卫星的向心引力网；
 * 2. 交互式缩放平移与节点探测：支持点击聚焦、关联边高亮、详情侧栏探测与外链直达；
 * 3. 技术最短演进路径 (Dijkstra Path Finder)：交互式选定两项技术，动态高亮最短演进链路；
 * 4. 跨分类雷同站点查重与语义聚类：智能扫描高重合度站点并提供标签融合建议。
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  Compass,
  Search,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  GitFork,
  Copy,
  Layers,
  ArrowRight,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  X,
  RefreshCw,
} from 'lucide-react'
import {
  fetchKnowledgeMesh,
  findTechGraphPath,
  fetchSiteDuplicates,
  type SiteKnowledgeMesh,
  type SiteKnowledgeNode,
  type TechGraphPath,
  type SiteDuplicateReport,
} from '@/lib/navhub-api'
import { Button } from '@/registry/new-york/ui/button'
import { Input } from '@/registry/new-york/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { copyText } from '@/lib/clipboard'

interface KnowledgeStarMapModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ActiveTab = 'star-map' | 'path-finder' | 'dedup-audit'

export function KnowledgeStarMapModal({ open, onOpenChange }: KnowledgeStarMapModalProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('star-map')
  const [loading, setLoading] = useState(false)
  const [mesh, setMesh] = useState<SiteKnowledgeMesh | null>(null)
  const [selectedNode, setSelectedNode] = useState<SiteKnowledgeNode | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')

  // 缩放平移状态
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })

  // 最短演进路径状态
  const [pathStart, setPathStart] = useState('react')
  const [pathTarget, setPathTarget] = useState('postgres')
  const [pathResult, setPathResult] = useState<TechGraphPath | null>(null)
  const [pathLoading, setPathLoading] = useState(false)

  // 语义查重状态
  const [dedupReport, setDedupReport] = useState<SiteDuplicateReport | null>(null)
  const [dedupLoading, setDedupLoading] = useState(false)

  // 加载全站星图网格数据
  const loadMesh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchKnowledgeMesh()
      if (res.ok && res.mesh) {
        setMesh(res.mesh)
      } else {
        toast.error('加载知识星图拓扑失败')
      }
    } catch {
      toast.error('网络异常，无法获取知识星图')
    } finally {
      setLoading(false)
    }
  }, [])

  // 加载演进路径
  const handleFindPath = useCallback(async (start: string, target: string) => {
    if (!start.trim() || !target.trim()) return
    setPathLoading(true)
    try {
      const res = await findTechGraphPath(start.trim(), target.trim())
      if (res.ok && (res.path || res.result)) {
        setPathResult(res.path || res.result)
      } else {
        toast.error('未找到对应技术演进路径')
      }
    } catch {
      toast.error('路径计算失败')
    } finally {
      setPathLoading(false)
    }
  }, [])

  // 加载语义查重数据
  const loadDuplicates = useCallback(async () => {
    setDedupLoading(true)
    try {
      const res = await fetchSiteDuplicates()
      if (res.ok && res.report) {
        setDedupReport(res.report)
      } else {
        toast.error('查重扫描失败')
      }
    } catch {
      toast.error('网络异常，查重失败')
    } finally {
      setDedupLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      loadMesh()
      handleFindPath(pathStart, pathTarget)
      loadDuplicates()
    }
  }, [open, loadMesh, handleFindPath, loadDuplicates, pathStart, pathTarget])

  // ESC 键退出
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onOpenChange(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onOpenChange])

  // 计算节点坐标与向心布局
  const layoutNodes = useMemo(() => {
    if (!mesh || !mesh.nodes) return []

    const width = 900
    const height = 620
    const centerX = width / 2
    const centerY = height / 2

    const normalizedNodes = mesh.nodes.map((n) => {
      const raw = n as SiteKnowledgeNode & { name?: string; categoryId?: string }
      const label = raw.label || raw.name || raw.id
      const category =
        raw.category ||
        (raw.categoryId ? (raw.categoryId.startsWith('cat_') ? raw.categoryId : `cat_${raw.categoryId}`) : undefined)
      return {
        ...raw,
        label,
        category,
      }
    })

    const categories = normalizedNodes.filter((n) => n.type === 'category')
    const sites = normalizedNodes.filter((n) => n.type === 'site')
    const tags = normalizedNodes.filter((n) => n.type === 'tag')

    // 分类节点均布在内环 (R = 160)
    const catPositions: Record<string, { x: number; y: number }> = {}
    const catCount = Math.max(categories.length, 1)
    categories.forEach((cat, idx) => {
      const angle = (idx / catCount) * 2 * Math.PI - Math.PI / 2
      const r = 160
      catPositions[cat.id] = {
        x: centerX + Math.cos(angle) * r,
        y: centerY + Math.sin(angle) * r,
      }
    })

    // 站点围绕对应分类环绕 (R = 260 ~ 300)
    const sitePositions: Record<string, { x: number; y: number }> = {}
    const sitesByCategory: Record<string, typeof normalizedNodes> = {}
    sites.forEach((site) => {
      const catKey = site.category || 'default'
      if (!sitesByCategory[catKey]) sitesByCategory[catKey] = []
      sitesByCategory[catKey].push(site)
    })

    Object.entries(sitesByCategory).forEach(([catKey, siteList]) => {
      const catPos = catPositions[catKey] || { x: centerX, y: centerY }
      const sCount = siteList.length
      siteList.forEach((site, sIdx) => {
        const angle = (sIdx / Math.max(sCount, 1)) * 2 * Math.PI
        const dist = 75 + ((sIdx * 23) % 45)
        sitePositions[site.id] = {
          x: catPos.x + Math.cos(angle) * dist,
          y: catPos.y + Math.sin(angle) * dist,
        }
      })
    })

    // 标签散布在外环
    const tagPositions: Record<string, { x: number; y: number }> = {}
    const tagCount = Math.max(tags.length, 1)
    tags.forEach((tag, idx) => {
      const angle = (idx / tagCount) * 2 * Math.PI
      const r = 380 + ((idx * 31) % 60)
      tagPositions[tag.id] = {
        x: centerX + Math.cos(angle) * r,
        y: centerY + Math.sin(angle) * r,
      }
    })

    return normalizedNodes.map((node) => {
      let pos = { x: centerX, y: centerY }
      if (node.type === 'category' && catPositions[node.id]) pos = catPositions[node.id]
      else if (node.type === 'site' && sitePositions[node.id]) pos = sitePositions[node.id]
      else if (node.type === 'tag' && tagPositions[node.id]) pos = tagPositions[node.id]

      return {
        ...node,
        x: pos.x,
        y: pos.y,
      }
    })
  }, [mesh])

  const nodeMap = useMemo(() => {
    const map = new Map<string, (typeof layoutNodes)[0]>()
    layoutNodes.forEach((n) => map.set(n.id, n))
    return map
  }, [layoutNodes])

  // 过滤后的节点
  const filteredNodes = useMemo(() => {
    return layoutNodes.filter((node) => {
      if (selectedCategory !== 'all') {
        if (node.type === 'category' && node.id !== selectedCategory) return false
        if (node.type === 'site' && node.category !== selectedCategory) return false
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        return (node.label || '').toLowerCase().includes(q) || Boolean(node.url && node.url.toLowerCase().includes(q))
      }
      return true
    })
  }, [layoutNodes, selectedCategory, searchQuery])

  // 计算连线
  const visibleEdges = useMemo(() => {
    if (!mesh || !mesh.edges) return []
    const visibleIds = new Set(filteredNodes.map((n) => n.id))

    return mesh.edges
      .map((edge) => {
        const s = nodeMap.get(edge.source)
        const t = nodeMap.get(edge.target)
        if (!s || !t) return null
        if (!visibleIds.has(s.id) && !visibleIds.has(t.id)) return null
        return {
          ...edge,
          x1: s.x,
          y1: s.y,
          x2: t.x,
          y2: t.y,
        }
      })
      .filter((e): e is NonNullable<typeof e> => Boolean(e))
  }, [mesh, filteredNodes, nodeMap])

  // 鼠标/触控拖拽平移画布
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true
    dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
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

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      isDraggingRef.current = true
      dragStartRef.current = { x: e.touches[0].clientX - pan.x, y: e.touches[0].clientY - pan.y }
    }
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDraggingRef.current || e.touches.length !== 1) return
    setPan({
      x: e.touches[0].clientX - dragStartRef.current.x,
      y: e.touches[0].clientY - dragStartRef.current.y,
    })
  }

  const handleTouchEnd = () => {
    isDraggingRef.current = false
  }

  if (!open) return null

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-2 sm:p-4 animate-in fade-in duration-200"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="relative flex flex-col w-full max-w-6xl h-[92vh] sm:h-[88vh] rounded-2xl border border-white/20 dark:border-white/10 bg-white/95 dark:bg-zinc-950/95 shadow-2xl overflow-hidden backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏与标签切换 */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-3 sm:px-6 py-3 sm:py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 text-white shadow-md shadow-indigo-500/20 shrink-0">
                <Compass className="w-4 h-4 sm:w-5 sm:h-5 animate-pulse" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <h2 className="text-sm sm:text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 truncate">
                    全景知识星图与拓扑演进中枢
                  </h2>
                  <Badge variant="outline" className="hidden sm:inline-flex text-[10px] sm:text-xs bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30 shrink-0">
                    拓扑互联 2.0
                  </Badge>
                </div>
                <p className="text-[11px] sm:text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  跨分类向心星图 · 技术演进最短寻路 · 语义查重聚类
                </p>
              </div>
            </div>

            {/* Mobile Close Button */}
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              aria-label="关闭星图模态框"
              className="md:hidden shrink-0 w-8 h-8 rounded-xl hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 text-zinc-500"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* 模式切换 Switch */}
          <div className="flex items-center justify-between md:justify-end gap-2">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-200/60 dark:bg-zinc-800/60 border border-zinc-300/40 dark:border-zinc-700/50 overflow-x-auto max-w-full">
              <button
                onClick={() => setActiveTab('star-map')}
                className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  activeTab === 'star-map'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Compass className="inline-block w-3.5 h-3.5 mr-1" />
                全景星图
              </button>
              <button
                onClick={() => setActiveTab('path-finder')}
                className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  activeTab === 'path-finder'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <GitFork className="inline-block w-3.5 h-3.5 mr-1" />
                最短寻路
              </button>
              <button
                onClick={() => setActiveTab('dedup-audit')}
                className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  activeTab === 'dedup-audit'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Layers className="inline-block w-3.5 h-3.5 mr-1" />
                查重聚类
                {dedupReport && dedupReport.duplicatePairs.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500 text-white font-mono">
                    {dedupReport.duplicatePairs.length}
                  </span>
                )}
              </button>
            </div>

            {/* Desktop Close Button */}
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              aria-label="关闭星图模态框"
              className="hidden md:inline-flex shrink-0 rounded-xl hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* 主体交互区域 */}
        <div className="flex-1 flex overflow-hidden">
          {/* TAB 1: 全景知识星图 */}
          {activeTab === 'star-map' && (
            <div className="flex-1 flex flex-col relative select-none">
              {/* 控制搜索与过滤栏 */}
              <div className="absolute top-3 sm:top-4 left-3 sm:left-4 z-10 flex items-center gap-1.5 sm:gap-2 p-1.5 sm:p-2 rounded-xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border border-zinc-200/80 dark:border-zinc-800 shadow-lg max-w-[calc(100%-1.5rem)]">
                <div className="relative w-32 min-[380px]:w-44 sm:w-64">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-zinc-400" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="聚焦节点或站点..."
                    aria-label="聚焦节点或站点"
                    className="pl-8 h-8 sm:h-9 text-xs rounded-lg bg-zinc-100/60 dark:bg-zinc-800/60 border-none"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      aria-label="清空搜索"
                      className="absolute right-2 top-2 sm:top-2.5 text-zinc-400 hover:text-zinc-600"
                    >
                      <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-0.5 sm:gap-1 border-l border-zinc-200 dark:border-zinc-800 pl-1.5 sm:pl-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setZoom((z) => Math.min(z + 0.2, 2.5))}
                    aria-label="放大星图画布"
                    className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg"
                  >
                    <ZoomIn className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setZoom((z) => Math.max(z - 0.2, 0.4))}
                    aria-label="缩小星图画布"
                    className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg"
                  >
                    <ZoomOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      setZoom(1)
                      setPan({ x: 0, y: 0 })
                    }}
                    aria-label="重置星图视角"
                    className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg"
                  >
                    <RotateCcw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </Button>
                </div>
              </div>

              {/* 统计指标浮动小卡片 */}
              {mesh && (
                <div className="absolute top-4 right-4 z-10 hidden sm:flex items-center gap-3 px-3 py-2 rounded-xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border border-zinc-200/80 dark:border-zinc-800 shadow-lg text-xs text-zinc-600 dark:text-zinc-400">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
                    {mesh.stats.totalNodes} 节点
                  </span>
                  <span>·</span>
                  <span>{mesh.stats.totalEdges} 拓扑边</span>
                  <span>·</span>
                  <span>{mesh.stats.categoryCount} 核心星系</span>
                </div>
              )}

              {/* SVG Canvas 交互画布 */}
              <div
                className="flex-1 w-full h-full cursor-grab active:cursor-grabbing overflow-hidden bg-radial-gradient touch-none"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
              >
                <svg
                  className="w-full h-full"
                  viewBox="0 0 900 620"
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: 'center center',
                    transition: isDraggingRef.current ? 'none' : 'transform 0.1s ease-out',
                  }}
                >
                  <defs>
                    <radialGradient id="hubGradient" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#818cf8" stopOpacity="0.8" />
                      <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.2" />
                    </radialGradient>
                    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                  </defs>

                  {/* 背景参考轨道圈 */}
                  <circle cx="450" cy="310" r="160" fill="none" stroke="currentColor" strokeDasharray="3 6" className="text-zinc-200 dark:text-zinc-800" strokeWidth="1" />
                  <circle cx="450" cy="310" r="280" fill="none" stroke="currentColor" strokeDasharray="4 8" className="text-zinc-200 dark:text-zinc-800" strokeWidth="1" />
                  <circle cx="450" cy="310" r="390" fill="none" stroke="currentColor" strokeDasharray="2 6" className="text-zinc-200 dark:text-zinc-850" strokeWidth="0.8" />

                  {/* 拓扑连线 Edges */}
                  {visibleEdges.map((edge, idx) => {
                    const isRelated = selectedNode && (edge.source === selectedNode.id || edge.target === selectedNode.id)
                    return (
                      <line
                        key={`edge-${idx}`}
                        x1={edge.x1}
                        y1={edge.y1}
                        x2={edge.x2}
                        y2={edge.y2}
                        stroke={isRelated ? '#a855f7' : '#71717a'}
                        strokeWidth={isRelated ? 2 : 0.8}
                        strokeOpacity={isRelated ? 0.9 : 0.25}
                        className="transition-all duration-300"
                      />
                    )
                  })}

                  {/* 节点 Nodes */}
                  {filteredNodes.map((node) => {
                    const isSelected = selectedNode?.id === node.id
                    const isCat = node.type === 'category'
                    const isSite = node.type === 'site'
                    const isTag = node.type === 'tag'

                    let nodeRadius = 8
                    let fillColor = '#6366f1'
                    if (isCat) {
                      nodeRadius = 24
                      fillColor = '#8b5cf6'
                    } else if (isSite) {
                      nodeRadius = 12
                      fillColor = '#3b82f6'
                    } else if (isTag) {
                      nodeRadius = 6
                      fillColor = '#ec4899'
                    }

                    return (
                      <g
                        key={node.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`查看节点 ${node.label}`}
                        transform={`translate(${node.x}, ${node.y})`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedNode(node)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setSelectedNode(node)
                          }
                        }}
                        className="cursor-pointer group focus:outline-none"
                      >
                        {isSelected && (
                          <circle
                            r={nodeRadius + 8}
                            fill="none"
                            stroke="#ec4899"
                            strokeWidth="2.5"
                            strokeDasharray="4 4"
                            className="animate-spin origin-center"
                          />
                        )}

                        <circle
                          r={nodeRadius}
                          fill={fillColor}
                          filter={isCat || isSelected ? 'url(#glow)' : undefined}
                          className="transition-transform duration-200 group-hover:scale-125"
                          opacity={isTag ? 0.7 : 0.9}
                        />

                        <text
                          dy={nodeRadius + 14}
                          textAnchor="middle"
                          className={`text-[10px] select-none pointer-events-none transition-colors duration-200 ${
                            isCat
                              ? 'font-bold fill-zinc-900 dark:fill-zinc-100 text-[12px]'
                              : isSelected
                              ? 'font-semibold fill-purple-600 dark:fill-purple-400'
                              : 'fill-zinc-600 dark:fill-zinc-400 group-hover:fill-zinc-900 dark:group-hover:fill-zinc-100'
                          }`}
                        >
                          {node.label}
                        </text>
                      </g>
                    )
                  })}
                </svg>
              </div>

              {/* 节点探测侧边卡片 (Node Inspector) */}
              {selectedNode && (
                <div className="absolute bottom-3 sm:bottom-4 left-3 right-3 sm:right-auto sm:left-4 z-20 w-auto sm:w-80 max-w-sm p-3.5 sm:p-4 rounded-2xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl border border-zinc-200 dark:border-zinc-800 shadow-2xl animate-in slide-in-from-bottom-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] mb-1.5 ${
                          selectedNode.type === 'category'
                            ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                            : selectedNode.type === 'site'
                            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                            : 'bg-pink-500/10 text-pink-600 dark:text-pink-400'
                        }`}
                      >
                        {selectedNode.type === 'category' ? '分类星系' : selectedNode.type === 'site' ? '导航站点' : '关联标签'}
                      </Badge>
                      <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                        {selectedNode.label}
                      </h3>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setSelectedNode(null)}
                      aria-label="关闭节点探测卡片"
                      className="w-6 h-6 rounded-md -mr-1 -mt-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  {selectedNode.url && (
                    <div className="mt-2 text-xs font-mono text-zinc-500 dark:text-zinc-400 truncate">
                      {selectedNode.url}
                    </div>
                  )}

                  <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between gap-2">
                    {selectedNode.url ? (
                      <Button
                        size="sm"
                        onClick={() => window.open(selectedNode.url, '_blank', 'noopener,noreferrer')}
                        className="w-full h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        访问站点原址
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSearchQuery(selectedNode.label)}
                        className="w-full h-8 text-xs rounded-lg"
                      >
                        聚焦以此为中心
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: 最短技术演进路径 (Dijkstra Path Finder) */}
          {activeTab === 'path-finder' && (
            <div className="flex-1 p-8 overflow-y-auto bg-zinc-50/50 dark:bg-zinc-950/50">
              <div className="max-w-3xl mx-auto space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <GitFork className="w-5 h-5 text-indigo-500" />
                    技术栈双向演进寻路 (Dijkstra Shortest Path)
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    计算前端框架、中间件、数据库与 DevOps 工具链之间的最短协作协同链路与生态递进路径。
                  </p>
                </div>

                {/* 选点查询表单 */}
                <div className="flex flex-col sm:flex-row items-center gap-3 p-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm">
                  <div className="flex-1 w-full">
                    <label htmlFor="path-start-tech" className="text-[11px] font-medium text-zinc-500 mb-1 block">起始技术 / 站点</label>
                    <Input
                      id="path-start-tech"
                      value={pathStart}
                      onChange={(e) => setPathStart(e.target.value)}
                      placeholder="如: react, vue, nextjs..."
                      className="h-9 text-xs"
                    />
                  </div>
                  <div className="pt-5 hidden sm:block text-zinc-400">
                    <ArrowRight className="w-4 h-4" />
                  </div>
                  <div className="flex-1 w-full">
                    <label htmlFor="path-target-tech" className="text-[11px] font-medium text-zinc-500 mb-1 block">目标技术 / 站点</label>
                    <Input
                      id="path-target-tech"
                      value={pathTarget}
                      onChange={(e) => setPathTarget(e.target.value)}
                      placeholder="如: postgres, docker, k8s..."
                      className="h-9 text-xs"
                    />
                  </div>
                  <div className="pt-5 w-full sm:w-auto">
                    <Button
                      onClick={() => handleFindPath(pathStart, pathTarget)}
                      disabled={pathLoading}
                      className="h-9 w-full sm:w-auto px-5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded-lg"
                    >
                      {pathLoading ? '寻路计算中...' : '开始演进寻路'}
                    </Button>
                  </div>
                </div>

                {/* 快捷预设按钮 */}
                <div className="flex items-center gap-2 flex-wrap text-xs text-zinc-500">
                  <span>推荐链路:</span>
                  {[
                    ['React', 'PostgreSQL'],
                    ['Next.js', 'Docker'],
                    ['TypeScript', 'Redis'],
                    ['Vue', 'TailwindCSS'],
                  ].map(([from, to]) => (
                    <button
                      key={`${from}-${to}`}
                      onClick={() => {
                        setPathStart(from.toLowerCase())
                        setPathTarget(to.toLowerCase())
                        handleFindPath(from.toLowerCase(), to.toLowerCase())
                      }}
                      className="px-2.5 py-1 rounded-md bg-zinc-200/60 dark:bg-zinc-800/60 hover:bg-indigo-500/10 hover:text-indigo-600 dark:hover:text-indigo-400 text-zinc-600 dark:text-zinc-300 transition-colors"
                    >
                      {from} → {to}
                    </button>
                  ))}
                </div>

                {/* 演进路径结果渲染 */}
                {pathResult && (
                  <div className="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-md">
                    {pathResult.found ? (
                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4" />
                            已找到最短演进协同路径（距离权重: {pathResult.distance} · 共 {pathResult.steps.length} 跳）
                          </span>
                          <span className="text-xs font-mono text-zinc-400">
                            {pathResult.from || (pathResult as any).startId} ➔ {pathResult.to || (pathResult as any).targetId}
                          </span>
                        </div>

                        {/* 时间轴节点树 */}
                        <div className="relative pl-6 border-l-2 border-indigo-500/30 space-y-6 my-4">
                          <div className="relative">
                            <span className="absolute -left-[31px] top-1 w-4 h-4 rounded-full bg-indigo-600 ring-4 ring-indigo-100 dark:ring-indigo-950/50" />
                            <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                              {String(pathResult.from || (pathResult as any).startId || '').toUpperCase()} (起点生态)
                            </div>
                          </div>

                          {pathResult.steps.map((step, idx) => {
                            const rawStep = step as typeof step & { fromNode?: { name?: string }; toNode?: { name?: string } }
                            const stepFrom = rawStep.from || rawStep.fromNode?.name || ''
                            const stepTo = rawStep.to || rawStep.toNode?.name || ''
                            return (
                              <div key={idx} className="relative pl-2">
                                <span className="absolute -left-[31px] top-1 w-3.5 h-3.5 rounded-full bg-purple-500 ring-4 ring-purple-100 dark:ring-purple-950/50" />
                                <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60">
                                  <div className="flex items-center gap-2 text-xs font-medium text-purple-600 dark:text-purple-400">
                                    <span>跳数 #{idx + 1}</span>
                                    <span>·</span>
                                    <Badge variant="outline" className="text-[10px] py-0">
                                      {step.relation}
                                    </Badge>
                                  </div>
                                  <div className="mt-1 text-sm font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                                    <span>{stepFrom}</span>
                                    <ArrowRight className="w-3.5 h-3.5 text-zinc-400" />
                                    <span className="text-indigo-600 dark:text-indigo-400">{stepTo}</span>
                                  </div>
                                  {step.description && (
                                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                      {step.description}
                                    </p>
                                  )}
                                </div>
                              </div>
                            )
                          })}

                          <div className="relative">
                            <span className="absolute -left-[31px] top-1 w-4 h-4 rounded-full bg-emerald-600 ring-4 ring-emerald-100 dark:ring-emerald-950/50" />
                            <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                              {String(pathResult.to || (pathResult as any).targetId || '').toUpperCase()} (到达目标)
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-zinc-500">
                        <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                        <p className="text-sm">这两项技术在当前预置图谱中未形成直接演进关联</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: 跨分类查重聚类 (Dedup Audit) */}
          {activeTab === 'dedup-audit' && (
            <div className="flex-1 p-8 overflow-y-auto bg-zinc-50/50 dark:bg-zinc-950/50">
              <div className="max-w-4xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                      <Layers className="w-5 h-5 text-indigo-500" />
                      全站跨分类语义雷同与冗余查重
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      基于域名主干聚类、分词 Jaccard 与跨分类标签重合度分析，识别多处重复收录或冗余的死角站点。
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={loadDuplicates}
                    disabled={dedupLoading}
                    className="text-xs rounded-lg gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${dedupLoading ? 'animate-spin' : ''}`} />
                    重新全站扫描
                  </Button>
                </div>

                {dedupReport ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-4 p-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs">
                      <div>
                        已扫描站点: <span className="font-semibold font-mono text-zinc-900 dark:text-zinc-100">{dedupReport.scannedCount}</span>
                      </div>
                      <div>·</div>
                      <div>
                        识别潜在雷同对: <span className="font-semibold font-mono text-amber-600 dark:text-amber-400">{dedupReport.duplicatePairs.length}</span>
                      </div>
                      <div>·</div>
                      <div>
                        高置信度重复: <span className="font-semibold font-mono text-rose-600 dark:text-rose-400">{dedupReport.highConfidenceCount ?? dedupReport.duplicatePairs.filter((p) => p.similarity >= 0.85).length}</span>
                      </div>
                    </div>

                    {dedupReport.duplicatePairs.length === 0 ? (
                      <div className="p-12 text-center rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                        <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                        <h4 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">太棒了，全站未发现冗余雷同站点</h4>
                        <p className="text-xs text-zinc-500 mt-1">所有收录站点的域名主干与内容特征均具有高度独立性。</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4">
                        {dedupReport.duplicatePairs.map((pair, idx) => {
                          const rawPair = pair as typeof pair & {
                            idA?: string
                            titleA?: string
                            urlA?: string
                            idB?: string
                            titleB?: string
                            urlB?: string
                            recommendation?: string
                          }
                          const titleA = rawPair.siteA?.title || rawPair.titleA || '未知站点 A'
                          const urlA = rawPair.siteA?.url || rawPair.urlA || ''
                          const titleB = rawPair.siteB?.title || rawPair.titleB || '未知站点 B'
                          const urlB = rawPair.siteB?.url || rawPair.urlB || ''
                          const action =
                            rawPair.suggestedAction ||
                            (rawPair.recommendation === 'merge'
                              ? 'merge_tags'
                              : rawPair.recommendation === 'archive_b'
                                ? 'remove_redundant'
                                : 'keep_both')

                          return (
                            <div
                              key={idx}
                              className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-4 hover:border-indigo-500/40 transition-colors"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Badge
                                    className={`text-xs ${
                                      pair.similarity > 0.8
                                        ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30'
                                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                    }`}
                                    variant="outline"
                                  >
                                    相似度 {(pair.similarity * 100).toFixed(0)}%
                                  </Badge>
                                  <span className="text-xs text-zinc-500">{pair.reason}</span>
                                </div>
                                <Badge variant="secondary" className="text-[10px]">
                                  建议操作: {action === 'merge_tags' ? '合并标签' : action === 'remove_redundant' ? '剔除冗余' : '保留双向互补'}
                                </Badge>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40">
                                <div className="space-y-1">
                                  <div className="text-[10px] uppercase font-mono text-zinc-400">站点 A</div>
                                  <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 truncate">{titleA}</div>
                                  <div className="text-[11px] font-mono text-zinc-500 truncate">{urlA}</div>
                                </div>
                                <div className="space-y-1">
                                  <div className="text-[10px] uppercase font-mono text-zinc-400">站点 B</div>
                                  <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 truncate">{titleB}</div>
                                  <div className="text-[11px] font-mono text-zinc-500 truncate">{urlB}</div>
                                </div>
                              </div>

                              <div className="flex items-center justify-end gap-2 pt-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    copyText(`${titleA} (${urlA}) & ${titleB} (${urlB})`)
                                    toast.success('已复制雷同对名称与 URL')
                                  }}
                                  className="h-7 text-xs rounded-lg"
                                >
                                  <Copy className="w-3 h-3 mr-1" />
                                  复制信息
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    toast.success(`已标记合并操作: ${titleA} 与 ${titleB}`)
                                  }}
                                  className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg"
                                >
                                  一键融合标签与关联
                                </Button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-12 text-center text-zinc-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                    正在扫描分析全站拓扑与冗余特征...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
