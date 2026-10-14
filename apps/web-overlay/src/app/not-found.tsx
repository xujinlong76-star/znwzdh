'use client'

import Link from 'next/link'
import { Button } from "@/registry/new-york/ui/button"
import { Compass, Home, Search, ArrowLeft } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] p-4 text-center">
      <div className="max-w-md w-full p-8 rounded-3xl border border-border/80 glass-surface shadow-xl space-y-6 animate-in fade-in zoom-in-95 duration-200">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center mx-auto shadow-xs">
          <Compass className="w-8 h-8 animate-pulse" />
        </div>

        <div className="space-y-2">
          <div className="inline-block text-xs font-mono px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold border border-primary/20">
            404 NOT FOUND
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            页面未找到
          </h1>
          <p className="text-xs text-muted-foreground leading-relaxed">
            抱歉，您访问的路径不存在或已被移除。您可以尝试搜索或返回探索导航主干。
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Button asChild size="sm" className="w-full sm:w-auto text-xs rounded-xl gap-1.5 shadow-xs">
            <Link href="/">
              <Home className="w-3.5 h-3.5" />
              <span>返回主页</span>
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="w-full sm:w-auto text-xs rounded-xl gap-1.5">
            <Link href="/graph">
              <Search className="w-3.5 h-3.5" />
              <span>技术生态图谱</span>
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
