'use client'

import { Button } from "@/registry/new-york/ui/button"
import { useEffect } from 'react'
import { AlertTriangle, RotateCcw, Home } from 'lucide-react'
import Link from 'next/link'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Next.js Page Error:', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] p-4 text-center">
      <div className="max-w-md w-full p-8 rounded-3xl border border-destructive/30 bg-destructive/5 glass-surface shadow-xl space-y-6 animate-in fade-in zoom-in-95 duration-200">
        <div className="w-16 h-16 rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center justify-center mx-auto shadow-xs">
          <AlertTriangle className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <div className="inline-block text-xs font-mono px-2.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-semibold border border-destructive/20">
            运行时异常
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            页面渲染遇到错误
          </h1>
          <p className="text-xs text-muted-foreground leading-relaxed break-all font-mono bg-background/60 p-2 rounded-xl border border-border/50 max-h-24 overflow-y-auto">
            {error.message || '系统遇到了未知异常，可尝试点击重试或返回主页'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Button
            onClick={() => reset()}
            size="sm"
            className="w-full sm:w-auto text-xs rounded-xl gap-1.5 shadow-xs"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>重新加载</span>
          </Button>
          <Button asChild variant="outline" size="sm" className="w-full sm:w-auto text-xs rounded-xl gap-1.5">
            <Link href="/">
              <Home className="w-3.5 h-3.5" />
              <span>返回主页</span>
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
