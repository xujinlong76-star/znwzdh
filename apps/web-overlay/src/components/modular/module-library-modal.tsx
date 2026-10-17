'use client'

import React, { useState } from 'react'
import { WIDGET_REGISTRY } from '@/lib/modular/registry'
import { 
  X, 
  Search, 
  Plus, 
  LayoutGrid, 
  Sparkles,
  Clock,
  Wrench,
  TrendingUp,
  GitCompare,
  Zap,
  FileText,
  Activity,
  Bookmark,
  Folder,
  GitCommit,
  CloudSun,
  ExternalLink
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'

interface ModuleLibraryModalProps {
  isOpen: boolean
  onClose: () => void
  onAddModule: (type: string) => void
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Clock,
  Wrench,
  TrendingUp,
  GitCompare,
  Zap,
  FileText,
  Activity,
  Bookmark,
  Folder,
  Search,
  GitCommit,
  CloudSun,
  ExternalLink,
}

const CATEGORIES = [
  { id: 'all', label: '全部模块' },
  { id: 'efficiency', label: '⚡ 效率与启动' },
  { id: 'tools', label: '🛠️ 极客工具' },
  { id: 'analytics', label: '📊 趋势与分析' },
  { id: 'ai', label: '🤖 前沿与平替' },
  { id: 'content', label: '📝 内容与备忘' },
]

export function ModuleLibraryModal({ isOpen, onClose, onAddModule }: ModuleLibraryModalProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCat, setSelectedCat] = useState('all')

  if (!isOpen) return null

  const modules = Object.values(WIDGET_REGISTRY).filter((m) => {
    const matchCat = selectedCat === 'all' || m.category === selectedCat
    const matchSearch =
      m.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.description.toLowerCase().includes(searchTerm.toLowerCase())
    return matchCat && matchSearch
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl bg-background border border-border/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <LayoutGrid className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">添加独立功能模块</h2>
              <p className="text-xs text-muted-foreground">从模块库选择并添加至你的自定义排版工作台</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" aria-label="关闭" title="关闭" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* 检索与分类过滤器 */}
        <div className="p-4 border-b border-border/40 space-y-3 bg-card/40">
          <div className="relative">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="搜索模块名称或核心功能描述..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full text-xs pl-9 pr-4 py-2 rounded-xl border border-border/70 bg-background outline-none focus:border-primary/50"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCat(cat.id)}
                className={`px-2.5 py-1 rounded-full whitespace-nowrap transition-colors text-xs font-medium ${
                  selectedCat === cat.id
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* 模块列表卡片流 */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {modules.map((m) => {
            const Icon = ICON_MAP[m.icon] || Sparkles
            return (
              <div
                key={m.type}
                className="group relative p-3.5 rounded-xl border border-border/70 hover:border-primary/50 bg-card/70 hover:bg-card transition-all flex flex-col justify-between space-y-3 shadow-xs"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <span className="font-semibold text-xs text-foreground">{m.title}</span>
                    </div>
                    {m.badge && (
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded-full bg-muted border font-medium text-muted-foreground">
                        {m.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                    {m.description}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border/40 text-xs text-muted-foreground">
                  <span className="font-mono">
                    默认跨度: {m.defaultColSpan}格宽 / {m.defaultRowSpan}格高
                  </span>
                  <Button
                    size="sm"
                    className="h-6 px-2.5 text-xs rounded-lg gap-1 shadow-xs"
                    onClick={() => {
                      onAddModule(m.type)
                      onClose()
                    }}
                  >
                    <Plus className="w-3 h-3" />
                    <span>添加</span>
                  </Button>
                </div>
              </div>
            )
          })}
        </div>

        {/* 底部信息提示 */}
        <div className="px-6 py-2.5 bg-muted/30 border-t border-border/40 text-xs text-muted-foreground flex items-center justify-between">
          <span>共 {modules.length} 个可用独立业务模块</span>
          <span className="font-mono">支持自由拖拽与双轴无级缩放</span>
        </div>
      </div>
    </div>
  )
}
