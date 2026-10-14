'use client'

import { useState } from 'react'
import { GitCompare, ExternalLink, ArrowRight } from 'lucide-react'
import Link from 'next/link'

const ALTERNATIVE_PAIRS = [
  { commercial: 'Vercel', openSource: 'Coolify', domain: '自托管 PaaS', reason: '开源、支持自建 VPS、零月费' },
  { commercial: 'Figma', openSource: 'Penpot', domain: '矢量设计协作', reason: 'Web 标准 SVG、自托管私有部署' },
  { commercial: 'Notion', openSource: 'AppFlowy', domain: '知识库管理', reason: '本地优先、数据 100% 自主可控' },
  { commercial: 'Docker Desktop', openSource: 'OrbStack', domain: '轻量容器环境', reason: '启动极快、内存开销减少 80%' },
  { commercial: 'Postman', openSource: 'Bruno', domain: 'API 调试协作', reason: 'Git 版本控制友好、纯离线存储' },
]

export function HyperbolicRadarWidget() {
  const [selectedPair, setSelectedPair] = useState(ALTERNATIVE_PAIRS[0])

  return (
    <div className="h-full flex flex-col justify-between p-3 select-none">
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium">
          <GitCompare className="w-3.5 h-3.5 text-purple-500" />
          <span>双曲平替与开源雷达</span>
        </div>
        <Link href="/graph" className="text-xs text-primary hover:underline flex items-center gap-0.5">
          <span>拓扑图谱</span>
          <ExternalLink className="w-2.5 h-2.5" />
        </Link>
      </div>

      <div className="flex-1 flex flex-col justify-between py-2 min-h-0 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-center">
            <span className="text-xs text-muted-foreground block font-mono">商业标杆</span>
            <span className="text-xs font-bold text-foreground">{selectedPair.commercial}</span>
          </div>
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-center">
            <span className="text-xs text-emerald-600 dark:text-emerald-400 block font-mono">平替 / 开源推荐</span>
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center justify-center gap-1">
              <span>{selectedPair.openSource}</span>
            </span>
          </div>
        </div>

        <div className="bg-muted/40 p-2 rounded-lg text-center space-y-0.5">
          <div className="text-xs font-mono text-purple-600 dark:text-purple-400 font-semibold">
            领域：{selectedPair.domain}
          </div>
          <div className="text-xs text-muted-foreground leading-relaxed">
            核心优势：{selectedPair.reason}
          </div>
        </div>

        {/* 快速切换条 */}
        <div className="flex items-center justify-center gap-1 flex-wrap">
          {ALTERNATIVE_PAIRS.map((pair) => (
            <button
              key={pair.commercial}
              onClick={() => setSelectedPair(pair)}
              className={`px-1.5 py-0.5 rounded text-xs transition-all ${
                selectedPair.commercial === pair.commercial
                  ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400 font-semibold border border-purple-500/30'
                  : 'bg-muted/30 text-muted-foreground hover:text-foreground'
              }`}
            >
              {pair.openSource}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-1 text-xs text-muted-foreground/70 text-center font-mono">
        Poincaré 双曲空间几何平替推演
      </div>
    </div>
  )
}
