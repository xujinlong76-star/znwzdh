'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Rss, ExternalLink, RefreshCw, Sparkles, Clock } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'

interface FeedItem {
  id: string
  title: string
  link: string
  publishedAt?: string
  source?: string
}

interface RssFeedWidgetProps {
  config?: {
    feedUrl?: string
    title?: string
    limit?: number
  }
}

const PRESET_FEEDS: FeedItem[] = [
  {
    id: 'f1',
    title: 'React 19.2 正式发布：全面增强 Server Actions 与异步流水线',
    link: 'https://react.dev/blog',
    publishedAt: '10 分钟前',
    source: 'React Team',
  },
  {
    id: 'f2',
    title: 'Next.js 15.5 性能分析报告：Turbopack 编译提速 42%',
    link: 'https://nextjs.org/blog',
    publishedAt: '35 分钟前',
    source: 'Vercel',
  },
  {
    id: 'f3',
    title: 'Rust 2026 Edition 关键特性路线图公布',
    link: 'https://blog.rust-lang.org',
    publishedAt: '2 小时前',
    source: 'Rust Blog',
  },
  {
    id: 'f4',
    title: 'SQLite 推出轻量向量扩展增强包，加速边缘端 AI 落地',
    link: 'https://sqlite.org',
    publishedAt: '4 小时前',
    source: 'SQLite News',
  },
  {
    id: 'f5',
    title: 'TypeScript 5.8 候选版：支持条件导入类型推断',
    link: 'https://devblogs.microsoft.com/typescript',
    publishedAt: '6 小时前',
    source: 'TypeScript',
  },
]

export function RssFeedWidget({ config }: RssFeedWidgetProps) {
  const title = config?.title || '技术动态与社区早报'
  const limit = Math.min(10, Math.max(3, config?.limit || 5))

  const [items, setItems] = useState<FeedItem[]>(PRESET_FEEDS.slice(0, limit))
  const [loading, setLoading] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date())

  const handleRefresh = useCallback(() => {
    setLoading(true)
    setTimeout(() => {
      // 模拟微洗牌最新流
      const shuffled = [...PRESET_FEEDS].sort(() => 0.5 - Math.random())
      setItems(shuffled.slice(0, limit))
      setLastRefreshed(new Date())
      setLoading(false)
    }, 400)
  }, [limit])

  return (
    <div className="flex flex-col h-full justify-between p-3.5 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <Rss className="w-3.5 h-3.5" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-foreground truncate max-w-[140px]">{title}</h4>
            <span className="text-[10px] text-muted-foreground font-mono">聚合动态流</span>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={handleRefresh}
          disabled={loading}
          title="刷新动态"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="space-y-1.5 flex-1 overflow-y-auto pr-1">
        {items.map((item) => (
          <a
            key={item.id}
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="group block p-2 rounded-lg bg-muted/30 hover:bg-muted/60 border border-border/40 hover:border-border transition-all"
          >
            <div className="flex items-start justify-between gap-1.5">
              <span className="text-xs font-medium text-foreground group-hover:text-primary transition-colors line-clamp-1 leading-snug">
                {item.title}
              </span>
              <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-primary shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
              {item.source && <span className="font-semibold text-amber-600 dark:text-amber-400">{item.source}</span>}
              <span className="flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />
                {item.publishedAt}
              </span>
            </div>
          </a>
        ))}
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/30">
        <span>已聚合 {items.length} 篇最新动态</span>
        <span>更新于 {lastRefreshed.toLocaleTimeString()}</span>
      </div>
    </div>
  )
}
