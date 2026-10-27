'use client'

import { useState, useMemo } from 'react'
import type { MindMapNode } from '@/lib/video-mindmap-generator'
import { exportMindMapAsMarkdown, flattenMindMap } from '@/lib/video-mindmap-generator'
import { Button } from '@/registry/new-york/ui/button'
import { formatDuration } from '@/lib/video-format'
import {
  ChevronRight,
  ChevronDown,
  Download,
  Share2,
  Sparkles,
  Play,
  Layers,
  CheckCircle2,
  Code,
  FolderTree,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface VideoMindmapViewProps {
  rootNode: MindMapNode
  onSeek?: (timeSec: number) => void
  videoTitle: string
}

export function VideoMindmapView({ rootNode, onSeek, videoTitle }: VideoMindmapViewProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')

  const allNodes = useMemo(() => flattenMindMap(rootNode), [rootNode])

  const toggleCollapse = (id: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const expandAll = () => setCollapsedIds(new Set())
  const collapseAll = () => {
    const ids = new Set<string>()
    allNodes.forEach(n => {
      if (n.children && n.children.length > 0) ids.add(n.id)
    })
    setCollapsedIds(ids)
  }

  const handleExportMarkdown = () => {
    const md = exportMindMapAsMarkdown(rootNode)
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${videoTitle}-知识脑图.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const renderNode = (node: MindMapNode, depth = 0) => {
    const isCollapsed = collapsedIds.has(node.id)
    const hasChildren = node.children && node.children.length > 0
    const matchesSearch = searchQuery.trim() === '' || node.title.toLowerCase().includes(searchQuery.toLowerCase())

    if (!matchesSearch && !hasChildren) return null

    const typeBadges: Record<MindMapNode['type'], { color: string; label: string; icon: React.ReactNode }> = {
      root: { color: 'bg-primary/10 text-primary border-primary/20', label: '核心主题', icon: <Sparkles className="w-3 h-3 text-primary" /> },
      category: { color: 'bg-blue-500/10 text-blue-500 border-blue-500/20', label: '知识域', icon: <Layers className="w-3 h-3 text-blue-500" /> },
      concept: { color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20', label: '核心原理', icon: <CheckCircle2 className="w-3 h-3 text-emerald-500" /> },
      action: { color: 'bg-amber-500/10 text-amber-500 border-amber-500/20', label: '代码演练', icon: <Code className="w-3 h-3 text-amber-500" /> },
    }

    const badge = typeBadges[node.type] || typeBadges.concept

    return (
      <div key={node.id} className="relative group">
        <div
          className={cn(
            "flex items-center gap-2 p-1.5 rounded-lg transition-colors border border-transparent hover:border-border/60 hover:bg-accent/40",
            depth === 0 && "bg-accent/30 font-semibold mb-2",
            node.type === 'category' && "font-medium"
          )}
          style={{ paddingLeft: `${Math.max(6, depth * 18)}px` }}
        >
          {hasChildren ? (
            <button
              onClick={() => toggleCollapse(node.id)}
              className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          ) : (
            <span className="w-3.5 h-3.5 flex items-center justify-center text-muted-foreground/40">•</span>
          )}

          <span className="shrink-0">{badge.icon}</span>

          <span className="text-xs text-foreground flex-1 break-words">{node.title}</span>

          <span className={cn("text-[10px] px-1.5 py-0.2 rounded border font-mono shrink-0", badge.color)}>
            {badge.label}
          </span>

          {node.timeSec !== undefined && onSeek && (
            <button
              onClick={() => onSeek(node.timeSec!)}
              className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted hover:bg-primary hover:text-primary-foreground transition-colors shrink-0"
              title="跳转至对应播放时间点"
            >
              <Play className="w-2.5 h-2.5 fill-current" />
              <span>{formatDuration(node.timeSec)}</span>
            </button>
          )}
        </div>

        {hasChildren && !isCollapsed && (
          <div className="relative border-l border-border/30 ml-4 pl-1 space-y-0.5">
            {node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-card border border-border/50 text-xs">
        <div className="flex items-center gap-1.5">
          <FolderTree className="w-4 h-4 text-primary" />
          <span className="font-semibold text-foreground">AI 知识图谱与脑图</span>
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
            {allNodes.length} 节点
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 text-[11px] px-2" onClick={expandAll}>
            全部展开
          </Button>
          <Button variant="ghost" size="sm" className="h-6 text-[11px] px-2" onClick={collapseAll}>
            全部折叠
          </Button>
          <Button variant="outline" size="sm" className="h-6 text-[11px] px-2 gap-1" onClick={handleExportMarkdown}>
            <Download className="w-3 h-3" />
            导出脑图
          </Button>
        </div>
      </div>

      {/* Filter */}
      <div className="px-1">
        <input aria-label="搜索思维导图节点"
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="检索知识图谱知识点与代码节点..."
          className="w-full px-2.5 py-1 text-xs rounded-md bg-card border border-border/50 focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Mindmap Node Tree */}
      <div className="p-2 rounded-lg bg-card border border-border/40 max-h-[calc(100vh-14rem)] overflow-y-auto space-y-0.5">
        {renderNode(rootNode)}
      </div>
    </div>
  )
}
