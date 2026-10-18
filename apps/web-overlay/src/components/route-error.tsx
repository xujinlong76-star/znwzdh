'use client'

/**
 * 路由级错误边界的共享实现。
 *
 * 全局 `app/error.tsx` 已经做得很完整（分类、诊断编号、复制、重试），
 * 但它是**整页级**的：`/hot`、`/site/[id]` 这类页面一旦抛错，用户会被
 * 踢出整个外壳（导航消失），只能回首页重来。
 *
 * 这里给每条路由一个**局部**兜底：保留站内外壳，只把出错的内容区替换成
 * 「发生了什么 + 重试 + 返回」，文案复用 `lib/error-report` 的同一套判定，
 * 因此不会出现两套口径。
 */
import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RotateCcw, Home } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { describeCrash } from '@/lib/error-report'
import { reportClientError } from '@/lib/client-error-report'

export function RouteError({
  error,
  reset,
  scope,
}: {
  error: Error & { digest?: string }
  reset: () => void
  /** 出错区域的名字，用于文案（如「热度榜」） */
  scope?: string
}) {
  const crash = describeCrash(error, error?.digest)

  useEffect(() => {
    // 保留控制台现场：生产环境没有 source map 时，digest 是唯一能对上服务端日志的线索
    console.error('[route-error]', scope ?? '', error)
  }, [error, scope])
    // 上报到中枢（脱敏：只发分类 + 指纹 + pathname + digest；开关默认关闭）
    reportClientError({ message: error?.message ?? String(error), digest: error?.digest })

  return (
    <div className="container mx-auto px-4 py-16 max-w-xl" role="alert">
      <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-6 space-y-4 text-center">
        <div className="mx-auto w-12 h-12 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center justify-center">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-semibold">
            {scope ? scope + '加载失败' : '这部分内容加载失败'}
          </h2>
          <p className="text-sm font-medium">{crash.title}</p>
          <p className="text-sm text-muted-foreground">{crash.hint}</p>
        </div>
        {error?.digest && (
          <p className="text-[11px] font-mono text-muted-foreground/80">诊断编号：{error.digest}</p>
        )}
        <div className="flex items-center justify-center gap-2 pt-1">
          {crash.retryable && (
            <Button size="sm" onClick={reset} className="gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" />
              重试
            </Button>
          )}
          <Button size="sm" variant="outline" asChild className="gap-1.5">
            <Link href="/">
              <Home className="w-3.5 h-3.5" />
              返回首页
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
