'use client'

/**
 * 匿名身份提示区（T1 收敛）。
 *
 * 此前 account / data / plugins / settings 四页各自手写样式雷同但文案分散的
 * 匿名提示块；统一为一个组件：结构固定（标题 + 说明 + 登录按钮 + 可选次操作），
 * 文案由调用方按页面语境传入。
 */
import Link from 'next/link'
import { LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function AnonymousHint({
  title = '当前是匿名身份',
  description,
  callbackUrl,
  secondaryHref,
  secondaryLabel,
}: {
  title?: string
  description: string
  /** 登录后回跳地址 */
  callbackUrl: string
  /** 可选次操作（如「查看本机收藏」） */
  secondaryHref?: string
  secondaryLabel?: string
}) {
  return (
    <section className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <LogIn className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button asChild size="sm" className="w-full text-xs sm:w-auto">
          <Link href={`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`}>登录 / 创建账号</Link>
        </Button>
        {secondaryHref && secondaryLabel && (
          <Button asChild variant="outline" size="sm" className="w-full text-xs sm:w-auto">
            <Link href={secondaryHref}>{secondaryLabel}</Link>
          </Button>
        )}
      </div>
    </section>
  )
}

/** 单行轻量变体：插件 / 设置页用的上下文内提示（不挡内容，仅说明语义） */
export function AnonymousHintInline({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-4 text-xs leading-relaxed text-muted-foreground sm:p-5">
      {children}
    </section>
  )
}
