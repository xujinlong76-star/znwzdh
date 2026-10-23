'use client'

/**
 * 路由级错误边界。
 *
 * 之前这里把 `error.message` 直接当正文：生产环境里那通常是一行英文内部信息
 * （`Minified React error #418` / `ChunkLoadError` / `Failed to fetch`），
 * 用户既看不懂也不知道该做什么，反馈时也拿不出任何可用于定位的编号。
 *
 * 现在：文案由 `lib/error-report.ts`（纯函数，可单测）按异常类型给出
 * 「发生了什么 + 现在该做什么」，并把 Next 的 digest 与可复制的诊断信息露出来。
 */

import { Button } from "@/registry/new-york/ui/button"
import { useEffect } from 'react'
import { AlertTriangle, RotateCcw, Home, Copy, Check, RefreshCw, WifiOff, Database, Clock } from 'lucide-react'
import Link from 'next/link'
import { crashReportText, describeCrash, type CrashKind } from '@/lib/error-report'
import { reportClientError } from '@/lib/client-error-report'
import { copyText } from '@/lib/clipboard'
import { useCopyFeedback } from '@/hooks/use-copy-feedback'

const ICONS: Record<CrashKind, typeof AlertTriangle> = {
  chunk: Clock,
  network: WifiOff,
  hydration: RefreshCw,
  storage: Database,
  runtime: AlertTriangle,
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const crash = describeCrash(error, error?.digest)
  const Icon = ICONS[crash.kind]
  const { copyFeedback, reportCopy } = useCopyFeedback()

  useEffect(() => {
    console.error('Next.js Page Error:', error)
  }, [error])
    // 上报到中枢（脱敏：只发分类 + 指纹 + pathname + digest；开关默认关闭）
    reportClientError({ message: error?.message ?? String(error), digest: error?.digest })

  const copyDiagnostics = async () => {
    // copyText 永不 reject，返回值即真实结果：失败时把按钮状态还原成"未复制"，
    // 并保留下方可手动选中的详情块作为兜底
    const result = await copyText(crashReportText(crash))
    reportCopy(result)
  }

  return (
    <main id="main-content" className="flex flex-col items-center justify-center min-h-[80vh] p-4 text-center">
      <div className="max-w-md w-full p-8 rounded-3xl border border-destructive/30 bg-destructive/5 glass-surface shadow-xl space-y-6 animate-in fade-in zoom-in-95 duration-200">
        <div className="w-16 h-16 rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center justify-center mx-auto shadow-xs">
          <Icon className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <div className="inline-block text-xs font-mono px-2.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-semibold border border-destructive/20">
            {crash.badge}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{crash.title}</h1>
          <p className="text-xs text-muted-foreground leading-relaxed">{crash.hint}</p>
          {crash.digest && (
            <p className="text-xs text-muted-foreground">
              错误编号{' '}
              <code className="px-1.5 py-0.5 rounded-md bg-background/60 border border-border/60 font-mono select-all">
                {crash.digest}
              </code>
              （反馈时请一并提供）
            </p>
          )}
        </div>

        {(crash.detail || crash.digest) && (
          <details className="text-left rounded-xl border border-border/50 bg-background/60 overflow-hidden">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
              错误详情（反馈时复制给站长）
            </summary>
            <pre className="px-3 pb-3 text-[11px] leading-relaxed font-mono text-muted-foreground whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
              {crashReportText(crash)}
            </pre>
          </details>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          {crash.retryable && (
            <Button
              onClick={() => reset()}
              size="sm"
              className="w-full sm:w-auto text-xs rounded-xl gap-1.5 shadow-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>重新加载</span>
            </Button>
          )}
          <Button asChild variant="outline" size="sm" className="w-full sm:w-auto text-xs rounded-xl gap-1.5">
            <Link href="/">
              <Home className="w-3.5 h-3.5" />
              <span>返回主页</span>
            </Link>
          </Button>
          {(crash.detail || crash.digest) && (
            <Button
              onClick={() => void copyDiagnostics()}
              variant="ghost"
              size="sm"
              title={copyFeedback.state === 'failed' ? `复制失败：${copyFeedback.reason}` : '复制诊断信息'}
              className="w-full sm:w-auto text-xs rounded-xl gap-1.5"
            >
              {copyFeedback.state === 'copied' ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>
                {copyFeedback.state === 'copied'
                  ? '已复制'
                  : copyFeedback.state === 'failed'
                    ? '复制失败'
                    : '复制诊断信息'}
              </span>
              <span role="status" className="sr-only">
                {copyFeedback.reason ?? ''}
              </span>
            </Button>
          )}
        </div>
      </div>
    </main>
  )
}
