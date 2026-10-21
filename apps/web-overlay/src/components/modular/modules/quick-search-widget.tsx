'use client'

import { useState } from 'react'
import { Search, ArrowRight } from 'lucide-react'

interface SearchEngine {
  id: string
  name: string
  icon: string
  buildUrl: (q: string) => string
}

const SEARCH_ENGINES: Record<string, SearchEngine> = {
  google: {
    id: 'google',
    name: 'Google',
    icon: '🔍',
    buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  },
  github: {
    id: 'github',
    name: 'GitHub',
    icon: '🐙',
    buildUrl: (q) => `https://github.com/search?q=${encodeURIComponent(q)}`,
  },
  npm: {
    id: 'npm',
    name: 'npm',
    icon: '📦',
    buildUrl: (q) => `https://www.npmjs.com/search?q=${encodeURIComponent(q)}`,
  },
  bing: {
    id: 'bing',
    name: 'Bing',
    icon: '🌐',
    buildUrl: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  },
}

export function QuickSearchWidget({ config }: { config?: Record<string, unknown> }) {
  const defaultEngineKey = (typeof config?.defaultEngine === 'string' ? config.defaultEngine : null) || 'google'
  const [selectedEngine, setSelectedEngine] = useState<string>(defaultEngineKey)
  const [query, setQuery] = useState('')

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    const engine = SEARCH_ENGINES[selectedEngine] || SEARCH_ENGINES.google
    window.open(engine.buildUrl(trimmed), '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="h-full flex flex-col justify-between p-3 select-none">
      {/* 顶部标题与引擎选择栏 */}
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium min-w-0">
          <Search className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          <span className="truncate">多引擎聚合搜索</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {Object.values(SEARCH_ENGINES).map((eng) => (
            <button
              key={eng.id}
              onClick={() => setSelectedEngine(eng.id)}
              className={`px-1.5 py-0.5 rounded text-xs transition-all flex items-center gap-0.5 ${
                selectedEngine === eng.id
                  ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>{eng.icon}</span>
              <span>{eng.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 搜索输入框 */}
      <form onSubmit={handleSearch} className="flex-1 flex flex-col justify-center py-2">
        <div className="relative">
          <input aria-label="搜索关键词"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`在 ${SEARCH_ENGINES[selectedEngine]?.name || 'Google'} 中快速搜索并直达...`}
            className="w-full text-base sm:text-xs px-3 py-2 rounded-xl border border-border/70 bg-background outline-none pr-9 focus:border-blue-500/60 shadow-xs"
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary flex items-center justify-center transition-colors"
            title="回车或点击立即搜索"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>

      {/* 底部信息 */}
      <div className="pt-1 text-xs text-muted-foreground/70 text-center font-mono">
        按 Enter 直达新标签页 · 零隐私追踪
      </div>
    </div>
  )
}
