'use client'

import React, { useState, useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Network, Search, ArrowRight, Play, Sparkles, Compass } from 'lucide-react'
import {
  buildConceptGraphFromVideos,
  findShortestLearningPath,
  type ConceptGraphTopology,
} from '@/lib/video-concept-graph-navigator'
import type { NavigationData } from '@/types/navigation'

interface VideoConceptGraphDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  navigationData: NavigationData
  onJumpToTarget?: (target: { bvid: string; seekSec: number }) => void
}

export function VideoConceptGraphDialog({
  open,
  onOpenChange,
  navigationData,
  onJumpToTarget,
}: VideoConceptGraphDialogProps) {
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [startConcept, setStartConcept] = useState<string>('concept_deepseek')
  const [targetConcept, setTargetConcept] = useState<string>('concept_docker')

  const topology: ConceptGraphTopology = useMemo(() => {
    return buildConceptGraphFromVideos(navigationData)
  }, [navigationData])

  const filteredNodes = useMemo(() => {
    if (!searchTerm) return topology.nodes
    return topology.nodes.filter(n =>
      n.label.toLowerCase().includes(searchTerm.toLowerCase())
    )
  }, [topology, searchTerm])

  const shortestPathResult = useMemo(() => {
    if (!startConcept || !targetConcept) return null
    return findShortestLearningPath(topology, startConcept, targetConcept)
  }, [topology, startConcept, targetConcept])

  const conceptOptions = topology.nodes.filter(n => n.type === 'concept' || n.type === 'course')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="shrink-0 pb-3 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2.5 text-base font-bold">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Network className="w-5 h-5" />
            </div>
            <div>
              <span>交互式技术概念图谱与 Dijkstra 最优学习路径穿梭机</span>
              <p className="text-[11px] font-normal text-muted-foreground mt-0.5">
                全站知识拓扑图谱 · 依赖推演 · 点击节点即时穿梭到课程对应时间点
              </p>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pt-3 pr-1 text-xs">
          {/* Path Finding Controls */}
          <div className="p-3 rounded-lg border border-border/60 bg-muted/20 space-y-2.5">
            <div className="font-semibold text-foreground flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-emerald-400" />
              <span>Dijkstra 最短前置知识演进路线规划</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label htmlFor="concept-start" className="text-[11px] text-muted-foreground">当前掌握起点:</label>
                <select id="concept-start"
                  value={startConcept}
                  onChange={e => setStartConcept(e.target.value)}
                  className="w-full h-8 px-2 rounded-md bg-background border border-border text-xs"
                >
                  {conceptOptions.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.label} ({c.type})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="concept-target" className="text-[11px] text-muted-foreground">目标掌握技能:</label>
                <select id="concept-target"
                  value={targetConcept}
                  onChange={e => setTargetConcept(e.target.value)}
                  className="w-full h-8 px-2 rounded-md bg-background border border-border text-xs"
                >
                  {conceptOptions.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.label} ({c.type})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {shortestPathResult && shortestPathResult.found && (
              <div className="p-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                <div className="font-medium text-[11px] flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" />
                  <span>推荐演进路线 ({shortestPathResult.path.length} 个节点):</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5 font-mono text-[11px]">
                  {shortestPathResult.path.map((nodeId, idx) => {
                    const node = topology.nodes.find(n => n.id === nodeId)
                    return (
                      <React.Fragment key={nodeId}>
                        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/30">
                          {node?.label || nodeId}
                        </span>
                        {idx < shortestPathResult.path.length - 1 && (
                          <ArrowRight className="w-3 h-3 text-emerald-400" />
                        )}
                      </React.Fragment>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Node Search & Jump list */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <input aria-label="搜索概念或课程"
                  type="text"
                  placeholder="搜索概念或课程..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full h-8 pl-8 pr-2 rounded-md bg-background border border-border text-xs"
                />
              </div>
              <span className="text-[11px] text-muted-foreground font-mono">
                共 {topology.nodes.length} 个节点，{topology.edges.length} 条拓扑边
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
              {filteredNodes.slice(0, 16).map(node => (
                <div
                  key={node.id}
                  className="flex items-center justify-between p-2 rounded-md bg-background border border-border/60 hover:border-emerald-500/40 transition-colors"
                >
                  <div className="min-w-0 pr-2">
                    <p className="font-medium text-foreground truncate">{node.label}</p>
                    <p className="text-[10px] text-muted-foreground">
                      类型: {node.type} · 中心度: {node.degreeCentrality}
                    </p>
                  </div>
                  {node.jumpTarget && onJumpToTarget && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        onJumpToTarget({
                          bvid: node.jumpTarget!.bvid,
                          seekSec: node.jumpTarget!.seekSec,
                        })
                        onOpenChange(false)
                      }}
                      className="h-7 px-2 text-[11px] gap-1 text-emerald-400 hover:text-emerald-300"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>穿梭</span>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
